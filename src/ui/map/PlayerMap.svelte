<script lang="ts">
  // The players' live map. A joined campaign shows session.scene (as the DM last sent it) and lets the player drag their own token on
  // their turn: the drop moves it here at once, then goes to the DM, whose next scene replaces it (a refusal snaps it back). On the
  // DM's device in Player view (R12) the same player scene is built locally, read-only.
  import { db } from '../../lib/db.ts';
  import { feetBetween, snap, type Pt } from '../../lib/map/grid.ts';
  import { untrack } from 'svelte';
  import { aimPlan, judge, type AimPlan } from '../../lib/combat/aiming.ts';
  import { targetingOn, type Pickable, type Toggle } from '../../lib/combat/targeting.ts';
  import { rollAim, reveal, type AimRoll } from './aimRoll.ts';
  import { actionsForPlayers, arrowsOn, type DeclaredAction } from '../../lib/map/actions.ts';
  import { tokenColor } from '../../lib/map/scene.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { currentActor } from '../../lib/sync/project.ts';
  import { sceneForPlayers, type PlayerScene } from '../../lib/sync/scene.ts';
  import { clearDeclared, declareAction, sendDrag, sendEndTurn, sendUse, sendMove, session } from '../../lib/sync/session.svelte.ts';
  import { budgetFeet, effectiveSpeed, originOf, remainingFeet } from '../../lib/combat/movement.ts';
  import { pcActions, slotsLeft, type TurnAction } from '../../lib/combat/turnActions.ts';
  import { featureList } from '../../lib/character/play.ts';
  import type { Campaign, Character, Combatant } from '../../lib/types.ts';
  import MapCanvas from './MapCanvas.svelte';
  import TurnPanel from '../turn/TurnPanel.svelte';
  import type { SpellArea } from '../../lib/combat/spellText.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import Drawer from '../kit/Drawer.svelte';
  import Workspace from '../kit/Workspace.svelte';

  let { campaign }: { campaign: Campaign } = $props();

  const joined = $derived(campaign.sync?.role === 'player');
  const settings = $derived(campaign.settings);
  let chars: Character[] = $state.raw([]);
  let local: PlayerScene | undefined = $state.raw();
  let error = $state('');
  let selected: string[] = $state([]);
  /** The optimistic drop, until the next scene from the DM. */
  let pending: { of: PlayerScene; id: string; at: Pt } | undefined = $state.raw();
  /** Final M3: a drop while offline snaps back (nothing is sent), and the status line says so until the next drop. */
  let unsent = $state(false);

  async function reload() {
    const cid = campaign.id;
    const c = await db.characters.list(cid);
    chars = c;
    if (!joined) {
      const [s, k] = await Promise.all([db.scenes.shown(cid), db.combat.get(cid)]);
      local = sceneForPlayers(s, c, k, settings);
    }
  }
  $effect(() => { void session.rev; void settings; reload().catch((e) => (error = e instanceof Error ? e.message : String(e))); });

  const base = $derived(joined ? session.scene : local);
  const view = $derived(base && pending?.of === base
    ? { ...base, tokens: base.tokens.map((t) => (t.id === pending!.id ? { ...t, ...pending!.at } : t)) } : base);

  const mine = (characterId: string | undefined) => {
    const c = characterId === undefined ? undefined : chars.find((x) => x.id === characterId);
    return joined && !!c && c.ownerId !== undefined && c.ownerId === campaign.sync?.playerId ? c : undefined;
  };
  const actor = $derived(currentActor(session.tracker));
  const owned = $derived(view?.tokens.filter((t) => mine(t.characterId)) ?? []);
  const myTurn = $derived(owned.some((t) => t.characterId === actor));
  const status = $derived(!owned.length ? '' : unsent && session.status !== 'online' ? "You're offline: that move wasn't sent." : settings.freeMovement ? 'Free movement is on.' : myTurn ? 'Your turn: drag your token.' : 'Wait for your turn to move.');
  // Movement budget (spec 1): the tracker carries each player character's turn origin and Dashes while one applies; used = distance
  // from that origin to where the token stands (moving back gives movement back).
  const budget = $derived(!!session.tracker && session.tracker.round >= 1 && !settings.freeMovement);
  const budgetOf = (characterId: string | undefined) => {
    const c = mine(characterId), row = c && session.tracker?.rows.find((r) => r.characterId === c.id);
    if (!budget || !c || !row || !view) return undefined;
    try {
      const speed = effectiveSpeed(computeSheet(c, { settings, viewer: 'player' }).speed.walk, c.state.conditions, c.state.exhaustion);
      const at = view.tokens.find((t) => t.characterId === c.id);
      return { left: remainingFeet(speed, row.moved, at, view.grid, settings.diagonal), from: originOf(row.moved), budget: budgetFeet(speed, row.moved), dashes: row.moved?.dashes ?? 0 };
    } catch { return undefined; }
  };
  // Turn panel: in a fight, the player's character that is acting, else their next to act; a switcher when they have several there.
  const fight = $derived(session.tracker && session.tracker.round >= 1 ? session.tracker : undefined);
  const myRows = $derived(fight?.rows.filter((r) => r.econ && mine(r.characterId)) ?? []);
  let chosen: string | undefined = $state();
  const turnKey = $derived(fight?.current); // a string: a tracker update on the same turn keeps the pick
  $effect(() => { void turnKey; chosen = undefined; }); // a new turn: back to the acting (or next) one
  const turn = $derived.by(() => {
    if (!fight || !myRows.length) return undefined;
    const i = Math.max(0, fight.rows.findIndex((r) => r.id === fight.current));
    const r = myRows.find((x) => x.id === chosen) ?? [...fight.rows.slice(i), ...fight.rows.slice(0, i)].find((x) => myRows.includes(x));
    const c = mine(r?.characterId);
    if (!r?.econ || !c) return undefined;
    try {
      const sheet = computeSheet(c, { settings, viewer: 'player' });
      const { reaction, perAction: _p, conc: _c, hasted: _h, rider: _r, ...economy } = r.econ;
      return { r, c, econ: r.econ, sheet, actions: pcActions(c, sheet, featureList(c, settings)), x: { economy, reactionUsed: reaction } as Combatant };
    } catch { return undefined; }
  });
  /** The tracker a use was sent under: its buttons stay off until the next tracker arrives or 3 s pass (a double tap sends one use). */
  let sentUnder: object | undefined = $state.raw();
  let sentTimer: ReturnType<typeof setTimeout> | undefined;
  const offline = () => { if (session.status === 'online') return false; toast("You're offline: that wasn't sent.", true); return true; };
  function useAction(a: TurnAction, slot?: number, target?: string): boolean {
    if (!turn || offline()) return false;
    sentUnder = session.tracker;
    sendUse(turn.c.id, a.id, slot, target);
    clearTimeout(sentTimer);
    sentTimer = setTimeout(() => (sentUnder = undefined), 3000);
    return true;
  }
  $effect(() => () => clearTimeout(sentTimer));

  // Targeting: the action being aimed on the map. The dice roll here (the d20 shows at once); the DM's device works it out and answers.
  let aiming: { a: TurnAction; slot?: number; toggles: Toggle[]; dtype?: string; plan: AimPlan; c: Character } | undefined = $state.raw();
  let held: { action: string; roll: AimRoll } | undefined;
  const onaim = (a: TurnAction, slot: number | undefined, toggles: Toggle[], dtype?: string) => {
    const plan = aimPlan(a, { level: slot, toggles, dtype, rider: turn?.econ.rider });
    if (plan && turn && joined) { aiming = { a, slot, toggles, dtype, plan, c: turn.c }; selected = []; }
  };
  const OUT = /incapacitated|paralyzed|petrified|stunned|unconscious/i;
  const aim = $derived.by(() => {
    const m = aiming, v = view;
    if (!m || !v) return undefined;
    const me = v.tokens.find((t) => t.characterId === m.c.id);
    if (!me) return undefined;
    // the DM's device decides; this only rolls two d20s when it will see a hostile creature within 5 ft (one with no character)
    const foe = v.tokens.some((t) => t.id !== me.id && t.characterId === undefined && !t.conditions.some((c) => OUT.test(c)) && feetBetween(v.grid, me, t, settings.diagonal) <= 5);
    const pickable = (id: string): Pickable => {
      const t = v.tokens.find((x) => x.id === id);
      // its conditions as the player's map shows them; a monster's Dodge only the DM's device knows (two d20s are sent either way)
      return t && t.id !== me.id ? judge(m.plan, v.grid, settings.diagonal, me, foe, t, { attacker: m.c.state.conditions, target: t.conditions, exhaustion: m.c.state.exhaustion }) : { ok: false };
    };
    return { from: { x: me.x, y: me.y }, line: m.plan.line, ...(m.plan.area && { area: m.plan.area }), pickable,
      onpick: (p: { tokenId?: string; point: Pt }) => fire(p, pickable), oncancel: () => (aiming = undefined) };
  });
  function fire(p: { tokenId?: string; point: Pt }, pickable: (id: string) => Pickable) {
    const m = aiming;
    aiming = undefined;
    if (!m || offline()) return;
    const pick = p.tokenId ? pickable(p.tokenId) : undefined;
    const r = rollAim(m.a.name, m.plan, pick);
    held = { action: m.a.name, roll: r };
    sentUnder = session.tracker;
    sendUse(m.c.id, m.a.id, m.slot, undefined, { ...(p.tokenId ? { target: p.tokenId } : { point: p.point }), rolled: r.rolled, toggles: m.toggles.map((t) => t.id), ...(m.dtype && { dtype: m.dtype }) });
    clearTimeout(sentTimer);
    sentTimer = setTimeout(() => (sentUnder = undefined), 3000);
  }
  // The DM's answer: hit or miss (the damage shows only on a hit), a spell's DC and the creatures its area caught.
  const opened = Date.now();
  $effect(() => {
    const o = session.outcome;
    if (!o || o.at < opened) return;
    untrack(() => {
      const h = held;
      held = undefined;
      if (h?.action === o.action) reveal(h.roll.held, o.hit);
      toast([o.action, o.hit === undefined ? '' : o.hit ? 'Hit!' : 'Missed.', o.dc !== undefined ? `Save DC ${o.dc}.` : '',
        o.caught ? `In the area: ${o.caught.join(', ') || 'no one'}.` : ''].filter(Boolean).join(' '));
    });
  });
  /** An area spell's template on the map (local, as the Template tool), from the caster's cell for Self spells. */
  let preset: { shape: SpellArea['shape']; feet: number; width?: number; origin?: Pt; n: number } | undefined = $state.raw();
  const placeTemplate = (area: SpellArea) => {
    const t = turn && view?.tokens.find((k) => k.characterId === turn!.c.id);
    preset = { shape: area.shape, feet: area.feet, ...(area.width && { width: area.width }), ...(area.self && t && { origin: { x: t.x, y: t.y } }), n: (preset?.n ?? 0) + 1 };
  };
  const turnBudget = $derived(myTurn && !(unsent && session.status !== 'online') ? budgetOf(actor) : undefined);
  const limitOf = (id: string) => { const b = budgetOf(tokenOf(id)?.characterId); return b && { from: b.from, budget: b.budget, clamp: true }; };

  const tokenOf = (id: string) => view?.tokens.find((t) => t.id === id);
  const canDrag = (id: string) => {
    const t = tokenOf(id);
    return !!t && !!mine(t.characterId) && (settings.freeMovement || actor === t.characterId);
  };
  const speedOf = (id: string) => {
    const c = mine(tokenOf(id)?.characterId);
    if (!c) return undefined;
    try { return computeSheet(c, { settings, viewer: 'player' }).speed.walk; } catch { return undefined; }
  };
  const onmove = (_ids: string[], primary: string, to: Pt) => {
    const t = tokenOf(primary);
    if (!base || !t || !canDrag(primary)) return;
    unsent = session.status !== 'online';
    if (unsent) return;
    pending = { of: base, id: primary, at: snap(base.grid, to, t.size) };
    sendMove(base.id, primary, to);
  };

  // Live drag previews from others (the DM, other players): the token drawn where it is being dragged.
  const dragged = $derived(view ? view.tokens.map((t) => (session.drags[t.id] ? { ...t, ...session.drags[t.id] } : t)) : []);

  // Declared actions: only what players may see (on the DM's device in Player view the list holds everything); a player clears their
  // own, points from their own token or a point, and only while online (as moves).
  const me = $derived(campaign.sync?.playerId);
  const strong = getComputedStyle(document.documentElement).getPropertyValue('--text-strong').trim() || '#eafffb';
  const actions = $derived(base ? actionsForPlayers(session.actions as DeclaredAction[], base) : []);
  const arrows = $derived(view ? arrowsOn(actions, view.id, view.tokens, (a) => joined && a.by === me, (by) => (by === 'dm' ? strong : tokenColor(by))) : []);
  const myArrow = $derived(joined && actions.some((a) => a.by === me));
  /** The arrow picked on the map (phones have no Delete key: the panel offers a button while it is the player's own). */
  let picked: string | undefined = $state();
  const pickedOwn = $derived(arrows.find((a) => a.id === picked)?.clearable);
  const ondeclare = $derived(joined && session.status === 'online' ? (d: { from: Pt; fromToken?: string; to: Pt; toToken?: string }) => {
    if (!base) return;
    const own = d.fromToken !== undefined && !!mine(tokenOf(d.fromToken)?.characterId);
    void declareAction({ sceneId: base.id, from: own ? { tokenId: d.fromToken! } : d.from, to: d.toToken ? { tokenId: d.toToken } : d.to, kind: 'intent' });
  } : undefined);
</script>

{#if !view}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <p class="muted">The DM isn't showing a map right now.</p>
{:else}
  <!-- The same canvas as the DM's; the panel (a sheet on phones, always up) holds the player's own tokens and the turn status. -->
  <Workspace fill panelLabel="Scene and tokens" open={true}>
    {#key view.id}
      <MapCanvas
        width={view.width}
        height={view.height}
        image={view.image}
        grid={view.grid}
        tokens={dragged}
        fog={view.fog}
        dm={false}
        diagonal={settings.diagonal}
        {selected}
        {canDrag}
        {speedOf}
        {limitOf}
        onselect={(ids) => (selected = ids)}
        {onmove}
        rev={session.rev}
        {arrows}
        {ondeclare}
        onclear={() => clearDeclared()}
        bind:arrow={picked}
        {preset}
        {aim}
        areas={view.areas}
        ondrag={(id, at) => { if (joined && base && (at ? canDrag(id) : !!mine(tokenOf(id)?.characterId))) sendDrag(base.id, id, at); }}
      />
    {/key}
    {#snippet panel()}
      {#if error}<p role="alert" class="error">{error}</p>{/if}
      <h2 class="scene-name">{view.name}</h2>
      {#if !joined}<p class="muted note">Player view: read-only</p>{/if}
      {#if turn && fight}
        <TurnPanel name={turn.c.name} order={fight.rows} self={turn.r.id} current={fight.current} round={fight.round}
          ac={turn.sheet.ac} hp={turn.c.state.hp} maxHp={turn.sheet.maxHp} tempHp={turn.c.state.tempHp} conditions={[...turn.c.state.conditions, ...(turn.econ.hasted ? ['Haste'] : [])]}
          moveLeft={turn.c.id === actor ? turnBudget?.left : undefined} x={turn.x} perAction={turn.econ.perAction} onTurn={turn.c.id === actor}
          actions={turn.actions} slots={slotsLeft(turn.sheet, turn.c)} concentrating={turn.econ.conc}
          busy={!!sentUnder && sentUnder === session.tracker} canEnd={turn.c.id === actor} onuse={useAction} onend={() => { if (!offline()) sendEndTurn(turn!.c.id); }} ontemplate={placeTemplate}
          targeting={joined && targetingOn(settings)} features={featureList(turn.c, settings).map((f) => f.name)} {onaim}>
          {#snippet top()}
            {#if myRows.length > 1}
              <div class="row switch" role="group" aria-label="Your characters">
                {#each myRows as r (r.id)}<button type="button" aria-pressed={r.id === turn!.r.id} onclick={() => (chosen = r.id)}>{r.name}</button>{/each}
              </div>
            {/if}
          {/snippet}
        </TurnPanel>
        {#if unsent && session.status !== 'online'}<p class="status" role="status">{status}</p>{/if}
      {:else if turnBudget && actor}
        <p class="status" role="status" aria-live="polite">Your turn: <span class="num">{turnBudget.left}</span> ft left{turnBudget.dashes ? ` · Dashed ×${turnBudget.dashes}` : ''}.</p>
      {:else}
        <p class="status" role="status" aria-live="polite">{status}</p>
      {/if}
      {#if myArrow}
        <div class="arrow-btns">
          {#if pickedOwn}<button type="button" class="del-arrow" onclick={() => { clearDeclared(); picked = undefined; }}>Delete arrow</button>{/if}
          <button type="button" onclick={() => clearDeclared()}>Clear arrow</button>
        </div>
      {/if}
      {#if owned.length}
        <div class="caption">Your tokens</div>
        <ul class="plain tokens">{#each owned as t (t.id)}{@render row(t)}{/each}</ul>
      {/if}
      {#if view.tokens.length}
        <Drawer title="Tokens ({view.tokens.length})">
          <ul class="plain tokens">{#each view.tokens as t (t.id)}{@render row(t)}{/each}</ul>
        </Drawer>
      {/if}
    {/snippet}
  </Workspace>
{/if}

{#snippet row(t: { id: string; name: string; color: string; health?: string; conditions: string[] })}
  <li><span class="dot" style:background={t.color} aria-hidden="true"></span><span class="nm">{t.name}</span>{#if t.health}<span class="muted"> · {t.health}</span>{/if}{#if t.conditions.length}<span class="muted"> · {t.conditions.join(', ')}</span>{/if}</li>
{/snippet}

<style>
  .scene-name {
    margin: 0 0 0.2rem;
    font-size: 1.2rem;
    color: var(--text-strong);
  }

  .note {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }

  .status {
    margin: 0.4rem 0 0.9rem;
    color: var(--text-strong);
  }

  .switch button {
    min-height: 44px;
  }

  .switch button[aria-pressed='true'] {
    border-color: var(--accent);
  }

  .tokens {
    margin: 0.25rem 0 0.75rem;
  }

  .arrow-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: -0.5rem 0 0.9rem;
  }

  .del-arrow {
    min-height: 44px;
  }

  .tokens li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.3rem 0;
  }

  .tokens li + li {
    border-top: 1px solid var(--line);
  }

  .nm {
    color: var(--text-strong);
  }

  .dot {
    flex: none;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    margin-right: 0.5rem;
    box-shadow: 0 0 0 1px var(--line-strong);
  }
</style>
