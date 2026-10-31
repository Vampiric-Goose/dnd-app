<script lang="ts">
  import { packAllowed, sourceLabel } from '../../lib/content/sources.ts';
  import { db } from '../../lib/db.ts';
  import { selectDataFiles, walkEntries, type FsEntry } from '../../lib/import/dataFolder.ts';
  import { splitImportErrors } from '../../lib/import/summary.ts';
  import { refreshCampaigns, getFullIndex } from '../../lib/store.svelte.ts';
  import type { Pack, PackMeta } from '../../lib/types.ts';

  type Counts = PackMeta['counts'];
  type Summary = { packs: { name: string; source: string; counts: Counts; patches: number }[]; errors: { file: string; message: string }[]; skipped: string[]; warnings: string[]; skipped2024: number; skippedUnknown: number; files: number };

  let packs: PackMeta[] = $state([]);
  let busy = $state(false);
  let progress = $state('');
  let summary: Summary | undefined = $state.raw();
  let error = $state('');
  let deleting: PackMeta | undefined = $state();
  let removing: PackMeta | undefined = $state();

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const listPacks = () => db.packs.listMeta().then((m) => (packs = m.filter((p) => p.id !== 'srd')));
  $effect(() => {
    listPacks().catch((e) => (error = message(e)));
  });
  // R52: packs stored before the whitelist (or restored from a backup) may hold 2024 or unknown content.
  const official = $derived(packs.filter(packAllowed));
  const unofficial = $derived(packs.filter((p) => !packAllowed(p)));
  const title = (p: PackMeta) => (p.name === p.source ? sourceLabel(p.source, p.homebrew) : p.name);

  const countText = (c: Counts) =>
    Object.entries(c).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing';

  const tick = () => new Promise<void>((r) => setTimeout(r));

  type Item = { name: string; text: () => Promise<string> };
  type Plan = { total: number; items: Item[]; skipped: { reason: string; count: number }[]; homebrew: boolean };
  let plan: Plan | undefined = $state.raw(); // a scanned folder, waiting for Import or Cancel

  // Folder picking needs `webkitdirectory` (desktop browsers); most phones lack it.
  const folderOk = 'webkitdirectory' in document.createElement('input');
  const coarse = matchMedia('(pointer: coarse)').matches;
  let folderInput: HTMLInputElement | undefined = $state();
  let zipInput: HTMLInputElement | undefined = $state();
  let dragging = $state(false);

  /** A File's bytes as chunks (a reader loop: Safari has no async iteration of ReadableStream). Stopping early cancels the read. */
  async function* chunksOf(file: File) {
    const reader = file.stream().getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
  }

  let reading: AbortController | undefined = $state(); // a zip being read; Cancel or leaving the page aborts it
  $effect(() => () => reading?.abort());

  /** Reads a 5etools zip as downloaded (or a homebrew zip) and shows the same summary as a folder. Only the selected files are inflated. */
  async function proposeZip(file: File) {
    summary = undefined;
    plan = undefined;
    error = '';
    busy = true;
    progress = 'Reading the zip…';
    const ac = (reading = new AbortController());
    try {
      const { readDataZip } = await import('../../lib/import/zip.ts'); // lazy: keeps fflate out of first load
      const size = file.size || 1;
      const { files, summary: sel } = await readDataZip(chunksOf(file),
        (done) => (progress = done >= size ? 'Unpacking the data files…' : `Reading the zip… ${Math.floor((done / size) * 100)}%`), { signal: ac.signal });
      const { root } = sel;
      plan = {
        total: sel.use.length + sel.skipped.reduce((n, s) => n + s.count, 0),
        items: files.map((f) => ({ name: root ? f.path.slice(root.length + 1) : f.path, text: async () => f.text })),
        skipped: sel.skipped,
        homebrew: root === null,
      };
    } catch (err) {
      if (!ac.signal.aborted) error = `Could not read ${file.name}: ${message(err)}`; // a cancelled read just ends, its partial results dropped
    } finally {
      if (reading === ac) reading = undefined;
      busy = false;
      progress = '';
    }
  }

  function onZip(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) proposeZip(file);
  }

  const entryFile = (entry: FsEntry) => new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));

  /** Works out which of these files to import and shows the summary. Reads no file contents (a File handle only gives its size). */
  async function propose(paths: string[], getFile: (path: string) => Promise<File>) {
    let sel = selectDataFiles(paths);
    if (sel.root === null) { // homebrew: the 5 MB cap needs sizes
      const sizes = new Map<string, number>();
      for (const p of sel.use) sizes.set(p, (await getFile(p)).size);
      sel = selectDataFiles(paths, (p) => sizes.get(p));
    }
    const { root } = sel;
    plan = {
      total: sel.use.length + sel.skipped.reduce((n, s) => n + s.count, 0),
      items: sel.use.map((p) => ({ name: root ? p.slice(root.length + 1) : p, text: async () => (await getFile(p)).text() })),
      skipped: sel.skipped,
      homebrew: root === null,
    };
  }

  async function onFolder(e: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = '';
    if (!files.length) return;
    summary = undefined;
    error = '';
    const byPath = new Map(files.map((f) => [f.webkitRelativePath || f.name, f]));
    await propose([...byPath.keys()], async (p) => byPath.get(p)!).catch((err) => (error = message(err)));
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (busy) return;
    // The entries must be taken synchronously: the browser invalidates the drop data after the first await.
    const roots = [...(e.dataTransfer?.items ?? [])].map((i) => i.webkitGetAsEntry()).filter((x) => x !== null);
    if (!roots.length) return;
    if (roots.length === 1 && roots[0].isFile && roots[0].name.toLowerCase().endsWith('.zip')) {
      await entryFile(roots[0]).then(proposeZip, (err) => (error = message(err)));
      return;
    }
    summary = undefined;
    error = '';
    try {
      const found = await walkEntries(roots);
      const byPath = new Map(found.map((f) => [f.path, f.entry]));
      await propose([...byPath.keys()], (p) => entryFile(byPath.get(p)!));
    } catch (err) {
      error = message(err);
    }
  }

  function onFiles(e: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = ''; // so choosing the same files again fires change
    if (files.length) importFiles(files.map((f) => ({ name: f.name, text: () => f.text() })));
  }

  async function importFiles(files: Item[]) {
    plan = undefined;
    busy = true;
    error = '';
    summary = undefined;
    try {
      // Read and parse each file, one at a time, so only one file's text is in memory; one bad file is reported and skipped.
      const parsed: { name: string; json: unknown }[] = [];
      const readErrors: { file: string; message: string }[] = [];
      let last = performance.now();
      for (const [i, f] of files.entries()) {
        progress = `Reading ${i + 1} / ${files.length}…`;
        try {
          parsed.push({ name: f.name, json: JSON.parse(await f.text()) });
        } catch (err) {
          readErrors.push({ file: f.name, message: 'Not valid JSON: ' + message(err) });
        }
        if (performance.now() - last > 50) { await tick(); last = performance.now(); } // let the page repaint
      }

      progress = 'Converting…';
      await tick();
      const { import5etools, mergePack } = await import('../../lib/import/fivetools/index.ts'); // lazy: keeps the importer out of first load
      const index = await getFullIndex();
      const res = await import5etools(parsed, {
        index,
        rawLookup: async (key) => (await db.raw5e.getMany([key]))[0],
        homebrewSources: (await db.packs.listMeta()).filter((m) => m.homebrew).map((m) => m.source),
      });

      progress = 'Saving…';
      const saved: Pack[] = [];
      for (const p of res.packs) {
        const merged = mergePack(await db.packs.get(p.id), p);
        await db.packs.put(merged);
        saved.push(p);
      }
      await db.raw5e.putMany(res.raw);
      summary = {
        packs: saved.map((p) => {
          const counts: Counts = {};
          for (const en of p.entities) counts[en.kind] = (counts[en.kind] ?? 0) + 1;
          return { name: p.name, source: p.source, counts, patches: p.patches.length };
        }),
        ...splitImportErrors([...readErrors, ...res.errors]),
        warnings: res.warnings,
        skipped2024: res.skipped2024,
        skippedUnknown: res.skippedUnknown,
        files: files.length,
      };
      await listPacks();
    } catch (err) {
      error = 'Import failed: ' + message(err);
    } finally {
      busy = false;
      progress = '';
    }
  }

  async function confirmDelete() {
    const d = deleting;
    if (!d) return;
    try {
      await db.packs.delete(d.id);
      await listPacks();
      deleting = undefined;
    } catch (err) {
      error = message(err);
    }
  }

  /** Removes a pack that is not 2014 official content, and drops it from every campaign, in one transaction. */
  async function confirmRemove() {
    const d = removing;
    if (!d) return;
    try {
      await db.packs.remove(d.id);
      await refreshCampaigns();
      await listPacks();
      removing = undefined;
    } catch (err) {
      error = message(err);
    }
  }
</script>

<h1>Packs</h1>
<p>
  Import your own copies of 5etools-format books. Files are read on this device only and nothing is uploaded.
  Choose the 5etools zip as you downloaded it (no need to unzip it), or its <code>data</code> folder, and the app picks out the files it needs: books reference each other, so importing them together gives the best result.
</p>

<section
  class="card drop"
  class:dragging
  aria-label="Import 5etools"
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <input bind:this={zipInput} type="file" accept=".zip,application/zip" hidden tabindex="-1" aria-hidden="true" onchange={onZip} />
  <button class="primary" disabled={busy} onclick={() => zipInput?.click()}>Import 5etools (zip or folder)</button>
  {#if folderOk}
    <input bind:this={folderInput} type="file" webkitdirectory hidden tabindex="-1" aria-hidden="true" onchange={onFolder} />
    <button disabled={busy} onclick={() => folderInput?.click()}>Choose a data folder instead</button>
    <span class="muted"> or drop the zip or folder here.</span>
  {/if}
  {#if !folderOk || coarse}
    <p class="muted">On a phone, import the 5etools zip file.</p>
  {/if}
</section>

{#if plan}
  <section class="card" aria-label="Import scan">
    <p role="status">
      {#if plan.homebrew}No 5etools data folder was recognised, so every .json file under 5 MB is treated as homebrew. {/if}
      Found {plan.total} {plan.total === 1 ? 'file' : 'files'} · importing {plan.items.length}{plan.skipped.length ? ' · skipped: ' + plan.skipped.map((s) => `${s.reason} ${s.count}`).join(', ') : ''}
    </p>
    <div class="row">
      <button class="primary" disabled={busy || !plan.items.length} onclick={() => plan && importFiles(plan.items)}>Import</button>
      <button disabled={busy} onclick={() => (plan = undefined)}>Cancel</button>
    </div>
  </section>
{/if}

<div class="field">
  <label for="pack-files">Import individual files (homebrew)</label>
  <input id="pack-files" type="file" accept=".json" multiple disabled={busy} onchange={onFiles} />
</div>

{#if busy}
  <p role="status">{progress}</p>
  {#if reading}<button onclick={() => reading?.abort()}>Cancel</button>{/if}
{/if}
{#if error}<p role="alert" class="error">{error}</p>{/if}

{#if summary}
  <section class="card" aria-label="Import summary">
    <h2>Import summary</h2>
    <p>Selected {summary.files} {summary.files === 1 ? "file" : "files"}.</p>
    {#if summary.packs.length}
      <ul>
        {#each summary.packs as p (p.source)}
          <li>
            <strong>{p.name}</strong>{p.name === p.source ? "" : ` (${p.source})`}: {countText(p.counts)}{p.patches ? `; ${p.patches} updates to SRD entries` : ''}
          </li>
        {/each}
      </ul>
    {:else}
      <p>No content was imported.</p>
    {/if}
    {#if summary.skipped2024}<p>Skipped {summary.skipped2024} entries from the 2024 rules (this app uses the 2014 rules).</p>{/if}
    {#if summary.skippedUnknown}<p>Skipped {summary.skippedUnknown} entries from unrecognised sources (not 2014 official books, and not declared as homebrew). The warnings list the files and sources.</p>{/if}
    {#if summary.skipped.length}
      <details>
        <summary class="muted">Skipped {summary.skipped.length} {summary.skipped.length === 1 ? "file" : "files"} with no recognised content</summary>
        <ul>
          {#each summary.skipped as name}<li>{name}</li>{/each}
        </ul>
      </details>
    {/if}
    {#if summary.errors.length}
      <details open={summary.errors.length <= 10}>
        <summary>{summary.errors.length} {summary.errors.length === 1 ? 'error' : 'errors'}</summary>
        <ul>
          {#each summary.errors as er}<li><strong>{er.file}</strong>: {er.message}</li>{/each}
        </ul>
      </details>
    {/if}
    {#if summary.warnings.length}
      <details>
        <summary>{summary.warnings.length} {summary.warnings.length === 1 ? 'warning' : 'warnings'}</summary>
        <ul>
          {#each summary.warnings as w}<li>{w}</li>{/each}
        </ul>
      </details>
    {/if}
  </section>
{/if}

{#if unofficial.length}
  <section class="card" aria-label="Packs that are not 2014 official content">
    <h2 class="error">Not 2014 official content</h2>
    <p role="alert" class="error">
      These packs are not 2014 official content: {unofficial.map((p) => sourceLabel(p.source)).join(', ')}.
      The app ignores them everywhere (the compendium, the character creator, campaign settings) until you remove them.
    </p>
    {#each unofficial as p (p.id)}
      <div class="card">
        <strong>{title(p)}</strong>{#if p.name !== p.source} <span class="muted">({p.source})</span>{/if}
        <div>{countText(p.counts)}</div>
        <div class="muted">Imported {new Date(p.importedAt).toLocaleDateString()}</div>
        <div class="row">
          <button class="danger" aria-label="Remove {title(p)}" onclick={() => (removing = p)}>Remove</button>
        </div>
        {#if removing?.id === p.id}
          <div role="alertdialog" aria-label="Confirm remove" class="row">
            <p>Remove “{title(p)}”? This deletes its {countText(p.counts)} from this device and turns it off in every campaign. Characters keep the content they already embedded.</p>
            <button class="danger" onclick={confirmRemove}>Remove pack</button>
            <button onclick={() => (removing = undefined)}>Keep it</button>
          </div>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<h2>Imported books</h2>
<p class="muted">The System Reference Document 5.1 is built in. Enable imported books per campaign in Settings.</p>
{#each official as p (p.id)}
  <div class="card">
    <strong>{title(p)}</strong>{#if p.name !== p.source} <span class="muted">({p.source})</span>{/if}{#if p.homebrew && p.name !== p.source} <span class="muted">· Homebrew</span>{/if}
    <div>{countText(p.counts)}</div>
    <div class="muted">Imported {new Date(p.importedAt).toLocaleDateString()}</div>
    <div class="row">
      <button class="danger" aria-label="Delete {p.name}" onclick={() => (deleting = p)}>Delete</button>
    </div>
    {#if deleting?.id === p.id}
      <div role="alertdialog" aria-label="Confirm delete" class="row">
        <p>Delete “{p.name}”? This removes its {countText(p.counts)} from this device. Campaigns that use it lose that content, and characters built from it may show missing entries. You can import the files again later.</p>
        <button class="danger" onclick={confirmDelete}>Delete book</button>
        <button onclick={() => (deleting = undefined)}>Keep it</button>
      </div>
    {/if}
  </div>
{:else}
  <p class="muted">No books imported yet.</p>
{/each}

<style>
  .drop.dragging {
    outline: 2px dashed var(--accent);
  }
</style>
