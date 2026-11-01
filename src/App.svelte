<script lang="ts">
  import { onMount, untrack, type Component } from 'svelte';
  import { requestPersistence } from './lib/db.ts';
  import { dmOnly, router } from './lib/router.svelte.ts';
  import { app, startup } from './lib/store.svelte.ts';
  import { follow, session } from './lib/sync/session.svelte.ts';
  import { rollViewer } from './lib/rolls.svelte.ts';
  import BackupBanner from './ui/BackupBanner.svelte';
  import CampaignPicker from './ui/CampaignPicker.svelte';
  import DiceTray from './ui/DiceTray.svelte';
  import Toast from './ui/Toast.svelte';
  import SyncStatus from './ui/sync/SyncStatus.svelte';
  import ViewerToggle from './ui/ViewerToggle.svelte';

  onMount(() => {
    void requestPersistence();
    void startup();
  });

  // R12: who is rolling. A joined campaign holds nothing hidden, so its rolls are a player's whatever the view toggle says.
  $effect(() => {
    rollViewer.value = app.campaign?.sync?.role === 'player' ? 'player' : app.viewer;
  });

  // Stage 3: hosting resumes, or a joined campaign reconnects, for the open campaign (the session loads the engine only then).
  $effect(() => {
    const c = app.campaign; // a new object whenever campaigns are re-read
    if (app.ready) untrack(() => void follow(c));
  });

  type Params = Record<string, string>;
  // Each page receives the route's `:name` captures as a `params` prop (pages may ignore it).
  type Loader = () => Promise<{ default: Component<any> }>;

  // One line per route: [pattern, page name, lazy loader]. A route with no loader shows the
  // "Not built yet" placeholder; a later task adds its page with, for example,
  // () => import('./ui/pages/Characters.svelte'). Order matters: first match wins.
  const routes: [pattern: string, name: string, load?: Loader][] = [
    ['', 'Campaigns', () => import('./ui/pages/Campaigns.svelte')],
    ['characters', 'Characters', () => import('./ui/pages/Characters.svelte')],
    ['characters/new', 'Creator', () => import('./ui/creator/Creator.svelte')],
    ['characters/:id', 'Sheet', () => import('./ui/sheet/Sheet.svelte')],
    ['characters/:id/level-up', 'LevelUp', () => import('./ui/creator/LevelUp.svelte')],
    ['characters/:id/choices', 'Choices', () => import('./ui/creator/Choices.svelte')],
    ['combat', 'Initiative', () => import('./ui/pages/Initiative.svelte')],
    ['compendium', 'Compendium', () => import('./ui/pages/Compendium.svelte')],
    ['monsters', 'Monsters', () => import('./ui/pages/Monsters.svelte')],
    ['monsters/new', 'MonsterEditor', () => import('./ui/pages/Monsters.svelte')], // `?from=<id>` starts from a copy (Duplicate)
    ['monsters/:id', 'Monsters', () => import('./ui/pages/Monsters.svelte')], // the library with that monster's stat block open
    ['monsters/:id/edit', 'MonsterEditor', () => import('./ui/pages/Monsters.svelte')],
    ['items', 'Items', () => import('./ui/pages/Items.svelte')],
    ['items/:id', 'ItemEditor', () => import('./ui/pages/Items.svelte')], // the same page; `:id` is an item id or "new"
    ['packs', 'Packs', () => import('./ui/pages/Packs.svelte')],
    ['settings', 'CampaignSettings', () => import('./ui/pages/CampaignSettings.svelte')],
    ['about', 'About', () => import('./ui/pages/About.svelte')],
    ['join', 'Join', () => import('./ui/pages/Join.svelte')], // no code yet: the page asks for one
    ['join/:code', 'Join', () => import('./ui/pages/Join.svelte')],
    ['map', 'Map', () => import('./ui/pages/Map.svelte')], // stage 5; `?scene=<id>` picks the scene
  ];

  // Compendium, Monsters and Items are DM information (R2): no link in Player view (always Player in a joined campaign).
  const nav = $derived(([
    ['Campaigns', ''],
    ['Characters', 'characters'],
    ['Combat', 'combat'],
    ['Map', 'map'],
    ['Compendium', 'compendium'],
    ['Monsters', 'monsters'],
    ['Items', 'items'],
    ['Packs', 'packs'],
    ['Settings', 'settings'],
    ['About', 'about'],
  ] as [label: string, segment: string][]).filter(([, g]) => !dmOnly(app.viewer, g)));

  // The phone bottom bar's tabs; everything else is under More.
  const PRIMARY = new Set(['characters', 'combat', 'map', 'items']);
  const here = $derived(router.path[0] ?? '');
  let moreOpen = $state(false);

  // The sticky top bar's height, for kit/Workspace.svelte (panel height) and the Dice button (sits in the bar on desktop).
  let topH = $state(0);
  $effect(() => {
    if (topH) document.documentElement.style.setProperty('--topbar-h', `${topH}px`);
  });
  // The backup reminder strip's height (0 when hidden), so a full-height Workspace (the map) still fits the screen.
  let bannerH = $state(0);
  $effect(() => { document.documentElement.style.setProperty('--banner-h', `${bannerH}px`); });

  function match(key: string) {
    const path = key.split('/').filter(Boolean);
    for (const [pattern, name, load] of routes) {
      const parts = pattern.split('/').filter(Boolean);
      const params: Params = {};
      const hit =
        parts.length === path.length &&
        parts.every((part, i) => {
          if (!part.startsWith(':')) return part === path[i];
          params[part.slice(1)] = path[i];
          return true;
        });
      if (hit) return { name, load, params };
    }
  }

  // Keyed by the joined path so a query-only change (such as a tab switch) keeps the page mounted.
  const key = $derived(router.path.join('/'));
  const current = $derived(match(key));
  // A typed address still lands: a notice instead. The DM's page stays mounted (hidden) so toggling to Player can't lose its
  // unsaved edits; a joined campaign never had a DM there, so nothing mounts.
  const blocked = $derived(dmOnly(app.viewer, here));
</script>

<div class="shell">
  <header bind:offsetHeight={topH}>
    <span class="brand phone-only">DNDND</span>
    <div class="campaign-slot"><CampaignPicker /></div>
    <SyncStatus />
    <ViewerToggle />
  </header>

  <nav aria-label="Main">
    <span class="brand rail-only">DNDND</span>
    {#each nav as [label, segment]}
      <a href="#/{segment}" class:secondary={!PRIMARY.has(segment)} aria-current={here === segment ? 'page' : undefined}>{label}</a>
    {/each}
    <!-- Phones: the bottom bar keeps four big tabs; the rest sit behind More. -->
    <details class="more" bind:open={moreOpen}>
      <summary aria-current={nav.some(([, g]) => g === here && !PRIMARY.has(g)) ? 'page' : undefined}>More</summary>
      <div class="menu">
        {#each nav.filter(([, g]) => !PRIMARY.has(g)) as [label, segment]}
          <a href="#/{segment}" aria-current={here === segment ? 'page' : undefined} onclick={() => (moreOpen = false)}>{label}</a>
        {/each}
      </div>
    </details>
  </nav>

  <main>
    <div bind:clientHeight={bannerH}><BackupBanner /></div>
    {#if app.error && key !== ''}<p role="alert" class="error">{app.error}</p>{/if}<!-- the Campaigns page shows it itself -->
    {#if !current}
      <h1>Page not found</h1>
      <p><a href="#/">Back to Campaigns</a></p>
    {:else if current.load}
      {#if blocked}
        <h1>Not available to players</h1>
        <p><a href="#/characters">Go to Characters</a></p>
      {/if}
      {#if !blocked || app.campaign?.sync?.role !== 'player'}
        <div class="page" style:display={blocked ? 'none' : 'contents'}>
          {#await current.load()}
            <!-- the page chunk is loading -->
          {:then { default: Page }}
            <Page params={current.params} />
          {:catch}
            <p role="alert">Could not load this page. Check your connection and reload.</p>
          {/await}
        </div>
      {/if}
    {:else}
      <h1>{current.name}</h1>
      <p>Not built yet.</p>
    {/if}
  </main>
</div>

<DiceTray />
<Toast />
{#if app.campaign?.sync?.role === 'player' && session.tracker?.ask}
  {#await import('./ui/initiative/InitiativePrompt.svelte') then { default: InitiativePrompt }}<InitiativePrompt campaign={app.campaign} />{/await}
{/if}

<style>
  /*
   * Phones: top bar (scrolls away), page, fixed bottom tab bar.
   * >= 768 px: left rail (sticky, full height) | sticky slim top bar over the page.
   * Pages are padded by --page-pad / --page-pad-bottom; kit/Workspace.svelte cancels that to go edge to edge.
   */
  .shell {
    display: grid;
    grid-template-areas: 'top' 'main';
    grid-template-rows: auto 1fr;
    min-height: 100dvh;
    padding-bottom: var(--bottombar-h); /* room for the fixed bottom tab bar */
  }

  .brand {
    color: var(--text-strong);
    font-weight: 600;
    font-size: 0.9rem;
    letter-spacing: 0.3em;
  }

  .rail-only {
    display: none;
  }

  header {
    grid-area: top;
    display: flex;
    align-items: center;
    gap: 0.4rem 0.9rem;
    flex-wrap: wrap;
    min-height: 2.75rem;
    box-sizing: border-box;
    padding: 0.3rem var(--page-pad);
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }

  .campaign-slot {
    margin-right: auto;
    min-width: 0;
  }

  main {
    --page-pad: 1rem;
    --page-pad-bottom: 4.5rem; /* the floating Dice button must never cover the last controls on a page */
    grid-area: main;
    padding: 0 var(--page-pad) var(--page-pad-bottom);
    min-width: 0;
    overflow-wrap: anywhere; /* long URLs, such as the SRD attribution's, must not widen the page */
  }

  header {
    --page-pad: 1rem;
  }

  nav {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 30; /* the More menu opens above the page, the bottom sheet and the floating Dice button */
    display: flex;
    height: var(--bottombar-h);
    background: var(--rail);
    border-top: 1px solid var(--line);
  }

  nav > a,
  .more > summary {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    color: var(--muted);
    text-decoration: none;
    cursor: pointer;
  }

  nav > a.secondary {
    display: none;
  }

  .more {
    flex: 1 1 0;
    display: flex;
  }

  .more > summary {
    list-style: none;
  }

  .more > summary::-webkit-details-marker {
    display: none;
  }

  .more .menu {
    position: fixed;
    right: 0.5rem;
    bottom: calc(var(--bottombar-h) + 0.4rem);
    display: flex;
    flex-direction: column;
    min-width: 12rem;
    padding: 0.3rem;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    box-shadow: 0 10px 24px rgb(0 0 0 / 0.5);
  }

  .more .menu a {
    padding: 0.7rem 1rem;
    border-radius: 4px;
    color: var(--text);
    text-decoration: none;
  }

  nav a[aria-current='page'],
  .more > summary[aria-current='page'] {
    color: var(--accent);
    box-shadow: inset 0 2px var(--accent);
  }

  .more .menu a[aria-current='page'] {
    color: var(--text-strong);
    background: var(--raised);
    box-shadow: inset 2px 0 var(--accent);
  }

  @media (min-width: 768px) {
    .shell {
      grid-template-areas: 'nav top' 'nav main';
      grid-template-columns: 11rem minmax(0, 1fr);
      grid-template-rows: auto 1fr;
    }

    .phone-only {
      display: none;
    }

    .rail-only {
      display: block;
      padding: 0.35rem 0.6rem 1.1rem;
    }

    header,
    main {
      --page-pad: 1.5rem;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 10;
      padding-right: 7rem; /* the Dice button sits at the top bar's right end */
    }

    main {
      --page-pad-bottom: 1.5rem;
    }

    nav {
      grid-area: nav;
      position: sticky;
      top: 0;
      height: 100dvh;
      flex-direction: column;
      gap: 1px;
      box-sizing: border-box;
      padding: 0.9rem 0.6rem;
      overflow-y: auto;
      border-top: 0;
      border-right: 1px solid var(--line);
    }

    nav > a,
    nav > a.secondary {
      display: block;
      flex: none;
      padding: 0.4rem 0.6rem;
      border-radius: 5px;
      font-size: 1rem;
    }

    nav > a:hover {
      color: var(--text);
    }

    .more {
      display: none;
    }

    nav a[aria-current='page'] {
      color: var(--text-strong);
      background: var(--raised);
      box-shadow: inset 2px 0 var(--accent);
    }
  }
</style>
