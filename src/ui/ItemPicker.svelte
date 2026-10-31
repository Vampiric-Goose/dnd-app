<script lang="ts">
  import { fold } from '../lib/content/ids.ts';
  import { makeEntry } from '../lib/items/inventory.ts';
  import { playerItem } from '../lib/items/playerView.ts';
  import { stripStored } from '../lib/items/rows.ts';
  import type { InventoryEntry, ItemDef, StoredItem } from '../lib/types.ts';
  import type { Pool } from './items/pool.ts';
  import VirtualList from './VirtualList.svelte';

  let { pool, viewer, onpick }: { pool: Pool; viewer: 'dm' | 'player'; onpick: (entry: InventoryEntry) => void } = $props();

  let q = $state('');
  let type = $state('');
  let rarity = $state('');
  let last = $state('');

  const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
  const stored = (i: ItemDef): StoredItem | undefined => pool.homebrew.find((h) => h.id === i.id);
  // A player must not learn a homebrew item's real name or hidden rarity from the list or the search.
  const seen = (i: ItemDef) => (viewer === 'player' && stored(i) ? playerItem(i, stored(i)!.defaultView) : i);
  const nameOf = (i: ItemDef) => seen(i).name;

  const types = $derived([...new Set([...pool.homebrew, ...pool.index.all('item')].map((i) => i.type))].sort());
  // Filter first, then let the virtual list draw only the visible rows (about 3,400 items with the packs loaded).
  const hits = $derived.by<ItemDef[]>(() => {
    const n = fold(q.trim());
    const own = pool.homebrew.filter((h) => fold(nameOf(h)).includes(n));
    return [...own, ...pool.index.search(q, ['item'], Infinity).filter((e): e is ItemDef => e.kind === 'item')]
      .filter((i) => (!type || i.type === type) && (!rarity || i.rarity === rarity));
  });

  function pick(i: ItemDef) {
    const h = stored(i);
    onpick(makeEntry(h ? stripStored(h) : i, { sourceId: i.id, view: h?.defaultView && structuredClone($state.snapshot(h.defaultView)) }));
    last = nameOf(i);
  }
</script>

<div class="picker card">
  <div class="row">
    <label class="field">Search <input type="search" bind:value={q} autocomplete="off" placeholder="{pool.index.all('item').length + pool.homebrew.length} items" /></label>
    <label class="field">Type
      <select bind:value={type}><option value="">Any</option>{#each types as t (t)}<option value={t}>{t}</option>{/each}</select>
    </label>
    <label class="field">Rarity
      <select bind:value={rarity}><option value="">Any</option>{#each RARITIES as r (r)}<option value={r}>{r}</option>{/each}</select>
    </label>
  </div>
  <p class="muted" aria-live="polite">{hits.length} found. Click an item or press Enter to add it.{last ? ` Added ${last}.` : ''}</p>
  <div class="list">
    <VirtualList items={hits} label="Items" onselect={pick}>
      {#snippet row(i: ItemDef)}
        <strong>{nameOf(i)}</strong>
        <small class="muted">{[seen(i).type, seen(i).magic ? seen(i).rarity : undefined, stored(i) ? 'homebrew' : i.source].filter(Boolean).join(' · ')}</small>
      {/snippet}
    </VirtualList>
  </div>
</div>

<style>
  .list {
    height: 16rem;
  }

  .field {
    margin: 0;
  }
</style>
