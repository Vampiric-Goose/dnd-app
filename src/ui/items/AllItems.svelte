<script lang="ts">
  import { importRecord } from '../../lib/backup.ts';
  import { db } from '../../lib/db.ts';
  import { catalogRows, filterCatalog, type CatalogRow } from '../../lib/items/catalog.ts';
  import { customize, importedItem } from '../../lib/items/homebrew.ts';
  import { makeEntry } from '../../lib/items/inventory.ts';
  import { stripStored } from '../../lib/items/rows.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { app } from '../../lib/store.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, Character, ItemDef, PlayerView } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import VirtualList from '../VirtualList.svelte';
  import { editUnassigned } from './loot.ts';
  import type { Pool } from './pool.ts';

  let { campaign, pool, chars, reload }: { campaign: Campaign; pool: Pool; chars: Character[]; reload: () => Promise<void> } = $props();

  const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
  const dm = $derived(app.viewer === 'dm');

  let q = $state('');
  let magic: '' | 'magic' | 'mundane' = $state('');
  let type = $state('');
  let rarity = $state('');
  let source = $state('');
  let selId = $state('');
  let error = $state('');
  let notice = $state('');
  let panel: 'give' | undefined = $state();
  let target = $state('');
  let qty: number | null = $state(1);
  let busy = $state(false);

  // Built once per content and viewer; typing only re-filters.
  const rows = $derived(catalogRows(pool.index.all('item'), pool.homebrew, app.viewer));
  const hits = $derived(filterCatalog(rows, { q, magic, type, rarity, source }));
  const types = $derived([...new Set(rows.map((r) => r.shown.type))].sort());
  const sources = $derived([...new Set(rows.map((r) => r.source))].sort());
  const selected = $derived(rows.find((r) => r.item.id === selId));

  const amount = $derived(Math.max(1, Math.floor(qty ?? 1)));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const sub = (r: CatalogRow) => [cap(r.shown.type), r.shown.magic && r.shown.rarity, pool.index.label(r.source)].filter(Boolean).join(' · ');

  function pick(r: CatalogRow) {
    selId = r.item.id;
    panel = undefined;
    error = notice = '';
  }

  const entryFor = (r: CatalogRow, quantity: number) =>
    makeEntry(r.stored ? stripStored(r.stored) : r.item, { sourceId: r.item.id, quantity, view: r.stored?.defaultView && (structuredClone($state.snapshot(r.stored.defaultView)) as PlayerView) });

  // The copy is saved at once and the editor opened on it, so the editor's leave guard has a real item to protect.
  // A copy the DM does not want is deleted from the editor.
  async function doCustomize(r: CatalogRow) {
    error = notice = '';
    try {
      const copy = customize(r.item, campaign.id);
      await db.items.put(copy);
      navigate(`items/${copy.id}`);
    } catch (e) {
      error = `Could not customize: ${message(e)}`;
    }
  }

  async function addToUnassigned(r: CatalogRow) {
    error = notice = '';
    await editUnassigned(campaign.id, (list) => [...list, entryFor(r, amount)]);
    toast(`Added ${amount} × ${r.shown.name} to Unassigned.`);
  }

  function askGive() {
    panel = 'give';
    target = chars[0]?.id ?? '';
  }

  // A single write to one character, read fresh first.
  // ponytail: if that character's sheet is open in another tab, its autosave can later write its older copy over this change; a cross-tab lock is not worth it yet.
  async function give(r: CatalogRow) {
    busy = true;
    error = notice = '';
    try {
      const ch = await db.characters.get(target);
      if (!ch) throw new Error('That character no longer exists.');
      await db.characters.put($state.snapshot({ ...ch, inventory: [...ch.inventory, entryFor(r, amount)] }) as Character);
      toast(`Gave ${amount} × ${r.shown.name} to ${ch.name || 'Unnamed'}.`);
      panel = undefined;
    } catch (e) {
      error = `Could not give it: ${message(e)}`;
    } finally {
      busy = false;
    }
  }

  const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

  // importRecord and importPdf don't save: this is where the item is put, as this campaign's homebrew under a fresh id.
  async function onImport(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    error = notice = '';
    try {
      let data: ItemDef & { defaultView?: PlayerView };
      if (isPdf(file)) {
        const { importPdf } = await import('../../lib/pdf/importPdf.ts'); // pdf-lib's own chunk, loaded only now
        const rec = await importPdf(new Uint8Array(await file.arrayBuffer()));
        if (rec.kind !== 'item') throw new Error('That file is a character. Import it on the Characters page.');
        data = rec.data;
      } else {
        const rec = await importRecord(file);
        if (rec.kind !== 'item') throw new Error('That file is a character. Import it on the Characters page.');
        data = rec.data;
      }
      const item = importedItem(data, campaign.id);
      await db.items.put(item);
      await reload();
      selId = item.id;
      notice = `Imported ${item.name} as homebrew.`;
    } catch (err) {
      error = message(err);
    }
  }

  // On a phone the detail replaces the list: put focus on its back button so keyboard users are not left behind.
  const focusOnPhone = (node: HTMLElement) => { if (matchMedia('(max-width: 767px)').matches) node.focus(); };
</script>

<div class="layout" class:has-detail={!!selected}>
  <section class="browse" aria-label="Browse">
    {#if dm}
      <div class="row actions">
        <button type="button" class="primary" onclick={() => navigate('items/new')}>New item</button>
        <label class="file"><span>Import item (.json / .pdf)</span>
          <input type="file" accept=".json,.pdf,application/json,application/pdf" onchange={onImport} />
        </label>
      </div>
    {/if}
    {#if error && !selected}<p role="alert" class="error">{error}</p>{/if}
    {#if notice && !selected}<p role="status">{notice}</p>{/if}

    <div class="row filters">
      <label class="field grow">Search
        <input type="search" bind:value={q} autocomplete="off" placeholder="{rows.length} items" />
      </label>
      <label class="field">Kind
        <select bind:value={magic}>
          <option value="">All</option>
          <option value="magic">Magic</option>
          <option value="mundane">Mundane</option>
        </select>
      </label>
      <label class="field">Type
        <select bind:value={type}><option value="">Any</option>{#each types as t (t)}<option value={t}>{cap(t)}</option>{/each}</select>
      </label>
      <label class="field">Rarity
        <select bind:value={rarity}><option value="">Any</option>{#each RARITIES as r (r)}<option value={r}>{cap(r)}</option>{/each}</select>
      </label>
      <label class="field">Source
        <select bind:value={source}><option value="">All</option>{#each sources as s (s)}<option value={s}>{pool.index.label(s)}</option>{/each}</select>
      </label>
    </div>

    <p class="muted count" aria-live="polite">{hits.length} {hits.length === 1 ? 'item' : 'items'}</p>
    <div class="listwrap">
      <VirtualList items={hits} {selected} label="All items" onselect={pick}>
        {#snippet row(r: CatalogRow)}
          <span class="name">
            <strong>{r.shown.name}</strong>
            {#if r.shown.magic}<span class="tag">Magic</span>{/if}
            {#if r.stored}<span class="tag">Homebrew</span>{/if}
          </span>
          <span class="muted small">{sub(r)}</span>
        {/snippet}
      </VirtualList>
    </div>
  </section>

  <section class="detail" aria-label="Details">
    {#if selected}
      <button type="button" class="back" onclick={() => (selId = '')} {@attach focusOnPhone}>&larr; Back to list</button>
      <div class="card">
        <EntityDetail entity={selected.item} index={pool.index} />
        {#if dm}
          <div class="row">
            {#if selected.stored}
              <button type="button" onclick={() => navigate(`items/${selected.item.id}`)}>Edit</button>
            {:else}
              <button type="button" onclick={() => doCustomize(selected)}>Customize</button>
            {/if}
            <label class="field inline">Quantity <input type="number" min="1" step="1" bind:value={qty} /></label>
            <button type="button" onclick={() => addToUnassigned(selected)}>Add to Unassigned</button>
            <button type="button" disabled={!chars.length} title={chars.length ? '' : 'There are no characters in this campaign'} aria-expanded={panel === 'give'} onclick={askGive}>Give to…</button>
          </div>
          {#if panel === 'give'}
            <div class="panel" role="group" aria-label="Give {selected.shown.name}">
              <label class="field">To <select bind:value={target}>{#each chars as c (c.id)}<option value={c.id}>{c.name || 'Unnamed'}</option>{/each}</select></label>
              <p>Give {amount} × {selected.shown.name} to {chars.find((c) => c.id === target)?.name || 'Unnamed'}?</p>
              <div class="row">
                <button type="button" class="primary" disabled={busy || !target} onclick={() => give(selected)}>Confirm</button>
                <button type="button" onclick={() => (panel = undefined)}>Cancel</button>
              </div>
            </div>
          {/if}
        {/if}
        {#if error}<p role="alert" class="error">{error}</p>{/if}
        {#if notice}<p role="status">{notice}</p>{/if}
      </div>
    {:else}
      <p class="muted placeholder">Select an item to read it.</p>
    {/if}
  </section>
</div>

<style>
  .layout { display: block; }
  .actions { align-items: center; margin-bottom: 0.5rem; }
  .file { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0; }
  .file span { white-space: nowrap; }
  .filters { align-items: flex-end; }
  .filters .field { margin: 0.25rem 0; min-width: 0; }
  .grow { flex: 1 1 12rem; }
  .inline { margin: 0; flex-direction: row; align-items: center; gap: 0.4rem; }
  .inline input { width: 5rem; }
  .count { margin: 0.25rem 0; }
  .listwrap { height: 60dvh; min-height: 16rem; }
  .name, .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.25; }
  .small { font-size: 0.75rem; }
  .tag { border: 1px solid var(--accent); color: var(--accent); border-radius: 0.3rem; padding: 0 0.3rem; font-size: 0.7rem; margin-left: 0.3rem; }
  .detail { min-width: 0; }
  .placeholder { display: none; }
  .panel { margin-top: 0.6rem; padding-top: 0.6rem; border-top: 1px solid var(--border); }

  @media (max-width: 767px) {
    .has-detail .browse { display: none; }
    .detail:not(:has(.card)) { display: none; }
  }

  @media (min-width: 768px) {
    .layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 1rem; align-items: start; }
    .listwrap { height: calc(100dvh - 20rem); }
    .detail { position: sticky; top: 0.5rem; max-height: calc(100dvh - 1rem); overflow-y: auto; }
    .detail .card { margin-top: 0; }
    .placeholder { display: block; }
    .back { display: none; }
  }
</style>
