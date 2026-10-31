<script lang="ts">
  import { tick } from 'svelte';
  import { importRecord } from '../../lib/backup.ts';
  import { db } from '../../lib/db.ts';
  import { catalogRows, filterCatalog, type CatalogRow } from '../../lib/items/catalog.ts';
  import { customize, importedItem } from '../../lib/items/homebrew.ts';
  import { makeEntry } from '../../lib/items/inventory.ts';
  import { stripStored } from '../../lib/items/rows.ts';
  import { leaveGuard, navigate } from '../../lib/router.svelte.ts';
  import { app } from '../../lib/store.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, Character, ItemDef, PlayerView } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import VirtualList from '../VirtualList.svelte';
  import PasteDialog from '../PasteDialog.svelte';
  import { pasted } from '../pasted.ts';
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
  let pasting = $state(false);
  let panel: 'give' | undefined = $state();
  let target = $state('');
  let qty: number | null = $state(1);
  let busy = $state(false);
  let confirmingRemove = $state(false);
  let giveBtn: HTMLButtonElement | undefined = $state();
  let giveSelect: HTMLSelectElement | undefined = $state();

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
  // `busy` guards all three writes, so a double-click creates or adds only once.
  async function doCustomize(r: CatalogRow) {
    if (busy) return;
    busy = true;
    error = notice = '';
    try {
      const copy = customize(r.item, campaign.id);
      await db.items.put(copy);
      navigate(`items/${copy.id}`);
    } catch (e) {
      error = `Could not customize: ${message(e)}`;
    } finally {
      busy = false;
    }
  }

  async function addToUnassigned(r: CatalogRow) {
    if (busy) return;
    busy = true;
    error = notice = '';
    try {
      const n = amount;
      if (await editUnassigned(campaign.id, (list) => [...list, entryFor(r, n)])) toast(`Added ${n} × ${r.shown.name} to Unassigned.`); // a failure was already toasted
    } finally {
      busy = false;
    }
  }

  async function askGive() {
    panel = 'give';
    target = chars[0]?.id ?? '';
    await tick();
    giveSelect?.focus();
  }

  async function closeGive() {
    panel = undefined;
    await tick();
    giveBtn?.focus();
  }

  async function backToList() {
    selId = '';
    panel = undefined;
    await tick();
    document.querySelector<HTMLElement>('.listwrap [role=listbox]')?.focus(); // its active option is the item that was open
  }

  // A single write to one character, read fresh first.
  // ponytail: if that character's sheet is open in another tab, its autosave can later write its older copy over this change; a cross-tab lock is not worth it yet.
  async function give(r: CatalogRow) {
    if (busy) return;
    busy = true;
    error = notice = '';
    try {
      const ch = await db.characters.get(target);
      if (!ch) throw new Error('That character no longer exists.');
      await db.characters.put($state.snapshot({ ...ch, inventory: [...ch.inventory, entryFor(r, amount)] }) as Character);
      toast(`Gave ${amount} × ${r.shown.name} to ${ch.name || 'Unnamed'}.`);
      void closeGive();
    } catch (e) {
      error = `Could not give it: ${message(e)}`;
    } finally {
      busy = false;
    }
  }

  // Damaged records (old bad imports, a damaged restore) are hidden everywhere; this is how the DM clears them out.
  async function removeDamaged() {
    if (busy) return;
    busy = true;
    error = notice = '';
    try {
      const n = pool.damaged.length;
      for (const d of pool.damaged) await db.items.delete(d.id);
      await reload();
      confirmingRemove = false;
      toast(`Removed ${n} damaged ${n === 1 ? 'item' : 'items'}.`);
    } catch (e) {
      error = `Could not remove them: ${message(e)}`;
    } finally {
      busy = false;
    }
  }

  const isPdf =(f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

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
        if (rec.kind !== 'item') throw new Error(rec.kind === 'monster' ? 'That file is a monster. Import it on the Monsters page.' : 'That file is a character. Import it on the Characters page.');
        data = rec.data;
      } else {
        const rec = await importRecord(file);
        if (rec.kind !== 'item') throw new Error(rec.kind === 'monster' ? 'That file is a monster. Import it on the Monsters page.' : 'That file is a character. Import it on the Characters page.');
        data = rec.data;
      }
      const { item, ignored } = importedItem(data, campaign.id);
      await db.items.put(item);
      await reload();
      selId = item.id;
      const lost = ignored.map((k) => `a damaged ${k === 'defaultView' ? 'player view' : k} block`);
      notice = `Imported ${item.name} as homebrew${lost.length ? ` (ignored ${lost.join(', ')})` : ''}.`;
    } catch (err) {
      error = message(err);
    }
  }

  // On a phone the detail replaces the list: put focus on its back button so keyboard users are not left behind.
  const focusOnPhone = (node: HTMLElement) => { if (matchMedia('(max-width: 767px)').matches) node.focus(); };
</script>

{#if pasting && dm}
  <PasteDialog kind="item" oncancel={() => (pasting = false)} onread={(draft, notes) => { pasted.item = { draft: draft as ItemDef, notes }; pasting = false; navigate('items/new?pasted=1'); }} />
{/if}
<div class="layout" class:has-detail={!!selected}>
  <section class="browse" aria-label="Browse">
    {#if dm}
      <div class="row actions">
        <button type="button" class="primary" onclick={() => navigate('items/new')}>New item</button>
        <button type="button" aria-expanded={pasting} onclick={() => { if (!pasting || leaveGuard.fn?.() !== false) pasting = !pasting; }}>Paste an item</button>
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

    {#if pool.damaged.length}
      <div class="row damaged">
        <p role="status">{pool.damaged.length} damaged {pool.damaged.length === 1 ? 'item' : 'items'} hidden</p>
        {#if dm && !confirmingRemove}
          <button type="button" onclick={() => (confirmingRemove = true)}>Remove damaged items</button>
        {/if}
      </div>
      {#if dm && confirmingRemove}
        <div role="alertdialog" aria-label="Confirm removing damaged items" class="row">
          <p>Permanently remove {pool.damaged.length} damaged homebrew {pool.damaged.length === 1 ? 'item' : 'items'}? This cannot be undone.</p>
          <button type="button" class="danger" disabled={busy} onclick={removeDamaged}>Remove</button>
          <button type="button" onclick={() => (confirmingRemove = false)}>Keep them</button>
        </div>
      {/if}
    {/if}

    <p class="muted count" aria-live="polite">{hits.length} {hits.length === 1 ? 'item' : 'items'}</p>
    <div class="listwrap">
      <VirtualList items={hits} {selected} label="All items" onselect={pick}>
        {#snippet row(r: CatalogRow)}
          <span class="line">
            <strong class="name">{r.shown.name}</strong>
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
      <button type="button" class="back" onclick={backToList} {@attach focusOnPhone}>&larr; Back to list</button>
      <div class="card">
        <EntityDetail entity={selected.item} index={pool.index} />
        {#if dm}
          <div class="row">
            {#if selected.stored}
              <button type="button" onclick={() => navigate(`items/${selected.item.id}`)}>Edit</button>
            {:else}
              <button type="button" disabled={busy} onclick={() => doCustomize(selected)}>Customize</button>
            {/if}
            <label class="field inline">Quantity <input type="number" min="1" step="1" bind:value={qty} /></label>
            <button type="button" disabled={busy} onclick={() => addToUnassigned(selected)}>Add to Unassigned</button>
            <button type="button" bind:this={giveBtn} disabled={!chars.length} aria-describedby={chars.length ? undefined : 'give-why'} aria-expanded={panel === 'give'} onclick={askGive}>Give to…</button>
          </div>
          {#if !chars.length}<p id="give-why" class="muted">Give to… needs a character in this campaign.</p>{/if}
          {#if panel === 'give'}
            <div class="panel" role="group" aria-label="Give {selected.shown.name}">
              <label class="field">To <select bind:this={giveSelect} bind:value={target}>{#each chars as c (c.id)}<option value={c.id}>{c.name || 'Unnamed'}</option>{/each}</select></label>
              <p>Give {amount} × {selected.shown.name} to {chars.find((c) => c.id === target)?.name || 'Unnamed'}?</p>
              <div class="row">
                <button type="button" class="primary" disabled={busy || !target} onclick={() => give(selected)}>Confirm</button>
                <button type="button" onclick={closeGive}>Cancel</button>
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
  .damaged { align-items: center; }
  .damaged p { margin: 0.25rem 0; }
  .count { margin: 0.25rem 0; }
  .listwrap { height: 60dvh; min-height: 16rem; }
  .name, .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.25; }
  .small { font-size: 0.75rem; }
  .line { display: flex; align-items: center; gap: 0.3rem; min-width: 0; } /* the name truncates; the tags never do */
  .name { min-width: 0; }
  .tag { flex: none; border: 1px solid var(--accent); color: var(--accent); border-radius: 0.3rem; padding: 0 0.3rem; font-size: 0.7rem; }
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
