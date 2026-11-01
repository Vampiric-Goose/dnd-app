<script lang="ts">
  import { db } from '../../lib/db.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { app } from '../../lib/store.svelte.ts';
  import type { Campaign, Character } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import Tabs from '../kit/Tabs.svelte';
  import Workspace from '../kit/Workspace.svelte';
  import AllItems from './AllItems.svelte';
  import { loadPool, type Pool } from './pool.ts';
  import Unassigned from './Unassigned.svelte';

  let { campaign }: { campaign: Campaign } = $props();

  let pool: Pool | undefined = $state.raw();
  let chars: Character[] = $state.raw([]);
  let error = $state('');

  let seq = 0;
  async function load(id: string) {
    const mine = ++seq;
    try {
      const [p, list] = await Promise.all([loadPool(id), db.characters.list(id)]);
      if (mine !== seq) return;
      pool = p;
      chars = list.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      if (mine === seq) error = message(e);
    }
  }
  $effect(() => {
    const id = campaign.id;
    pool = undefined;
    chars = [];
    error = '';
    void load(id);
    return () => { seq++; };
  });

  // Unassigned is the DM's: a player never sees the tab, and its address shows All items.
  const tab = $derived(router.query.get('tab') === 'unassigned' && app.viewer === 'dm' ? 'unassigned' : 'all');
  const tabs = $derived([{ id: 'all', label: 'All items' }, ...(app.viewer === 'dm' ? [{ id: 'unassigned', label: 'Unassigned', count: campaign.loot.length }] : [])]);
  const go = (id: string) => { location.hash = id === 'all' ? '#/items' : `#/items?tab=${id}`; };
</script>

<!-- The tab strip starts each view's header row; the view adds its own action at the right end. -->
{#snippet tabStrip()}
  {#if tabs.length > 1}
    <Tabs label="Items view" {tabs} value={tab} onchange={go} />
  {:else}
    <span class="caption">All items</span>
  {/if}
{/snippet}

<h1 class="sr-only">Items</h1>
{#if tab === 'unassigned'}
  <Unassigned {campaign} {pool} {chars} {error} tabs={tabStrip} />
{:else if pool}
  <AllItems {campaign} {pool} {chars} reload={() => load(campaign.id)} tabs={tabStrip} />
{:else}
  <Workspace>
    {@render tabStrip()}
    {#if error}<p role="alert" class="error">{error}</p>{:else}<p class="muted">Loading items…</p>{/if}
  </Workspace>
{/if}
