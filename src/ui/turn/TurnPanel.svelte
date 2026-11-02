<script lang="ts">
  // The map panel's turn view (turn panel spec): the turn strip, HP, conditions and what they do now, movement, the three pips, the
  // primary action card and End turn / Next. "All actions" opens a pop-up with everything, grouped by what it costs. The page decides
  // what a use does (a player sends it to the DM's device, the DM applies it); this only checks what is greyed out and rolls.
  import { CONDITION_TEXT } from '../../lib/combat/economy.ts';
  import { primaryAction, problemOf, visible, type TurnAction } from '../../lib/combat/turnActions.ts';
  import { aimPlan } from '../../lib/combat/aiming.ts';
  import { attackToggles, type Toggle } from '../../lib/combat/targeting.ts';
  import { richToPlain } from '../../lib/content/richtext.ts';
  import { rollParts } from '../../lib/monsters/library.ts';
  import { diceAt, type SpellArea } from '../../lib/combat/spellText.ts';
  import { natD20 } from '../../lib/rolls.svelte.ts';
  import type { Combatant } from '../../lib/types.ts';
  import { signed, titleCase } from '../creator/labels.ts';
  import Bar from '../kit/Bar.svelte';
  import RichText from '../RichText.svelte';
  import { rollD20, rollTo } from '../sheet/roll.ts';
  import { untrack, type Snippet } from 'svelte';

  type Pip = 'action' | 'bonus' | 'reaction';
  let {
    name, order, self, current, round, ac, hp, maxHp, tempHp = 0, tone = 'accent', conditions, moveLeft, x, perAction = 1, onTurn, actions,
    slots = [], concentrating = false, dm = false, busy = false, canEnd, endLabel = 'End turn', onuse, onend, onpip, onstrip, ontemplate, top,
    targeting = false, features = [], onaim,
  }: {
    name: string;
    /** The turn order as the viewer sees it; `self` is the creature shown, `current` the one acting. */
    order: { id: string; name: string; init?: number }[]; self: string; current?: string; round: number;
    ac?: number; hp?: number; maxHp?: number; tempHp?: number; tone?: 'accent' | 'danger';
    conditions: string[]; moveLeft?: number;
    /** Its pips (economy, reactionUsed) and legendary uses. */
    x: Combatant; perAction?: number; onTurn: boolean; actions: TurnAction[];
    /** Spell slots left per level (index 0 = 1st). */
    slots?: number[]; concentrating?: boolean;
    /** A use is on its way: its buttons stay off. */
    busy?: boolean;
    dm?: boolean; canEnd: boolean; endLabel?: string;
    /** false: not sent (offline), so nothing rolls. */
    onuse: (a: TurnAction, slot?: number, target?: string) => boolean | void; onend: () => void;
    /** DM: set or clear a pip. */
    onpip?: (pip: Pip, used: boolean) => void;
    /** DM: show another creature from the strip. */
    onstrip?: (id: string) => void;
    /** Place an area spell's template on the map. */
    ontemplate?: (area: SpellArea) => void;
    /** Targeting (the DM's setting): an aimable action shows Target, which hands it to the map with its slot, the toggles and damage type picked. */
    targeting?: boolean; features?: string[]; onaim?: (a: TurnAction, slot: number | undefined, toggles: Toggle[], dtype?: string) => void;
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
  // The pop-up's sections; each entry says what it costs.
  type Section = 'attacks' | 'utility' | 'unique' | 'spells';
  const SECTIONS: [Section, string][] = [['attacks', 'Attacks'], ['utility', 'Utility'], ['unique', 'Unique'], ['spells', 'Spells']];
  // Separate lists: Actions (what costs an Action, then free things such as Action Surge), Bonus actions, Reactions. A Bonus action is
  // never in Actions. Each list has its spells too (a bonus-action spell keeps the Bonus actions list), and a creature with spells
  // also gets a Spells list of all of them, split the same way by casting time.
  type Cost = 'action' | 'bonus' | 'reaction';
  type Kind = Cost | 'spell';
  const COSTS: [Cost, string][] = [['action', 'Actions'], ['bonus', 'Bonus actions'], ['reaction', 'Reactions']];
  const KINDS: [Kind, string][] = [...COSTS, ['spell', 'Spells']];
  const costIs = (a: TurnAction, k: Cost) => (k === 'action' ? a.cost === 'action' || a.cost === 'none' : a.cost === k);
  const inKind = (a: TurnAction, k: Kind) => (k === 'spell' ? a.group === 'spell' : costIs(a, k));
  const bySpellLevel = (p: TurnAction, q: TurnAction) => (p.spell?.level ?? 0) - (q.spell?.level ?? 0) || p.name.localeCompare(q.name);
  let kind: Kind = $state('action');
  const kindLabel = $derived(KINDS.find(([k]) => k === kind)![1]);
  const shown = $derived(actions.filter((a) => visible(a, conditions))); // Escape only while grappled, Stand up only while prone
  /** Attacks: weapons, off-hand, a monster's attacks (a to-hit roll, or Multiattack); Utility: the standard actions; Spells; the rest
   * (class and race features, resources, a monster's traits, reactions and legendary actions) is Unique. */
  function sectionOf(a: TurnAction): Section {
    if (a.group === 'attack') return 'attacks';
    if (a.group === 'standard') return 'utility';
    if (a.group === 'spell') return 'spells';
    if (a.group === 'monster' && !a.legendary && a.cost === 'action' && (/multiattack/i.test(a.name) || (a.text && rollParts(richToPlain(a.text)).some((p) => 'hit' in p && p.hit)))) return 'attacks';
    return 'unique';
  }
  const freeSlots = (a: TurnAction) => slots.flatMap((n, i) => (n > 0 && i + 1 >= a.spell!.level ? [i + 1] : []));
  let slotFor: Record<string, number> = $state({});
  /** Who a spell that needs a target goes to (default: the creature shown). */
  let targetFor: Record<string, string> = $state({});
  /** Targeting: the attack toggles ticked per action (Great Weapon Master, Sharpshooter). */
  let toggleFor: Record<string, string[]> = $state({});
  /** Targeting: the damage type picked per spell whose type is chosen (default: the first it names). */
  let typeFor: Record<string, string> = $state({});
  /** A character's levelled spell uses a slot it picks; a monster's spends its own slots or per-day uses (a.spend). */
  const slotted = (a: TurnAction) => !!a.spell && a.spell.level > 0 && !a.spend;
  const problem = (a: TurnAction) => problemOf(x, a, conditions, onTurn, perAction) ?? (slotted(a) && !freeSlots(a).length ? 'no slot left' : undefined);
  /** The spell's dice at the slot picked (a monster's: its own level). */
  const spellDice = (a: TurnAction) => diceAt(a.cast!.read, { slot: slotted(a) ? slotOf(a) : a.spell!.level, level: a.spell!.level, charLevel: a.cast!.charLevel, mod: a.cast!.mod });
  const inAttack = $derived(e.attacks > 0 && e.attacks < perAction);

  let dialog: HTMLDialogElement | undefined = $state();
  let crit = $state(false);
  $effect(() => { void self; untrack(() => { slotFor = {}; targetFor = {}; toggleFor = {}; typeFor = {}; crit = false; }); }); // another creature: its own slot picks, no carried crit
  /** The slot picked for it while still free, else the lowest free one. */
  const slotOf = (a: TurnAction) => (freeSlots(a).includes(slotFor[a.id]) ? slotFor[a.id] : freeSlots(a)[0]);

  function use(a: TurnAction): boolean {
    if (a.spell?.concentration && concentrating && !confirm('Casting this ends your concentration on the current spell. Go on?')) return false;
    const pick = a.target ? targetFor[a.id] ?? self : a.options ? targetFor[a.id] ?? a.options[0].id : undefined;
    return onuse(a, slotted(a) ? slotOf(a) : undefined, pick) !== false;
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
      <span>{#if ac !== undefined}<strong class="ac">AC <span class="num">{ac}</span></strong>{/if}<span class="num">{hp}</span>/<span class="num">{maxHp}</span> HP{#if tempHp}<span class="muted"> +<span class="num">{tempHp}</span> temp</span>{/if}</span>
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
  </div>
  {#if blocked}<p class="muted small">No actions or reactions: {conditions.filter((c) => /incapacitated|stunned|paralyzed|petrified|unconscious/i.test(c)).join(', ')}.</p>{/if}

  {#if primary}<div class="card">{@render entry(primary, false)}</div>{/if}
  {#if primary?.attack}<label class="check small" class:on={crit}><input type="checkbox" bind:checked={crit} /> Critical hit (next damage doubles its dice)</label>{/if}
  <div class="row btns">
    {#each KINDS as [k, label]}
      {#if shown.some((a) => inKind(a, k))}<button type="button" onclick={() => { kind = k; dialog?.showModal(); }}>{label}</button>{/if}
    {/each}
    {#if canEnd}<button type="button" class="primary" onclick={onend}>{endLabel}</button>{/if}
  </div>
</section>

<dialog bind:this={dialog} class="actions" aria-labelledby="actions-title" onclick={(ev) => { if (ev.target === dialog) dialog?.close(); }}>
  <div class="body">
  <div class="head">
    <h2 id="actions-title">{name}: {kindLabel.toLowerCase()}</h2>
    <button type="button" aria-label="Close" onclick={() => dialog?.close()}>✕</button>
  </div>
  {#if kind === 'spell' && slots.some((n) => n > 0)}
    <p class="muted small">Slots left: {slots.flatMap((n, i) => (n > 0 ? [`level ${i + 1}: ${n}`] : [])).join(' · ')}</p>
  {/if}
  {#each kind === 'spell' ? COSTS : SECTIONS as [sec, label]}
    {@const list = kind === 'spell'
      ? shown.filter((a) => inKind(a, 'spell') && costIs(a, sec as Cost)).sort(bySpellLevel)
      : shown.filter((a) => inKind(a, kind) && sectionOf(a) === sec).sort((p, q) => Number(p.cost === 'none') - Number(q.cost === 'none'))}
    {#if list.length}
      {@const shared = list.every((a) => problem(a) === problem(list[0])) ? problem(list[0]) : undefined}
      <h3 class:cast={kind === 'spell'}>{label}{#if shared}<span class="small">{` · ${shared}`}</span>{/if}</h3>
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
    {#if full && a.spell}<span class="muted small">{a.spell.level ? `Level ${a.spell.level}` : 'Cantrip'}</span>{/if}
    {#if full && a.cost === 'none'}<span class="cost small">{a.legendary ? `Legendary ×${a.legendary}` : 'Free'}</span>{/if}
    {#if a.uses}<span class="muted small"><span class="num">{a.uses.left}</span>/<span class="num">{a.uses.max}</span> left</span>{/if}
    {#if a.legendary}<span class="muted small">{x.legendary ? `${x.legendary.max - x.legendary.used} legendary left` : ''}</span>{/if}
    {#if a.attack && a.cost === 'action' && perAction > 1 && inAttack}<span class="muted small">Attack <span class="num">{e.attacks + 1}</span> of <span class="num">{perAction}</span></span>{/if}
  </div>
  <div class="rolls">
    {#if targeting && onaim && aimPlan(a, { level: slotted(a) ? slotOf(a) : undefined })}
      {@const toggles = attackToggles(a, features)}
      {#each toggles as t (t.id)}
        <label class="check small" class:on={toggleFor[a.id]?.includes(t.id)}><input type="checkbox" checked={toggleFor[a.id]?.includes(t.id) ?? false}
          onchange={(ev) => (toggleFor[a.id] = (ev.currentTarget as HTMLInputElement).checked ? [...(toggleFor[a.id] ?? []), t.id] : (toggleFor[a.id] ?? []).filter((k) => k !== t.id))} />
          {t.name} (−5 / +10)</label>
      {/each}
      {#if slotted(a) && freeSlots(a).length > 1}
        <select aria-label="{a.name} slot level" value={slotOf(a)} onchange={(ev) => (slotFor[a.id] = Number((ev.currentTarget as HTMLSelectElement).value))}>
          {#each freeSlots(a) as l}<option value={l}>Level {l}</option>{/each}
        </select>
      {/if}
      {@const choices = a.cast?.read.choices}
      {#if choices}
        <select aria-label="{a.name} damage type" value={typeFor[a.id] ?? choices[0]} onchange={(ev) => (typeFor[a.id] = (ev.currentTarget as HTMLSelectElement).value)}>
          {#each choices as c}<option value={c}>{c}</option>{/each}
        </select>
      {/if}
      {#if a.cast?.read.save && a.cast.dc !== undefined}<span class="save">DC <span class="num">{a.cast.dc}</span> {a.cast.read.save} save</span>{/if}
      <button type="button" class="use" disabled={!!why || busy} onclick={() => { dialog?.close(); onaim(a, slotted(a) ? slotOf(a) : undefined, toggles.filter((t) => toggleFor[a.id]?.includes(t.id)), choices && (typeFor[a.id] ?? choices[0])); }}>Target</button>
    {:else if a.attack}
      <button type="button" disabled={!!why || busy} aria-label="Roll {a.name} attack, {signed(a.attack.toHit)}" onclick={() => attack(a)}>Attack <span class="num">{signed(a.attack.toHit)}</span></button>
      <button type="button" aria-label="Roll {a.name} damage, {a.attack.damage}" onclick={() => damage(`${a.attack!.name} damage`, a.attack!.damage)}>Damage <span class="num">{a.attack.damage}</span></button>
      {#if a.attack.versatile}<button type="button" onclick={() => damage(`${a.attack!.name} damage (two-handed)`, a.attack!.versatile!)}>Two-handed <span class="num">{a.attack.versatile}</span></button>{/if}
    {:else if a.check}
      {#each a.check as c (c.label)}
        <button type="button" disabled={!!why || busy} aria-label="Roll {a.name}, {c.label} {signed(c.bonus)}" onclick={() => { if (use(a)) rollD20(`${name}: ${a.name} (${c.label})`, c.bonus); }}>{c.label} <span class="num">{signed(c.bonus)}</span></button>
      {/each}
    {:else}
      {#each parts as p}{#if 'expr' in p}<button type="button" aria-label="Roll {a.name} {p.hit ? 'attack' : 'damage'}, {p.t}" onclick={() => rollTo(`${name}: ${a.name} ${p.hit ? 'attack' : 'damage'}`, p.expr!, { public: false })}>{p.t}</button>{/if}{/each}
      {#if a.options}
        <select aria-label="{a.name}: which" value={targetFor[a.id] ?? a.options[0].id} onchange={(ev) => (targetFor[a.id] = (ev.currentTarget as HTMLSelectElement).value)}>
          {#each a.options as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
        </select>
      {/if}
      {#if a.target}
        <select aria-label="{a.name} target" value={targetFor[a.id] ?? self} onchange={(ev) => (targetFor[a.id] = (ev.currentTarget as HTMLSelectElement).value)}>
          {#each order as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
        </select>
      {/if}
      {#if slotted(a) && freeSlots(a).length > 1}
        <select aria-label="{a.name} slot level" value={slotOf(a)} onchange={(ev) => (slotFor[a.id] = Number((ev.currentTarget as HTMLSelectElement).value))}>
          {#each freeSlots(a) as l}<option value={l}>Level {l}</option>{/each}
        </select>
      {/if}
      {#if a.cast?.read.attack && a.cast.attack !== undefined}
        <button type="button" disabled={!!why || busy} aria-label="Cast {a.name}: spell attack {signed(a.cast.attack)}" onclick={() => { if (use(a)) rollD20(`${a.name}: spell attack`, a.cast!.attack!, { shareAs: 'Spell attack' }); }}>Spell attack <span class="num">{signed(a.cast.attack)}</span></button>
      {:else}
        <button type="button" class="use" disabled={!!why || busy} onclick={() => use(a)}>{a.spell ? 'Cast' : 'Use'}{#if slotted(a) && freeSlots(a).length === 1} <span class="muted">(level {freeSlots(a)[0]})</span>{/if}</button>
      {/if}
      {#if a.cast}
        {@const d = spellDice(a)}
        {#if a.cast.read.save && a.cast.dc !== undefined}<span class="save">DC <span class="num">{a.cast.dc}</span> {a.cast.read.save} save</span>{/if}
        {#each d.damage as dmg}
          {@const [expr, ...type] = dmg.split(' ')}
          <button type="button" aria-label="Roll {a.name} damage, {dmg}" onclick={() => damage(`${a.name} damage (${type.join(' ')})`, expr)}>{expr} <span class="muted">{type.join(' ')}</span></button>
        {/each}
        {#if d.heal}<button type="button" aria-label="Roll {a.name} healing, {d.heal}" onclick={() => rollTo(`${a.name}: healing`, d.heal!, { shareAs: 'Healing' })}>Heal <span class="num">{d.heal}</span></button>{/if}
        {#if a.cast.read.area && ontemplate}<button type="button" onclick={() => ontemplate(a.cast!.read.area!)}>{a.cast.read.area.feet}-ft {a.cast.read.area.shape} on map</button>{/if}
      {/if}
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

  .cost {
    padding: 0 0.4rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--muted);
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

  .save {
    align-self: center;
    color: var(--text-strong);
    font-size: 0.9rem;
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

  .ac {
    margin-right: 0.75rem;
  }

  .actions h3 {
    margin: 0.9rem 0 0.2rem;
    font-size: 0.95rem;
    color: var(--muted);
  }

  /* Spells: the casting-time headers split one long list, so they stand out */
  .actions h3.cast {
    margin-top: 1.2rem;
    padding-bottom: 0.25rem;
    border-bottom: 2px solid var(--accent);
    font-size: 1.1rem;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .actions h3.cast .small {
    text-transform: none;
    letter-spacing: normal;
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
