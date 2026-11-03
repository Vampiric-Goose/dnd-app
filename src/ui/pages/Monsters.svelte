<script lang="ts">
  import { exportRecord, importRecord } from '../../lib/backup.ts';
  import { withMonster } from '../../lib/combat/encounters.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { rehome } from '../../lib/monsters/editing.ts';
  import { duplicateMonster, soundMonster } from '../../lib/monsters/homebrew.ts';
  import { filterMonsters, monsterType, SIZE_NAMES } from '../../lib/monsters/library.ts';
  import { leaveGuard, navigate, router } from '../../lib/router.svelte.ts';
  import { CR_LADDER, crValue } from '../../lib/rules/monsters.ts';
  import { app, getIndex } from '../../lib/store.svelte.ts';
  import type { Encounter, MonsterDef, Size, StoredMonster } from '../../lib/types.ts';
  import { uid } from '../../lib/uid.ts';
  import Encounters from '../initiative/Encounters.svelte';
  import { message } from '../creator/labels.ts';
  import { download, downloadPdf, fileName } from '../download.ts';
  import Menu, { type MenuItem } from '../kit/Menu.svelte';
  import Pill from '../kit/Pill.svelte';
  import Workspace from '../kit/Workspace.svelte';
  import MonsterEditor from '../monsters/MonsterEditor.svelte';
  import StatBlock from '../monsters/StatBlock.svelte';
  import PasteDialog from '../PasteDialog.svelte';
  import { pasted } from '../pasted.ts';
  import VirtualList from '../VirtualList.svelte';

  let { params }: { params: Record<string, string> } = $props();

  let q = $state('');
  let crMin = $state('');
  let crMax = $state('');
  let type = $state('');
  let size = $state('');
  let source = $state('');

  let index: ContentIndex | undefined = $state.raw();
  let own: StoredMonster[] = $state.raw([]);
  let error = $state('');
  // The library: prepared groups (encounters without a saved fight) the map's Library tab places
  let groups: Encounter[] = $state.raw([]);
  let library = $state(false);
  async function loadGroups() {
    const id = app.campaign?.id;
    groups = id ? (await db.encounters.list(id)).filter((e) => !e.fight).sort((a, b) => a.name.localeCompare(b.name)) : [];
  }

  // (Re)load whenever the campaign changes; a stale load must not overwrite a newer one. Player view loads nothing (R2).
  let loadSeq = 0;
  function load() {
    const id = app.campaign?.id;
    const seq = ++loadSeq;
    error = '';
    Promise.all([getIndex(id), id ? db.monsters.list(id) : Promise.resolve([])]).then(
      ([ix, mine]) => { if (seq === loadSeq) { index = ix; own = mine.filter(soundMonster); void loadGroups(); } }, // a damaged record would throw in the stat block
      (e) => { if (seq === loadSeq) error = e instanceof Error ? e.message : String(e); },
    );
  }
  $effect(() => {
    if (!app.ready || app.viewer !== 'dm' || editing) return;
    void app.campaign?.id;
    index = undefined;
    load();
  });

  const pool = $derived<MonsterDef[]>(index ? [...own, ...index.all('monster')] : []);
  const types = $derived([...new Set(pool.map(monsterType))].filter(Boolean).sort());
  const sources = $derived([...new Set(pool.map((m) => m.source))].sort());
  const filter = $derived({
    q,
    cr: crMin || crMax ? [crValue(crMin || '0')!, crValue(crMax || '30')!] as [number, number] : undefined,
    type: type || undefined,
    size: (size || undefined) as Size | undefined,
    source: source || undefined,
  });
  const rows = $derived(filterMonsters(pool, filter));

  // Pull-down counts: what each option would show with the other filters kept.
  function counts(skip: 'cr' | 'type' | 'size' | 'source', keys: (m: MonsterDef) => readonly string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const m of filterMonsters(pool, { ...filter, [skip]: undefined })) for (const k of keys(m)) out.set(k, (out.get(k) ?? 0) + 1);
    return out;
  }
  type Filter = { id: string; label: string; value: string; set: (v: string) => void; options: { value: string; label: string; count: number }[] };
  const filters = $derived.by<Filter[]>(() => {
    const opts = (vals: readonly string[], label: (v: string) => string, c: Map<string, number>) => vals.map((v) => ({ value: v, label: label(v), count: c.get(v) ?? 0 }));
    const cr = counts('cr', (m) => [m.cr]);
    return [
      { id: 'crMin', label: 'CR from', value: crMin, set: (v) => (crMin = v), options: opts(CR_LADDER, (c) => `CR ${c}`, cr) },
      { id: 'crMax', label: 'CR to', value: crMax, set: (v) => (crMax = v), options: opts(CR_LADDER, (c) => `CR ${c}`, cr) },
      { id: 'type', label: 'Type', value: type, set: (v) => (type = v), options: opts(types, (t) => t, counts('type', (m) => [monsterType(m)])) },
      { id: 'size', label: 'Size', value: size, set: (v) => (size = v), options: opts(Object.keys(SIZE_NAMES), (k) => SIZE_NAMES[k as Size], counts('size', (m) => m.size)) },
      { id: 'source', label: 'Source', value: source, set: (v) => (source = v), options: opts(sources, (s) => index?.label(s) ?? s, counts('source', (m) => [m.source])) },
    ];
  });
  const valueLabel = (f: Filter) => {
    const o = f.options.find((x) => x.value === f.value)?.label ?? f.value;
    return f.id === 'crMin' ? `${o} or more` : f.id === 'crMax' ? `${o} or less` : o;
  };
  const menuItems = (f: Filter): MenuItem[] => [
    { label: 'Any', checked: f.value === '', onselect: () => f.set('') },
    ...f.options.map((o) => ({ label: o.label, count: o.count, checked: f.value === o.value, onselect: () => f.set(o.value) })),
  ];
  const anyFilter = $derived(filters.some((f) => f.value !== ''));
  const clearFilters = () => { crMin = crMax = type = size = source = ''; };

  const select = $derived(router.query.get('id') ?? params.id ?? '');
  const selected = $derived<MonsterDef | undefined>(own.find((m) => m.id === select) ?? (index?.get(select)?.kind === 'monster' ? index.get(select) as MonsterDef : undefined));
  const isOwn = $derived(!!selected && own.some((m) => m.id === selected.id));

  const go = (id?: string) => { location.hash = '#/monsters' + (id ? `?id=${encodeURIComponent(id)}` : ''); };
  const kindOf = (m: MonsterDef) => `${m.size.map((s) => SIZE_NAMES[s]).join('/')} ${monsterType(m)}`;

  // `monsters/new` (optionally `?from=<id>`: Duplicate, or `?pasted=1`: the paste dialog's draft) and `monsters/:id/edit` show
  // the editor instead of the library.
  const editing = $derived(router.path[1] === 'new' || router.path[2] === 'edit');
  const from = $derived(router.query.get('from') ?? (router.query.has('pasted') ? 'pasted' : ''));
  // M2: the pasted draft is dropped once its editor is left (saved, or discarded), so Back can't reopen it as a second copy.
  $effect(() => { if (from !== 'pasted') pasted.monster = undefined; });
  async function loadEditor(campaignId: string, id: string | undefined, from: string): Promise<{ initial?: StoredMonster; draft?: MonsterDef; notes?: string[] }> {
    if (from === 'pasted') {
      if (!pasted.monster) throw new Error('The pasted stat block is gone (it was saved or discarded, or the page was reloaded). Paste it again.');
      return pasted.monster;
    }
    if (id) {
      const x = await db.monsters.get(id);
      if (!x || x.campaignId !== campaignId) throw new Error('That monster is not in this campaign.');
      if (!soundMonster(x)) throw new Error('That monster is damaged and cannot be opened.');
      return { initial: x };
    }
    if (!from) return {};
    const mine = await db.monsters.get(from);
    const x = mine?.campaignId === campaignId ? mine : (await getIndex(campaignId)).get(from);
    if (x?.kind !== 'monster') throw new Error("The monster to copy is not in this campaign's content.");
    return { draft: x };
  }

  // R49: an imported monster whose id is this campaign's already waits here for Replace or Keep both.
  let clash: { file: StoredMonster; monster: StoredMonster; existing: string; edits: string[] } | undefined = $state.raw();
  let keepBtn: HTMLButtonElement | undefined = $state();
  let notice = $state('');
  /** One more of the monster in a library group, or a new group named after it. */
  async function addToLibrary(m: MonsterDef, e?: Encounter) {
    const cid = app.campaign?.id;
    if (!cid) return;
    const g = withMonster(e, m, Date.now(), { id: uid(), campaignId: cid, name: m.name });
    try { await db.encounters.put($state.snapshot(g)); } catch (err) { error = message(err); return; }
    notice = `${m.name} added to “${g.name}”.`;
    await loadGroups();
  }
  let pasting = $state(false);
  $effect(() => { if (clash) keepBtn?.focus(); });

  const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

  // importRecord and importPdf don't save: this is where the monster is put, re-homed into this campaign (see rehome).
  async function onImport(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file || !app.campaign) return;
    error = notice = '';
    clash = undefined;
    try {
      let data: StoredMonster, edits: string[] = [];
      if (isPdf(file)) {
        const { importPdf } = await import('../../lib/pdf/importPdf.ts'); // pdf-lib's own chunk, loaded only now
        const rec = await importPdf(new Uint8Array(await file.arrayBuffer()));
        if (rec.kind !== 'monster') throw new Error(`That file is a${rec.kind === 'item' ? 'n item. Import it on the Items page' : ' character. Import it on the Characters page'}.`);
        data = { campaignId: '', updatedAt: 0, ...rec.data };
        edits = rec.edits;
      } else {
        const rec = await importRecord(file);
        if (rec.kind !== 'monster') throw new Error(`That file is a${rec.kind === 'item' ? 'n item. Import it on the Items page' : ' character. Import it on the Characters page'}.`);
        data = rec.data;
      }
      const existing = await db.monsters.get(data.id);
      const { monster, clash: asks } = rehome(data, app.campaign.id, existing);
      if (asks) clash = { file: data, monster, existing: existing!.name, edits };
      else await put(monster, edits);
    } catch (err) {
      error = message(err);
    }
  }
  async function put(x: StoredMonster, edits: string[]) {
    await db.monsters.put(x);
    notice = `Imported ${x.name}.${edits.length ? ` Changes made in the PDF were applied: ${edits.join(', ')}.` : ''}`;
    load();
    go(x.id);
  }
  async function resolveClash(how: 'replace' | 'keep') {
    const k = clash!;
    clash = undefined;
    try {
      await put(how === 'keep' ? duplicateMonster(k.file, app.campaign!.id) : k.monster, k.edits);
    } catch (err) {
      error = message(err);
    }
  }

  async function exportPdf(m: MonsterDef) {
    error = '';
    try {
      const { exportMonsterPdf } = await import('../../lib/pdf/exportPdf.ts');
      downloadPdf(await exportMonsterPdf(m), fileName(m.name, 'pdf', 'monster'));
    } catch (e) {
      error = `Could not export the PDF: ${message(e)}`;
    }
  }

  function exportJson(m: MonsterDef) {
    const data: StoredMonster = { campaignId: app.campaign?.id ?? '', updatedAt: Date.now(), ...m };
    download(exportRecord('monster', data), fileName(m.name, 'json', 'monster'));
  }

  let fileInput: HTMLInputElement | undefined = $state();
  const togglePaste = () => { if (!pasting || leaveGuard.fn?.() !== false) pasting = !pasting; };
</script>

{#if editing && app.campaign}
  <!-- The editor stays mounted (hidden) in Player view, so switching view can't lose unsaved edits; its leave guard still asks. -->
  {#if app.viewer !== 'dm'}
    <h1>Monsters</h1>
    <p>Monsters are visible to the DM only.</p>
  {/if}
  <div hidden={app.viewer !== 'dm'}>
    {#key app.campaign.id + (params.id ?? 'new') + from}
      {#await loadEditor(app.campaign.id, params.id, from)}
        <p class="muted">Loading…</p>
      {:then r}
        {#if r.notes?.length}
          <div class="note" role="note">
            <strong>Read from pasted text.</strong> Check these before saving:
            <ul>{#each r.notes as n}<li>{n}</li>{/each}</ul>
          </div>
        {/if}
        <MonsterEditor campaignId={app.campaign.id} initial={r.initial} draft={r.draft} />
      {:catch e}
        <h1>Monsters</h1>
        <p role="alert" class="error">{message(e)}</p>
        <p><a href="#/monsters">Back to monsters</a></p>
      {/await}
    {/key}
  </div>
{:else if app.viewer !== 'dm'}
  <h1>Monsters</h1>
  <p>Monsters are visible to the DM only.</p>
{:else}
  <Workspace panelLabel="Stat block" open={!!select && !!index} onclose={() => go()}>
    <section class="browse" aria-label="Browse">
      <div class="top">
        <h1>Monsters</h1>
        {#if app.campaign}
          <div class="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={!library} onclick={() => (library = false)}>All monsters</button>
            <button type="button" aria-pressed={library} onclick={() => (library = true)}>Library <span class="num">{groups.length}</span></button>
          </div>
          <button type="button" class="primary" onclick={() => navigate('monsters/new')}>New monster</button>
          <Menu label="Import" align="end" items={[
            { label: 'Paste a stat block', onselect: togglePaste },
            { label: 'Import monster (.json / .pdf)', onselect: () => fileInput?.click() },
          ]} />
          <input bind:this={fileInput} type="file" accept=".json,.pdf,application/json,application/pdf" hidden onchange={onImport} />
        {/if}
      </div>
      {#if !app.campaign}<p class="muted">Open a campaign to make monsters.</p>{/if}
      {#if editing}<p>{app.ready ? 'Open a campaign to make monsters.' : 'Loading…'}</p>{/if}
      {#if error && index}<p role="alert" class="error">{error}</p>{/if}
      {#if notice}<p role="status">{notice}</p>{/if}
      {#if clash}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape bubbles up from the dialog's own buttons) -->
        <div role="alertdialog" aria-label="Monster already exists" class="note" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (clash = undefined)}>
          <p>This campaign already has a monster with this id: “{clash.existing}”. Replace “{clash.existing}” with the imported “{clash.monster.name}”, or keep both?</p>
          <div class="row">
            <button type="button" class="danger" onclick={() => resolveClash('replace')}>Replace “{clash.existing}”</button>
            <button type="button" class="primary" bind:this={keepBtn} onclick={() => resolveClash('keep')}>Keep both</button>
            <button type="button" onclick={() => (clash = undefined)}>Cancel</button>
          </div>
        </div>
      {/if}
      {#if pasting && app.campaign}
        <PasteDialog kind="monster" oncancel={() => (pasting = false)} onread={(draft, notes) => { pasted.monster = { draft: draft as MonsterDef, notes }; pasting = false; navigate('monsters/new?pasted=1'); }} />
      {/if}

      {#if library && app.campaign}
        <p class="muted">Groups you prepare here are placed from the map’s Library tab.</p>
        <Encounters prep campaign={app.campaign} combat={undefined} encounters={groups} {pool} reload={loadGroups} />
      {:else}
      <div class="filters">
        <label class="search">
          <span class="sr-only">Search</span>
          <input type="search" bind:value={q} autocomplete="off" placeholder="Search…" />
        </label>
        {#each filters as f (f.id)}
          <Menu label={f.value ? valueLabel(f) : f.label} ariaLabel={f.value ? `${f.label}: ${valueLabel(f)}` : undefined} active={f.value !== ''} items={menuItems(f)} />
        {/each}
      </div>

      {#if !index && error}
        <p class="error" role="alert">Could not load the monsters: {error}</p>
      {:else if !index}
        <p class="muted">Loading…</p>
      {:else}
        <div class="active">
          {#each filters.filter((f) => f.value) as f (f.id)}
            <Pill label={valueLabel(f)} onremove={() => f.set('')} />
          {/each}
          <span class="muted count" aria-live="polite"><span class="num">{rows.length}</span> {rows.length === 1 ? 'monster' : 'monsters'}</span>
          {#if anyFilter}<button type="button" class="clear" onclick={clearFilters}>clear</button>{/if}
        </div>
        <div class="listwrap">
          <div class="cols head" aria-hidden="true"><span>Name</span><span>CR</span><span>Type</span><span>Source</span></div>
          <VirtualList items={rows} {selected} label="Monsters" onselect={(m) => go(m.id)}>
            {#snippet row(m)}
              <span class="cols">
                <span class="name">{m.name}</span>
                <span class="cr"><span class="phone">CR </span><span class="num">{m.cr}</span></span>
                <span class="kind">{kindOf(m)}</span>
                <span class="from">{index?.label(m.source) ?? m.source}</span>
              </span>
            {/snippet}
          </VirtualList>
        </div>
      {/if}
      {/if}
    </section>

    {#snippet panel()}
      {#if selected}
        <div class="actions">
          {#if app.campaign}
            {#if isOwn}<button type="button" onclick={() => navigate(`monsters/${selected!.id}/edit`)}>Edit</button>{/if}
            <button type="button" onclick={() => navigate(`monsters/new?from=${encodeURIComponent(selected!.id)}`)}>Duplicate</button>
            <Menu label="Add to library" items={[
              ...groups.map((g) => ({ label: `Add to “${g.name}”`, onselect: () => addToLibrary(selected!, g) })),
              { label: 'New group', onselect: () => addToLibrary(selected!) },
            ]} />
          {/if}
          <Menu label="Export" align="end" items={[
            { label: 'Export JSON', onselect: () => exportJson(selected!) },
            { label: 'Export PDF', onselect: () => exportPdf(selected!) },
          ]} />
        </div>
        <StatBlock monster={selected} {index} />
      {:else if select && index}
        <p class="muted">That monster is not in this campaign's content.</p>
      {:else}
        <p class="muted">Select a monster to read its stat block.</p>
      {/if}
    {/snippet}
  </Workspace>
{/if}

<style>
  .browse {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .browse > p {
    margin: 0;
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.6rem;
  }

  .top h1 {
    flex: 1;
    margin: 0;
  }

  .seg {
    display: inline-flex;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    overflow: hidden;
  }

  .seg button {
    border: 0;
    border-radius: 0;
    border-right: 1px solid var(--line);
    background: transparent;
  }

  .seg button:last-child {
    border-right: 0;
  }

  .seg button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  .note {
    padding: 0.5rem 0.75rem;
    border-left: 2px solid var(--accent);
    background: var(--panel);
    margin: 0.5rem 0;
  }

  .note p {
    margin: 0 0 0.5rem;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .search {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .search input {
    width: 100%;
  }

  .active {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    min-height: 1.6rem;
  }

  .clear {
    min-height: 0;
    padding: 0 0.2rem;
    border: 0;
    background: none;
    color: var(--muted);
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  .clear:hover:not(:disabled) {
    background: none;
    color: var(--text);
  }

  .listwrap {
    display: flex;
    flex-direction: column;
    height: 65dvh;
    min-height: 16rem;
    border-top: 1px solid var(--line);
  }

  .listwrap :global([role='listbox']) {
    flex: 1;
  }

  /* Phones: name on the first line, "CR · type · source" under it. Desktop: four columns under a header. */
  .cols {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    grid-template-areas: 'name name name' 'cr kind from';
    column-gap: 0.6rem;
    line-height: 1.25;
  }

  .cols > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    grid-area: name;
  }

  .cr,
  .kind,
  .from {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .cr {
    grid-area: cr;
  }

  .kind {
    grid-area: kind;
  }

  .from {
    grid-area: from;
    text-align: right;
  }

  .head {
    display: none;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  @media (min-width: 768px) {
    .browse {
      height: calc(100dvh - var(--topbar-h) - 1.75rem);
    }

    .listwrap {
      flex: 1;
      height: auto;
    }

    .cols {
      grid-template-columns: minmax(0, 1.6fr) 3.5rem minmax(0, 1.2fr) minmax(0, 1fr);
      grid-template-areas: 'name cr kind from';
      align-items: baseline;
    }

    .cr,
    .kind,
    .from {
      font-size: 0.9rem;
    }

    .cr {
      color: var(--text);
    }

    .from {
      text-align: left;
    }

    .phone {
      display: none;
    }

    .head {
      display: grid;
      padding: 0.35rem 0.75rem;
      overflow: hidden;
      scrollbar-gutter: stable;
      border-bottom: 1px solid var(--line);
    }

    .head > span {
      color: var(--label);
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
  }
</style>
