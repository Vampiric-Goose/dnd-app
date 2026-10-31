<script lang="ts">
  import { db } from '../../lib/db.ts';
  import { app } from '../../lib/store.svelte.ts';
  import type { StoredItem } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import ItemEditor from '../items/ItemEditor.svelte';
  import ItemsHome from '../items/ItemsHome.svelte';

  let { params }: { params: Record<string, string> } = $props();

  const campaign = $derived(app.campaign);

  const blank = (campaignId: string): StoredItem => ({ id: '', kind: 'item', name: '', source: 'Homebrew', text: [], type: 'wondrous', magic: true, campaignId, updatedAt: 0 });

  // `items` is the page (All items and Unassigned tabs); `items/new` and `items/:id` edit. Awaiting by (campaign, id) remounts the editor for a different item.
  async function load(campaignId: string, id: string): Promise<StoredItem> {
    if (id === 'new') return blank(campaignId);
    const it = await db.items.get(id);
    if (!it || it.campaignId !== campaignId) throw new Error('That item is not in this campaign.');
    return it;
  }
</script>

{#if !campaign}
  <h1>Items</h1>
  <p>{app.ready ? 'No campaign is open.' : 'Loading…'} <a href="#/">Open or create a campaign</a> first.</p>
{:else if params.id}
  {#key campaign.id + params.id}
    {#await load(campaign.id, params.id)}
      <p class="muted">Loading…</p>
    {:then initial}
      <ItemEditor {initial} isNew={params.id === 'new'} />
    {:catch e}
      <h1>Items</h1>
      <p role="alert" class="error">{message(e)}</p>
      <p><a href="#/items">Back to items</a></p>
    {/await}
  {/key}
{:else}
  <ItemsHome {campaign} />
{/if}
