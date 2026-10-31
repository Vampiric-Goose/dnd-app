<script lang="ts">
  import { fold } from '../../lib/content/ids.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { app, getIndex } from '../../lib/store.svelte.ts';
  import type { Entity, EntityKind, ItemDef } from '../../lib/types.ts';
  import { soundItem } from '../../lib/items/homebrew.ts';
  import { displayItem } from '../../lib/items/playerView.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import VersionToggle from '../VersionToggle.svelte';
  import VirtualList from '../VirtualList.svelte';
  import { versions } from '../creator/labels.ts';

  const tabs: { id: string; label: string; kinds: EntityKind[] }[] = [
    { id: 'spell', label: 'Spells', kinds: ['spell'] },
    { id: 'item', label: 'Items', kinds: ['item'] },
    { id: 'race', label: 'Races', kinds: ['race', 'subrace'] },
    { id: 'class', label: 'Classes', kinds: ['class', 'subclass'] },
    { id: 'background', label: 'Backgrounds', kinds: ['background'] },
    { id: 'feat', label: 'Feats', kinds: ['feat'] },
    { id: 'option', label: 'Options', kinds: ['optionalFeature'] },
    { id: 'condition', label: 'Conditions', kinds: ['condition'] },
  ];
  const rarities = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];

  let tab = $state(tabs.find((t) => t.id === router.query.get('kind'))?.id ?? 'spell');
  let q = $state('');
  let source = $state('');
  let level = $state(''); // spells
  let cls = $state(''); // spells
  let itemType = $state(''); // items
  let rarity = $state(''); // items
  let magic = $state(''); // items: '', 'magic' or 'mundane'

  let index: ContentIndex | undefined = $state.raw();
  let homebrew: ItemDef[] = $state.raw([]);
  let error = $state('');

  // (Re)load the content whenever the campaign changes; a stale load must not overwrite a newer one.
  let loadSeq = 0;
  $effect(() => {
    if (!app.ready) return;
    const id = app.campaign?.id;
    const seq = ++loadSeq;
    index = undefined;
    error = '';
    Promise.all([getIndex(id), id ? db.items.list(id) : Promise.resolve([])]).then(
      ([ix, items]) => { if (seq === loadSeq) { index = ix; homebrew = items.filter(soundItem); } }, // a damaged record would throw in the list and the detail
      (e) => { if (seq === loadSeq) error = e instanceof Error ? e.message : String(e); },
    );
  });

  const kinds = $derived(tabs.find((t) => t.id === tab)!.kinds);
  // A homebrew item as this viewer sees it (cover name, hidden rarity): search and filters must not match what a player can't see.
  const seen = $derived(new Map(homebrew.map((h) => [h.id, displayItem(h, app.viewer)])));
  const look = (e: Entity): Entity => (e.kind === 'item' && seen.get(e.id)) || e;
  const select = $derived(router.query.get('id') ?? '');

  // Everything on this tab for the current search text, before the filters.
  const found = $derived.by<Entity[]>(() => {
    if (!index) return [];
    const hits = index.search(q, kinds, Infinity);
    if (tab !== 'item') return hits;
    const n = fold(q.trim());
    return [...homebrew.filter((h) => fold(look(h).name).includes(n)), ...hits];
  });
  const pool = $derived.by<Entity[]>(() => {
    if (!index) return [];
    return [...(tab === 'item' ? homebrew : []), ...kinds.flatMap((k) => index!.all(k))];
  });
  const sources = $derived([...new Set(pool.map((e) => e.source))].sort());
  const spellClasses = $derived(tab === 'spell' ? [...new Set(pool.flatMap((e) => (e.kind === 'spell' ? e.classes : [])))].sort() : []);
  const itemTypes = $derived(tab === 'item' ? [...new Set(pool.flatMap((e) => (e.kind === 'item' ? [e.type] : [])))].sort() : []);

  const shown = $derived(
    found.filter((raw) => {
      const e = look(raw); // rows keep the real record: its id is what the detail opens
      if (source && e.source !== source) return false;
      if (e.kind === 'spell') return (level === '' || e.level === +level) && (!cls || e.classes.includes(cls));
      if (e.kind === 'item') return (!itemType || e.type === itemType) && (!rarity || e.rarity === rarity) && (!magic || e.magic === (magic === 'magic'));
      return true;
    }),
  );

  // Subclasses and subraces are listed indented under their parent, never as flat rows. A
  // child that matches the filters brings its parent along so it always has context.
  // Races with the same name from different books are one row; the detail has a ruleset toggle.
  const parentOf = (e: Entity) => (e.kind === 'subclass' ? e.classId : e.kind === 'subrace' ? e.raceId : undefined);
  const raceVersions = $derived(new Map(index ? versions(index.all('race')).map((g) => [fold(g[0].name), g] as const) : []));
  const siblings = (e: Entity) => (e.kind === 'race' && raceVersions.get(fold(e.name))) || [e];
  const rows = $derived.by<Entity[]>(() => {
    const kids = new Map<string, Entity[]>();
    for (const e of shown) { const p = parentOf(e); if (p) kids.set(p, [...(kids.get(p) ?? []), e]); }
    if (!kids.size && tab !== 'race') return shown;
    const top = shown.filter((e) => !parentOf(e));
    const have = new Set(top.map((e) => e.id));
    const orphans: Entity[] = [];
    for (const [p, list] of kids) {
      if (have.has(p)) continue;
      const parent = index?.get(p);
      if (parent) { top.push(parent); have.add(p); } else orphans.push(...list);
    }
    // One row per name (the selected version if it is one of them), with every version's subraces under it.
    const groups = tab === 'race' ? versions(top) : top.sort((a, b) => a.name.localeCompare(b.name)).map((e) => [e]);
    return [...groups.flatMap((g) => [g.find((e) => e === selected) ?? g[0], ...g.flatMap((e) => kids.get(e.id) ?? [])]), ...orphans];
  });

  // The Compendium never shows monsters (R2): a `monster:` deep link reads as not found, in either view.
  const selected = $derived(homebrew.find((h) => h.id === select) ?? (index?.get(select)?.kind === 'monster' ? undefined : index?.get(select)));

  function reset(id: string) {
    tab = id;
    source = level = cls = itemType = rarity = magic = '';
    go();
  }
  const go = (id?: string) => { location.hash = `#/compendium?kind=${tab}` + (id ? `&id=${encodeURIComponent(id)}` : ''); };

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  function sub(e: Entity): string {
    const what =
      e.kind === 'spell' ? (e.level === 0 ? `${cap(e.school)} cantrip` : `Level ${e.level} ${e.school}`)
      : e.kind === 'item' ? [cap(e.type), e.magic && e.rarity].filter(Boolean).join(', ')
      : e.kind === 'class' ? `d${e.hitDie}`
      : e.kind === 'subclass' ? 'Subclass'
      : e.kind === 'subrace' ? 'Subrace'
      : '';
    const all = siblings(e);
    const from = all.length > 1 ? `${all.length} versions: ${all.map((v) => v.source).join(', ')}` : (index?.label(e.source) ?? e.source);
    return [what, from].filter(Boolean).join(' · ');
  }

  // On a phone the detail replaces the list: put focus on its back button so keyboard users are not left behind.
  const focusOnPhone = (node: HTMLElement) => { if (matchMedia('(max-width: 767px)').matches) node.focus(); };
</script>

<h1>Compendium</h1>

<div class="layout" class:has-detail={!!selected}>
  <section class="browse" aria-label="Browse">
    <div class="row tabs" role="group" aria-label="Kind">
      {#each tabs as t}
        <button type="button" aria-pressed={tab === t.id} class:primary={tab === t.id} onclick={() => reset(t.id)}>{t.label}</button>
      {/each}
    </div>

    <div class="row filters">
      <label class="field grow">Search
        <input type="search" bind:value={q} autocomplete="off" />
      </label>
      <label class="field">Source
        <select bind:value={source}>
          <option value="">All</option>
          {#each sources as s}<option value={s}>{index?.label(s) ?? s}</option>{/each}
        </select>
      </label>
      {#if tab === 'spell'}
        <label class="field">Level
          <select bind:value={level}>
            <option value="">All</option>
            <option value="0">Cantrip</option>
            {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as n}<option value={String(n)}>{n}</option>{/each}
          </select>
        </label>
        <label class="field">Class
          <select bind:value={cls}>
            <option value="">All</option>
            {#each spellClasses as c}<option value={c}>{cap(c)}</option>{/each}
          </select>
        </label>
      {:else if tab === 'item'}
        <label class="field">Type
          <select bind:value={itemType}>
            <option value="">All</option>
            {#each itemTypes as t}<option value={t}>{cap(t)}</option>{/each}
          </select>
        </label>
        <label class="field">Rarity
          <select bind:value={rarity}>
            <option value="">All</option>
            {#each rarities as r}<option value={r}>{cap(r)}</option>{/each}
          </select>
        </label>
        <label class="field">Magic
          <select bind:value={magic}>
            <option value="">All</option>
            <option value="magic">Magic</option>
            <option value="mundane">Mundane</option>
          </select>
        </label>
      {/if}
    </div>

    {#if error}
      <p class="error" role="alert">Could not load the compendium: {error}</p>
    {:else if !index}
      <p class="muted">Loading…</p>
    {:else}
      <p class="muted count" aria-live="polite">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</p>
      <div class="listwrap">
        <VirtualList items={rows} {selected} label={tabs.find((t) => t.id === tab)?.label ?? 'Entries'} onselect={(e) => go(e.id)}>
          {#snippet row(raw)}
            {@const e = raw.kind === 'item' ? displayItem(raw, app.viewer) : raw}
            <span class="name" class:child={!!parentOf(e)}>{e.name}</span>
            <span class="muted small" class:child={!!parentOf(e)}>{sub(e)}</span>
          {/snippet}
        </VirtualList>
      </div>
    {/if}
  </section>

  <section class="detail" aria-label="Details">
    {#if selected}
      <button type="button" class="back" onclick={() => go()} {@attach focusOnPhone}>&larr; Back to list</button>
      <div class="card">
        {#if siblings(selected).length > 1}
          <VersionToggle versions={siblings(selected)} value={selected.id} label={(s) => index?.label(s) ?? s} onchange={(id) => go(id)} />
        {/if}
        <EntityDetail entity={selected} {index} />
      </div>
    {:else if select && index}
      <p class="muted">That entry is not in this campaign's content.</p>
    {:else}
      <p class="muted placeholder">Select an entry to read it.</p>
    {/if}
  </section>
</div>

<style>
  .layout { display: block; }
  .tabs { margin-bottom: 0.5rem; }
  .filters { align-items: flex-end; }
  .filters .field { margin: 0.25rem 0; min-width: 0; }
  .grow { flex: 1 1 12rem; }
  .count { margin: 0.25rem 0; }
  .listwrap { height: 60dvh; min-height: 16rem; }
  .name, .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.25; }
  .small { font-size: 0.75rem; }
  .child { padding-left: 1.25rem; }
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
