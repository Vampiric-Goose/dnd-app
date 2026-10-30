<script lang="ts">
  import { importRecord } from '../../lib/backup.ts';
  import { db } from '../../lib/db.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { app } from '../../lib/store.svelte.ts';
  import type { Character } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';

  let chars: Character[] = $state.raw([]);
  let loaded = $state(false);
  let filter = $state('all'); // 'all', 'none' or a campaign id
  let error = $state('');
  let notice = $state('');
  let deleting: Character | undefined = $state.raw();

  async function load() {
    try {
      chars = (await db.characters.list()).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      error = message(e);
    }
    loaded = true;
  }
  load();

  const shown = $derived(chars.filter((c) => filter === 'all' || (filter === 'none' ? !c.campaignId : c.campaignId === filter)));
  const campaignName = (id?: string) => app.campaigns.find((x) => x.id === id)?.name;

  // Reads the embedded copies, so it works whatever books are loaded.
  function summary(c: Character): string {
    const n: Record<string, number> = {};
    for (const l of c.build.levels) n[l.classId] = (n[l.classId] ?? 0) + 1;
    const race = c.embedded[c.build.subraceId ?? '']?.name ?? c.embedded[c.build.raceId]?.name;
    return [race, Object.entries(n).map(([id, lv]) => `${c.embedded[id]?.name ?? id} ${lv}`).join(' / ')].filter(Boolean).join(' · ');
  }

  async function onImport(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    error = notice = '';
    try {
      // ponytail: .pdf import arrives with Task 20.
      const rec = await importRecord(file);
      if (rec.kind !== 'character') throw new Error('That file is an item. Import it on the Items page.');
      const c = rec.data;
      if (c.campaignId && !app.campaigns.some((x) => x.id === c.campaignId)) delete c.campaignId; // its campaign isn't on this device
      await db.characters.put(c); // importRecord doesn't save (N2)
      notice = `Imported ${c.name}.`;
      await load();
    } catch (err) {
      error = message(err);
    }
  }

  async function confirmDelete() {
    const d = deleting!;
    try {
      await db.characters.delete(d.id);
      deleting = undefined;
      await load();
    } catch (e) {
      error = message(e);
    }
  }
</script>

<h1>Characters</h1>

{#if error}<p role="alert" class="error">{error}</p>{/if}
{#if notice}<p role="status">{notice}</p>{/if}

<div class="row">
  <button class="primary" onclick={() => navigate('characters/new')}>New character</button>
  <label class="row">
    <span class="muted">Show</span>
    <select bind:value={filter}>
      <option value="all">All characters</option>
      <option value="none">Not in a campaign</option>
      {#each app.campaigns as camp (camp.id)}<option value={camp.id}>{camp.name}</option>{/each}
    </select>
  </label>
</div>

{#if !loaded}
  <p class="muted">Loading…</p>
{:else if !shown.length}
  <p class="muted">{chars.length ? 'No characters match.' : 'No characters yet. Create one, or import a character file below.'}</p>
{:else}
  <ul class="plain">
    {#each shown as c (c.id)}
      <li class="card">
        <div class="row">
          <a href="#/characters/{c.id}"><strong>{c.name || 'Unnamed'}</strong></a>
          <span class="muted">{summary(c)}</span>
          {#if campaignName(c.campaignId)}<span class="muted">· {campaignName(c.campaignId)}</span>{/if}
        </div>
        <div class="row">
          <a href="#/characters/{c.id}/level-up">Level up</a>
          <button class="danger" aria-label="Delete {c.name}" onclick={() => (deleting = c)}>Delete</button>
        </div>
        {#if deleting?.id === c.id}
          <div role="alertdialog" aria-label="Confirm delete" class="row">
            <p>Delete “{c.name}”? This cannot be undone.</p>
            <button class="danger" onclick={confirmDelete}>Delete character</button>
            <button onclick={() => (deleting = undefined)}>Keep it</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<h2>Import a character</h2>
<div class="field">
  <label for="import-character">Character file (.json)</label>
  <input id="import-character" type="file" accept=".json,application/json" onchange={onImport} />
</div>
