<script lang="ts">
  import { characterSummary } from '../../lib/character/play.ts';
  import { db, StorageError } from '../../lib/db.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { rollLog } from '../../lib/rolls.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { DEFAULT_SETTINGS } from '../../lib/settings.ts';
  import { app } from '../../lib/store.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Character, OverrideKey } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import Abilities from './Abilities.svelte';
  import Attacks from './Attacks.svelte';
  import Combat from './Combat.svelte';
  import CustomEffects from './CustomEffects.svelte';
  import Features from './Features.svelte';
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

  async function flush() {
    clearTimeout(timer);
    timer = undefined;
    const cur = c;
    if (!cur || cur === saved) return;
    try {
      await db.characters.put($state.snapshot(cur) as Character);
      saved = cur;
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

  const last = $derived(rollLog[0]);
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
      <button type="button" class="primary" onclick={() => navigate(`characters/${c!.id}/level-up`)}>Level up</button>
      <!-- ponytail: Export is wired up in Task 20 -->
      <button type="button" disabled title="Available soon">Export</button>
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
    <p class="lastroll card" role="status">
      <strong class="total">{last.total}</strong>
      <span>{last.label} <small class="muted">{last.expr === last.label ? '' : `${last.expr}: `}{last.detail}</small></span>
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
      <CustomEffects {c} {update} />
    </div>
  </div>

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

  .lastroll {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    overflow-wrap: anywhere;
  }

  .total {
    font-size: 1.5rem;
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
