<script lang="ts">
  import { addCombatants, addMonsters, lairCombatant, MAX_COMBATANTS, pcCombatant, prev, rollInit, setInit } from '../../lib/combat/combat.ts';
  import { deleteEncounter, endCombat, saveFight, saveFightAs, turn, updateCombat } from '../../lib/combat/store.ts';
  import { budgetApplies, budgetFeet, combatantForToken, effectiveSpeed, monsterSpeed, moveSpeed, resetMovement, usedFeet } from '../../lib/combat/movement.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { session } from '../../lib/sync/session.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { saveCampaign } from '../../lib/store.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, CampaignSettings, Character, Combat, Combatant, Encounter, MonsterDef, Scene } from '../../lib/types.ts';
  import Drawer from '../kit/Drawer.svelte';
  import Menu, { type MenuItem } from '../kit/Menu.svelte';
  import Tabs from '../kit/Tabs.svelte';
  import Workspace from '../kit/Workspace.svelte';
  import { act } from './act.ts';
  import CombatantPanel from './CombatantPanel.svelte';
  import CombatantRow from './CombatantRow.svelte';
  import Encounters from './Encounters.svelte';
  import FightDialog, { type FightAnswer, type FightAsk } from './FightDialog.svelte';
  import MonsterSearch from './MonsterSearch.svelte';
  import { currentRun, reorder, sortAround } from './order.ts';

  let { campaign, combat, chars, pool, index, encounters, reload }: {
    campaign: Campaign; combat: Combat | undefined; chars: Character[]; pool: MonsterDef[]; index: ContentIndex | undefined; encounters: Encounter[];
    reload: () => Promise<void>;
  } = $props();

  type Mod = keyof CampaignSettings['initiativeModules'];
  const MODULES: [Mod, string][] = [['hp', 'HP'], ['conditions', 'Conditions'], ['concentration', 'Concentration'], ['deathSaves', 'Death saves'], ['legendary', 'Legendary actions'], ['lair', 'Lair actions'], ['reactions', 'Reactions']];

  const cid = $derived(campaign.id);
  const settings = $derived(campaign.settings);
  const mods = $derived(settings.initiativeModules);
  const list = $derived(combat?.combatants ?? []);
  const round = $derived(combat?.round ?? 0);
  const full = $derived(list.length >= MAX_COMBATANTS);

  const current = $derived.by(() => {
    const r = currentRun(combat);
    return new Set(r ? list.slice(r[0], r[1] + 1).map((x) => x.id) : []);
  });
  const turnName = $derived(list.find((x) => x.id === combat?.turn)?.name);

  /** Speed after conditions, as the host counts it (a PC's player-view walk, a monster's stat block); undefined: no readout. */
  function speedOf(x: Combatant): number | undefined {
    let walk: number | undefined, conds = x.conditions ?? [], exh = 0;
    const ch = x.characterId ? charById.get(x.characterId) : undefined;
    if (ch) { try { walk = moveSpeed(computeSheet(ch, { settings, viewer: 'player' }).speed); } catch { /* a damaged character: no readout */ } conds = ch.state.conditions; exh = ch.state.exhaustion; }
    else if (x.monsterId) { const m = monById.get(x.monsterId); walk = m && monsterSpeed(m, x.conditions ?? []); }
    return walk === undefined ? undefined : effectiveSpeed(walk, conds, exh);
  }
  // Movement used is the distance from the turn's origin to where the token stands, so the tokens' scenes are read too (the shown one first).
  let scenes: Scene[] = $state.raw([]);
  $effect(() => {
    void session.rev; void combat;
    const id = cid;
    db.scenes.list(id).then((s) => { if (id === cid) scenes = s.sort((a, b) => Number(!!b.shown) - Number(!!a.shown)); }, (e) => console.warn(e));
  });
  /** The combatant's token and its scene's grid (the shown scene first), if any. */
  const tokenOf = (c: Combat, id: string) => {
    for (const s of scenes) { const t = s.tokens.find((t) => combatantForToken(c, t)?.id === id); if (t) return { at: { x: t.x, y: t.y }, grid: s.grid }; }
  };
  // Movement budget (spec 1): the current run (a grouped monster turn is several, each on its own budget). The readout is its first
  // combatant's; Reset movement applies to every member. A Dash is an action now, taken from the map's Turn panel.
  const mover = $derived.by(() => {
    const r = currentRun(combat);
    if (!r || !combat || !budgetApplies(combat, settings)) return undefined;
    const c = combat;
    const run = list.slice(r[0], r[1] + 1).flatMap((x) => {
      const speed = speedOf(x), tk = tokenOf(c, x.id);
      return speed === undefined ? [] : [{ id: x.id, speed, used: usedFeet(c.movement?.[x.id], tk?.at, tk?.grid, settings.diagonal) }];
    });
    if (!run.length) return undefined;
    const m = c.movement?.[run[0].id];
    return { run, ids: run.map((x) => x.id), left: Math.max(0, budgetFeet(run[0].speed, m) - run[0].used), dashes: m?.dashes ?? 0 };
  });
  const resetRun = (c: Combat, ids: string[]): Combat => ids.reduce(resetMovement, c);
  const status = $derived(round === 0 ? 'Setup' : `Round ${round}${turnName ? ` · ${turnName}'s turn` : ''}`);

  const charById = $derived(new Map(chars.map((c) => [c.id, c])));
  /** Players' characters in the fight still without initiative: the party rolls its own, from a pop-up the DM sends. */
  const unrolled = $derived(list.filter((x) => x.kind === 'pc' && x.init === undefined && !!charById.get(x.characterId ?? '')?.ownerId));
  const monById = $derived(new Map(pool.map((m) => [m.id, m])));
  const outside = $derived(chars.filter((c) => !list.some((x) => x.characterId === c.id)));
  let pickChar = $state('');

  const run = async (op: () => Promise<unknown>) => { await act(op); await reload(); };
  const edit = (fn: (c: Combat) => Combat) => run(() => updateCombat(cid, fn));
  /** One roster: who joins the fight also gets a token on its scene (none yet: the map places them once one is made). */
  const join = (fn: (c: Combat) => Combat) => run(async () => {
    await updateCombat(cid, fn);
    const p = await (await import('../../lib/map/store.ts')).placeUnplaced(cid, (id) => monById.get(id));
    if (p.why === 'full') toast(`The scene is full (200 tokens): ${p.placed ? `only ${p.placed} placed` : 'no tokens placed'}.`, true);
  });
  const pcs = (cs: Character[]) => cs.map((c) => pcCombatant(c, computeSheet(c, { settings, viewer: 'dm' })));

  // Toggles save one after another, each from the stored campaign, so quick toggles never overwrite each other.
  let moduleSaves: Promise<unknown> = Promise.resolve();
  function setModule(k: Mod, on: boolean) {
    moduleSaves = moduleSaves.then(() => act(async () => {
      const fresh = await db.campaigns.get(cid);
      if (fresh) await saveCampaign({ ...fresh, settings: { ...fresh.settings, initiativeModules: { ...fresh.settings.initiativeModules, [k]: on } } });
    }));
  }

  const rollUnrolled = () => edit((c) => {
    let out = c;
    for (const x of c.combatants) if (x.kind !== 'pc' && out.combatants.find((y) => y.id === x.id)?.init === undefined) out = setInit(out, x.id, rollInit(x.initMod));
    return out;
  });

  // Saved fights: one dialog for naming, "save first?" (Encounters) and End combat on a linked fight.
  let fightDialog: ReturnType<typeof FightDialog> | undefined = $state();
  const ask = (k: FightAsk): Promise<FightAnswer> => fightDialog?.ask(k) ?? Promise.resolve(undefined);

  async function saveAs() {
    const a = await ask('name');
    if (typeof a === 'object') await run(async () => { const e = await saveFightAs(cid, a.name); toast(`Saved as the encounter “${e.name}”.`); });
  }

  async function end() {
    // A linked fight: keep its encounter (saved as it is now) or delete it. A failed save stops here, so the fight is not lost.
    const linked = combat?.encounterId;
    let then: (() => Promise<unknown>) | undefined;
    if (linked) {
      const a = await ask('end');
      if (a === 'keep') then = () => saveFight(cid);
      else if (a === 'delete') then = () => deleteEncounter(cid, linked);
      else return;
    } else if (!confirm('End this combat? The order, monster HP and condition durations are cleared.')) return;
    void run(async () => {
      await then?.(); // a kept encounter is saved with its map first
      // One roster: the fight's monsters leave the map with it. A failure there must not keep the fight going.
      try { await (await import('../../lib/map/store.ts')).clearFightTokens(cid); } catch (e) { console.warn(e); toast("The fight's monsters stayed on the map.", true); }
      await endCombat(cid);
    });
  }

  // Native drag and drop for the mouse (Move up / Move down are the keyboard and touch way).
  let dragged: string | undefined;

  // The row shown in the panel, and the panel tab. Phones: the sheet shows while a row is picked or Encounters was asked for.
  let selectedId: string | undefined = $state();
  let tab = $state('combatant');
  let sheet = $state(false);
  const sel = $derived(list.find((x) => x.id === selectedId));
  const select = (id: string) => { selectedId = id; tab = 'combatant'; };

  // A concentration prompt (Con save DC after damage, or "ends at 0 HP") stays with its combatant while another row is picked.
  type Prompt = { dc?: number; lost?: boolean };
  let prompts: Record<string, Prompt> = $state({});
  const setPrompt = (id: string, p: Prompt) => { prompts[id] = p; };

  const addItems = $derived<MenuItem[]>([
    { label: 'Add party', disabled: !outside.length || full, onselect: () => void join((c) => addCombatants(c, pcs(outside))) },
    ...(mods.lair && !list.some((x) => x.kind === 'lair')
      ? [{ label: 'Add lair actions', disabled: full, onselect: () => void edit((c) => addCombatants(c, [lairCombatant()])) }]
      : []),
  ]);

  const moreItems = $derived<MenuItem[]>([
    { label: 'Group identical monsters', checked: combat?.groupMonsters ?? false, onselect: () => { const on = !(combat?.groupMonsters ?? false); void edit((c) => ({ ...c, groupMonsters: on })); } },
    { label: 'Sort', disabled: list.length < 2, onselect: () => void edit(sortAround) },
    { label: 'Roll unrolled', disabled: !list.some((x) => x.kind !== 'pc' && x.init === undefined), onselect: () => void rollUnrolled() },
    { label: 'Encounters', onselect: () => { tab = 'encounters'; sheet = true; } },
    ...(mover && combat ? [
      { separator: true } as const,
      { label: 'Reset movement', disabled: resetRun(combat, mover.ids) === combat, onselect: () => { const { ids } = mover; void edit((c) => resetRun(c, ids)); } },
    ] : []),
    ...(combat ? [{ separator: true } as const, { label: 'Save as encounter…', onselect: () => void saveAs() }] : []),
    ...(combat?.encounterId ? [{ label: 'Save encounter', onselect: () => void run(async () => { if (await saveFight(cid)) toast('Encounter saved.'); }) }] : []),
    ...(combat ? [{ separator: true } as const, { label: 'End combat', danger: true, onselect: () => void end() }] : []),
  ]);
</script>

<Workspace panelLabel={tab === 'encounters' ? 'Encounters' : sel?.name ?? 'Combatant'} open={sel !== undefined || sheet}
  onclose={() => { selectedId = undefined; sheet = false; }}>
  <section aria-labelledby="tracker-h">
    <div class="turnbar">
      <h2 id="tracker-h" class="round">
        {#if round === 0}<span class="caption">Setup</span>{:else}<span class="caption">Round</span> <span class="num">{round}</span>{/if}
      </h2>
      <span class="who">{turnName && round ? `${turnName}'s turn` : `${list.length} ${list.length === 1 ? 'combatant' : 'combatants'}`}</span>
      {#if mover}
        <span class="left num">{mover.left} ft left{mover.dashes ? ` · Dashed ×${mover.dashes}` : ''}</span>
      {/if}
      <div class="acts">
        {#if round === 0}
          {#if unrolled.length}
            <button type="button" disabled={combat?.askInit} onclick={() => edit((c) => ({ ...c, askInit: true }))}>{combat?.askInit ? `Waiting for ${unrolled.map((x) => x.name).join(', ')}` : 'Ask the party for initiative'}</button>
          {/if}
          <button type="button" class="primary" disabled={!list.length} onclick={() => run(() => turn(cid, 'start'))}>Start</button>
        {:else}
          <button type="button" aria-label="Previous turn" onclick={() => edit(prev)}>◀ Prev</button>
          <button type="button" class="primary" aria-label="Next turn" onclick={() => run(() => turn(cid, 'next'))}>Next turn ▶</button>
        {/if}
        <Menu label="+ Add" ariaLabel="Add combatants" items={addItems} align="end">
          {#snippet children()}
            <div class="add">
              {#if full}<p class="muted">A fight holds at most {MAX_COMBATANTS} combatants.</p>{/if}
              <label class="fld"><span class="caption">Character</span>
                <select bind:value={pickChar} disabled={!outside.length}>
                  <option value="">Choose…</option>
                  {#each outside as c (c.id)}<option value={c.id}>{c.name || 'Unnamed'}</option>{/each}
                </select>
              </label>
              <button type="button" disabled={!pickChar || full} onclick={() => { const c = charById.get(pickChar); pickChar = ''; if (c) void join((x) => addCombatants(x, pcs([c]))); }}>Add character</button>
              <MonsterSearch {pool} label="Add monster" onadd={(m, count) => join((c) => addMonsters(c, [{ monster: m, count }], settings.monsterHp))} />
            </div>
          {/snippet}
        </Menu>
        <Menu label="⋯" ariaLabel="More combat actions" caret={false} align="end" items={moreItems}>
          {#snippet children()}
            <Drawer title="Modules">
              {#snippet summary()}<span class="num">{MODULES.filter(([k]) => mods[k]).length}</span> on{/snippet}
              {#each MODULES as [k, label] (k)}
                <label class="check"><input type="checkbox" checked={mods[k]} onchange={(e) => setModule(k, e.currentTarget.checked)} /> {label}</label>
              {/each}
            </Drawer>
          {/snippet}
        </Menu>
      </div>
    </div>
    <p class="sr-only" aria-live="polite">{status}</p>

    {#if list.length}
      <ol class="list">
        {#each list as x, i (x.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (the name button is the keyboard way) -->
          <li draggable="true" class:current={current.has(x.id)} class:selected={x.id === selectedId} aria-current={current.has(x.id) ? 'true' : undefined}
            onclick={() => select(x.id)}
            ondragstart={(e) => { dragged = x.id; e.dataTransfer?.setData('text/plain', x.id); }}
            ondragover={(e) => e.preventDefault()}
            ondrop={(e) => { e.preventDefault(); const id = dragged; dragged = undefined; if (id && id !== x.id) void edit((c) => reorder(c, id, i)); }}>
            <CombatantRow {x} {i} count={list.length} current={current.has(x.id)} selected={x.id === selectedId}
              ch={x.characterId ? charById.get(x.characterId) : undefined} {settings} prompt={prompts[x.id]} {edit} onselect={() => select(x.id)} />
          </li>
        {/each}
      </ol>
    {:else}
      <p class="muted empty">No combatants yet. Use “+ Add” to bring in the party and monsters.</p>
    {/if}
  </section>

  {#snippet panel()}
    <Tabs label="Combat panel" tabs={[{ id: 'combatant', label: sel?.name ?? 'Combatant' }, { id: 'encounters', label: 'Encounters', count: encounters.length }]} bind:value={tab}>
      {#snippet panel(id)}
        {#if id === 'encounters'}
          <Encounters {campaign} {combat} {encounters} {pool} {reload} {ask} />
        {:else if sel}
          {#key sel.id}
            <CombatantPanel x={sel} i={list.indexOf(sel)} count={list.length} combatants={list} current={current.has(sel.id)}
              ch={sel.characterId ? charById.get(sel.characterId) : undefined} monster={sel.monsterId ? monById.get(sel.monsterId) : undefined}
              {index} {settings} {cid} {edit} {run} prompt={prompts[sel.id]} {setPrompt} />
          {/key}
        {:else}
          <p class="muted">Pick a combatant to see its hit points, conditions and notes.</p>
        {/if}
      {/snippet}
    </Tabs>
  {/snippet}
</Workspace>
<FightDialog bind:this={fightDialog} />

<style>
  .turnbar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.9rem;
    margin: 0 0 0.5rem;
    padding: 0.55rem 0;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }

  .round {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0;
    font-size: 1rem;
    font-weight: 400;
  }

  .round .num {
    font-size: 1.35rem;
    color: var(--text-strong);
  }

  .who {
    flex: 1 1 8rem;
    min-width: 0;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .left {
    color: var(--text-strong);
    white-space: nowrap;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 18rem;
    max-width: 100%;
  }

  .add p {
    margin: 0;
  }

  .fld {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    border-bottom: 1px solid var(--line);
    border-radius: var(--radius);
    cursor: pointer;
  }

  li:hover {
    background: color-mix(in srgb, var(--raised) 45%, transparent);
  }

  li.current {
    background: var(--raised);
    box-shadow: inset 2px 0 var(--accent);
  }

  li.selected {
    outline: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
    outline-offset: -1px;
  }

  .empty {
    margin: 1.5rem 0;
  }

  @media (min-width: 768px) {
    .turnbar {
      top: var(--topbar-h);
    }
  }
</style>
