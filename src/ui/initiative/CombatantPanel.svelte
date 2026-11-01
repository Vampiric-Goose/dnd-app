<script lang="ts">
  // The picked combatant's full controls (right panel / phone sheet): name, initiative, hidden, HP, concentration prompts, death saves,
  // then drawers for conditions, concentration / reaction / legendary, stat block and notes, and Remove.
  import { INIT_MAX, INIT_MIN, initOk, patchCombatant, rollInit, setInit } from '../../lib/combat/combat.ts';
  import { changeHp, deathSave, remove, setCondition } from '../../lib/combat/store.ts';
  import { deathState } from '../../lib/character/play.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { CONDITIONS } from '../../lib/rules/constants.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import type { CampaignSettings, Character, Combat, Combatant, Duration, MonsterDef } from '../../lib/types.ts';
  import { signed } from '../creator/labels.ts';
  import HpControls from '../HpControls.svelte';
  import Bar from '../kit/Bar.svelte';
  import Drawer from '../kit/Drawer.svelte';
  import StatBlock from '../monsters/StatBlock.svelte';
  import { rollTo } from '../sheet/roll.ts';
  import { reorder } from './order.ts';

  type Prompt = { dc?: number; lost?: boolean };

  /** Final M2: a linked token first takes the combatant's HP (the map chunk loads only here); a failed write-back still removes it. */
  async function removeLinked(id: string) {
    const m = await import('../../lib/map/store.ts').catch((e) => void console.warn(e));
    return m ? m.removeCombatant(cid, id) : remove(cid, id);
  }

  let { x, i, count, combatants, current, ch, monster, index, settings, cid, edit, run, prompt, setPrompt }: {
    x: Combatant; i: number; count: number; combatants: Combatant[]; current: boolean; ch: Character | undefined; monster: MonsterDef | undefined;
    index: ContentIndex | undefined; settings: CampaignSettings; cid: string;
    edit: (fn: (c: Combat) => Combat) => Promise<void>; run: (op: () => Promise<unknown>) => Promise<void>;
    /** the concentration prompt, kept by the tracker so it survives picking another row */
    prompt: Prompt | undefined; setPrompt: (id: string, p: Prompt) => void;
  } = $props();

  const mods = $derived(settings.initiativeModules);
  const pc = $derived(x.kind === 'pc');
  const sheet = $derived(ch ? computeSheet(ch, { settings, viewer: 'dm' }) : undefined);
  const hp = $derived(ch ? { now: ch.state.hp, max: sheet?.maxHp, temp: ch.state.tempHp } : { now: x.hp, max: x.maxHp, temp: x.tempHp ?? 0 });
  const conditions = $derived(pc ? ch?.state.conditions ?? [] : x.conditions ?? []);
  const life = $derived(ch ? deathState(ch.state) : 'ok');
  const patch = (p: Partial<Combatant>) => edit((c) => patchCombatant(c, x.id, p));

  let statOpen = $state(false);

  function hpOp(op: Parameters<typeof changeHp>[2]) {
    const id = x.id;
    void run(async () => {
      const r = await changeHp(cid, id, op, settings);
      if (r.concentrationDc !== undefined) setPrompt(id, { dc: r.concentrationDc, lost: false });
      if (r.concentrationLost) setPrompt(id, { dc: undefined, lost: true });
      return r;
    });
  }

  function setInitFrom(v: string, el: HTMLInputElement) {
    const n = v.trim() === '' ? undefined : Number(v);
    if (n !== undefined && !initOk(n)) { el.value = x.init === undefined ? '' : String(x.init); return; }
    void edit((c) => setInit(c, x.id, n));
  }

  // A condition's optional duration (the next one switched on uses it).
  let rounds: number | null = $state(null);
  let at: Duration['at'] = $state('end');
  let of = $state('');
  $effect(() => { if (!combatants.some((y) => y.id === of)) of = x.id; });
  function toggle(name: string) {
    const on = !conditions.includes(name);
    const duration = on && Number.isInteger(rounds) && rounds! >= 1 ? { rounds: rounds!, at, of } : undefined;
    void run(() => setCondition(cid, x.id, name, on, duration));
  }

  // Final M2: from the stored record, so two quick taps both count.
  const legendary = (d: number) => edit((c) => {
    const l = c.combatants.find((z) => z.id === x.id)?.legendary;
    return l ? patchCombatant(c, x.id, { legendary: { ...l, used: Math.max(0, Math.min(l.max, l.used + d)) } }) : c;
  });

  // Final M8: a monster with special HP gets its HP typed in.
  function setMax(v: number | null) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1) void patch({ hp: v, maxHp: v });
  }

  function rollDeath() {
    const r = rollTo('Death save', '1d20');
    if (r) void run(() => deathSave(cid, x.id, r.total));
  }

  const showConc = $derived(mods.concentration && x.kind !== 'lair');
  const showReact = $derived(mods.reactions && x.kind !== 'lair');
  const showLeg = $derived(mods.legendary && !!x.legendary);
  const actTitle = $derived([showConc && 'Concentration', showReact && 'Reaction', showLeg && 'Legendary'].filter(Boolean).join(' · '));
  const actSummary = $derived([
    showConc && x.concentrating && 'concentrating',
    showReact && (x.reactionUsed ? 'reaction used' : 'reaction ready'),
    showLeg && x.legendary && `${x.legendary.used}/${x.legendary.max} used`,
  ].filter(Boolean).join(' · '));
</script>

<article class="cp" aria-current={current ? 'true' : undefined} aria-label={x.name}>
  <input class="name" aria-label="Name of {x.name}" value={x.name} onchange={(e) => { const v = e.currentTarget.value.trim(); if (v) void patch({ name: v }); else e.currentTarget.value = x.name; }} />

  <div class="row meta">
    {#if x.kind !== 'lair'}
      <label class="row"><span class="caption">Init</span>
        <input type="number" class="init num" min={INIT_MIN} max={INIT_MAX} step="1" inputmode="numeric" aria-label="Initiative of {x.name}" value={x.init ?? ''}
          onchange={(e) => setInitFrom(e.currentTarget.value, e.currentTarget)} />
      </label>
      <button type="button" aria-label="Roll initiative for {x.name}" onclick={() => edit((c) => setInit(c, x.id, rollInit(x.initMod)))}>Roll</button>
    {:else}
      <span><span class="caption">Init</span> <span class="num">{x.init}</span></span>
    {/if}
    {#if x.ac !== undefined}<span><span class="caption">AC</span> <span class="num strong">{x.ac}</span></span>{/if}
  </div>
  <label class="check"><input type="checkbox" checked={!!x.hidden} onchange={(e) => patch({ hidden: e.currentTarget.checked })} /> Hidden from players</label>
  <div class="row move">
    <button type="button" aria-label="Move {x.name} up" disabled={i === 0 || current} onclick={() => edit((c) => reorder(c, x.id, i - 1))}>↑ Up</button>
    <button type="button" aria-label="Move {x.name} down" disabled={i === count - 1 || current} onclick={() => edit((c) => reorder(c, x.id, i + 1))}>↓ Down</button>
  </div>

  {#if mods.hp && x.kind !== 'lair'}
    <div class="hp">
      <span class="caption">Hit points</span>
      <p class="hpline">
        <span class="num big">{hp.now ?? '—'}</span>{#if hp.max !== undefined}<span class="num muted"> / {hp.max}</span>{/if}
        {#if hp.temp}<span class="muted">Temp <span class="num">{hp.temp}</span></span>{/if}
        {#if life !== 'ok'}<strong class="error">{life === 'dying' ? 'Dying' : life === 'stable' ? 'Stable' : 'Dead'}</strong>{/if}
      </p>
      {#if hp.now !== undefined && hp.max !== undefined}
        <Bar value={hp.now} max={hp.max} temp={hp.temp} label="{x.name} hit points" tone={pc ? 'accent' : 'danger'} />
      {/if}
      {#if x.kind === 'monster' && x.hp === undefined}
        <label class="row"><span>Max HP of {x.name}</span><input type="number" class="init num" min="1" step="1" inputmode="numeric" onchange={(e) => setMax(e.currentTarget.valueAsNumber)} /></label>
      {/if}
      <HpControls label={x.name} dead={!!ch?.state.dead} atZero={!!ch && ch.state.hp === 0 && !ch.state.dead}
        ondamage={(n, crit) => hpOp({ damage: n, crit })} onheal={(n) => hpOp({ heal: n })} ontemp={(n) => hpOp({ temp: n })} />
    </div>
  {/if}

  {#if prompt?.dc !== undefined}
    <div class="row prompt" role="status">
      <span>Concentration: Con save DC <span class="num">{prompt.dc}</span></span>
      <button type="button" onclick={() => rollTo('Concentration save', `1d20${signed(x.conSave)}`, { public: false })}>Roll</button>
      <button type="button" onclick={() => { setPrompt(x.id, { ...prompt, dc: undefined }); void patch({ concentrating: false }); }}>Lost concentration</button>
      <button type="button" aria-label="Dismiss the concentration prompt for {x.name}" onclick={() => setPrompt(x.id, { ...prompt, dc: undefined })}>Kept</button>
    </div>
  {/if}

  {#if prompt?.lost}
    <div class="row prompt" role="status">
      <span>Concentration ends (0 HP)</span>
      <button type="button" aria-label="Dismiss the concentration notice for {x.name}" onclick={() => setPrompt(x.id, { ...prompt, lost: false })}>OK</button>
    </div>
  {/if}

  {#if mods.deathSaves && ch && life === 'dying'}
    <div class="row saves" role="group" aria-label="Death saves of {x.name}">
      <span>Successes <span class="marks" role="img" aria-label="{ch.state.deathSaves.success} of 3">{'●'.repeat(ch.state.deathSaves.success)}{'○'.repeat(3 - ch.state.deathSaves.success)}</span></span>
      <span>Failures <span class="marks" role="img" aria-label="{ch.state.deathSaves.fail} of 3">{'●'.repeat(ch.state.deathSaves.fail)}{'○'.repeat(3 - ch.state.deathSaves.fail)}</span></span>
      <button type="button" onclick={rollDeath}>Roll death save</button>
    </div>
  {/if}

  <div class="drawers">
    {#if mods.conditions && x.kind !== 'lair'}
      <Drawer title="Conditions">
        {#snippet summary()}{conditions.length ? conditions.join(', ') : 'none'}{/snippet}
        {#if conditions.length}
          <div class="row" role="group" aria-label="Conditions of {x.name}">
            {#each conditions as name (name)}
              {@const d = x.durations?.[name]}
              <button type="button" class="chip on" aria-label="Remove {name} from {x.name}{d ? `, ${d.rounds} ${d.rounds === 1 ? 'round' : 'rounds'} left` : ''}" onclick={() => toggle(name)}>{name}{d ? ` (${d.rounds})` : ''} ×</button>
            {/each}
          </div>
        {/if}
        <p class="caption sub">Add condition</p>
        <div class="dur">
          <label><span>Rounds</span><input type="number" class="init num" min="1" step="1" inputmode="numeric" placeholder="—" bind:value={rounds} /></label>
          <label><span>Ends at</span><select bind:value={at}><option value="start">start</option><option value="end">end</option></select></label>
          <label class="of"><span>of turn of</span><select bind:value={of}>{#each combatants as y (y.id)}<option value={y.id}>{y.name}</option>{/each}</select></label>
        </div>
        <div class="row" role="group" aria-label="Add a condition to {x.name}">
          {#each CONDITIONS.filter((n) => !conditions.includes(n)) as name (name)}
            <button type="button" class="chip" onclick={() => toggle(name)}>{name}</button>
          {/each}
        </div>
      </Drawer>
    {/if}

    {#if actTitle}
      <Drawer title={actTitle}>
        {#snippet summary()}{actSummary}{/snippet}
        {#if showConc}
          <label class="check"><input type="checkbox" checked={!!x.concentrating} onchange={(e) => patch({ concentrating: e.currentTarget.checked })} /> Concentrating</label>
        {/if}
        {#if showReact}
          <label class="check"><input type="checkbox" checked={!!x.reactionUsed} onchange={(e) => patch({ reactionUsed: e.currentTarget.checked })} /> Reaction used</label>
        {/if}
        {#if showLeg && x.legendary}
          {@const l = x.legendary}
          <span class="row" role="group" aria-label="Legendary actions of {x.name}">
            <span>Legendary <span class="num">{l.used}/{l.max}</span></span>
            <button type="button" aria-label="One fewer legendary action used by {x.name}" disabled={l.used <= 0} onclick={() => legendary(-1)}>−</button>
            <button type="button" aria-label="One more legendary action used by {x.name}" disabled={l.used >= l.max} onclick={() => legendary(1)}>+</button>
          </span>
        {/if}
      </Drawer>
    {/if}

    {#if monster}
      <Drawer title="Stat block" bind:open={statOpen}>
        {#snippet summary()}CR <span class="num">{monster.cr}</span>{/snippet}
        {#if statOpen}<StatBlock {monster} {index} />{/if}
      </Drawer>
    {:else if x.kind === 'monster'}
      <p class="muted gone">This monster's stat block is no longer in the campaign.</p>
    {/if}

    <Drawer title="Notes">
      {#snippet summary()}{x.notes?.trim() || 'none'}{/snippet}
      <label class="col"><span>Notes for {x.name} (DM only)</span>
        <textarea rows="3" value={x.notes ?? ''} onchange={(e) => patch({ notes: e.currentTarget.value })}></textarea>
      </label>
    </Drawer>
  </div>

  <button type="button" class="danger remove" aria-label="Remove {x.name}" onclick={() => run(() => removeLinked(x.id))}>Remove</button>
</article>

<style>
  .cp {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .name {
    width: 100%;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-strong);
    background: transparent;
    border-color: transparent;
    padding-left: 0.3rem;
  }

  .name:hover,
  .name:focus {
    border-color: var(--line-strong);
  }

  .meta {
    gap: 0.5rem 0.9rem;
  }

  .init {
    width: 4.2rem;
  }

  .strong {
    color: var(--text-strong);
  }

  .check {
    margin: 0;
  }

  .hp {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line);
  }

  .hpline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 0.6rem;
    margin: 0;
  }

  .big {
    font-size: 1.6rem;
    color: var(--text-strong);
  }

  .hp :global(.hpc) {
    margin: 0.15rem 0;
  }

  .prompt {
    padding: 0.4rem 0.6rem;
    border-left: 2px solid var(--accent);
    background: var(--raised);
    border-radius: var(--radius);
  }

  .saves {
    padding: 0.4rem 0;
  }

  .marks {
    letter-spacing: 0.15em;
    color: var(--accent);
  }

  .drawers {
    border-bottom: 1px solid var(--line);
  }

  .sub {
    margin: 0.6rem 0 0.3rem;
  }

  .dur {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.6rem;
    margin-bottom: 0.5rem;
  }

  .dur label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .dur .of {
    flex: 1 1 8rem;
    min-width: 0;
  }

  .chip {
    min-height: 2rem;
    padding: 0.1rem 0.65rem;
    border-radius: 99px;
    font-size: 0.85rem;
  }

  .chip.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .gone {
    margin: 0.5rem 0;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  textarea {
    width: 100%;
  }

  .remove {
    align-self: flex-start;
    margin-top: 0.5rem;
  }

  /* Move up / down: in the row on wider screens, here on phones. */
  @media (min-width: 768px) {
    .move {
      display: none;
    }
  }

  @media (max-width: 767px) {
    .chip {
      min-height: 44px;
    }
  }
</style>
