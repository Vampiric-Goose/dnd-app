<script lang="ts">
  import { exportRecord } from '../../lib/backup.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { soundMonster } from '../../lib/monsters/homebrew.ts';
  import { filterMonsters, monsterType, SIZE_NAMES } from '../../lib/monsters/library.ts';
  import { navigate, router } from '../../lib/router.svelte.ts';
  import { CR_LADDER, crValue } from '../../lib/rules/monsters.ts';
  import { app, getIndex } from '../../lib/store.svelte.ts';
  import type { MonsterDef, Size, StoredMonster } from '../../lib/types.ts';
  import { download, fileName } from '../download.ts';
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
    if (!app.ready || app.viewer !== 'dm') return;
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

  function exportJson(m: MonsterDef) {
    const data: StoredMonster = { campaignId: app.campaign?.id ?? '', updatedAt: Date.now(), ...m };
    download(exportRecord('monster', data), fileName(m.name, 'json', 'monster'));
  }

  // On a phone the detail replaces the list: put focus on its back button so keyboard users are not left behind.
  const focusOnPhone = (node: HTMLElement) => { if (matchMedia('(max-width: 767px)').matches) node.focus(); };
</script>

<h1>Monsters</h1>

{#if app.viewer !== 'dm'}
  <p>Monsters are visible to the DM only.</p>
{:else}
  <div class="layout" class:has-detail={!!selected}>
    <section class="browse" aria-label="Browse">
      <div class="row actions">
        {#if app.campaign}
          <button type="button" class="primary" onclick={() => navigate('monsters/new')}>New monster</button>
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
