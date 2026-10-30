<script lang="ts">
  import { db } from '../../lib/db.ts';
  import { getFullIndex } from '../../lib/store.svelte.ts';
  import type { Pack, PackMeta } from '../../lib/types.ts';

  type Counts = PackMeta['counts'];
  type Summary = { packs: { name: string; source: string; counts: Counts; patches: number }[]; errors: { file: string; message: string }[]; warnings: string[]; skipped2024: number; files: number };

  let packs: PackMeta[] = $state([]);
  let busy = $state(false);
  let progress = $state('');
  let summary: Summary | undefined = $state.raw();
  let error = $state('');
  let deleting: PackMeta | undefined = $state();

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const listPacks = () => db.packs.listMeta().then((m) => (packs = m.filter((p) => p.id !== 'srd')));
  $effect(() => {
    listPacks().catch((e) => (error = message(e)));
  });

  const countText = (c: Counts) =>
    Object.entries(c).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing';

  const tick = () => new Promise<void>((r) => setTimeout(r));

  async function onFiles(e: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = ''; // so choosing the same files again fires change
    if (!files.length) return;
    busy = true;
    error = '';
    summary = undefined;
    try {
      // Read and parse each file; one bad file is reported and skipped.
      const parsed: { name: string; json: unknown }[] = [];
      const readErrors: { file: string; message: string }[] = [];
      let last = performance.now();
      for (const [i, f] of files.entries()) {
        progress = `Reading file ${i + 1} of ${files.length}…`;
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
        errors: [...readErrors, ...res.errors],
        warnings: res.warnings,
        skipped2024: res.skipped2024,
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
</script>

<h1>Packs</h1>
<p>
  Import your own copies of 5etools-format books. Files are read on this device only and nothing is uploaded.
  Select all the files at once (for example, everything in a data folder): books reference each other, so importing them together gives the best result.
</p>

<div class="field">
  <label for="pack-files">5etools data files (.json, several allowed)</label>
  <input id="pack-files" type="file" accept=".json" multiple disabled={busy} onchange={onFiles} />
</div>

{#if busy}<p role="status">{progress}</p>{/if}
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

<h2>Imported books</h2>
<p class="muted">The System Reference Document 5.1 is built in. Enable imported books per campaign in Settings.</p>
{#each packs as p (p.id)}
  <div class="card">
    <strong>{p.name}</strong>{#if p.name !== p.source} <span class="muted">({p.source})</span>{/if}
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
