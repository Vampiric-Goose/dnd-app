<script lang="ts">
  import { fold } from '../lib/content/ids.ts';
  import { makeEntry } from '../lib/items/inventory.ts';
  import { playerItem } from '../lib/items/playerView.ts';
  import { stripStored } from '../lib/items/rows.ts';
  import type { InventoryEntry, ItemDef, StoredItem } from '../lib/types.ts';
  import type { Pool } from './items/pool.ts';
  import Menu from './kit/Menu.svelte';
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
      .filter((i) => (!type || seen(i).type === type) && (!rarity || seen(i).rarity === rarity)); // what the viewer sees, so a hidden rarity can't be probed
  });

  function pick(i: ItemDef) {
    const h = stored(i);
    onpick(makeEntry(h ? stripStored(h) : i, { sourceId: i.id, view: h?.defaultView && structuredClone($state.snapshot(h.defaultView)) }));
    last = nameOf(i);
  }
</script>

<div class="picker">
  <div class="filters">
    <input class="search" type="search" aria-label="Search" bind:value={q} autocomplete="off" placeholder="Search {pool.index.all('item').length + pool.homebrew.length} items…" />
    <Menu label={type || 'Type'} active={!!type} items={[{ label: 'Any type', checked: !type, onselect: () => (type = '') }, ...types.map((t) => ({ label: t, checked: type === t, onselect: () => (type = t) }))]} />
    <Menu label={rarity || 'Rarity'} active={!!rarity} items={[{ label: 'Any rarity', checked: !rarity, onselect: () => (rarity = '') }, ...RARITIES.map((r) => ({ label: r, checked: rarity === r, onselect: () => (rarity = r) }))]} />
  </div>
  <p class="muted note" aria-live="polite"><span class="num">{hits.length}</span> found. Click an item or press Enter to add it.{last ? ` Added ${last}.` : ''}</p>
  <div class="list">
    <VirtualList items={hits} label="Items" onselect={pick}>
      {#snippet row(i: ItemDef)}
        <strong>{nameOf(i)}</strong>
        <small class="muted">{[seen(i).type, seen(i).magic ? seen(i).rarity : undefined, stored(i) ? 'homebrew' : pool.index.label(i.source)].filter(Boolean).join(' · ')}</small>
      {/snippet}
    </VirtualList>
  </div>
</div>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .search {
    flex: 1 1 10rem;
    min-width: 0;
  }

  .note {
    margin: 0.4rem 0;
    font-size: 0.875rem;
  }

  .list {
    height: 16rem;
  }

  .list :global(.list) {
    border-color: var(--line);
    background: transparent;
  }

  .list :global(.item) {
    border-bottom-color: var(--line);
  }

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--text-strong);
    font-weight: 500;
  }
</style>
