<script lang="ts">
  import type { Snippet } from 'svelte';
  import { refreshEntry } from '../../lib/items/inventory.ts';
  import { app } from '../../lib/store.svelte.ts';
  import type { Campaign, Character } from '../../lib/types.ts';
  import Workspace from '../kit/Workspace.svelte';
  import ItemPicker from '../ItemPicker.svelte';
  import EntryRow from './EntryRow.svelte';
  import { editUnassigned, giveFromUnassigned } from './loot.ts';
  import { latestItem, type Pool } from './pool.ts';

  let { campaign, pool, chars, error, tabs }: { campaign: Campaign; pool: Pool | undefined; chars: Character[]; error: string; tabs: Snippet } = $props();

  let adding = $state(false);
  const targets = $derived(chars.map((x) => ({ id: x.id, label: x.name || 'Unnamed' })));
  const edit = (fn: Parameters<typeof editUnassigned>[1]) => editUnassigned(campaign.id, fn);
</script>

<!-- While adding, the picker takes the right panel (the bottom sheet on phones), so the list stays in view. -->
{#snippet picker()}
  <p class="caption">Add to Unassigned</p>
  {#if pool}
    <ItemPicker {pool} viewer={app.viewer} onpick={(entry) => edit((list) => [...list, entry])} />
  {:else if error}<p role="alert" class="error">{error}</p>
  {:else}<p class="muted">Loading items…</p>{/if}
{/snippet}

<Workspace panel={adding ? picker : undefined} panelLabel="Add item" open={adding} onclose={() => (adding = false)}>
  <div class="head">
    {@render tabs()}
    <span class="end"><button type="button" class:primary={!adding} aria-expanded={adding} onclick={() => (adding = !adding)}>{#if adding}Done adding{:else}<span aria-hidden="true">+&nbsp;</span>Add item{/if}</button></span>
  </div>
  <p class="muted intro">The DM's holding list for <strong>{campaign.name}</strong>. Players do not see it. Use Give to… to move an item into a character's inventory.</p>

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
</Workspace>

<style>
  .head {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    border-bottom: 1px solid var(--line);
  }

  .head > :global([role='tablist']) {
    flex: 1;
    min-width: 0;
    border-bottom: 0;
  }

  .end {
    padding-bottom: 0.35rem;
  }

  .intro {
    margin: 0.6rem 0;
  }

  ul {
    border-bottom: 1px solid var(--line);
  }
</style>
