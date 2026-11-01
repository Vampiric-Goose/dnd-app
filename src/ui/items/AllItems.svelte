<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { importRecord } from '../../lib/backup.ts';
  import { db } from '../../lib/db.ts';
  import { catalogRows, filterCatalog, HOMEBREW_SOURCE, type CatalogFilter, type CatalogRow } from '../../lib/items/catalog.ts';
  import { customize, importedItem } from '../../lib/items/homebrew.ts';
  import { makeEntry } from '../../lib/items/inventory.ts';
  import { playerItem } from '../../lib/items/playerView.ts';
  import { stripStored } from '../../lib/items/rows.ts';
  import { leaveGuard, navigate } from '../../lib/router.svelte.ts';
  import { app } from '../../lib/store.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, Character, ItemDef, PlayerView } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import { downloadPdf, fileName } from '../download.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import Drawer from '../kit/Drawer.svelte';
  import Menu, { type MenuItem } from '../kit/Menu.svelte';
  import Pill from '../kit/Pill.svelte';
  import Workspace from '../kit/Workspace.svelte';
  import VirtualList from '../VirtualList.svelte';
  import PasteDialog from '../PasteDialog.svelte';
  import { pasted } from '../pasted.ts';
  import { editUnassigned } from './loot.ts';
  import type { Pool } from './pool.ts';

  let { campaign, pool, chars, reload, tabs }: { campaign: Campaign; pool: Pool; chars: Character[]; reload: () => Promise<void>; tabs: Snippet } = $props();

  const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
  const dm = $derived(app.viewer === 'dm');
  const phone = new MediaQuery('max-width: 767px');

  let q = $state('');
  let magic: '' | 'magic' | 'mundane' = $state('');
  let type = $state('');
  let rarity = $state('');
  let source = $state('');
  let sortKey: SortKey = $state('name');
  let sortDesc = $state(false);
  let selId = $state('');
  let error = $state('');
  let notice = $state('');
  let pasting = $state(false);
  let step: 'give' | undefined = $state();
  let target = $state('');
  let qty: number | null = $state(1);
  let busy = $state(false);
  let confirmingRemove = $state(false);
  let giveBtn: HTMLButtonElement | undefined = $state();
  let giveSelect: HTMLSelectElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();

  // Built once per content and viewer; typing only re-filters.
  const rows = $derived(catalogRows(pool.index.all('item'), pool.homebrew, app.viewer));
  const filter = $derived<CatalogFilter>({ q, magic, type, rarity, source });
  const hits = $derived(filterCatalog(rows, filter));
  const types = $derived([...new Set(rows.map((r) => r.shown.type))].sort());
  const sources = $derived([...new Set(rows.map((r) => r.source))].sort());
  const selected = $derived(rows.find((r) => r.item.id === selId));

  const amount = $derived(Math.max(1, Math.floor(qty ?? 1)));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Table columns. Each reads what the viewer sees (`shown`), so a hidden rarity or attunement stays hidden.
  type SortKey = 'name' | 'type' | 'rarity' | 'attune' | 'source';
  const COLS: [SortKey, string][] = [['name', 'Name'], ['type', 'Type'], ['rarity', 'Rarity'], ['attune', 'Attunement'], ['source', 'Source']];
  const rarityOf = (r: CatalogRow) => (r.shown.magic && r.shown.rarity) || '';
  const attuneOf = (r: CatalogRow) => (r.shown.attunement === true ? 'Yes' : typeof r.shown.attunement === 'string' ? r.shown.attunement : '');
  const sourceOf = (r: CatalogRow) => pool.index.label(r.source);
  const shortSource = (r: CatalogRow) => (r.source === HOMEBREW_SOURCE ? 'Homebrew' : r.source); // the table cell; the full name is its tooltip
  const keyOf: Record<SortKey, (r: CatalogRow) => string | number> = {
    name: (r) => r.folded,
    type: (r) => r.shown.type,
    rarity: (r) => (rarityOf(r) ? RARITIES.indexOf(rarityOf(r)) : RARITIES.length),
    attune: (r) => (attuneOf(r) ? 0 : 1),
    source: shortSource,
  };
  // `hits` is in name order, and the sort is stable, so ties stay alphabetical.
  const sorted = $derived.by(() => {
    if (sortKey === 'name' && !sortDesc) return hits;
    const k = keyOf[sortKey];
    const dir = sortDesc ? -1 : 1;
    return [...hits].sort((a, b) => { const x = k(a), y = k(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  });
  const sortLabel = $derived(COLS.find(([k]) => k === sortKey)![1]);
  function sortBy(k: SortKey) {
    if (sortKey === k) sortDesc = !sortDesc;
    else { sortKey = k; sortDesc = false; }
  }

  // Filter pull-downs: each count is what that choice would show with the other filters kept.
  const countBy = (without: keyof CatalogFilter, key: (r: CatalogRow) => string) => {
    const m = new Map<string, number>();
    for (const r of filterCatalog(rows, { ...filter, [without]: '' })) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return m;
  };
  const kindCounts = $derived(countBy('magic', (r) => (r.shown.magic ? 'magic' : 'mundane')));
  const typeCounts = $derived(countBy('type', (r) => r.shown.type));
  const rarityCounts = $derived(countBy('rarity', (r) => r.shown.rarity ?? ''));
  const sourceCounts = $derived(countBy('source', (r) => r.source));
  const choice = (value: string, set: (v: string) => void, all: string, opts: [string, string][], counts: Map<string, number>): MenuItem[] => [
    { label: all, checked: value === '', onselect: () => set('') },
    ...opts.map(([v, label]) => ({ label, count: counts.get(v) ?? 0, checked: value === v, onselect: () => set(v) })),
  ];
  const kindItems = $derived(choice(magic, (v) => (magic = v as typeof magic), 'All', [['magic', 'Magic'], ['mundane', 'Mundane']], kindCounts));
  const typeItems = $derived(choice(type, (v) => (type = v), 'Any type', types.map((t) => [t, cap(t)]), typeCounts));
  const rarityItems = $derived(choice(rarity, (v) => (rarity = v), 'Any rarity', RARITIES.map((r) => [r, cap(r)]), rarityCounts));
  const sourceItems = $derived(choice(source, (v) => (source = v), 'All sources', sources.map((s) => [s, pool.index.label(s)]), sourceCounts));
  const sortItems = $derived<MenuItem[]>([
    ...COLS.map(([k, label]) => ({ label, checked: sortKey === k, onselect: () => { sortKey = k; } })),
    { separator: true },
    { label: 'Ascending', checked: !sortDesc, onselect: () => (sortDesc = false) },
    { label: 'Descending', checked: sortDesc, onselect: () => (sortDesc = true) },
  ]);
  const pills = $derived(
    ([
      [magic, cap(magic), () => (magic = '')],
      [type, cap(type), () => (type = '')],
      [rarity, cap(rarity), () => (rarity = '')],
      [source, pool.index.label(source), () => (source = '')],
    ] as const).filter(([v]) => v !== ''),
  );
  const clearAll = () => { q = magic = type = rarity = source = ''; };

  const newItems = $derived<MenuItem[]>([
    { label: 'New item', onselect: () => navigate('items/new') },
    { label: 'Paste an item', onselect: () => { if (!pasting || leaveGuard.fn?.() !== false) pasting = !pasting; } },
    { label: 'Import item (.json / .pdf)', onselect: () => fileInput?.click() },
  ]);

  // The item's sub line: the same facts as the table row.
  const sub = (r: CatalogRow, short = false) => [cap(r.shown.type), rarityOf(r) && cap(rarityOf(r)), r.shown.attunement && (attuneOf(r) === 'Yes' ? 'attunement' : `attunement ${attuneOf(r)}`), short ? shortSource(r) : sourceOf(r)].filter(Boolean).join(' · ');

  function pick(r: CatalogRow) {
    selId = r.item.id;
    step = undefined;
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
    step = 'give';
    target = chars[0]?.id ?? '';
    await tick();
    giveSelect?.focus();
  }

  async function closeGive() {
    step = undefined;
    await tick();
    giveBtn?.focus();
  }

  async function backToList() {
    selId = '';
    step = undefined;
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

  // What this viewer may see, as the inventory row's Export PDF does: the DM's full item, a player's cover and bars.
  async function exportPdf(r: CatalogRow) {
    try {
      const { exportItemPdf } = await import('../../lib/pdf/exportPdf.ts');
      downloadPdf(await exportItemPdf(dm ? (r.stored ? stripStored(r.stored) : r.item) : r.shown), fileName(r.shown.name, 'pdf', 'item'));
    } catch (e) {
      error = `Could not export the PDF: ${message(e)}`;
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
</script>

{#if pasting && dm}
  <PasteDialog kind="item" oncancel={() => (pasting = false)} onread={(draft, notes) => { pasted.item = { draft: draft as ItemDef, notes }; pasting = false; navigate('items/new?pasted=1'); }} />
{/if}

<Workspace panelLabel="Item" open={!!selected} onclose={backToList}>
  <section class="browse" aria-label="Browse">
    <div class="head">
      {@render tabs()}
      {#if dm}
        <span class="end">
          <Menu label="+ New item" align="end" items={newItems} />
          <input bind:this={fileInput} class="sr-only" type="file" tabindex="-1" aria-label="Import item (.json / .pdf)" accept=".json,.pdf,application/json,application/pdf" onchange={onImport} />
        </span>
      {/if}
    </div>
    {#if error && !selected}<p role="alert" class="error">{error}</p>{/if}
    {#if notice && !selected}<p role="status">{notice}</p>{/if}

    <div class="filters">
      <input class="search" type="search" aria-label="Search" bind:value={q} autocomplete="off" placeholder="Search {rows.length} items…" />
      <div class="menus">
      <Menu label={magic ? cap(magic) : 'Kind'} active={!!magic} items={kindItems} />
      <Menu label={rarity ? cap(rarity) : 'Rarity'} active={!!rarity} items={rarityItems} />
      <Menu label={type ? cap(type) : 'Type'} active={!!type} items={typeItems} />
      <Menu label={source ? pool.index.label(source) : 'Source'} active={!!source} items={sourceItems} />
      <Menu label="Sort: {sortLabel}{sortDesc ? ' ↓' : ''}" items={sortItems} align="end" />
      </div>
    </div>

    <div class="status">
      {#each pills as [, label, clear] (label)}<Pill {label} onremove={clear} />{/each}
      <span class="muted count" aria-live="polite"><span class="num">{hits.length}</span> {hits.length === 1 ? 'item' : 'items'}</span>
      {#if pills.length || q}<button type="button" class="link" onclick={clearAll}>clear</button>{/if}
    </div>

    {#if pool.damaged.length}
      <div class="damaged">
        <p role="status" class="error">{pool.damaged.length} damaged {pool.damaged.length === 1 ? 'item' : 'items'} hidden</p>
        {#if dm && !confirmingRemove}
          <button type="button" onclick={() => (confirmingRemove = true)}>Remove damaged items</button>
        {/if}
      </div>
      {#if dm && confirmingRemove}
        <div role="alertdialog" aria-label="Confirm removing damaged items" class="damaged">
          <p>Permanently remove {pool.damaged.length} damaged homebrew {pool.damaged.length === 1 ? 'item' : 'items'}? This cannot be undone.</p>
          <button type="button" class="danger" disabled={busy} onclick={removeDamaged}>Remove</button>
          <button type="button" onclick={() => (confirmingRemove = false)}>Keep them</button>
        </div>
      {/if}
    {/if}

    <div class="table">
      {#if !phone.current}
        <div class="cols th" role="group" aria-label="Sort the list">
          {#each COLS as [k, label] (k)}
            <button type="button" class:on={sortKey === k} onclick={() => sortBy(k)}>
              {label}{#if sortKey === k}<span aria-hidden="true"> {sortDesc ? '▼' : '▲'}</span><span class="sr-only">, sorted {sortDesc ? 'descending' : 'ascending'}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
      <div class="listwrap">
        <VirtualList items={sorted} {selected} label="All items" rowHeight={phone.current ? 52 : 36} onselect={pick}>
          {#snippet row(r: CatalogRow)}
            {#if phone.current}
              <span class="name">{r.shown.name}</span>
              <span class="muted small">{sub(r, true)}</span>
            {:else}
              <span class="cols">
                <span class="name">{r.shown.name}</span>
                <span>{cap(r.shown.type)}</span>
                <span>{rarityOf(r) ? cap(rarityOf(r)) : '—'}</span>
                <span>{attuneOf(r) || '—'}</span>
                <span title={sourceOf(r)}>{shortSource(r)}</span>
              </span>
            {/if}
          {/snippet}
        </VirtualList>
      </div>
    </div>
  </section>

  {#snippet panel()}
    {#if selected}
      {@const view = selected.stored?.defaultView}
      <h2 class="title">{selected.shown.name}</h2>
      <p class="muted sub">{sub(selected)}</p>
      {#if dm}
        <div class="actions">
          <label class="qty">Quantity <input class="num" type="number" min="1" step="1" bind:value={qty} /></label>
          <button type="button" class="primary" bind:this={giveBtn} disabled={!chars.length} aria-describedby={chars.length ? undefined : 'give-why'} aria-expanded={step === 'give'} onclick={askGive}>Give to…</button>
          <button type="button" aria-label="Add to Unassigned" disabled={busy} onclick={() => addToUnassigned(selected)}>To Unassigned</button>
        </div>
        {#if !chars.length}<p id="give-why" class="muted">Give to… needs a character in this campaign.</p>{/if}
        {#if step === 'give'}
          <div class="give" role="group" aria-label="Give {selected.shown.name}">
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

      <div class="drawers">
        <Drawer title="Description" open>
          <div class="desc"><EntityDetail entity={selected.item} index={pool.index} /></div>
        </Drawer>
        <!-- What players are shown is the DM's to know: the real item stays hidden from them. -->
        {#if dm}
          <Drawer title="Player view">
            {#snippet summary()}{view?.name ? `“${view.name}”` : view ? 'Partly hidden' : 'Sees it all'}{/snippet}
            {#if view}
              <EntityDetail entity={playerItem(selected.item, view)} index={pool.index} />
            {:else}
              <p class="muted">Players see this item as it is.</p>
            {/if}
            <p class="muted">{selected.stored ? 'Change it with Edit.' : 'Customize it to hide parts from players.'}</p>
          </Drawer>
        {/if}
        <Drawer title="More">
          {#snippet summary()}{dm ? (selected.stored ? 'Edit · ' : 'Customize · ') : ''}Export PDF{/snippet}
          <div class="row">
            {#if dm}
              {#if selected.stored}
                <button type="button" onclick={() => navigate(`items/${selected.item.id}`)}>Edit</button>
              {:else}
                <button type="button" disabled={busy} onclick={() => doCustomize(selected)}>Customize</button>
              {/if}
            {/if}
            <button type="button" onclick={() => exportPdf(selected)}>Export PDF</button>
          </div>
        </Drawer>
      </div>
    {:else}
      <p class="caption">No item chosen</p>
      <p class="muted">Select an item to read it.</p>
      <p class="muted">SRD, pack and homebrew items for <strong>{campaign.name}</strong>. The Compendium has the read-only reference for everything else.</p>
    {/if}
  {/snippet}
</Workspace>

<style>
  .browse {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
    height: calc(100dvh - var(--topbar-h) - 1.75rem);
    min-height: 26rem;
  }

  .head {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    border-bottom: 1px solid var(--line);
  }

  .head > :global([role='tablist']) {
    flex: 1;
    min-width: 0;
    border-bottom: 0;
  }

  .head > :global(.caption) {
    flex: 1;
    padding: 0.6rem 0;
  }

  .end {
    padding-bottom: 0.35rem;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .search {
    flex: 1 1 14rem;
    min-width: 0;
  }

  .menus {
    display: flex;
    gap: 0.4rem;
    min-width: 0;
  }

  /* Phones: the pull-downs stay on one line and scroll sideways inside it. */
  @media (max-width: 767px) {
    .search {
      flex-basis: 100%;
    }

    .menus {
      flex: 1 1 100%;
      overflow-x: auto;
      scrollbar-width: none;
    }
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    min-height: 1.6rem;
  }

  .count {
    font-size: 0.9em;
  }

  .link {
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    text-decoration: underline;
    font-size: 0.9em;
  }

  .link:hover:not(:disabled) {
    background: transparent;
    color: var(--accent);
  }

  .damaged {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  .damaged p {
    flex: 1 1 14rem;
    margin: 0;
  }

  .table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
    width: 100%;
  }

  .cols > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The header reserves the list's scrollbar gutter, so its columns line up with the rows'. */
  .th {
    box-sizing: border-box;
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--line);
    overflow: hidden;
    scrollbar-gutter: stable;
  }

  .th button {
    min-height: 2rem;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    color: var(--label);
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .th button:hover:not(:disabled),
  .th button.on {
    background: transparent;
    color: var(--text-strong);
  }

  .listwrap {
    flex: 1;
    min-height: 0;
  }

  .listwrap :global(.list) {
    border: 0;
    border-radius: 0;
    background: transparent;
    scrollbar-gutter: stable;
  }

  .listwrap :global(.item) {
    border-bottom: 1px solid var(--line);
    color: var(--text);
  }

  .listwrap :global(.item:hover) {
    background: color-mix(in srgb, var(--raised) 50%, transparent);
  }

  .listwrap :global(.item.selected) {
    background: var(--raised);
    box-shadow: inset 2px 0 var(--accent);
    color: var(--text-strong);
  }

  .name {
    color: var(--text-strong);
  }

  .name,
  .small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }

  .small {
    font-size: 0.8rem;
  }

  /* Panel */
  .title {
    margin: 0.1rem 0 0;
    font-size: 1.2rem;
    color: var(--text-strong);
  }

  .sub {
    margin: 0.1rem 0 0.75rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  .qty {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .qty input {
    width: 4.5rem;
  }

  .give {
    padding: 0.5rem 0 0.75rem;
  }

  .give .field {
    margin: 0 0 0.25rem;
  }

  .give p {
    margin: 0.25rem 0 0.5rem;
  }

  .drawers {
    margin-top: 0.5rem;
  }

  /* The panel's own heading names the item, so the entry's repeated name and sub line are dropped. */
  .desc :global(article > h2),
  .desc :global(article > .sub) {
    display: none;
  }

  @media (max-width: 767px) {
    .browse {
      height: auto;
      min-height: 0;
    }

    .listwrap {
      flex: none;
      height: 60dvh;
      min-height: 16rem;
    }

    .listwrap :global(.item) {
      gap: 0.1rem;
    }
  }
</style>
