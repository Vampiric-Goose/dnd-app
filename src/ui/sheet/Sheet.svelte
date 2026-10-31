<script lang="ts">
  import { setContext } from 'svelte';
  import { exportRecord } from '../../lib/backup.ts';
  import { characterSummary } from '../../lib/character/play.ts';
  import { db, StorageError } from '../../lib/db.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { natD20, rollLog, shownRolls } from '../../lib/rolls.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { DEFAULT_SETTINGS } from '../../lib/settings.ts';
  import { transfer } from '../../lib/items/inventory.ts';
  import { app, refreshCampaigns } from '../../lib/store.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, CampaignSettings, Character, OverrideKey } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import { download, downloadPdf, fileName } from '../download.ts';
  import Abilities from './Abilities.svelte';
  import Attacks from './Attacks.svelte';
  import Combat from './Combat.svelte';
  import CustomEffects from './CustomEffects.svelte';
  import Features from './Features.svelte';
  import Inventory from './Inventory.svelte';
  import RestDialogs from './RestDialogs.svelte';
  import Spells from './Spells.svelte';

  let { params }: { params: { id: string } } = $props();

  // The character is replaced, never mutated, so `c !== saved` is the whole dirty check.
  let c: Character | undefined = $state.raw();
  let status: 'loading' | 'ready' | 'missing' | 'error' = $state('loading');
  let error = $state('');
  let restMode: 'short' | 'long' | undefined = $state();
  let saved: Character | undefined; // what is in storage (or was loaded from it)
  let timer: ReturnType<typeof setTimeout> | undefined;

  let moving = false; // a transfer is committing: autosave stays out of its way (R44)

  async function flush() {
    clearTimeout(timer);
    timer = undefined;
    const cur = c;
    if (!cur || cur === saved || moving) return;
    try {
      const stored = await db.characters.put($state.snapshot(cur) as Character);
      // N1: continue from what was stored, so the next save's base (sync) includes this one. Edits made meanwhile keep their values.
      saved = stored;
      c = c === cur ? stored : c && { ...c, sync: stored.sync };
    } catch (e) {
      // The in-memory state is kept; the next edit tries again.
      toast(e instanceof StorageError ? e.message : `Could not save: ${message(e)}`, true);
    }
  }

  $effect(() => {
    const id = params.id;
    let live = true;
    c = saved = undefined;
    status = 'loading';
    db.characters.get(id).then((found) => {
      if (!live) return;
      saved = c = found; // loading is not an edit: nothing is saved until c changes
      status = found ? 'ready' : 'missing';
    }).catch((e) => {
      if (!live) return;
      error = message(e);
      status = 'error';
    });
    return () => {
      live = false;
      void flush(); // leaving the page (route change) must not lose the last edit
    };
  });

  // Debounced autosave.
  $effect(() => {
    if (c && c !== saved) {
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    }
  });

  // R36: the character's own campaign settings, not the picker's.
  const settings = $derived(app.campaigns.find((x) => x.id === c?.campaignId)?.settings ?? DEFAULT_SETTINGS);
  const sheet = $derived(c ? computeSheet(c, { settings, viewer: app.viewer }) : undefined);

  const update = (fn: (c: Character) => Character) => { if (c) c = fn(c); };
  const patch = (s: Partial<Character['state']>) => update((x) => ({ ...x, state: { ...x.state, ...s } }));
  function onset(key: OverrideKey, value: number | undefined) {
    update((x) => {
      const overrides = { ...x.overrides };
      if (value === undefined) delete overrides[key];
      else overrides[key] = value;
      return { ...x, overrides };
    });
  }

  // R37: moves the character into or out of a campaign; embedded content stays as it is.
  function setCampaign(id: string) {
    update(({ campaignId: _, ...rest }) => (id ? { ...rest, campaignId: id } : rest));
  }

  // R44: moves `qty` of an entry to Unassigned ('loot', the stored field) or another character, and commits both sides in one transaction.
  // The receiver is read fresh from storage. On failure nothing in memory changes. On success the sheet adopts what was
  // written as its saved baseline, so autosave doesn't write a stale copy over it.
  async function transferTo(entryId: string, qty: number, to: string) {
    const cur = c;
    if (!cur) return;
    if (moving) { toast("Another move is still saving. Try again in a moment.", true); return; }
    if (to === cur.id) { toast("That item is already with this character.", true); return; }
    moving = true;
    clearTimeout(timer);
    try {
      const camp = to === 'loot' ? await db.campaigns.get(cur.campaignId ?? '') : undefined;
      const other = to === 'loot' ? undefined : await db.characters.get(to);
      if (!camp && !other) throw new Error('Could not find where to send it.');
      const moved = transfer(cur.inventory, camp?.loot ?? other!.inventory, entryId, qty);
      if (moved.from === cur.inventory) throw new Error('Nothing was moved.');
      const next: Character = { ...cur, inventory: moved.from };
      const [stored] = await db.saveTogether(camp
        ? { characters: [$state.snapshot(next) as Character], campaign: $state.snapshot({ ...camp, loot: moved.to }) as Campaign }
        : { characters: [$state.snapshot(next) as Character, $state.snapshot({ ...other!, inventory: moved.to }) as Character] });
      if (c?.id === cur.id) { // still on this sheet (the route may have changed while it committed)
        saved = stored; // N1: as stored, with its sync
        // Edits made while it committed stay and autosave: the same move is applied to the latest inventory.
        c = c === cur ? stored : { ...c, sync: stored.sync, inventory: transfer(c.inventory, [], entryId, qty).from };
      }
      if (camp) await refreshCampaigns().catch(() => {});
      toast(`Moved to ${camp ? 'Unassigned' : other!.name || 'Unnamed'}.`);
    } catch (e) {
      toast(e instanceof StorageError ? e.message : `Could not move it: ${message(e)}`, true);
    } finally {
      moving = false;
      if (c && c !== saved) timer = setTimeout(flush, 500);
    }
  }

  // Exports: the character as it is on screen (autosave may not have caught up). The PDF shows the sheet as the current viewer sees it (R48).
  let exporting = $state(false);
  function exportJson() {
    if (c) download(exportRecord('character', $state.snapshot(c) as Character, app.viewer), fileName(c.name, 'json'));
  }
  async function exportPdf() {
    if (!c || !sheet || exporting) return;
    exporting = true;
    try {
      const { exportCharacterPdf } = await import('../../lib/pdf/exportPdf.ts');
      downloadPdf(await exportCharacterPdf($state.snapshot(c) as Character, sheet, { viewer: app.viewer, settings: $state.snapshot(settings) as CampaignSettings }), fileName(c.name, 'pdf'));
    } catch (e) {
      toast(`Could not export the PDF: ${message(e)}`, true);
    } finally {
      exporting = false;
    }
  }

  const last = $derived(shownRolls(rollLog, app.viewer)[0]); // R6: never a private (monster) roll in Player view
  const nat = $derived(last && natD20(last.detail));

  // R46: sheet edits (overrides, custom effects) are the DM's, through one Edit mode. Not saved; it never outlives the DM view or the page.
  let editOn = $state(false);
  const edit = $derived(editOn && app.viewer === 'dm');
  setContext('sheet-edit', () => edit);
  $effect(() => { if (app.viewer !== 'dm') editOn = false; });
  $effect(() => { void params.id; editOn = false; });
</script>

<svelte:window onpagehide={flush} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'hidden' && flush()} />

{#if status === 'loading'}
  <p class="muted">Loading…</p>
{:else if status === 'error'}
  <h1>Could not open the character</h1>
  <p role="alert" class="error">{error}</p>
  <p><a href="#/characters">Back to Characters</a></p>
{:else if status === 'missing' || !c || !sheet}
  <h1>Character not found</h1>
  <p>There is no saved character with this link. It may have been deleted, or it lives on another device.</p>
  <p><a href="#/characters">Back to Characters</a></p>
{:else}
  <header class="top">
    <h1>{c.name || 'Unnamed'}</h1>
    <p class="muted">{characterSummary(c)}{sheet.totalLevel ? ` · level ${sheet.totalLevel}` : ''}</p>
    <div class="row">
      {#if app.viewer === 'dm'}<button type="button" class="primary" onclick={() => navigate(`characters/${c!.id}/level-up`)}>Level up</button>{/if}
      <button type="button" onclick={exportJson}>Export JSON</button>
      <button type="button" disabled={exporting} onclick={exportPdf}>Export PDF</button>
      {#if app.viewer === 'dm'}
        <button type="button" class="editbtn" aria-pressed={edit} onclick={() => (editOn = !editOn)}>Edit mode</button>
      {/if}
      <label class="row">
        <span class="muted">Campaign</span>
        <select value={c.campaignId ?? ''} onchange={(e) => setCampaign(e.currentTarget.value)}>
          <option value="">No campaign</option>
          {#each app.campaigns as camp (camp.id)}<option value={camp.id}>{camp.name}</option>{/each}
        </select>
      </label>
    </div>
  </header>

  {#if c.imported}
    <p class="card banner" role="note"><strong>Imported, unverified.</strong> These numbers were read from a file, not built here. Check them against your original sheet.</p>
  {/if}
  {#if sheet.warnings.length}
    <div class="card warnings" role="note">
      <strong>Warnings</strong>
      <ul>{#each sheet.warnings as w (w)}<li>{w}</li>{/each}</ul>
    </div>
  {/if}

  {#if last}
    <p class="lastroll" class:nat20={nat === 'nat20'} class:nat1={nat === 'nat1'} role="status">
      <strong class="total">{last.total}</strong>
      <span class="what">
        {#if nat === 'nat20'}<b class="tag">★ Natural 20!</b>{:else if nat === 'nat1'}<b class="tag">Natural 1</b>{/if}
        {last.label} <small>{last.expr === last.label ? '' : `${last.expr}: `}{last.detail}</small>
      </span>
    </p>
  {/if}

  <div class="cols">
    <div>
      <Combat {c} {sheet} {update} {patch} {onset} onrest={(m) => (restMode = m)} />
      <Attacks {sheet} />
      {#if sheet.spellcasting.length || sheet.pact}<Spells {c} {sheet} {patch} {onset} />{/if}
    </div>
    <div>
      <Abilities {sheet} {onset} />
      <Features {c} {sheet} {settings} />
      {#if edit}<CustomEffects {c} {update} />{/if}
    </div>
  </div>

  <Inventory {c} {sheet} {settings} {update} ontransfer={transferTo} />

  <RestDialogs bind:mode={restMode} {c} {sheet} {update} />
{/if}

<style>
  .top h1 {
    margin-bottom: 0;
  }

  .top p {
    margin: 0.2rem 0 0.6rem;
  }

  .banner {
    border-color: var(--accent);
  }

  .warnings {
    border-color: #b3261e;
  }

  .warnings ul {
    margin: 0.2rem 0 0;
    padding-left: 1.2rem;
  }

  .editbtn[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  /* The newest roll: a gold band with its own colours (--roll-*), so it never blends in with the cards. */
  .lastroll {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.5rem 0;
    padding: 0.3rem 0.75rem;
    overflow-wrap: anywhere;
    background: var(--roll-bg);
    color: var(--roll-fg);
    border: 1px solid var(--roll-edge);
    border-left-width: 0.5rem;
    border-radius: 0.5rem;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
  }

  .lastroll.nat20 {
    border-width: 3px;
    border-left-width: 0.5rem;
  }

  .lastroll.nat1 {
    border-style: dashed;
    border-width: 3px;
    border-left-width: 0.5rem;
  }

  .total {
    font-size: 2rem;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    min-width: 2ch;
    text-align: center;
  }

  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.4rem;
    line-height: 1.3;
  }

  .tag {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.85rem;
  }

  small {
    font-size: 0.8rem;
  }

  /* The sticky strip must not cover a control that gets focus (keyboard, or tapping into a field on a phone). */
  :global(html:has(.lastroll)) {
    scroll-padding-top: 6rem;
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
    gap: 0 1rem;
    align-items: start;
  }

  .cols > div {
    min-width: 0;
  }
</style>
