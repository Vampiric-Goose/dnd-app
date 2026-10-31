<script lang="ts">
  import { applyDamage, applyHealing, rollDeathSave } from '../../lib/character/rest.ts';
  import { deathState } from '../../lib/character/play.ts';
  import { CONDITIONS } from '../../lib/rules/constants.ts';
  import type { Character, OverrideKey, Recharge, Sheet } from '../../lib/types.ts';
  import { signed } from '../creator/labels.ts';
  import OverrideNumber from './OverrideNumber.svelte';
  import Pips from './Pips.svelte';
  import { rollD20, rollTo } from './roll.ts';

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

  let amount: number | null = $state(null);
  let temp: number | null = $state(null);
  let crit = $state(false);

  const life = $derived(deathState(c.state));
  // The engine only reads the crit flag at 0 HP (2 death-save failures), so the box exists only then.
  const atZero = $derived(c.state.hp === 0 && !c.state.dead);
  $effect(() => { if (!atZero) crit = false; });
  const whole = (n: number | null): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

  function damage() {
    if (!whole(amount) || !amount) return;
    const n = amount;
    update((x) => applyDamage(x, n, sheet, crit));
    amount = null;
    crit = false;
  }

  function heal() {
    if (!whole(amount) || !amount) return;
    const n = amount;
    update((x) => applyHealing(x, n, sheet));
    amount = null;
  }

  function setTemp() {
    if (!whole(temp)) return;
    patch({ tempHp: temp });
    temp = null;
  }

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
  const speeds = $derived(Object.entries(sheet.speed).filter(([m, v]) => m !== 'walk' && v));
  const diceLeft = (die: number, total: number) => total - (c.state.hitDiceUsed[die] ?? 0);
</script>

<section aria-labelledby="combat-h">
  <h2 id="combat-h">Combat</h2>

  <div class="stats">
    <div class="card stat"><span class="k">Armor Class</span><OverrideNumber label="Armor Class" okey="ac" value={sheet.ac} overridden={has('ac')} {onset} /></div>
    <div class="card stat">
      <span class="k">Initiative</span>
      <OverrideNumber label="Initiative" okey="initiative" value={sheet.initiative} overridden={has('initiative')} {onset} format={signed} onroll={() => rollD20('Initiative', sheet.initiative)} />
    </div>
    <div class="card stat">
      <span class="k">Speed</span>
      <OverrideNumber label="Speed" okey="speed" value={sheet.speed.walk} overridden={has('speed')} {onset} format={(n) => `${n} ft`} />
      {#if speeds.length}<span class="muted small">{speeds.map(([m, v]) => `${m} ${v} ft`).join(', ')}</span>{/if}
    </div>
    <div class="card stat"><span class="k">Proficiency</span><OverrideNumber label="Proficiency bonus" okey="prof" value={sheet.prof} overridden={has('prof')} {onset} format={signed} /></div>
    <div class="card stat">
      <span class="k">Passive Perception</span>
      <OverrideNumber label="Passive Perception" okey="passivePerception" value={sheet.passivePerception} overridden={has('passivePerception')} {onset} />
    </div>
  </div>

  <div class="card hp" role="group" aria-labelledby="hp-h">
    <h3 id="hp-h">Hit points</h3>
    <p class="hpline">
      <span class="sr-only">Hit points</span>
      <strong class="now" data-testid="hp-now">{c.state.hp}</strong>
      <span aria-hidden="true">/</span><span class="sr-only">of</span>
      <OverrideNumber label="Max HP" okey="maxHp" value={sheet.maxHp} overridden={has('maxHp')} {onset} />
      <span class="muted">Temp HP <strong data-testid="hp-temp">{c.state.tempHp}</strong></span>
    </p>

    <div class="row">
      <label class="row"><span>Amount</span><input type="number" min="0" step="1" inputmode="numeric" bind:value={amount} /></label>
      <button type="button" class="danger" disabled={!whole(amount) || !amount || c.state.dead} onclick={damage}>Damage</button>
      <button type="button" disabled={!whole(amount) || !amount || c.state.dead} onclick={heal}>Heal</button>
      {#if atZero}
        <label class="check"><input type="checkbox" bind:checked={crit} /> Critical hit (2 failed death saves)</label>
      {/if}
    </div>
    <div class="row">
      <label class="row"><span>Temp HP</span><input type="number" min="0" step="1" inputmode="numeric" bind:value={temp} /></label>
      <button type="button" disabled={!whole(temp)} onclick={setTemp}>Set temp HP</button>
    </div>

    <div role="status" class="life">
      {#if life === 'dying'}
        <p><strong>Unconscious: death saves</strong></p>
        <p class="row">
          <span>Successes <span class="marks" aria-label="{c.state.deathSaves.success} of 3">{'●'.repeat(c.state.deathSaves.success)}{'○'.repeat(3 - c.state.deathSaves.success)}</span></span>
          <span>Failures <span class="marks" aria-label="{c.state.deathSaves.fail} of 3">{'●'.repeat(c.state.deathSaves.fail)}{'○'.repeat(3 - c.state.deathSaves.fail)}</span></span>
        </p>
        <button type="button" class="primary" onclick={deathSave}>Roll death save</button>
      {:else if life === 'stable'}
        <p><strong>Stable</strong> <span class="muted">Unconscious at 0 HP but no longer dying.</span></p>
      {:else if life === 'dead'}
        <p class="row"><strong class="error">Dead</strong> <button type="button" onclick={revive}>Revive at 1 HP</button></p>
      {/if}
    </div>
  </div>

  <div class="card">
    <h3>Rest</h3>
    <p class="muted">Hit dice left: {sheet.hitDice.map((h) => `${diceLeft(h.die, h.total)}/${h.total} d${h.die}`).join(', ') || 'none'}</p>
    <div class="row">
      <button type="button" onclick={() => onrest('short')}>Short rest</button>
      <button type="button" onclick={() => onrest('long')}>Long rest</button>
    </div>
  </div>

  {#if sheet.resistances.length || sheet.immunities.length || sheet.vulnerabilities.length}
    <div class="card">
      <h3>Damage types</h3>
      <ul class="plain">
        {#if sheet.resistances.length}<li>Resistant: {sheet.resistances.join(', ')}</li>{/if}
        {#if sheet.immunities.length}<li>Immune: {sheet.immunities.join(', ')}</li>{/if}
        {#if sheet.vulnerabilities.length}<li>Vulnerable: {sheet.vulnerabilities.join(', ')}</li>{/if}
      </ul>
    </div>
  {/if}

  <div class="card">
    <h3>Conditions</h3>
    <div class="row" role="group" aria-label="Conditions">
      {#each CONDITIONS as name (name)}
        <button type="button" class="chip" aria-pressed={c.state.conditions.includes(name)} onclick={() => toggleCondition(name)}>{name}</button>
      {/each}
    </div>
    <p class="row exhaustion" role="group" aria-labelledby="exh-l">
      <span id="exh-l">Exhaustion</span>
      <button type="button" aria-label="Lower exhaustion" disabled={c.state.exhaustion <= 0} onclick={() => patch({ exhaustion: c.state.exhaustion - 1 })}>−</button>
      <strong data-testid="exhaustion">{c.state.exhaustion}</strong>
      <button type="button" aria-label="Raise exhaustion" disabled={c.state.exhaustion >= 6} onclick={raiseExhaustion}>+</button>
      {#if c.state.exhaustion}<span class="muted">{EXHAUSTION[c.state.exhaustion]}</span>{/if}
    </p>
    <label class="check"><input type="checkbox" checked={c.state.inspiration} onchange={(e) => patch({ inspiration: e.currentTarget.checked })} /> Inspiration</label>
  </div>

  {#if sheet.resources.length}
    <div class="card">
      <h3>Resources</h3>
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
    </div>
  {/if}
</section>

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr));
    gap: 0 0.5rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .k {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .small {
    font-size: 0.85rem;
  }

  h3 {
    margin: 0 0 0.4rem;
  }

  .hpline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.5rem;
  }

  .now {
    font-size: 1.8rem;
    line-height: 1;
  }

  .hp input {
    width: 5rem;
  }

  .hp .row {
    margin: 0.4rem 0;
  }

  .life p {
    margin: 0.3rem 0;
  }

  .marks {
    letter-spacing: 0.15em;
    color: var(--accent);
  }

  .chip[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .chip {
    min-height: 2.2rem;
    border-radius: 1.2rem;
  }

  .exhaustion {
    margin: 0.75rem 0 0.25rem;
  }

  .res {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    padding: 0.25rem 0;
  }
</style>
