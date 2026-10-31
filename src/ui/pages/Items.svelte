<script lang="ts">
  import { db } from '../../lib/db.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { app } from '../../lib/store.svelte.ts';
  import type { StoredItem } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import ItemEditor from '../items/ItemEditor.svelte';

  let { params }: { params: Record<string, string> } = $props();

  const campaign = $derived(app.campaign);

  const blank = (campaignId: string): StoredItem => ({ id: '', kind: 'item', name: '', source: 'Homebrew', text: [], type: 'wondrous', magic: true, campaignId, updatedAt: 0 });

  // `items` lists; `items/new` and `items/:id` edit. Awaiting by (campaign, id) remounts the editor for a different item.
  async function load(campaignId: string, id: string): Promise<StoredItem> {
    if (id === 'new') return blank(campaignId);
    const it = await db.items.get(id);
    if (!it || it.campaignId !== campaignId) throw new Error('That item is not in this campaign.');
    return it;
  }
  const list = (campaignId: string) => db.items.list(campaignId).then((l) => l.sort((a, b) => a.name.localeCompare(b.name)));
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
  <h1>Items</h1>
  <p class="muted">Homebrew items for <strong>{campaign.name}</strong>. They also appear in the Compendium.</p>
  <p><button type="button" class="primary" onclick={() => navigate('items/new')}>New item</button></p>
  {#await list(campaign.id)}
    <p class="muted">Loading…</p>
  {:then items}
    {#if items.length}
      <ul class="plain">
        {#each items as it (it.id)}
          <li class="card">
            <a href="#/items/{it.id}"><strong>{it.name}</strong></a>
            <span class="muted">{[it.type, it.magic ? it.rarity : undefined].filter(Boolean).join(', ')}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No homebrew items yet.</p>
    {/if}
  {:catch e}
    <p role="alert" class="error">{message(e)}</p>
  {/await}
{/if}
