<script lang="ts">
  // The map panel's turn view (turn panel spec): the turn strip, HP, conditions and what they do now, movement, the three pips, the
  // primary action card and End turn / Next. "All actions" opens a pop-up with everything, grouped by what it costs. The page decides
  // what a use does (a player sends it to the DM's device, the DM applies it); this only checks what is greyed out and rolls.
  import { CONDITION_TEXT, type Cost } from '../../lib/combat/economy.ts';
  import { primaryAction, problemOf, type TurnAction } from '../../lib/combat/turnActions.ts';
  import { richToPlain } from '../../lib/content/richtext.ts';
  import { rollParts } from '../../lib/monsters/library.ts';
  import { natD20 } from '../../lib/rolls.svelte.ts';
  import type { Combatant } from '../../lib/types.ts';
  import { signed, titleCase } from '../creator/labels.ts';
  import Bar from '../kit/Bar.svelte';
  import RichText from '../RichText.svelte';
  import { rollD20, rollTo } from '../sheet/roll.ts';
  import { untrack, type Snippet } from 'svelte';

  type Pip = 'action' | 'bonus' | 'reaction' | 'extra';
  let {
    name, order, self, current, round, hp, maxHp, tempHp = 0, tone = 'accent', conditions, moveLeft, x, perAction = 1, onTurn, actions,
    slots = [], concentrating = false, dm = false, busy = false, canEnd, endLabel = 'End turn', onuse, onend, onpip, onstrip, top,
  }: {
    name: string;
    /** The turn order as the viewer sees it; `self` is the creature shown, `current` the one acting. */
    order: { id: string; name: string; init?: number }[]; self: string; current?: string; round: number;
    hp?: number; maxHp?: number; tempHp?: number; tone?: 'accent' | 'danger';
    conditions: string[]; moveLeft?: number;
    /** Its pips (economy, reactionUsed) and legendary uses. */
    x: Combatant; perAction?: number; onTurn: boolean; actions: TurnAction[];
    /** Spell slots left per level (index 0 = 1st). */
    slots?: number[]; concentrating?: boolean;
    /** A use is on its way: its buttons stay off. */
    busy?: boolean;
    dm?: boolean; canEnd: boolean; endLabel?: string;
    /** false: not sent (offline), so nothing rolls. */
    onuse: (a: TurnAction, slot?: number) => boolean | void; onend: () => void;
    /** DM: set or clear a pip; 'extra' adds an Action (Haste). */
    onpip?: (pip: Pip, used: boolean) => void;
    /** DM: show another creature from the strip. */
    onstrip?: (id: string) => void;
    top?: Snippet;
  } = $props();

  const e = $derived({ used: 0, extra: 0, bonus: false, attacks: 0, ...x.economy });
  const blocked = $derived(conditions.some((c) => ['incapacitated', 'stunned', 'paralyzed', 'petrified', 'unconscious'].includes(c.toLowerCase())));
  const strip = $derived.by(() => {
    const i = order.findIndex((r) => r.id === self), n = order.length;
    if (i < 0) return [];
    const ids = [...new Set([order[(i - 1 + n) % n].id, self, order[(i + 1) % n].id])];
    return ids.map((id) => order.find((r) => r.id === id)!);
  });
  const primary = $derived(primaryAction(actions) ?? actions.find((a) => a.group === 'monster' && a.cost === 'action'));
  const GROUPS: [Cost, string][] = [['action', 'Action'], ['bonus', 'Bonus action'], ['reaction', 'Reaction'], ['none', 'No cost']];
  const freeSlots = (a: TurnAction) => slots.flatMap((n, i) => (n > 0 && i + 1 >= a.spell!.level ? [i + 1] : []));
  let slotFor: Record<string, number> = $state({});
  const problem = (a: TurnAction) => problemOf(x, a, conditions, onTurn, perAction) ?? (a.spell && a.spell.level > 0 && !freeSlots(a).length ? 'no slot left' : undefined);
  const inAttack = $derived(e.attacks > 0 && e.attacks < perAction);

  let dialog: HTMLDialogElement | undefined = $state();
  let crit = $state(false);
  $effect(() => { void self; untrack(() => { slotFor = {}; crit = false; }); }); // another creature: its own slot picks, no carried crit
  /** The slot picked for it while still free, else the lowest free one. */
  const slotOf = (a: TurnAction) => (freeSlots(a).includes(slotFor[a.id]) ? slotFor[a.id] : freeSlots(a)[0]);

  function use(a: TurnAction): boolean {
    if (a.spell?.concentration && concentrating && !confirm('Casting this ends your concentration on the current spell. Go on?')) return false;
    return onuse(a, a.spell && a.spell.level > 0 ? slotOf(a) : undefined) !== false;
  }
  function attack(a: TurnAction) {
    if (!use(a)) return;
    const r = rollD20(`${a.attack!.name} attack`, a.attack!.toHit, { shareAs: 'Attack' });
    if (r) crit = natD20(r.detail) === 'nat20';
  }
  function damage(label: string, expr: string) {
    rollTo(label, expr, { crit, shareAs: 'Damage' });
    crit = false;
  }
  const condEffect = (c: string) => CONDITION_TEXT[titleCase(c)] ?? '';
</script>

<section class="turn" aria-label="Turn: {name}">
  {@render top?.()}
  <div class="strip">
    <span class="round muted">Round <span class="num">{round}</span></span>
    <ol class="plain strip" aria-label="Turn order">
      {#each strip as r (r.id)}
        {@const cls = ['who', r.id === self && 'self', r.id === current && 'now'].filter(Boolean).join(' ')}
        <li>
          {#if onstrip && r.id !== self}
            <button type="button" class={cls} aria-label="Show {r.name}" onclick={() => onstrip(r.id)}>{@render who(r)}</button>
          {:else}
            <span class={cls} aria-current={r.id === current ? 'true' : undefined}>{@render who(r)}</span>
          {/if}
        </li>
      {/each}
    </ol>
  </div>

  <h2 class="name">{name}</h2>
  {#if hp !== undefined && maxHp}
    <div class="hp">
      <span><span class="num">{hp}</span>/<span class="num">{maxHp}</span> HP{#if tempHp}<span class="muted"> +<span class="num">{tempHp}</span> temp</span>{/if}</span>
      <Bar value={hp} max={maxHp} temp={tempHp} {tone} label="{name} hit points" />
    </div>
  {/if}
  {#if conditions.length}
    <ul class="plain conds">{#each conditions as c}<li><strong>{titleCase(c)}</strong>{#if condEffect(c)}: {condEffect(c)}{/if}</li>{/each}</ul>
  {/if}
  {#if moveLeft !== undefined}<p class="move"><span class="num">{moveLeft}</span> ft of movement left</p>{/if}

  <div class="pips" class:blocked role="group" aria-label="Action economy">
    {#each { length: 1 + e.extra } as _, i}{@render pip('action', i < e.used, 1 + e.extra > 1 ? `Action ${i + 1}` : 'Action')}{/each}
    {@render pip('bonus', e.bonus, 'Bonus')}
    {@render pip('reaction', !!x.reactionUsed, 'Reaction')}
    {#if dm && onpip}
      <button type="button" class="add" aria-label="Add an Action (Haste and the like)" onclick={() => onpip('extra', true)}>+</button>
      {#if e.extra > 0}<button type="button" class="add" aria-label="Take back an extra Action" onclick={() => onpip('extra', false)}>−</button>{/if}
    {/if}
  </div>
  {#if blocked}<p class="muted small">No actions or reactions: {conditions.filter((c) => /incapacitated|stunned|paralyzed|petrified|unconscious/i.test(c)).join(', ')}.</p>{/if}

  {#if primary}<div class="card">{@render entry(primary, false)}</div>{/if}
  {#if primary?.attack}<label class="check small" class:on={crit}><input type="checkbox" bind:checked={crit} /> Critical hit (next damage doubles its dice)</label>{/if}
  <div class="row btns">
    <button type="button" onclick={() => dialog?.showModal()}>All actions</button>
    {#if canEnd}<button type="button" class="primary" onclick={onend}>{endLabel}</button>{/if}
  </div>
</section>

<dialog bind:this={dialog} class="actions" aria-labelledby="actions-title" onclick={(ev) => { if (ev.target === dialog) dialog?.close(); }}>
  <div class="body">
  <div class="head">
    <h2 id="actions-title">{name}: actions</h2>
    <button type="button" aria-label="Close" onclick={() => dialog?.close()}>✕</button>
  </div>
  {#each GROUPS as [cost, label]}
    {@const list = actions.filter((a) => a.cost === cost)}
    {#if list.length}
      {@const shared = list.every((a) => problem(a) === problem(list[0])) ? problem(list[0]) : undefined}
      <h3>{label}{#if shared}<span class="small">{` · ${shared}`}</span>{/if}</h3>
      <ul class="plain list">{#each list as a (a.id)}<li>{@render entry(a, true, shared)}</li>{/each}</ul>
    {/if}
  {/each}
  </div>
</dialog>

{#snippet who(r: { name: string; init?: number })}
  {#if r.init !== undefined}<span class="num init">{r.init}</span>{/if}<span class="nm">{r.name}</span>
{/snippet}

{#snippet pip(kind: Pip, used: boolean, label: string)}
  {#if dm && onpip}
    <button type="button" class="pip" class:used aria-pressed={used} aria-label="{label} {used ? 'used' : 'available'}" onclick={() => onpip(kind, !used)}>{label}</button>
  {:else}
    <span class="pip" class:used>{label}<span class="sr-only"> {used ? 'used' : 'available'}</span></span>
  {/if}
{/snippet}

<!-- One thing it can do: its rolls and its Use button, greyed out with the reason when it can't be used now. -->
{#snippet entry(a: TurnAction, full: boolean, hide?: string)}
  {@const why = problem(a)}
  {@const parts = a.group === 'monster' && a.text ? rollParts(richToPlain(a.text)).filter((p) => 'expr' in p) : []}
  <div class="what">
    <strong>{a.name}</strong>
    {#if a.uses}<span class="muted small"><span class="num">{a.uses.left}</span>/<span class="num">{a.uses.max}</span> left</span>{/if}
    {#if a.legendary}<span class="muted small">{x.legendary ? `${x.legendary.max - x.legendary.used} legendary left` : ''}</span>{/if}
    {#if a.attack && a.cost === 'action' && perAction > 1 && inAttack}<span class="muted small">Attack <span class="num">{e.attacks + 1}</span> of <span class="num">{perAction}</span></span>{/if}
  </div>
  <div class="rolls">
    {#if a.attack}
      <button type="button" disabled={!!why || busy} aria-label="Roll {a.name} attack, {signed(a.attack.toHit)}" onclick={() => attack(a)}>Attack <span class="num">{signed(a.attack.toHit)}</span></button>
      <button type="button" aria-label="Roll {a.name} damage, {a.attack.damage}" onclick={() => damage(`${a.attack!.name} damage`, a.attack!.damage)}>Damage <span class="num">{a.attack.damage}</span></button>
      {#if a.attack.versatile}<button type="button" onclick={() => damage(`${a.attack!.name} damage (two-handed)`, a.attack!.versatile!)}>Two-handed <span class="num">{a.attack.versatile}</span></button>{/if}
    {:else}
      {#each parts as p}{#if 'expr' in p}<button type="button" aria-label="Roll {a.name} {p.hit ? 'attack' : 'damage'}, {p.t}" onclick={() => rollTo(`${name}: ${a.name} ${p.hit ? 'attack' : 'damage'}`, p.expr!, { public: false })}>{p.t}</button>{/if}{/each}
      {#if a.spell && a.spell.level > 0 && freeSlots(a).length > 1}
        <select aria-label="{a.name} slot level" value={slotOf(a)} onchange={(ev) => (slotFor[a.id] = Number((ev.currentTarget as HTMLSelectElement).value))}>
          {#each freeSlots(a) as l}<option value={l}>Level {l}</option>{/each}
        </select>
      {/if}
      <button type="button" class="use" disabled={!!why || busy} onclick={() => use(a)}>{a.spell ? 'Cast' : 'Use'}{#if a.spell && a.spell.level > 0 && freeSlots(a).length === 1} <span class="muted">(level {freeSlots(a)[0]})</span>{/if}</button>
    {/if}
  </div>
  {#if why && why !== hide}<p class="why muted small">{why}</p>{/if}
  {#if full && a.text?.length}<details><summary class="small">What it does</summary><RichText text={a.text} /></details>{/if}
{/snippet}

<style>
  .turn {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .round {
    font-size: 0.85rem;
  }

  ol.strip {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .who {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 44px;
    padding: 0.15rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 0.9rem;
    color: var(--text);
    background: transparent;
  }

  .who.self {
    border-color: var(--line-strong);
    color: var(--text-strong);
  }

  .who.now {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent) inset;
  }

  .init {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .name {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text-strong);
  }

  .hp {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .conds li {
    font-size: 0.9rem;
    padding: 0.15rem 0;
  }

  .move {
    margin: 0;
    color: var(--text-strong);
  }

  .pips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .pip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    min-width: 4.5rem;
    padding: 0 0.6rem;
    border: 1px solid var(--accent);
    border-radius: 7px;
    color: var(--text-strong);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    font-size: 0.9rem;
  }

  .pip.used {
    border-color: var(--line);
    color: var(--muted);
    background: transparent;
    text-decoration: line-through;
  }

  .pips.blocked .pip {
    opacity: 0.45;
  }

  .add {
    min-width: 44px;
    min-height: 44px;
  }

  .card,
  .list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem 0.75rem;
  }

  .why,
  details {
    flex-basis: 100%;
  }

  .card {
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
  }

  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.6rem;
  }

  .what strong {
    color: var(--text-strong);
  }

  .rolls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .rolls button,
  .rolls select,
  .btns button {
    min-height: 44px;
  }

  .why {
    margin: 0;
  }

  .small {
    font-size: 0.85rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 44px;
    margin: 0;
  }

  .actions {
    box-sizing: border-box;
    width: min(34rem, calc(100vw - 2rem));
    max-height: min(80vh, 46rem);
    overflow: auto;
    padding: 0;
  }

  .body {
    padding: 0.75rem 1rem 1rem;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    position: sticky;
    top: 0;
    margin: -0.75rem -1rem 0;
    padding: 0.75rem 1rem 0.4rem;
    background: var(--panel);
  }

  .head h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .head button {
    min-width: 44px;
    min-height: 44px;
  }

  .actions h3 {
    margin: 0.9rem 0 0.2rem;
    font-size: 0.95rem;
    color: var(--muted);
  }

  .list li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line);
  }

  details {
    margin: 0;
  }

  /* Phones: the pop-up is a sheet along the bottom. */
  @media (max-width: 640px) {
    .actions {
      width: 100vw;
      max-width: 100vw;
      max-height: 85vh;
      margin: auto 0 0;
      border-radius: 12px 12px 0 0;
    }
  }
</style>
