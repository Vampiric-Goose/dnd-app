<script lang="ts">
  import { refreshEntry } from '../../lib/items/inventory.ts';
  import { app } from '../../lib/store.svelte.ts';
  import type { Campaign, Character } from '../../lib/types.ts';
  import ItemPicker from '../ItemPicker.svelte';
  import EntryRow from './EntryRow.svelte';
  import { editUnassigned, giveFromUnassigned } from './loot.ts';
  import { latestItem, type Pool } from './pool.ts';

  let { campaign, pool, chars, error }: { campaign: Campaign; pool: Pool | undefined; chars: Character[]; error: string } = $props();

  let adding = $state(false);
  const targets = $derived(chars.map((x) => ({ id: x.id, label: x.name || 'Unnamed' })));
  const edit = (fn: Parameters<typeof editUnassigned>[1]) => editUnassigned(campaign.id, fn);
</script>

<p class="muted">The DM's holding list for <strong>{campaign.name}</strong>. Players do not see it. Use Give to… to move an item into a character's inventory.</p>
<p><button type="button" class="primary" aria-expanded={adding} onclick={() => (adding = !adding)}>{adding ? 'Done adding' : 'Add item'}</button></p>
{#if adding}
  {#if pool}
    <ItemPicker {pool} viewer={app.viewer} onpick={(entry) => edit((list) => [...list, entry])} />
  {:else if error}<p role="alert" class="error">{error}</p>
  {:else}<p class="muted">Loading items…</p>{/if}
{/if}

{#if campaign.loot.length}
  <ul class="plain">
    {#each campaign.loot as e (e.id)}
      <EntryRow
        entry={e} viewer={app.viewer} {targets} moveLabel="Give to…"
        canRefresh={!!pool && !!e.sourceId && !!latestItem(pool, e.sourceId)}
        onchange={(fn) => edit((list) => list.map((x) => (x.id === e.id ? fn(x) : x)))}
        onremove={() => edit((list) => list.filter((x) => x.id !== e.id))}
        onrefresh={() => {
          const latest = pool && e.sourceId ? latestItem(pool, e.sourceId) : undefined;
          if (latest) void edit((list) => list.map((x) => (x.id === e.id ? refreshEntry(x, latest) : x)));
        }}
        onmove={async (target, qty) => { await giveFromUnassigned(campaign.id, e.id, qty, target); }}
      />
    {/each}
  </ul>
{:else}
  <p class="muted">Nothing is unassigned yet.</p>
{/if}
