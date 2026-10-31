<script lang="ts">
  import { db, StorageError } from '../../lib/db.ts';
  import { refreshEntry, transfer } from '../../lib/items/inventory.ts';
  import { app, refreshCampaigns, saveCampaign } from '../../lib/store.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Character, InventoryEntry } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import EntryRow from '../items/EntryRow.svelte';
  import { latestItem, loadPool, type Pool } from '../items/pool.ts';
  import ItemPicker from '../ItemPicker.svelte';

  const campaign = $derived(app.campaign);
  const campaignId = $derived(campaign?.id);

  let pool: Pool | undefined = $state.raw();
  let chars: Character[] = $state.raw([]);
  let adding = $state(false);
  let error = $state('');

  $effect(() => {
    const id = campaignId;
    let live = true;
    pool = undefined;
    chars = [];
    if (!id) return;
    loadPool(id).then((p) => { if (live) pool = p; }, (e) => { if (live) error = message(e); });
    db.characters.list(id).then((l) => { if (live) chars = l.sort((a, b) => a.name.localeCompare(b.name)); }, () => {});
    return () => { live = false; };
  });

  const targets = $derived(chars.map((x) => ({ id: x.id, label: x.name || 'Unnamed' })));

  // Every change re-reads the campaign first (a sheet may have moved loot meanwhile) and runs one at a time.
  // The page shows app.campaign, which only changes once the write has succeeded: on failure nothing moves.
  let queue: Promise<unknown> = Promise.resolve();
  const run = (f: (id: string) => Promise<void>) => {
    const id = campaignId;
    if (id) queue = queue.then(() => f(id)).catch((e) => toast(e instanceof StorageError ? e.message : `Could not save: ${message(e)}`, true));
    return queue as Promise<void>;
  };
  const edit = (fn: (loot: InventoryEntry[]) => InventoryEntry[]) => run(async (id) => {
    const fresh = await db.campaigns.get(id);
    if (!fresh) throw new Error('The campaign no longer exists.');
    await saveCampaign({ ...fresh, loot: fn(fresh.loot) });
  });

  // R44: the loot and the receiving character commit in one transaction; the character is read fresh.
  const give = (entryId: string, qty: number, charId: string) => run(async (id) => {
    const [fresh, ch] = await Promise.all([db.campaigns.get(id), db.characters.get(charId)]);
    if (!fresh || !ch) throw new Error('Could not find the campaign or the character.');
    const moved = transfer(fresh.loot, ch.inventory, entryId, qty);
    if (moved.from === fresh.loot) throw new Error('Nothing was moved.');
    await db.saveTogether({ characters: [{ ...ch, inventory: moved.to }], campaign: { ...fresh, loot: moved.from } });
    await refreshCampaigns();
    toast(`Given to ${ch.name || 'Unnamed'}.`);
  });
</script>

<h1>Party loot</h1>
{#if !campaign}
  <p>{app.ready ? 'No campaign is open.' : 'Loading…'} <a href="#/">Open or create a campaign</a> first.</p>
{:else}
  <p class="muted">Shared by everyone in <strong>{campaign.name}</strong>. Give an item to a character to move it into their inventory.</p>
  <p><button type="button" class="primary" aria-expanded={adding} onclick={() => (adding = !adding)}>{adding ? 'Done adding' : 'Add item'}</button></p>
  {#if adding}
    {#if pool}
      <ItemPicker {pool} viewer={app.viewer} onpick={(entry) => edit((loot) => [...loot, entry])} />
    {:else if error}<p role="alert" class="error">{error}</p>
    {:else}<p class="muted">Loading items…</p>{/if}
  {/if}

  {#if campaign.loot.length}
    <ul class="plain">
      {#each campaign.loot as e (e.id)}
        <EntryRow
          entry={e} viewer={app.viewer} {targets} moveLabel="Give to…"
          canRefresh={!!pool && !!e.sourceId && !!latestItem(pool, e.sourceId)}
          onchange={(fn) => edit((loot) => loot.map((x) => (x.id === e.id ? fn(x) : x)))}
          onremove={() => edit((loot) => loot.filter((x) => x.id !== e.id))}
          onrefresh={() => {
            const latest = pool && e.sourceId ? latestItem(pool, e.sourceId) : undefined;
            if (latest) void edit((loot) => loot.map((x) => (x.id === e.id ? refreshEntry(x, latest) : x)));
          }}
          onmove={(target, qty) => give(e.id, qty, target)}
        />
      {/each}
    </ul>
  {:else}
    <p class="muted">The party has no loot yet.</p>
  {/if}
{/if}
