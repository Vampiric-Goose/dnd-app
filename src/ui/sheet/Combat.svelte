<script lang="ts">
  import { applyDamage, applyHealing, rollDeathSave } from '../../lib/character/rest.ts';
  import { deathState } from '../../lib/character/play.ts';
  import { CONDITIONS } from '../../lib/rules/constants.ts';
  import type { Character, OverrideKey, Recharge, Sheet } from '../../lib/types.ts';
  import HpControls from '../HpControls.svelte';
  import Bar from '../kit/Bar.svelte';
  import Drawer from '../kit/Drawer.svelte';
  import Pill from '../kit/Pill.svelte';
  import OverrideNumber from './OverrideNumber.svelte';
  import Pips from './Pips.svelte';
  import { rollTo } from './roll.ts';

  let { c, sheet, update, patch, onset, onrest }: {
    c: Character;
    sheet: Sheet;
    update: (fn: (c: Character) => Character) => void;
    patch: (s: Partial<Character['state']>) => void;
    onset: (key: OverrideKey, value: number | undefined) => void;
    onrest: (mode: 'short' | 'long') => void;
  } = $props();

  const has = (k: OverrideKey) => sheet.overridden.includes(k);
  const RECHARGE: Record<Recharge, string> = { short: 'Short rest', long: 'Long rest', dawn: 'Dawn', dusk: 'Dusk', none: 'Manual' };
  // PHB p.291
  const EXHAUSTION = ['', 'Disadvantage on ability checks', 'Speed halved', 'Disadvantage on attack rolls and saving throws', 'Hit point maximum halved', 'Speed reduced to 0', 'Death'];

  const life = $derived(deathState(c.state));
  const atZero = $derived(c.state.hp === 0 && !c.state.dead);

  function deathSave() {
    const r = rollTo('Death save', '1d20');
    if (r) update((x) => rollDeathSave(x, r.total));
  }

  // PHB: exhaustion 6 is death. Stepping back down does not revive; Revive does.
  function raiseExhaustion() {
    const n = c.state.exhaustion + 1;
    patch(n >= 6 ? { exhaustion: 6, dead: true, stable: false } : { exhaustion: n });
  }
  const revive =() => patch({ dead: false, stable: false, hp: 1, deathSaves: { success: 0, fail: 0 } });
  const toggleCondition = (name: string) =>
    patch({ conditions: c.state.conditions.includes(name) ? c.state.conditions.filter((x) => x !== name) : [...c.state.conditions, name] });
  const diceLeft = (die: number, total: number) => total - (c.state.hitDiceUsed[die] ?? 0);
</script>

<!-- The sheet's right panel: live status. AC, initiative, speed and the rest of the numbers are in the sheet's header. -->
<section class="blk" aria-labelledby="hp-h">
  <h2 id="hp-h" class="cap">Hit points</h2>
  <p class="hpline">
    <span class="sr-only">Hit points</span>
    <strong class="now num" data-testid="hp-now">{c.state.hp}</strong>
    <span class="slash" aria-hidden="true">/</span><span class="sr-only">of</span>
    <OverrideNumber label="Max HP" okey="maxHp" value={sheet.maxHp} overridden={has('maxHp')} {onset} />
  </p>
  <Bar value={c.state.hp} max={sheet.maxHp} temp={c.state.tempHp} label="{c.name || 'Character'} hit points" />
  <p class="temp"><span class="cap">Temp HP</span> <strong class="num" data-testid="hp-temp">{c.state.tempHp}</strong></p>

  <HpControls label={c.name || 'Character'} dead={c.state.dead} {atZero}
    ondamage={(n, crit) => update((x) => applyDamage(x, n, sheet, crit))}
    onheal={(n) => update((x) => applyHealing(x, n, sheet))}
    ontemp={(n) => patch({ tempHp: n })} />

  <div role="status" class="life">
    {#if life === 'dying'}
      <p><strong>Unconscious: death saves</strong></p>
      <p class="row">
        <span>Successes <span class="marks" aria-label="{c.state.deathSaves.success} of 3">{'●'.repeat(c.state.deathSaves.success)}{'○'.repeat(3 - c.state.deathSaves.success)}</span></span>
        <span>Failures <span class="marks fail" aria-label="{c.state.deathSaves.fail} of 3">{'●'.repeat(c.state.deathSaves.fail)}{'○'.repeat(3 - c.state.deathSaves.fail)}</span></span>
      </p>
      <button type="button" class="primary" onclick={deathSave}>Roll death save</button>
    {:else if life === 'stable'}
      <p><strong>Stable</strong> <span class="muted">Unconscious at 0 HP but no longer dying.</span></p>
    {:else if life === 'dead'}
      <p class="row"><strong class="error">Dead</strong> <button type="button" onclick={revive}>Revive at 1 HP</button></p>
    {/if}
  </div>

  {#if sheet.resistances.length || sheet.immunities.length || sheet.vulnerabilities.length}
    <ul class="plain dmg" aria-label="Damage types">
      {#if sheet.resistances.length}<li><span class="cap">Resistant</span> {sheet.resistances.join(', ')}</li>{/if}
      {#if sheet.immunities.length}<li><span class="cap">Immune</span> {sheet.immunities.join(', ')}</li>{/if}
      {#if sheet.vulnerabilities.length}<li><span class="cap">Vulnerable</span> {sheet.vulnerabilities.join(', ')}</li>{/if}
    </ul>
  {/if}
</section>

<section class="blk" aria-labelledby="cond-h">
  <h2 id="cond-h" class="cap">Conditions</h2>
  <p class="active">
    {#each c.state.conditions as name (name)}<Pill label={name} accent />{:else}<span class="muted">None</span>{/each}
  </p>
  <Drawer title="Set conditions">
    <div class="chips" role="group" aria-label="Conditions">
      {#each CONDITIONS as name (name)}
        <button type="button" class="chip" aria-pressed={c.state.conditions.includes(name)} onclick={() => toggleCondition(name)}>{name}</button>
      {/each}
    </div>
  </Drawer>
  <p class="row exhaustion" role="group" aria-labelledby="exh-l">
    <span id="exh-l">Exhaustion</span>
    <button type="button" class="step" aria-label="Lower exhaustion" disabled={c.state.exhaustion <= 0} onclick={() => patch({ exhaustion: c.state.exhaustion - 1 })}>−</button>
    <strong class="num" data-testid="exhaustion">{c.state.exhaustion}</strong>
    <button type="button" class="step" aria-label="Raise exhaustion" disabled={c.state.exhaustion >= 6} onclick={raiseExhaustion}>+</button>
    {#if c.state.exhaustion}<span class="muted small">{EXHAUSTION[c.state.exhaustion]}</span>{/if}
  </p>
  <label class="check"><input type="checkbox" checked={c.state.inspiration} onchange={(e) => patch({ inspiration: e.currentTarget.checked })} /> Inspiration</label>
</section>

<section class="blk" aria-labelledby="rest-h2">
  <h2 id="rest-h2" class="cap">Hit dice and rest</h2>
  <p class="dice">
    {#each sheet.hitDice as h (h.die)}<span><span class="num">{diceLeft(h.die, h.total)}/{h.total}</span> d{h.die}</span>{:else}<span class="muted">No hit dice</span>{/each}
  </p>
  <div class="row">
    <button type="button" onclick={() => onrest('short')}>Short rest</button>
    <button type="button" onclick={() => onrest('long')}>Long rest</button>
  </div>
</section>

{#if sheet.resources.length}
  <section class="blk" aria-labelledby="res-h">
    <h2 id="res-h" class="cap">Resources</h2>
    <ul class="plain">
      {#each sheet.resources as r (r.name)}
        <li class="res">
          <span>{r.name} <span class="muted small">({RECHARGE[r.recharge]})</span></span>
          {#if Number.isFinite(r.max)}
            <Pips total={r.max} used={Math.min(r.max, c.state.resourcesUsed[r.name] ?? 0)} label={r.name} onchange={(n) => patch({ resourcesUsed: { ...c.state.resourcesUsed, [r.name]: n } })} />
          {:else}
            <span class="muted">Unlimited</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .blk + .blk {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--line);
  }

  .cap {
    margin: 0;
    color: var(--label);
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  h2.cap {
    margin-bottom: 0.3rem;
  }

  .hpline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
    margin: 0 0 0.4rem;
    --ov-size: 1.35rem;
  }

  .now {
    color: var(--text-strong);
    font-size: 2.3rem;
    font-weight: 600;
    line-height: 1;
  }

  .slash {
    color: var(--muted);
    font-size: 1.35rem;
  }

  .temp {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0.5rem 0 0.2rem;
  }

  .temp strong {
    color: var(--text-strong);
  }

  .life p {
    margin: 0.3rem 0;
  }

  .marks {
    letter-spacing: 0.15em;
    color: var(--accent);
  }

  .marks.fail {
    color: var(--danger);
  }

  .dmg {
    margin-top: 0.4rem;
    font-size: 0.9rem;
  }

  .active {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0 0 0.3rem;
    min-height: 1.5rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .chip {
    min-height: 1.9rem;
    padding: 0.1rem 0.55rem;
    font-size: 0.85rem;
  }

  .chip[aria-pressed='true'] {
    background: var(--raised);
    border-color: var(--accent);
    color: var(--accent);
  }

  .exhaustion {
    margin: 0.5rem 0 0.1rem;
  }

  .step {
    min-width: 2.2rem;
    min-height: 2.2rem;
    padding: 0;
  }

  .exhaustion strong {
    min-width: 1.2rem;
    text-align: center;
    color: var(--text-strong);
  }

  .small {
    font-size: 0.85rem;
  }

  .dice {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0 0 0.5rem;
  }

  .dice .num {
    color: var(--text-strong);
  }

  .res {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    padding: 0.3rem 0;
  }

  .res + .res {
    border-top: 1px solid var(--line);
  }

  @media (max-width: 767px) {
    .chip,
    .step {
      min-height: 44px;
      min-width: 44px;
    }
  }
</style>
