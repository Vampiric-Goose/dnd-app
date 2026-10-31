<script lang="ts">
  import { natD20 } from '../../lib/rolls.svelte.ts';
  import type { Sheet } from '../../lib/types.ts';
  import { signed, titleCase } from '../creator/labels.ts';
  import { rollD20, rollTo } from './roll.ts';

  let { sheet }: { sheet: Sheet } = $props();

  let crit = $state(false);

  function attack(name: string, toHit: number) {
    const r = rollD20(`${name} attack`, toHit);
    if (r && natD20(r.detail) === 'nat20') crit = true; // a natural 20 ticks Critical hit for the damage roll; untick to override
  }

  function damage(label: string, expr: string) {
    rollTo(label, expr, { crit });
    crit = false;
  }
</script>

<section aria-labelledby="attacks-h">
  <h2 id="attacks-h">Attacks</h2>
  <div class="card">
    <label class="check"><input type="checkbox" bind:checked={crit} /> Critical hit (the next damage roll doubles its dice)</label>
    <ul class="plain">
      {#each sheet.attacks as a (a.entryId)}
        <li>
          <strong>{a.name}</strong>
          <span class="muted small">{titleCase(a.damageType)}{a.properties.length ? `, ${a.properties.join(', ')}` : ''}</span>
          <span class="row">
            <button type="button" aria-label="Roll {a.name} attack, {signed(a.toHit)}" onclick={() => attack(a.name, a.toHit)}>Attack {signed(a.toHit)}</button>
            <button type="button" aria-label="Roll {a.name} damage, {a.damage}" onclick={() => damage(`${a.name} damage`, a.damage)}>Damage {a.damage}</button>
            {#if a.versatile}
              <button type="button" aria-label="Roll {a.name} damage two-handed, {a.versatile}" onclick={() => damage(`${a.name} damage (two-handed)`, a.versatile!)}>Two-handed {a.versatile}</button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  </div>
</section>

<style>
  li {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.4rem 0;
  }

  li + li {
    border-top: 1px solid var(--border);
  }

  .small {
    font-size: 0.85rem;
  }
</style>
