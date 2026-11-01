<script lang="ts">
  import { addCombatants, addMonsters, lairCombatant, MAX_COMBATANTS, pcCombatant, prev, rollInit, setInit } from '../../lib/combat/combat.ts';
  import { endCombat, turn, updateCombat } from '../../lib/combat/store.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { saveCampaign } from '../../lib/store.svelte.ts';
  import type { Campaign, CampaignSettings, Character, Combat, MonsterDef } from '../../lib/types.ts';
  import { act } from './act.ts';
  import CombatantRow from './CombatantRow.svelte';
  import MonsterSearch from './MonsterSearch.svelte';
  import { currentRun, reorder, sortAround } from './order.ts';

  let { campaign, combat, chars, pool, index, reload }: {
    campaign: Campaign; combat: Combat | undefined; chars: Character[]; pool: MonsterDef[]; index: ContentIndex | undefined; reload: () => Promise<void>;
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
  const status = $derived(round === 0 ? 'Setup' : `Round ${round}${turnName ? ` · ${turnName}'s turn` : ''}`);

  const charById = $derived(new Map(chars.map((c) => [c.id, c])));
  const monById = $derived(new Map(pool.map((m) => [m.id, m])));
  const outside = $derived(chars.filter((c) => !list.some((x) => x.characterId === c.id)));
  let pickChar = $state('');

  const run = async (op: () => Promise<unknown>) => { await act(op); await reload(); };
  const edit = (fn: (c: Combat) => Combat) => run(() => updateCombat(cid, fn));
  const pcs = (cs: Character[]) => cs.map((c) => pcCombatant(c, computeSheet(c, { settings, viewer: 'dm' })));

  function setModule(k: Mod, on: boolean) {
    // Final M3: from the stored campaign, so a second quick toggle does not undo the first.
    void act(async () => {
      const fresh = await db.campaigns.get(cid);
      if (fresh) await saveCampaign({ ...fresh, settings: { ...fresh.settings, initiativeModules: { ...fresh.settings.initiativeModules, [k]: on } } });
    });
  }

  const rollUnrolled = () => edit((c) => {
    let out = c;
    for (const x of c.combatants) if (x.kind !== 'pc' && out.combatants.find((y) => y.id === x.id)?.init === undefined) out = setInit(out, x.id, rollInit(x.initMod));
    return out;
  });

  function end() {
    if (confirm('End this combat? The order, monster HP and condition durations are cleared.')) void run(() => endCombat(cid));
  }

  // Native drag and drop for the mouse (Move up / Move down are the keyboard and touch way).
  let dragged: string | undefined;
</script>

<section aria-labelledby="tracker-h">
  <h2 id="tracker-h">{round === 0 ? 'Setup' : `Round ${round}`}</h2>
  <p class="sr-only" aria-live="polite">{status}</p>

  <div class="row">
    {#if round === 0}
      <button type="button" class="primary" disabled={!list.length} onclick={() => run(() => turn(cid, 'start'))}>Start</button>
    {:else}
      <button type="button" onclick={() => edit(prev)}>Previous turn</button>
      <button type="button" class="primary" onclick={() => run(() => turn(cid, 'next'))}>Next turn</button>
    {/if}
    {#if combat}<button type="button" class="danger" onclick={end}>End combat</button>{/if}
  </div>

  <div class="row">
    <details class="modules">
      <summary>Modules</summary>
      {#each MODULES as [k, label] (k)}
        <label class="check"><input type="checkbox" checked={mods[k]} onchange={(e) => setModule(k, e.currentTarget.checked)} /> {label}</label>
      {/each}
    </details>
    <label class="check"><input type="checkbox" checked={combat?.groupMonsters ?? false} onchange={(e) => { const on = e.currentTarget.checked; void edit((c) => ({ ...c, groupMonsters: on })); }} /> Group identical monsters</label>
  </div>
  <div class="row">
    <button type="button" disabled={list.length < 2} onclick={() => edit(sortAround)}>Sort</button>
    <button type="button" disabled={!list.some((x) => x.kind !== 'pc' && x.init === undefined)} onclick={rollUnrolled}>Roll unrolled</button>
  </div>

  <h3>Add combatants</h3>
  {#if full}<p class="muted">A fight holds at most {MAX_COMBATANTS} combatants.</p>{/if}
  <div class="row">
    <button type="button" disabled={!outside.length || full} onclick={() => edit((c) => addCombatants(c, pcs(outside)))}>Add party</button>
    <label class="row"><span>Character</span>
      <select bind:value={pickChar} disabled={!outside.length}>
        <option value="">Choose…</option>
        {#each outside as c (c.id)}<option value={c.id}>{c.name || 'Unnamed'}</option>{/each}
      </select>
    </label>
    <button type="button" disabled={!pickChar || full} onclick={() => { const c = charById.get(pickChar); pickChar = ''; if (c) void edit((x) => addCombatants(x, pcs([c]))); }}>Add character</button>
    {#if mods.lair && !list.some((x) => x.kind === 'lair')}
      <button type="button" disabled={full} onclick={() => edit((c) => addCombatants(c, [lairCombatant()]))}>Add lair actions</button>
    {/if}
  </div>
  <MonsterSearch {pool} label="Add monster" onadd={(m, count) => edit((c) => addMonsters(c, [{ monster: m, count }], settings.monsterHp))} />

  {#if list.length}
    <ol class="plain list">
      {#each list as x, i (x.id)}
        <li draggable="true"
          ondragstart={(e) => { dragged = x.id; e.dataTransfer?.setData('text/plain', x.id); }}
          ondragover={(e) => e.preventDefault()}
          ondrop={(e) => { e.preventDefault(); const id = dragged; dragged = undefined; if (id && id !== x.id) void edit((c) => reorder(c, id, i)); }}>
          <CombatantRow {x} {i} count={list.length} combatants={list} current={current.has(x.id)} ch={x.characterId ? charById.get(x.characterId) : undefined}
            monster={x.monsterId ? monById.get(x.monsterId) : undefined} {index} {settings} {cid} {edit} {run} />
        </li>
      {/each}
    </ol>
  {:else}
    <p class="muted">No combatants yet.</p>
  {/if}
</section>

<style>
  .modules {
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.3rem 0.6rem;
  }

  .modules[open] {
    display: flex;
    flex-direction: column;
  }

  .list {
    margin: 0.75rem 0;
  }

  h3 {
    margin: 1rem 0 0.3rem;
  }
</style>
