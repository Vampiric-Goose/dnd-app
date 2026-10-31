<script lang="ts">
  import { db } from '../../lib/db.ts';
  import { soundItem } from '../../lib/items/homebrew.ts';
  import { app } from '../../lib/store.svelte.ts';
  import type { StoredItem } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import ItemEditor from '../items/ItemEditor.svelte';
  import ItemsHome from '../items/ItemsHome.svelte';
  import { router } from '../../lib/router.svelte.ts';
  import { pasted } from '../pasted.ts';

  let { params }: { params: Record<string, string> } = $props();

  const campaign = $derived(app.campaign);

  const blank = (campaignId: string): StoredItem => ({ id: '', kind: 'item', name: '', source: 'Homebrew', text: [], type: 'wondrous', magic: true, campaignId, updatedAt: 0 });

  // `items` is the page (All items and Unassigned tabs); `items/new` and `items/:id` edit. Awaiting by (campaign, id) remounts the editor for a different item.
  async function load(campaignId: string, id: string): Promise<StoredItem> {
    // `items/new?pasted=1`: the paste dialog's draft, unsaved until Save.
    if (id === 'new' && router.query.has('pasted')) {
      if (!pasted.item) throw new Error('The pasted item is gone (the page was reloaded). Paste it again.');
      return { ...blank(campaignId), ...pasted.item.draft, id: '', source: 'Homebrew', campaignId, updatedAt: 0 };
    }
    if (id === 'new') return blank(campaignId);
    const it = await db.items.get(id);
    if (!it || it.campaignId !== campaignId) throw new Error('That item is not in this campaign.');
    if (!soundItem(it)) throw new Error('That item is damaged and cannot be opened. Remove it with "Remove damaged items" on the Items page.');
    return it;
  }
</script>

{#if !campaign}
  <h1>Items</h1>
  <p>{app.ready ? 'No campaign is open.' : 'Loading…'} <a href="#/">Open or create a campaign</a> first.</p>
{:else if params.id}
  <!-- The editor shows the real item, so Player view hides it. It stays mounted (hidden, not removed) so switching view can't
       lose unsaved edits; its leave guard still asks before the "Back to items" link or any other navigation leaves it. -->
  {#if app.viewer === 'player'}
    <h1>Items</h1>
    <p>Switch to DM view to edit items. <a href="#/items">Back to items</a></p>
  {/if}
  <div hidden={app.viewer === 'player'}>
    {#key campaign.id + params.id}
      {#await load(campaign.id, params.id)}
        <p class="muted">Loading…</p>
      {:then initial}
        {#if params.id === 'new' && router.query.has('pasted') && pasted.item?.notes.length}
          <div class="card" role="note">
            <strong>Read from pasted text.</strong> Check these before saving:
            <ul>{#each pasted.item.notes as n}<li>{n}</li>{/each}</ul>
          </div>
        {/if}
        <ItemEditor {initial} isNew={params.id === 'new'} pasted={params.id === 'new' && router.query.has('pasted')} />
      {:catch e}
        <h1>Items</h1>
        <p role="alert" class="error">{message(e)}</p>
        <p><a href="#/items">Back to items</a></p>
      {/await}
    {/key}
  </div>
{:else}
  <ItemsHome {campaign} />
{/if}
