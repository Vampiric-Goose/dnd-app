<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '../lib/db.ts';
  import { router } from '../lib/router.svelte.ts';
  import { isIOS, isStandalone, needsBackupReminder } from '../lib/platform.ts';
  import { app, saveBackup } from '../lib/store.svelte.ts';

  const DAY = 86_400_000;

  let snoozedUntil: number | undefined = $state();
  let hasCharacters = $state(false);
  let includeBooks = $state(false);
  let busy = $state(false);
  let error = $state('');
  let showTip = $state(false);

  onMount(async () => {
    try {
      snoozedUntil = await db.meta.get<number>('backupSnoozedUntil');
      showTip = isIOS() && !isStandalone() && !(await db.meta.get('iosTipDismissed'));
    } catch { /* no storage: the app already reports that */ }
  });

  // Characters can exist without a campaign, so look again whenever the page changes.
  $effect(() => {
    void router.path;
    db.characters.list().then((l) => (hasCharacters = l.length > 0), () => {});
  });

  const show = $derived(
    app.ready && needsBackupReminder({ lastBackupAt: app.lastBackupAt, snoozedUntil, hasData: app.campaigns.length > 0 || hasCharacters, now: Date.now() }),
  );

  async function exportAll() {
    busy = true;
    error = '';
    try {
      await saveBackup({ includePacks: includeBooks });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function snooze() {
    snoozedUntil = Date.now() + 3 * DAY;
    await db.meta.set('backupSnoozedUntil', snoozedUntil).catch(() => {});
  }

  async function dismissTip() {
    showTip = false;
    await db.meta.set('iosTipDismissed', true).catch(() => {});
  }
</script>

{#if showTip}
  <div class="strip" role="note" aria-label="Home Screen tip">
    <p>Add this app to your Home Screen so Safari doesn't clear your data.</p>
    <button onclick={dismissTip}>Got it</button>
  </div>
{/if}

{#if show}
  <div class="strip" role="region" aria-label="Backup reminder">
    <p>
      <span class="wide">Your data lives only in this browser.</span>
      {app.lastBackupAt === undefined ? "You haven't made a backup yet." : 'Your last backup was more than two weeks ago.'}
    </p>
    <label class="check">
      <input type="checkbox" bind:checked={includeBooks} />
      Include<span class="wide"> imported</span> books<span class="wide"> (larger file)</span>
    </label>
    <button class="primary" disabled={busy} onclick={exportAll}>Export backup</button>
    <button disabled={busy} onclick={snooze} aria-label="Remind me in 3 days"><span class="wide">Remind me in 3 days</span><span class="narrow">Later</span></button>
    {#if error}<p role="alert" class="error">{error}</p>{/if}
  </div>
{/if}

<style>
  /* A slim one-line strip (wraps on narrow screens), not a card */
  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.9rem;
    margin: 0.5rem 0;
    padding: 0.3rem 0.4rem 0.3rem 0.75rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-left: 2px solid var(--accent);
    border-radius: 4px;
    font-size: 0.875rem;
  }

  .strip p {
    margin: 0;
    flex: 1 1 18rem;
  }

  .strip .check {
    margin: 0;
    align-items: center;
  }

  .strip button {
    min-height: 2rem;
    padding: 0.1rem 0.7rem;
  }

  .strip .error {
    flex-basis: 100%;
  }

  .narrow {
    display: none;
  }

  /* Phones: message on one line, the checkbox and both buttons on the next */
  @media (max-width: 767px) {
    .strip p {
      flex-basis: 100%;
    }

    .strip button {
      min-height: 44px;
    }

    .wide {
      display: none;
    }

    .narrow {
      display: inline;
    }
  }
</style>
