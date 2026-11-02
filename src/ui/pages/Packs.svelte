<script lang="ts">
  import { packAllowed, sourceLabel } from '../../lib/content/sources.ts';
  import { db } from '../../lib/db.ts';
  import { selectDataFiles, walkEntries, type FsEntry } from '../../lib/import/dataFolder.ts';
  import { splitImportErrors } from '../../lib/import/summary.ts';
  import { refreshCampaigns, getFullIndex } from '../../lib/store.svelte.ts';
  import type { Pack, PackMeta, SpellDef } from '../../lib/types.ts';
  import { leaveGuard } from '../../lib/router.svelte.ts';
  import Drawer from '../kit/Drawer.svelte';
  import Menu from '../kit/Menu.svelte';
  import PasteDialog from '../PasteDialog.svelte';
  import SettingsGroup from '../SettingsGroup.svelte';
  import SpellEditor from '../spells/SpellEditor.svelte';
  import { newKey, publicText, TRUSTED_KEYS } from '../../lib/sync/signing.ts';

  type Counts = PackMeta['counts'];
  type Summary = { packs: { name: string; source: string; counts: Counts; patches: number }[]; errors: { file: string; message: string }[]; skipped: string[]; warnings: string[]; skipped2024: number; skippedUnknown: number; files: number };

  let packs: PackMeta[] = $state([]);
  let busy = $state(false);
  let progress = $state('');
  let summary: Summary | undefined = $state.raw();
  let error = $state('');
  let deleting: PackMeta | undefined = $state();
  let removing: PackMeta | undefined = $state();
  // Paste a spell: the dialog, then the spell editor on the draft; a save lands in the local pack My spells (R3).
  let pasteSpell = $state(false);
  let spellDraft: { draft: SpellDef; notes: string[] } | undefined = $state.raw();
  let spellNotice = $state('');

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // Publisher signatures: this device's signing key (its private half stays in this browser) and the public half to have it trusted.
  let keyText: string | undefined = $state();
  let copied = $state(false);
  $effect(() => { void db.meta.get<CryptoKeyPair>('signingKey').then(async (k) => { keyText = k ? await publicText(k.publicKey) : undefined; }); });
  const trustedKey = $derived(keyText !== undefined && TRUSTED_KEYS.includes(keyText));
  async function makeKey() {
    try { const k = await newKey(); await db.meta.set('signingKey', k); keyText = await publicText(k.publicKey); } catch (e) { error = message(e); }
  }
  async function copyKey() {
    try { await navigator.clipboard.writeText(keyText ?? ''); copied = true; } catch (e) { error = message(e); }
  }
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
<p class="lead">
  Import your own copies of 5etools-format books. Files are read on this device only and nothing is uploaded.
  Choose the 5etools zip as you downloaded it (no need to unzip it), or its <code>data</code> folder, and the app picks out the files it needs: books reference each other, so importing them together gives the best result.
</p>

<SettingsGroup title="Import">
  <section
    class="drop"
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
    <section class="scan" aria-label="Import scan">
      <p role="status">
        {#if plan.homebrew}No 5etools data folder was recognised, so every .json file under 5 MB is treated as homebrew. {/if}
        Found <span class="num">{plan.total}</span> {plan.total === 1 ? 'file' : 'files'} · importing <span class="num">{plan.items.length}</span>{plan.skipped.length ? ' · skipped: ' + plan.skipped.map((s) => `${s.reason} ${s.count}`).join(', ') : ''}
      </p>
      <div class="row">
        <button class="primary" disabled={busy || !plan.items.length} onclick={() => plan && importFiles(plan.items)}>Import</button>
        <button disabled={busy} onclick={() => (plan = undefined)}>Cancel</button>
      </div>
    </section>
  {/if}

  {#if busy}
    <div class="row busy">
      <p role="status">{progress}</p>
      {#if reading}<button onclick={() => reading?.abort()}>Cancel</button>{/if}
    </div>
  {/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}

  <Drawer title="Homebrew files and pasted spells" open={pasteSpell || !!spellDraft}>
    {#snippet summary()}Individual .json files · Paste a spell{/snippet}
    <div class="field">
      <label for="pack-files">Import individual files (homebrew)</label>
      <input id="pack-files" type="file" accept=".json" multiple disabled={busy} onchange={onFiles} />
    </div>
    <div class="row">
      <button type="button" aria-expanded={pasteSpell} disabled={!!spellDraft} onclick={() => { if (!pasteSpell || leaveGuard.fn?.() !== false) pasteSpell = !pasteSpell; spellNotice = ''; }}>Paste a spell</button>
      {#if spellNotice}<p role="status">{spellNotice}</p>{/if}
    </div>
    {#if pasteSpell}
      <PasteDialog kind="spell" oncancel={() => (pasteSpell = false)} onread={(draft, notes) => { spellDraft = { draft: draft as SpellDef, notes }; pasteSpell = false; }} />
    {/if}
    {#if spellDraft}
      <SpellEditor initial={spellDraft.draft} notes={spellDraft.notes} oncancel={() => (spellDraft = undefined)}
        onsaved={(sp) => { spellDraft = undefined; spellNotice = `Saved ${sp.name} to My spells. Enable My spells in a campaign's Settings to use it.`; void listPacks(); }} />
    {/if}
  </Drawer>
</SettingsGroup>

{#if summary}
  <SettingsGroup title="Import summary">
    <p>Selected <span class="num">{summary.files}</span> {summary.files === 1 ? "file" : "files"}.</p>
    {#if summary.packs.length}
      <ul class="plain rows">
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
      <Drawer title="Skipped {summary.skipped.length} {summary.skipped.length === 1 ? 'file' : 'files'} with no recognised content">
        <ul>
          {#each summary.skipped as name}<li>{name}</li>{/each}
        </ul>
      </Drawer>
    {/if}
    {#if summary.errors.length}
      <Drawer title="{summary.errors.length} {summary.errors.length === 1 ? 'error' : 'errors'}" open={summary.errors.length <= 10}>
        <ul>
          {#each summary.errors as er}<li><strong>{er.file}</strong>: {er.message}</li>{/each}
        </ul>
      </Drawer>
    {/if}
    {#if summary.warnings.length}
      <Drawer title="{summary.warnings.length} {summary.warnings.length === 1 ? 'warning' : 'warnings'}">
        <ul>
          {#each summary.warnings as w}<li>{w}</li>{/each}
        </ul>
      </Drawer>
    {/if}
  </SettingsGroup>
{/if}

{#if unofficial.length}
  <SettingsGroup title="Not 2014 official content" label="Packs that are not 2014 official content" danger>
    <p role="alert" class="error">
      These packs are not 2014 official content: {unofficial.map((p) => sourceLabel(p.source)).join(', ')}.
      The app ignores them everywhere (the compendium, the character creator, campaign settings) until you remove them.
    </p>
    <ul class="plain rows">
      {#each unofficial as p (p.id)}
        <li>
          <div class="book">
            <div class="info">
              <strong>{title(p)}</strong>{#if p.name !== p.source}{' '}<span class="muted">({p.source})</span>{/if}
              <div class="muted small">{countText(p.counts)} · Imported {new Date(p.importedAt).toLocaleDateString()}</div>
            </div>
            <button class="danger" aria-label="Remove {title(p)}" onclick={() => (removing = p)}>Remove</button>
          </div>
          {#if removing?.id === p.id}
            <div role="alertdialog" aria-label="Confirm remove" class="confirm">
              <p>Remove “{title(p)}”? This deletes its {countText(p.counts)} from this device and turns it off in every campaign. Characters keep the content they already embedded.</p>
              <div class="row">
                <button class="danger" onclick={confirmRemove}>Remove pack</button>
                <button onclick={() => (removing = undefined)}>Keep it</button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </SettingsGroup>
{/if}

<SettingsGroup title="Imported books">
  <p class="muted">The System Reference Document 5.1 is built in. Enable imported books per campaign in Settings.</p>
  <ul class="plain rows">
    {#each official as p (p.id)}
      <li>
        <div class="book">
          <div class="info">
            <strong>{title(p)}</strong>{#if p.name !== p.source}{' '}<span class="muted">({p.source})</span>{/if}{#if p.homebrew && p.name !== p.source}{' '}<span class="muted">· Homebrew</span>{/if}
            <div class="muted small">{countText(p.counts)} · Imported {new Date(p.importedAt).toLocaleDateString()}</div>
          </div>
          <Menu label="⋯" ariaLabel="More actions for {p.name}" caret={false} align="end"
            items={[{ label: `Delete ${p.name}`, danger: true, onselect: () => (deleting = p) }]} />
        </div>
        {#if deleting?.id === p.id}
          <div role="alertdialog" aria-label="Confirm delete" class="confirm">
            <p>Delete “{p.name}”? This removes its {countText(p.counts)} from this device. Campaigns that use it lose that content, and characters built from it may show missing entries. {p.id === 'pack:MYSPELLS' ? "These are spells you pasted; they can't be imported again." : 'You can import the files again later.'}</p>
            <div class="row">
              <button class="danger" onclick={confirmDelete}>Delete book</button>
              <button onclick={() => (deleting = undefined)}>Keep it</button>
            </div>
          </div>
        {/if}
      </li>
    {:else}
      <li class="muted">No books imported yet.</li>
    {/each}
  </ul>
</SettingsGroup>

<SettingsGroup title="Your books take priority">
  <p class="muted">With a trusted signing key, the books you imported yourself replace a DM's copy when you join their session, and their device shares them with everyone else.</p>
  {#if keyText === undefined}
    <button type="button" onclick={makeKey}>Create a signing key</button>
  {:else}
    <label class="key">Public key (not a secret)<textarea readonly rows="3" value={keyText}></textarea></label>
    <div class="row">
      <button type="button" onclick={copyKey}>{copied ? 'Copied' : 'Copy'}</button>
      <span class="muted small" role="status">{trustedKey ? 'Trusted: your books win.' : 'Not trusted yet: send this key to the app developer to add.'}</span>
    </div>
  {/if}
</SettingsGroup>

<style>
  .key {
    display: grid;
    gap: 0.25rem;
  }

  .key textarea {
    font-family: var(--font-mono, monospace);
    font-size: 0.8rem;
    word-break: break-all;
  }

  .lead {
    max-width: 900px;
    margin: 0 0 1rem;
  }

  .drop {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.9rem 1rem;
    border: 1px dashed var(--line-strong);
    border-radius: 6px;
  }

  .drop p {
    flex-basis: 100%;
    margin: 0;
  }

  .drop.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .scan {
    margin: 0.75rem 0;
    padding: 0.25rem 0.75rem;
    border-left: 2px solid var(--accent);
  }

  .scan p,
  .busy p {
    margin: 0.25rem 0 0.5rem;
  }

  .drop + :global(.drawer),
  .scan + :global(.drawer),
  .busy + :global(.drawer),
  .error + :global(.drawer) {
    margin-top: 0.75rem;
  }

  .rows {
    border-top: 1px solid var(--line);
  }

  .rows > li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line);
  }

  .book {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .info strong {
    color: var(--text-strong);
  }

  .small {
    font-size: 0.85rem;
  }

  .confirm {
    border-left: 2px solid var(--danger);
    padding: 0.25rem 0.75rem;
    margin: 0.5rem 0;
  }

  .confirm p {
    margin: 0 0 0.5rem;
  }

  code {
    font-family: var(--mono);
    color: var(--text-strong);
  }
</style>
