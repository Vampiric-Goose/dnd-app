<script lang="ts">
  import { exportRecord, importRecord, keepBoth, restoreSecrets } from '../../lib/backup.ts';
  import { characterSummary } from '../../lib/character/play.ts';
  import { db } from '../../lib/db.ts';
  import { characterListProblem } from '../../lib/recordShape.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { app, getFullIndex } from '../../lib/store.svelte.ts';
  import type { Character } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import { download, fileName } from '../download.ts';

  let chars: Character[] = $state.raw([]);
  let damaged: Character[] = $state.raw([]); // stored records the list itself can't read (R60/4: only that; the full check is for imports)
  let confirmingRemove = $state(false);
  let loaded = $state(false);
  let filter = $state('all'); // 'all', 'none' or a campaign id
  let error = $state('');
  let notice = $state('');
  let deleting: Character | undefined = $state.raw();

  async function load() {
    try {
      const all = await db.characters.list();
      damaged = all.filter((c) => characterListProblem(c));
      chars = all.filter((c) => !characterListProblem(c)).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      error = message(e);
    }
    loaded = true;
  }
  load();

  const shown = $derived(chars.filter((c) => filter === 'all' || (filter === 'none' ? !c.campaignId : c.campaignId === filter)));
  const campaignName = (id?: string) => app.campaigns.find((x) => x.id === id)?.name;

  // R49: an imported character whose id is already stored waits here until the user picks Replace or Keep both.
  let clash: { c: Character; edits: string[]; existing: string; playerView: boolean } | undefined = $state.raw();
  let keepBtn: HTMLButtonElement | undefined = $state();
  $effect(() => { if (clash) keepBtn?.focus(); }); // the dialog takes focus; Escape (below) cancels

  const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

  async function onImport(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    error = notice = '';
    clash = undefined;
    try {
      let c: Character, edits: string[] = [], taken: boolean, playerView = false;
      if (isPdf(file)) {
        const { importPdf } = await import('../../lib/pdf/importPdf.ts'); // pdf-lib's own chunk, loaded only now
        const rec = await importPdf(new Uint8Array(await file.arrayBuffer()), () => getFullIndex().catch(() => undefined)); // the index loads only if a field map needs it
        if (rec.kind !== 'character') throw new Error(rec.kind === 'monster' ? 'That file is a monster. Import it on the Monsters page.' : 'That file is an item. Import it on the Items page (All items tab).');
        c = rec.data;
        edits = rec.edits;
        playerView = !!rec.playerView;
        taken = !!(await db.characters.get(c.id));
      } else {
        const rec = await importRecord(file);
        if (rec.kind !== 'character') throw new Error(rec.kind === 'monster' ? 'That file is a monster. Import it on the Monsters page.' : 'That file is an item. Import it on the Items page (All items tab).');
        ({ data: c, taken, playerView } = rec);
      }
      if (c.campaignId && !app.campaigns.some((x) => x.id === c.campaignId)) { c = { ...c }; delete c.campaignId; } // its campaign isn't on this device
      if (taken) clash = { c, edits, existing: (await db.characters.get(c.id))?.name || 'Unnamed', playerView };
      else await save(c, edits);
    } catch (err) {
      error = message(err);
    }
  }

  // importRecord and importPdf don't save (N2): this is where the character is put.
  async function save(c: Character, edits: string[]) {
    await db.characters.put(c);
    notice = `Imported ${c.name}.${edits.length ? ` Changes made in the PDF were applied: ${edits.join(', ')}.` : ''}`;
    await load();
  }

  async function resolveClash(how: 'replace' | 'keep') {
    const k = clash!;
    clash = undefined;
    try {
      // R56: Replace with a Player-view file puts the real items back on the entries the stored character still has.
      const stored = how === 'replace' && k.playerView ? await db.characters.get(k.c.id) : undefined;
      await save(how === 'keep' ? keepBoth(k.c) : stored ? restoreSecrets(k.c, stored) : k.c, k.edits);
    } catch (err) {
      error = message(err);
    }
  }

  // Mirrors the Items page: damaged records are hidden, and this is how they are cleared out.
  async function removeDamaged() {
    try {
      for (const d of damaged) await db.characters.delete(d.id);
      confirmingRemove = false;
      await load();
    } catch (e) {
      error = message(e);
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
{#if clash}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape bubbles up from the dialog's own buttons) -->
  <div role="alertdialog" aria-label="Character already exists" class="card" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (clash = undefined)}>
    <p>You already have a character with this id: “{clash.existing}”. Replace “{clash.existing}” with the imported “{clash.c.name || 'Unnamed'}”, or keep both?</p>
    {#if clash.playerView}<p class="error" role="note">This file was exported in Player view; secret item details are not in it. Replace keeps the real items of “{clash.existing}” and takes quantities, equipped, attuned, charges and notes from the file.</p>{/if}
    {#if clash.edits.length}<p class="muted">Changes made in the PDF: {clash.edits.join(', ')}.</p>{/if}
    <div class="row">
      <button class="danger" onclick={() => resolveClash('replace')}>Replace “{clash.existing}”</button>
      <button class="primary" bind:this={keepBtn} onclick={() => resolveClash('keep')}>Keep both</button>
      <button onclick={() => (clash = undefined)}>Cancel</button>
    </div>
  </div>
{/if}

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

{#if damaged.length}
  <div class="row">
    <p role="status">{damaged.length} damaged {damaged.length === 1 ? 'character' : 'characters'} hidden</p>
    {#if !confirmingRemove}<button onclick={() => (confirmingRemove = true)}>Remove damaged characters</button>{/if}
  </div>
  <!-- the raw record, so its data can be rescued before it is removed -->
  <ul class="plain row">
    {#each damaged as d (d.id)}
      <li><button onclick={() => download(exportRecord('character', d), fileName(typeof d.name === 'string' ? d.name : '', 'json'))}>Export {typeof d.name === 'string' && d.name ? d.name : d.id}</button></li>
    {/each}
  </ul>
  {#if confirmingRemove}
    <div role="alertdialog" aria-label="Confirm removing damaged characters" class="row">
      <p>Permanently remove {damaged.length} damaged {damaged.length === 1 ? 'character' : 'characters'}? This cannot be undone.</p>
      <button class="danger" onclick={removeDamaged}>Remove</button>
      <button onclick={() => (confirmingRemove = false)}>Keep them</button>
    </div>
  {/if}
{/if}

{#if !loaded}
  <p class="muted">Loading…</p>
{:else if !shown.length}
  <p class="muted">{chars.length ? 'No characters match.' : 'No characters yet. Create one, or import a character file (JSON or PDF) below.'}</p>
{:else}
  <ul class="plain">
    {#each shown as c (c.id)}
      <li class="card">
        <div class="row">
          <a href="#/characters/{c.id}"><strong>{c.name || 'Unnamed'}</strong></a>
          <span class="muted">{characterSummary(c)}</span>
          {#if campaignName(c.campaignId)}<span class="muted">· {campaignName(c.campaignId)}</span>{/if}
        </div>
        <div class="row">
          {#if app.viewer === 'dm'}<a href="#/characters/{c.id}/level-up">Level up</a>{/if}
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
  <label for="import-character">Character file (.json or .pdf)</label>
  <input id="import-character" type="file" accept=".json,application/json,.pdf,application/pdf" onchange={onImport} />
</div>
