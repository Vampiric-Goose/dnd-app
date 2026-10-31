<script lang="ts">
  import { exportRecord, importRecord } from '../../lib/backup.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { rehome } from '../../lib/monsters/editing.ts';
  import { duplicateMonster, soundMonster } from '../../lib/monsters/homebrew.ts';
  import { filterMonsters, monsterType, SIZE_NAMES } from '../../lib/monsters/library.ts';
  import { navigate, router } from '../../lib/router.svelte.ts';
  import { CR_LADDER, crValue } from '../../lib/rules/monsters.ts';
  import { app, getIndex } from '../../lib/store.svelte.ts';
  import type { MonsterDef, Size, StoredMonster } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import { download, fileName } from '../download.ts';
  import MonsterEditor from '../monsters/MonsterEditor.svelte';
  import StatBlock from '../monsters/StatBlock.svelte';
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

  // (Re)load whenever the campaign changes; a stale load must not overwrite a newer one. Player view loads nothing (R2).
  let loadSeq = 0;
  function load() {
    const id = app.campaign?.id;
    const seq = ++loadSeq;
    error = '';
    Promise.all([getIndex(id), id ? db.monsters.list(id) : Promise.resolve([])]).then(
      ([ix, mine]) => { if (seq === loadSeq) { index = ix; own = mine.filter(soundMonster); } }, // a damaged record would throw in the stat block
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
  const rows = $derived(filterMonsters(pool, {
    q,
    cr: crMin || crMax ? [crValue(crMin || '0')!, crValue(crMax || '30')!] : undefined,
    type: type || undefined,
    size: (size || undefined) as Size | undefined,
    source: source || undefined,
  }));

  const select = $derived(router.query.get('id') ?? params.id ?? '');
  const selected = $derived<MonsterDef | undefined>(own.find((m) => m.id === select) ?? (index?.get(select)?.kind === 'monster' ? index.get(select) as MonsterDef : undefined));
  const isOwn = $derived(!!selected && own.some((m) => m.id === selected.id));

  const go = (id?: string) => { location.hash = '#/monsters' + (id ? `?id=${encodeURIComponent(id)}` : ''); };
  const sub = (m: MonsterDef) => [`CR ${m.cr}`, `${m.size.map((s) => SIZE_NAMES[s]).join('/')} ${monsterType(m)}`, index?.label(m.source) ?? m.source].join(' · ');

  // `monsters/new` (optionally `?from=<id>`: Duplicate) and `monsters/:id/edit` show the editor instead of the library.
  const editing = $derived(router.path[1] === 'new' || router.path[2] === 'edit');
  const from = $derived(router.query.get('from') ?? '');
  async function loadEditor(campaignId: string, id: string | undefined, from: string): Promise<{ initial?: StoredMonster; draft?: MonsterDef }> {
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
  let clash: { file: StoredMonster; monster: StoredMonster; existing: string } | undefined = $state.raw();
  let keepBtn: HTMLButtonElement | undefined = $state();
  let notice = $state('');
  $effect(() => { if (clash) keepBtn?.focus(); });

  // importRecord doesn't save: this is where the monster is put, re-homed into this campaign (see rehome).
  async function onImport(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file || !app.campaign) return;
    error = notice = '';
    clash = undefined;
    try {
      const rec = await importRecord(file);
      if (rec.kind !== 'monster') throw new Error(`That file is a${rec.kind === 'item' ? 'n item. Import it on the Items page' : ' character. Import it on the Characters page'}.`);
      const existing = await db.monsters.get(rec.data.id);
      const { monster, clash: asks } = rehome(rec.data, app.campaign.id, existing);
      if (asks) clash = { file: rec.data, monster, existing: existing!.name };
      else await put(monster);
    } catch (err) {
      error = message(err);
    }
  }
  async function put(x: StoredMonster) {
    await db.monsters.put(x);
    notice = `Imported ${x.name}.`;
    load();
    go(x.id);
  }
  async function resolveClash(how: 'replace' | 'keep') {
    const k = clash!;
    clash = undefined;
    try {
      await put(how === 'keep' ? duplicateMonster(k.file, app.campaign!.id) : k.monster);
    } catch (err) {
      error = message(err);
    }
  }

  function exportJson(m: MonsterDef) {
    const data: StoredMonster = { campaignId: app.campaign?.id ?? '', updatedAt: Date.now(), ...m };
    download(exportRecord('monster', data), fileName(m.name, 'json', 'monster'));
  }

  // On a phone the detail replaces the list: put focus on its back button so keyboard users are not left behind.
  const focusOnPhone = (node: HTMLElement) => { if (matchMedia('(max-width: 767px)').matches) node.focus(); };
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
  <h1>Monsters</h1>
  {#if editing}<p>{app.ready ? 'Open a campaign to make monsters.' : 'Loading…'}</p>{/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  {#if clash}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape bubbles up from the dialog's own buttons) -->
    <div role="alertdialog" aria-label="Monster already exists" class="card" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (clash = undefined)}>
      <p>This campaign already has a monster with this id: “{clash.existing}”. Replace “{clash.existing}” with the imported “{clash.monster.name}”, or keep both?</p>
      <div class="row">
        <button type="button" class="danger" onclick={() => resolveClash('replace')}>Replace “{clash.existing}”</button>
        <button type="button" class="primary" bind:this={keepBtn} onclick={() => resolveClash('keep')}>Keep both</button>
        <button type="button" onclick={() => (clash = undefined)}>Cancel</button>
      </div>
    </div>
  {/if}
  <div class="layout" class:has-detail={!!selected}>
    <section class="browse" aria-label="Browse">
      <div class="row actions">
        {#if app.campaign}
          <button type="button" class="primary" onclick={() => navigate('monsters/new')}>New monster</button>
          <label class="file"><span>Import monster (.json)</span>
            <input type="file" accept=".json,application/json" onchange={onImport} />
          </label>
        {:else}
          <p class="muted">Open a campaign to make monsters.</p>
        {/if}
      </div>

      <div class="row filters">
        <label class="field grow">Search
          <input type="search" bind:value={q} autocomplete="off" />
        </label>
        <label class="field">CR from
          <select bind:value={crMin}>
            <option value="">Any</option>
            {#each CR_LADDER as c}<option value={c}>{c}</option>{/each}
          </select>
        </label>
        <label class="field">CR to
          <select bind:value={crMax}>
            <option value="">Any</option>
            {#each CR_LADDER as c}<option value={c}>{c}</option>{/each}
          </select>
        </label>
        <label class="field">Type
          <select bind:value={type}>
            <option value="">All</option>
            {#each types as t}<option value={t}>{t}</option>{/each}
          </select>
        </label>
        <label class="field">Size
          <select bind:value={size}>
            <option value="">All</option>
            {#each Object.entries(SIZE_NAMES) as [k, v]}<option value={k}>{v}</option>{/each}
          </select>
        </label>
        <label class="field">Source
          <select bind:value={source}>
            <option value="">All</option>
            {#each sources as s}<option value={s}>{index?.label(s) ?? s}</option>{/each}
          </select>
        </label>
      </div>

      {#if error}
        <p class="error" role="alert">Could not load the monsters: {error}</p>
      {:else if !index}
        <p class="muted">Loading…</p>
      {:else}
        <p class="muted count" aria-live="polite">{rows.length} {rows.length === 1 ? 'monster' : 'monsters'}</p>
        <div class="listwrap">
          <VirtualList items={rows} {selected} label="Monsters" onselect={(m) => go(m.id)}>
            {#snippet row(m)}
              <span class="name">{m.name}</span>
              <span class="muted small">{sub(m)}</span>
            {/snippet}
          </VirtualList>
        </div>
      {/if}
    </section>

    <section class="detail" aria-label="Stat block">
      {#if selected}
        <button type="button" class="back" onclick={() => go()} {@attach focusOnPhone}>&larr; Back to list</button>
        <div class="card">
          <div class="row">
            {#if app.campaign}
              <button type="button" onclick={() => navigate(`monsters/new?from=${encodeURIComponent(selected!.id)}`)}>Duplicate</button>
              {#if isOwn}<button type="button" onclick={() => navigate(`monsters/${selected!.id}/edit`)}>Edit</button>{/if}
            {/if}
            <button type="button" onclick={() => exportJson(selected!)}>Export JSON</button>
          </div>
          <StatBlock monster={selected} {index} />
        </div>
      {:else if select && index}
        <p class="muted">That monster is not in this campaign's content.</p>
      {:else}
        <p class="muted placeholder">Select a monster to read its stat block.</p>
      {/if}
    </section>
  </div>
{/if}

<style>
  .layout { display: block; }
  .file { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0; }
  .file span { white-space: nowrap; }
  .filters { align-items: flex-end; }
  .filters .field { margin: 0.25rem 0; min-width: 0; }
  .grow { flex: 1 1 12rem; }
  .count { margin: 0.25rem 0; }
  .listwrap { height: 60dvh; min-height: 16rem; }
  .name, .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.25; }
  .small { font-size: 0.75rem; }
  .detail { min-width: 0; }
  .placeholder { display: none; }

  @media (max-width: 767px) {
    .has-detail .browse { display: none; }
    .detail:not(:has(.card)) { display: none; }
  }

  @media (min-width: 768px) {
    .layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 1rem; align-items: start; }
    .listwrap { height: calc(100dvh - 17rem); }
    .detail { position: sticky; top: 0.5rem; max-height: calc(100dvh - 1rem); overflow-y: auto; }
    .detail .card { margin-top: 0; }
    .placeholder { display: block; }
    .back { display: none; }
  }
</style>
