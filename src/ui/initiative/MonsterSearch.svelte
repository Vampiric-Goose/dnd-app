<script lang="ts">
  // Add monster (tracker) and an encounter line (editor): a name search, the first 20 results, a count 1–99 and Add.
  import { filterMonsters } from '../../lib/monsters/library.ts';
  import type { MonsterDef } from '../../lib/types.ts';

  let { pool, label, onadd }: { pool: MonsterDef[]; label: string; onadd: (m: MonsterDef, count: number) => void } = $props();

  let q = $state('');
  let picked = $state('');
  let count: number | null = $state(1);
  const hits = $derived(filterMonsters(pool, { q }));
  const shown = $derived(hits.slice(0, 20));
  const id = $props.id();
  $effect(() => { if (!shown.some((m) => m.id === picked)) picked = shown[0]?.id ?? ''; });
  const ok = $derived(Number.isInteger(count) && count! >= 1 && count! <= 99 && !!picked);

  function add() {
    const m = shown.find((x) => x.id === picked);
    if (!m || !ok) return;
    onadd(m, count!);
    count = 1;
  }
</script>

<div class="search" role="group" aria-label={label}>
  <label class="row"><span>Search monsters</span><input type="search" bind:value={q} placeholder="Name" /></label>
  <p class="muted small" id="{id}-n" aria-live="polite">{hits.length} {hits.length === 1 ? 'match' : 'matches'}{hits.length > 20 ? ', first 20 shown' : ''}</p>
  <div class="row">
    <label class="row"><span>Monster</span>
      <select bind:value={picked} aria-describedby="{id}-n" disabled={!shown.length}>
        {#each shown as m (m.id)}<option value={m.id}>{m.name} (CR {m.cr}{m.source === 'SRD' ? '' : `, ${m.source}`})</option>{/each}
      </select>
    </label>
    <label class="row"><span>Count</span><input type="number" min="1" max="99" step="1" inputmode="numeric" bind:value={count} /></label>
    <button type="button" disabled={!ok} onclick={add}>Add</button>
  </div>
</div>

<style>
  .search {
    margin: 0.5rem 0;
  }

  select {
    max-width: 14rem;
  }

  input[type='number'] {
    width: 4rem;
  }

  .small {
    font-size: 0.85rem;
    margin: 0.2rem 0;
  }
</style>
