<script lang="ts">
  import { onMount, untrack, type Component } from 'svelte';
  import { APP_NAME } from './lib/app.ts';
  import { requestPersistence } from './lib/db.ts';
  import { router } from './lib/router.svelte.ts';
  import { app, startup } from './lib/store.svelte.ts';
  import { follow } from './lib/sync/session.svelte.ts';
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
    ['join/:code', 'Join', () => import('./ui/pages/Join.svelte')],
  ];

  // Monsters are DM information (R2): no link in Player view.
  const nav = $derived<[label: string, segment: string][]>([
    ['Campaigns', ''],
    ['Characters', 'characters'],
    ['Compendium', 'compendium'],
    ...(app.viewer === 'dm' ? [['Monsters', 'monsters'] as [string, string]] : []),
    ['Items', 'items'],
    ['Packs', 'packs'],
    ['Settings', 'settings'],
    ['About', 'about'],
  ]);

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
</script>

<div class="shell">
  <header>
    <strong>{APP_NAME}</strong>
    <SyncStatus />
    <div class="campaign-slot"><CampaignPicker /></div>
    <ViewerToggle />
  </header>

  <nav aria-label="Main">
    {#each nav as [label, segment]}
      <a href="#/{segment}" aria-current={(router.path[0] ?? '') === segment ? 'page' : undefined}>{label}</a>
    {/each}
  </nav>

  <main>
    <BackupBanner />
    {#if app.error && key !== ''}<p role="alert" class="error">{app.error}</p>{/if}<!-- the Campaigns page shows it itself -->
    {#if !current}
      <h1>Page not found</h1>
      <p><a href="#/">Back to Campaigns</a></p>
    {:else if current.load}
      {#await current.load()}
        <!-- the page chunk is loading -->
      {:then { default: Page }}
        <Page params={current.params} />
      {:catch}
        <p role="alert">Could not load this page. Check your connection and reload.</p>
      {/await}
    {:else}
      <h1>{current.name}</h1>
      <p>Not built yet.</p>
    {/if}
  </main>
</div>

<DiceTray />
<Toast />

<style>
  .shell {
    display: grid;
    grid-template-areas: 'top' 'main';
    grid-template-rows: auto 1fr;
    min-height: 100vh;
    padding-bottom: 3.5rem; /* room for the fixed bottom tab bar */
  }

  header {
    grid-area: top;
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.5rem 1rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  .campaign-slot {
    margin-left: auto;
  }

  main {
    grid-area: main;
    padding: 0 1rem 4.5rem; /* the floating Dice button must never cover the last controls on a page */
    min-width: 0;
    overflow-wrap: anywhere; /* long URLs, such as the SRD attribution's, must not widen the page */
  }

  nav {
    position: fixed;
    inset: auto 0 0 0;
    display: flex;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }

  nav a {
    flex: 1 1 auto; /* size by label so all eight labels fit at 375px */
    padding: 0.9rem 0.05rem;
    text-align: center;
    font-size: 0.7rem;
    color: var(--muted);
    text-decoration: none;
  }

  nav a[aria-current='page'] {
    color: var(--accent);
    box-shadow: inset 0 3px var(--accent);
  }

  @media (min-width: 768px) {
    .shell {
      grid-template-areas: 'nav top' 'nav main';
      grid-template-columns: 12rem 1fr;
      padding-bottom: 0;
    }

    nav {
      grid-area: nav;
      position: sticky;
      top: 0;
      height: 100vh;
      flex-direction: column;
      border-top: 0;
      border-right: 1px solid var(--border);
    }

    nav a {
      flex: none;
      padding: 0.75rem 1.25rem;
      text-align: left;
      font-size: 1rem;
    }

    nav a[aria-current='page'] {
      box-shadow: inset 3px 0 var(--accent);
    }
  }
</style>
