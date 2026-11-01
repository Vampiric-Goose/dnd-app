<script lang="ts">
  import { natD20 } from '../../lib/rolls.svelte.ts';
  import type { Sheet } from '../../lib/types.ts';
  import { signed, titleCase } from '../creator/labels.ts';
  import { rollD20, rollTo } from './roll.ts';

  let { sheet }: { sheet: Sheet } = $props();

  let crit = $state(false);

  function attack(name: string, toHit: number) {
    const r = rollD20(`${name} attack`, toHit, { shareAs: 'Attack' }); // R12: shared from DM view without the (maybe hidden) item name
    if (r) crit = natD20(r.detail) === 'nat20'; // each attack roll sets the box: ticked on a natural 20, cleared otherwise (tick it by hand for a 19 crit range)
  }

  function damage(label: string, expr: string, shareAs: string) {
    rollTo(label, expr, { crit, shareAs });
    crit = false;
  }
</script>

<!-- The "Attacks" drawer: one hairline row per attack, its roll buttons on the right. -->
<ul class="plain">
  {#each sheet.attacks as a (a.entryId)}
    <li>
      <span class="what">
        <strong>{a.name}</strong>
        <span class="muted small">{titleCase(a.damageType)}{a.properties.length ? `, ${a.properties.join(', ')}` : ''}</span>
      </span>
      <span class="rolls">
        <button type="button" aria-label="Roll {a.name} attack, {signed(a.toHit)}" onclick={() => attack(a.name, a.toHit)}>Attack <span class="num">{signed(a.toHit)}</span></button>
        <button type="button" aria-label="Roll {a.name} damage, {a.damage}" onclick={() => damage(`${a.name} damage`, a.damage, 'Damage')}>Damage <span class="num">{a.damage}</span></button>
        {#if a.versatile}
          <button type="button" aria-label="Roll {a.name} damage two-handed, {a.versatile}" onclick={() => damage(`${a.name} damage (two-handed)`, a.versatile!, 'Damage (two-handed)')}>Two-handed <span class="num">{a.versatile}</span></button>
        {/if}
      </span>
    </li>
  {:else}
    <li class="muted">No attacks. Equip a weapon in the inventory.</li>
  {/each}
</ul>
<label class="check" class:on={crit}><input type="checkbox" bind:checked={crit} /> Critical hit (the next damage roll doubles its dice)</label>

<style>
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem 1rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
  }

  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .what strong {
    color: var(--text-strong);
  }

  .rolls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .rolls .num {
    color: var(--text-strong);
  }

  .small {
    font-size: 0.85rem;
  }

  .check {
    margin-bottom: 0;
  }

  .check.on {
    color: var(--accent);
  }
</style>
