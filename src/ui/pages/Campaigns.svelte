<script lang="ts">
  import { importBackup } from '../../lib/backup.ts';
  import { db } from '../../lib/db.ts';
  import { DEFAULT_SETTINGS } from '../../lib/settings.ts';
  import { app, refreshCampaigns, saveBackup, saveCampaign, setCampaign } from '../../lib/store.svelte.ts';

  let newName = $state('');
  let renaming: { id: string; name: string } | undefined = $state();
  let deleting: { id: string; name: string; items: number; characters: number } | undefined = $state();
  let includeBooks = $state(false);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // Runs one user action: clears old messages, and shows a failure instead of throwing out of a handler.
  async function run(fn: () => Promise<void>) {
    error = notice = '';
    busy = true;
    try {
      await fn();
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }

  const create = (e: SubmitEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    return run(async () => {
      const now = Date.now();
      const id = crypto.randomUUID();
      await saveCampaign({ id, name, createdAt: now, updatedAt: now, settings: structuredClone(DEFAULT_SETTINGS), enabledPacks: [], loot: [] });
      await setCampaign(id);
      newName = '';
    });
  };

  const rename = (e: SubmitEvent) => {
    e.preventDefault();
    const r = renaming;
    const c = r && app.campaigns.find((x) => x.id === r.id);
    if (!r || !c) return;
    const name = r.name.trim();
    return run(async () => {
      if (name) await saveCampaign({ ...$state.snapshot(c), name });
      renaming = undefined;
    });
  };

  const askDelete = (id: string, name: string) =>
    run(async () => {
      deleting = { id, name, items: (await db.items.list(id)).length, characters: (await db.characters.list(id)).length };
    });

  const confirmDelete = () =>
    run(async () => {
      const d = deleting!;
      await db.campaigns.delete(d.id);
      if (app.campaign?.id === d.id) await setCampaign(undefined);
      await refreshCampaigns();
      deleting = undefined;
    });

  let importing = $state(false);
  async function onImport(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // so choosing the same file again fires change
    if (!file) return;
    importing = true;
    await run(async () => {
      const n = await importBackup(file);
      await refreshCampaigns();
      notice = `Imported ${n.campaigns} campaigns, ${n.characters} characters, ${n.items} items and ${n.packs} books.`;
    });
    importing = false;
  }
</script>

<h1>Campaigns</h1>

{#if app.error}<p role="alert" class="error">{app.error}</p>{/if}
{#if error}<p role="alert" class="error">{error}</p>{/if}
{#if notice}<p role="status">{notice}</p>{/if}

<form class="row" onsubmit={create}>
  <label for="new-campaign">New campaign name</label>
  <input id="new-campaign" bind:value={newName} required autocomplete="off" />
  <button class="primary" disabled={busy || !newName.trim()}>Create campaign</button>
</form>

{#if !app.ready}
  <p class="muted">Loading…</p>
{:else if app.campaigns.length === 0}
  <p class="muted">No campaigns yet. Create one above, or import a backup below.</p>
{:else}
  <label class="check">
    <input type="checkbox" bind:checked={includeBooks} />
    Include imported books when exporting a campaign backup
  </label>
  <ul class="plain">
    {#each app.campaigns as c (c.id)}
      <li class="card">
        {#if renaming?.id === c.id}
          <form class="row" onsubmit={rename}>
            <label for="rename-{c.id}">Campaign name</label>
            <input id="rename-{c.id}" bind:value={renaming.name} required autocomplete="off" />
            <button class="primary" disabled={busy}>Save name</button>
            <button type="button" onclick={() => (renaming = undefined)}>Cancel</button>
          </form>
        {:else}
          <div class="row">
            <strong>{c.name}</strong>
            {#if app.campaign?.id === c.id}<span class="muted">(open)</span>{/if}
          </div>
          <div class="row">
            <button disabled={busy || app.campaign?.id === c.id} aria-label="Open {c.name}" onclick={() => run(() => setCampaign(c.id))}>Open</button>
            <button disabled={busy} aria-label="Rename {c.name}" onclick={() => (renaming = { id: c.id, name: c.name })}>Rename</button>
            <button disabled={busy} aria-label="Export a backup of {c.name}" onclick={() => run(() => saveBackup({ campaignId: c.id, includePacks: includeBooks }))}>Export backup</button>
            <button class="danger" disabled={busy} aria-label="Delete {c.name}" onclick={() => askDelete(c.id, c.name)}>Delete</button>
          </div>
        {/if}
        {#if deleting?.id === c.id}
          <div role="alertdialog" aria-label="Confirm delete" class="row">
            <p>
              Delete “{deleting.name}”? This removes the campaign, its settings and loot, and its {deleting.items} custom
              {deleting.items === 1 ? 'item' : 'items'}. Its {deleting.characters}
              {deleting.characters === 1 ? 'character stays' : 'characters stay'} but {deleting.characters === 1 ? 'is' : 'are'} no longer in a campaign. This cannot be undone.
            </p>
            <button class="danger" disabled={busy} onclick={confirmDelete}>Delete campaign</button>
            <button disabled={busy} onclick={() => (deleting = undefined)}>Keep it</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<h2>Import a backup</h2>
<p class="muted">Restores campaigns, characters, items, books and images from a backup file. Matching records are overwritten.</p>
<div class="field">
  <label for="import-backup">Backup file (.json)</label>
  <input id="import-backup" type="file" accept=".json,application/json" disabled={importing} onchange={onImport} />
</div>
