<script lang="ts">
  import { INIT_MAX, INIT_MIN, initOk, patchCombatant, rollInit, setInit } from '../../lib/combat/combat.ts';
  import { changeHp, deathSave, remove, setCondition } from '../../lib/combat/store.ts';
  import { deathState } from '../../lib/character/play.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { CONDITIONS } from '../../lib/rules/constants.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import type { CampaignSettings, Character, Combat, Combatant, Duration, MonsterDef } from '../../lib/types.ts';
  import { signed } from '../creator/labels.ts';
  import HpControls from '../HpControls.svelte';
  import StatBlock from '../monsters/StatBlock.svelte';
  import { rollTo } from '../sheet/roll.ts';
  import { reorder } from './order.ts';

  let { x, i, count, combatants, current, ch, monster, index, settings, cid, edit, run }: {
    x: Combatant; i: number; count: number; combatants: Combatant[]; current: boolean; ch: Character | undefined; monster: MonsterDef | undefined;
    index: ContentIndex | undefined; settings: CampaignSettings; cid: string;
    edit: (fn: (c: Combat) => Combat) => Promise<void>; run: (op: () => Promise<unknown>) => Promise<void>;
  } = $props();

  const mods = $derived(settings.initiativeModules);
  const pc = $derived(x.kind === 'pc');
  const sheet = $derived(ch ? computeSheet(ch, { settings, viewer: 'dm' }) : undefined);
  const hp = $derived(ch ? { now: ch.state.hp, max: sheet?.maxHp, temp: ch.state.tempHp } : { now: x.hp, max: x.maxHp, temp: x.tempHp ?? 0 });
  const conditions = $derived(pc ? ch?.state.conditions ?? [] : x.conditions ?? []);
  const life = $derived(ch ? deathState(ch.state) : 'ok');
  const patch = (p: Partial<Combatant>) => edit((c) => patchCombatant(c, x.id, p));

  let concDc: number | undefined = $state();
  let concLost = $state(false);
  let statOpen = $state(false);

  function hpOp(op: Parameters<typeof changeHp>[2]) {
    void run(async () => {
      const r = await changeHp(cid, x.id, op, settings);
      if (r.concentrationDc !== undefined) { concDc = r.concentrationDc; concLost = false; }
      if (r.concentrationLost) { concDc = undefined; concLost = true; }
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
</script>

<article class="card" aria-current={current ? 'true' : undefined} aria-label={x.name}>
  <div class="row top">
    <input class="name" aria-label="Name of {x.name}" value={x.name} onchange={(e) => { const v = e.currentTarget.value.trim(); if (v) void patch({ name: v }); else e.currentTarget.value = x.name; }} />
    {#if x.kind !== 'lair'}
      <label class="row"><span>Init</span>
        <input type="number" class="init" min={INIT_MIN} max={INIT_MAX} step="1" inputmode="numeric" aria-label="Initiative of {x.name}" value={x.init ?? ''}
          onchange={(e) => setInitFrom(e.currentTarget.value, e.currentTarget)} />
      </label>
      <button type="button" aria-label="Roll initiative for {x.name}" onclick={() => edit((c) => setInit(c, x.id, rollInit(x.initMod)))}>Roll</button>
    {:else}
      <span class="muted">Init {x.init}</span>
    {/if}
    {#if x.ac !== undefined}<span>AC {x.ac}</span>{/if}
    {#if x.hidden}<span class="muted">Hidden</span>{/if}
  </div>

  <div class="row">
    <button type="button" aria-label="Move {x.name} up" disabled={i === 0 || current} onclick={() => edit((c) => reorder(c, x.id, i - 1))}>↑</button>
    <button type="button" aria-label="Move {x.name} down" disabled={i === count - 1 || current} onclick={() => edit((c) => reorder(c, x.id, i + 1))}>↓</button>
    <label class="check"><input type="checkbox" checked={!!x.hidden} onchange={(e) => patch({ hidden: e.currentTarget.checked })} /> Hidden from players</label>
    <button type="button" class="danger" aria-label="Remove {x.name}" onclick={() => run(() => remove(cid, x.id))}>Remove</button>
  </div>

  {#if mods.hp && x.kind !== 'lair'}
    <p class="hpline">
      HP <strong>{hp.now ?? '—'}</strong>{#if hp.max !== undefined} / {hp.max}{/if}
      {#if hp.temp}<span class="muted">Temp {hp.temp}</span>{/if}
      {#if life !== 'ok'}<strong class="error">{life === 'dying' ? 'Dying' : life === 'stable' ? 'Stable' : 'Dead'}</strong>{/if}
    </p>
    {#if x.kind === 'monster' && x.hp === undefined}
      <label class="row"><span>Max HP of {x.name}</span><input type="number" class="init" min="1" step="1" inputmode="numeric" onchange={(e) => setMax(e.currentTarget.valueAsNumber)} /></label>
    {/if}
    <HpControls label={x.name} dead={!!ch?.state.dead} atZero={!!ch && ch.state.hp === 0 && !ch.state.dead}
      ondamage={(n, crit) => hpOp({ damage: n, crit })} onheal={(n) => hpOp({ heal: n })} ontemp={(n) => hpOp({ temp: n })} />
  {/if}
  {#if concDc !== undefined}
    <div class="row prompt" role="status">
      <span>Concentration: Con save DC {concDc}</span>
      <button type="button" onclick={() => rollTo('Concentration save', `1d20${signed(x.conSave)}`, { public: false })}>Roll</button>
      <button type="button" onclick={() => { concDc = undefined; void patch({ concentrating: false }); }}>Lost concentration</button>
      <button type="button" aria-label="Dismiss the concentration prompt for {x.name}" onclick={() => (concDc = undefined)}>Kept</button>
    </div>
  {/if}

  {#if concLost}
    <div class="row prompt" role="status">
      <span>Concentration ends (0 HP)</span>
      <button type="button" aria-label="Dismiss the concentration notice for {x.name}" onclick={() => (concLost = false)}>OK</button>
    </div>
  {/if}

  {#if mods.conditions && x.kind !== 'lair'}
    <div class="row" role="group" aria-label="Conditions of {x.name}">
      {#each conditions as name (name)}
        {@const d = x.durations?.[name]}
        <button type="button" class="chip on" aria-label="Remove {name} from {x.name}{d ? `, ${d.rounds} ${d.rounds === 1 ? 'round' : 'rounds'} left` : ''}" onclick={() => toggle(name)}>{name}{d ? ` (${d.rounds})` : ''} ×</button>
      {/each}
    </div>
    <details>
      <summary>Add condition</summary>
      <div class="row">
        <label class="row"><span>Rounds</span><input type="number" class="init" min="1" step="1" inputmode="numeric" placeholder="—" bind:value={rounds} /></label>
        <label class="row"><span>Ends at</span><select bind:value={at}><option value="start">start</option><option value="end">end</option></select></label>
        <label class="row"><span>of turn of</span><select bind:value={of}>{#each combatants as y (y.id)}<option value={y.id}>{y.name}</option>{/each}</select></label>
      </div>
      <div class="row" role="group" aria-label="Add a condition to {x.name}">
        {#each CONDITIONS.filter((n) => !conditions.includes(n)) as name (name)}
          <button type="button" class="chip" onclick={() => toggle(name)}>{name}</button>
        {/each}
      </div>
    </details>
  {/if}

  <div class="row">
    {#if mods.concentration && x.kind !== 'lair'}
      <label class="check"><input type="checkbox" checked={!!x.concentrating} onchange={(e) => patch({ concentrating: e.currentTarget.checked })} /> Concentrating</label>
    {/if}
    {#if mods.reactions && x.kind !== 'lair'}
      <label class="check"><input type="checkbox" checked={!!x.reactionUsed} onchange={(e) => patch({ reactionUsed: e.currentTarget.checked })} /> Reaction used</label>
    {/if}
    {#if mods.legendary && x.legendary}
      {@const l = x.legendary}
      <span class="row" role="group" aria-label="Legendary actions of {x.name}">
        <span>Legendary {l.used}/{l.max}</span>
        <button type="button" aria-label="One fewer legendary action used by {x.name}" disabled={l.used <= 0} onclick={() => legendary(-1)}>−</button>
        <button type="button" aria-label="One more legendary action used by {x.name}" disabled={l.used >= l.max} onclick={() => legendary(1)}>+</button>
      </span>
    {/if}
  </div>

  {#if mods.deathSaves && ch && life === 'dying'}
    <div class="row" role="group" aria-label="Death saves of {x.name}">
      <span>Successes <span class="marks" role="img" aria-label="{ch.state.deathSaves.success} of 3">{'●'.repeat(ch.state.deathSaves.success)}{'○'.repeat(3 - ch.state.deathSaves.success)}</span></span>
      <span>Failures <span class="marks" role="img" aria-label="{ch.state.deathSaves.fail} of 3">{'●'.repeat(ch.state.deathSaves.fail)}{'○'.repeat(3 - ch.state.deathSaves.fail)}</span></span>
      <button type="button" onclick={rollDeath}>Roll death save</button>
    </div>
  {/if}

  <details>
    <summary>Notes{monster ? ' and stat block' : ''}</summary>
    <label class="col"><span>Notes for {x.name} (DM only)</span>
      <textarea rows="2" value={x.notes ?? ''} onchange={(e) => patch({ notes: e.currentTarget.value })}></textarea>
    </label>
    {#if monster}
      <details bind:open={statOpen}>
        <summary>Stat block</summary>
        {#if statOpen}<StatBlock {monster} {index} />{/if}
      </details>
    {:else if x.kind === 'monster'}
      <p class="muted">This monster's stat block is no longer in the campaign.</p>
    {/if}
  </details>
</article>

<style>
  article {
    margin: 0.5rem 0;
  }

  article[aria-current='true'] {
    border-color: var(--accent);
    box-shadow: inset 4px 0 var(--accent);
  }

  .top {
    align-items: center;
  }

  .name {
    flex: 1 1 8rem;
    min-width: 0;
    font-weight: bold;
  }

  .init {
    width: 4rem;
  }

  .hpline {
    margin: 0.4rem 0 0;
  }

  .prompt {
    background: var(--surface);
    padding: 0.3rem;
  }

  .chip {
    min-height: 2.2rem;
    border-radius: 1.2rem;
  }

  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .marks {
    letter-spacing: 0.15em;
    color: var(--accent);
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  textarea {
    width: 100%;
  }

  details {
    margin: 0.3rem 0;
  }
</style>
