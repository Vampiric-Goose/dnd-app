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
  import Menu, { type MenuItem } from '../kit/Menu.svelte';
  import Pill from '../kit/Pill.svelte';
  import Tabs from '../kit/Tabs.svelte';
  import Workspace from '../kit/Workspace.svelte';
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

  type Facet = 'source' | 'level' | 'cls' | 'itemType' | 'rarity' | 'magic';
  // The filters, all but `skip`: a pull-down counts what each of its options would show with the other filters kept.
  function passes(raw: Entity, skip?: Facet): boolean {
    const e = look(raw); // rows keep the real record: its id is what the detail opens
    if (skip !== 'source' && source && e.source !== source) return false;
    if (e.kind === 'spell') return (skip === 'level' || level === '' || e.level === +level) && (skip === 'cls' || !cls || e.classes.includes(cls));
    if (e.kind === 'item') return (skip === 'itemType' || !itemType || e.type === itemType) && (skip === 'rarity' || !rarity || e.rarity === rarity) && (skip === 'magic' || !magic || e.magic === (magic === 'magic'));
    return true;
  }
  const shown = $derived(found.filter((raw) => passes(raw)));

  function counts(skip: Facet, keys: (e: Entity) => readonly (string | number | undefined)[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const raw of found) {
      if (!passes(raw, skip)) continue;
      for (const k of keys(look(raw))) if (k !== undefined) m.set(String(k), (m.get(String(k)) ?? 0) + 1);
    }
    return m;
  }

  // The pull-down filters of this tab: the value, how to set it, and the options with their counts.
  type Filter = { id: Facet; label: string; value: string; set: (v: string) => void; options: { value: string; label: string; count: number }[] };
  const filters = $derived.by<Filter[]>(() => {
    const opts = (vals: string[], label: (v: string) => string, c: Map<string, number>) => vals.map((v) => ({ value: v, label: label(v), count: c.get(v) ?? 0 }));
    const out: Filter[] = [];
    if (tab === 'spell') {
      out.push(
        { id: 'level', label: 'Level', value: level, set: (v) => (level = v), options: opts(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], (n) => (n === '0' ? 'Cantrip' : `Level ${n}`), counts('level', (e) => [e.kind === 'spell' ? e.level : undefined])) },
        { id: 'cls', label: 'Class', value: cls, set: (v) => (cls = v), options: opts(spellClasses, cap, counts('cls', (e) => (e.kind === 'spell' ? e.classes : []))) },
      );
    } else if (tab === 'item') {
      out.push(
        { id: 'itemType', label: 'Type', value: itemType, set: (v) => (itemType = v), options: opts(itemTypes, cap, counts('itemType', (e) => [e.kind === 'item' ? e.type : undefined])) },
        { id: 'rarity', label: 'Rarity', value: rarity, set: (v) => (rarity = v), options: opts(rarities, cap, counts('rarity', (e) => [e.kind === 'item' ? e.rarity : undefined])) },
        { id: 'magic', label: 'Magic', value: magic, set: (v) => (magic = v), options: opts(['magic', 'mundane'], cap, counts('magic', (e) => [e.kind === 'item' ? (e.magic ? 'magic' : 'mundane') : undefined])) },
      );
    }
    out.push({ id: 'source', label: 'Source', value: source, set: (v) => (source = v), options: opts(sources, (s) => index?.label(s) ?? s, counts('source', (e) => [e.source])) });
    return out;
  });
  const valueLabel = (f: Filter) => f.options.find((o) => o.value === f.value)?.label ?? f.value;
  const menuItems = (f: Filter): MenuItem[] => [
    { label: `Any ${f.label.toLowerCase()}`, checked: f.value === '', onselect: () => f.set('') },
    ...f.options.map((o) => ({ label: o.label, count: o.count, checked: f.value === o.value, onselect: () => f.set(o.value) })),
  ];
  const anyFilter = $derived(filters.some((f) => f.value !== ''));
  const clearFilters = () => { source = level = cls = itemType = rarity = magic = ''; };

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
  // A row's second and third columns (on a phone, its second line): what it is, and where it is from.
  function what(e: Entity): string {
    return e.kind === 'spell' ? (e.level === 0 ? `${cap(e.school)} cantrip` : `Level ${e.level} ${e.school}`)
      : e.kind === 'item' ? [cap(e.type), e.magic && e.rarity].filter(Boolean).join(', ')
      : e.kind === 'class' ? `d${e.hitDie}`
      : e.kind === 'subclass' ? 'Subclass'
      : e.kind === 'subrace' ? 'Subrace'
      : '';
  }
  function from(e: Entity): string {
    const all = siblings(e);
    return all.length > 1 ? `${all.length} versions: ${all.map((v) => v.source).join(', ')}` : (index?.label(e.source) ?? e.source);
  }
  const whatHead = $derived(({ spell: 'Level', item: 'Type', class: 'Hit die' } as Record<string, string>)[tab] ?? 'Kind');
</script>

<Workspace panelLabel="Details" open={!!select && !!index} onclose={() => go()}>
  <section class="browse" aria-label="Browse">
    <h1>Compendium</h1>
    <Tabs label="Kind" {tabs} bind:value={tab} onchange={reset} />

    <div class="filters">
      <label class="search">
        <span class="sr-only">Search</span>
        <input type="search" bind:value={q} autocomplete="off" placeholder="Search…" />
      </label>
      {#each filters as f (f.id)}
        <Menu label={f.value ? valueLabel(f) : f.label} ariaLabel={f.value ? `${f.label}: ${valueLabel(f)}` : undefined} active={f.value !== ''} items={menuItems(f)} />
      {/each}
    </div>

    {#if error}
      <p class="error" role="alert">Could not load the compendium: {error}</p>
    {:else if !index}
      <p class="muted">Loading…</p>
    {:else}
      <div class="active">
        {#each filters.filter((f) => f.value) as f (f.id)}
          <Pill label={valueLabel(f)} onremove={() => f.set('')} />
        {/each}
        <span class="muted count" aria-live="polite"><span class="num">{rows.length}</span> {rows.length === 1 ? 'entry' : 'entries'}</span>
        {#if anyFilter}<button type="button" class="clear" onclick={clearFilters}>clear</button>{/if}
      </div>
      <div class="listwrap">
        <div class="cols head" aria-hidden="true"><span>Name</span><span>{whatHead}</span><span>Source</span></div>
        <VirtualList items={rows} {selected} label={tabs.find((t) => t.id === tab)?.label ?? 'Entries'} onselect={(e) => go(e.id)}>
          {#snippet row(raw)}
            {@const e = raw.kind === 'item' ? displayItem(raw, app.viewer) : raw}
            <span class="cols">
              <span class="name" class:child={!!parentOf(e)}>{e.name}</span>
              <span class="what" class:child={!!parentOf(e)}>{what(e)}</span>
              <span class="from">{from(e)}</span>
            </span>
          {/snippet}
        </VirtualList>
      </div>
    {/if}
  </section>

  {#snippet panel()}
    {#if selected}
      {#if siblings(selected).length > 1}
        <VersionToggle versions={siblings(selected)} value={selected.id} label={(s) => index?.label(s) ?? s} onchange={(id) => go(id)} />
      {/if}
      <EntityDetail entity={selected} {index} />
    {:else if select && index}
      <p class="muted">That entry is not in this campaign's content.</p>
    {:else}
      <p class="muted">Select an entry to read it.</p>
    {/if}
  {/snippet}
</Workspace>

<style>
  .browse {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  h1 {
    margin: 0.6rem 0 0;
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

  /* One row: name, what, source. The header reserves the list's scrollbar gutter so the columns line up. */
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'name name' 'what from';
    column-gap: 0.75rem;
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

  .what,
  .from {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .what {
    grid-area: what;
  }

  .from {
    grid-area: from;
  }

  .child {
    padding-left: 1.25rem;
  }

  .head {
    display: none;
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
      grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr);
      grid-template-areas: 'name what from';
      align-items: baseline;
    }

    .what,
    .from {
      font-size: 0.9rem;
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
