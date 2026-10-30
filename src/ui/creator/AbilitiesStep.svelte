<script lang="ts">
  import { pointBuyCost } from '../../lib/rules/abilities.ts';
  import { ABILITIES, POINT_BUY_BUDGET, POINT_BUY_COST, STANDARD_ARRAY, abilityMod } from '../../lib/rules/constants.ts';
  import { roll } from '../../lib/rolls.svelte.ts';
  import type { Ability, CampaignSettings, Character, Scores, Sheet } from '../../lib/types.ts';
  import { ABILITY_NAMES, signed } from './labels.ts';

  let { c = $bindable(), rolls = $bindable(), settings, sheet }: { c: Character; rolls: number[]; settings: CampaignSettings; sheet: Sheet } = $props();

  type Method = Character['build']['abilityMethod'];
  const methods = $derived<[Method, string][]>([
    ['pointBuy', 'Point buy'], ['standard', 'Standard array'], ['rolled', 'Rolled (4d6, drop the lowest)'],
    ...(settings.allowOverrides || c.build.abilityMethod === 'manual' ? [['manual', 'Type them in'] as [Method, string]] : []),
  ]);
  const s = $derived(c.build.baseScores);
  const all = (n: number): Scores => ({ str: n, dex: n, con: n, int: n, wis: n, cha: n });

  function setMethod(m: Method) {
    c.build.abilityMethod = m;
    // 0 means "not assigned yet" for the standard array and rolled scores.
    if (m !== 'manual') c.build.baseScores = all(m === 'pointBuy' ? 8 : 0);
    if (m === 'rolled') rolls = [];
  }

  const cost = $derived(pointBuyCost(s));
  const canRaise = (a: Ability) => s[a] < 15 && cost !== null && cost - POINT_BUY_COST[s[a]] + POINT_BUY_COST[s[a] + 1] <= POINT_BUY_BUDGET;

  // A value from the pool is free for `a` while the pool holds more copies of it than the other abilities use.
  const pool = $derived(c.build.abilityMethod === 'rolled' ? rolls : STANDARD_ARRAY);
  const free = (a: Ability, v: number) => pool.filter((x) => x === v).length > ABILITIES.filter((b) => b !== a && s[b] === v).length;
  const poolValues = $derived([...new Set(pool)].sort((x, y) => y - x));

  function rollAll() {
    rolls = Array.from({ length: 6 }, () => roll('Ability score', '4d6kh3').total);
    c.build.baseScores = all(0);
  }

  // Custom origin (Tasha's): the racial increases move to any abilities.
  function setOrigin(a: Ability, n: number) {
    const o = { ...c.build.customOrigin };
    if (n) o[a] = n;
    else delete o[a];
    c.build.customOrigin = o;
  }
  function toggleOrigin(on: boolean) {
    if (on) c.build.customOrigin = {};
    else delete c.build.customOrigin;
  }
</script>

<fieldset>
  <legend>Method</legend>
  {#each methods as [m, label]}
    <label class="check"><input type="radio" name="method" checked={c.build.abilityMethod === m} onchange={() => setMethod(m)} /> {label}</label>
  {/each}
</fieldset>

{#if c.build.abilityMethod === 'pointBuy'}
  <p aria-live="polite"><strong>{cost === null ? '?' : POINT_BUY_BUDGET - cost}</strong> of {POINT_BUY_BUDGET} points left</p>
{:else if c.build.abilityMethod === 'rolled'}
  <p class="row">
    <button type="button" onclick={rollAll}>{rolls.length ? 'Roll again' : 'Roll six scores'}</button>
    {#if rolls.length}<span>Rolled: {rolls.join(', ')}</span>{/if}
  </p>
{/if}

<div class="scroll">
  <table>
    <thead><tr><th scope="col">Ability</th><th scope="col">Base</th><th scope="col">Total</th><th scope="col">Mod</th></tr></thead>
    <tbody>
      {#each ABILITIES as a}
        <tr>
          <th scope="row">{ABILITY_NAMES[a]}</th>
          <td>
            {#if c.build.abilityMethod === 'pointBuy'}
              <span class="row nowrap">
                <button type="button" aria-label="Lower {ABILITY_NAMES[a]}" disabled={s[a] <= 8} onclick={() => (c.build.baseScores[a] = s[a] - 1)}>−</button>
                <span class="num">{s[a]}</span>
                <button type="button" aria-label="Raise {ABILITY_NAMES[a]}" disabled={!canRaise(a)} onclick={() => (c.build.baseScores[a] = s[a] + 1)}>+</button>
              </span>
            {:else if c.build.abilityMethod === 'manual'}
              <input type="number" min="1" max="30" aria-label={ABILITY_NAMES[a]} value={s[a]} oninput={(e) => (c.build.baseScores[a] = Number(e.currentTarget.value) || 0)} />
            {:else}
              <select aria-label={ABILITY_NAMES[a]} value={String(s[a] || '')} disabled={!pool.length} onchange={(e) => (c.build.baseScores[a] = Number(e.currentTarget.value) || 0)}>
                <option value="">—</option>
                {#each poolValues as v}<option value={String(v)} disabled={s[a] !== v && !free(a, v)}>{v}</option>{/each}
              </select>
            {/if}
          </td>
          <td>{sheet.scores[a]}</td>
          <td>{signed(abilityMod(sheet.scores[a]))}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
<p class="muted">Total includes racial increases and any ability score improvements chosen later.</p>

{#if settings.customOrigin}
  <h3>Customize your origin</h3>
  <label class="check">
    <input type="checkbox" checked={!!c.build.customOrigin} onchange={(e) => toggleOrigin(e.currentTarget.checked)} />
    Move the racial ability increases: +2 and +1, or +1 to three scores
  </label>
  {#if c.build.customOrigin}
    <div class="row">
      {#each ABILITIES as a}
        <label class="field">
          {ABILITY_NAMES[a]}
          <select value={String(c.build.customOrigin[a] ?? 0)} onchange={(e) => setOrigin(a, Number(e.currentTarget.value))}>
            <option value="0">—</option><option value="1">+1</option><option value="2">+2</option>
          </select>
        </label>
      {/each}
    </div>
  {/if}
{/if}

<style>
  fieldset { border: 0; padding: 0; margin: 0; }
  legend { font-weight: 600; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; }
  th, td { padding: 0.25rem 0.5rem; text-align: left; border-bottom: 1px solid var(--border); }
  .nowrap { flex-wrap: nowrap; }
  .num { min-width: 1.5rem; text-align: center; }
  input[type='number'] { width: 5rem; }
</style>
