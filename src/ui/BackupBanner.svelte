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
  <div class="card banner" role="note" aria-label="Home Screen tip">
    <p>Add this app to your Home Screen so Safari doesn't clear your data.</p>
    <div class="row"><button onclick={dismissTip}>Got it</button></div>
  </div>
{/if}

{#if show}
  <div class="card banner" role="region" aria-label="Backup reminder">
    <p>
      Your data lives only in this browser.
      {app.lastBackupAt === undefined ? "You haven't made a backup yet." : 'Your last backup was more than two weeks ago.'}
    </p>
    <label class="check">
      <input type="checkbox" bind:checked={includeBooks} />
      Include imported books (larger file)
    </label>
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    <div class="row">
      <button class="primary" disabled={busy} onclick={exportAll}>Export backup</button>
      <button disabled={busy} onclick={snooze}>Remind me in 3 days</button>
    </div>
  </div>
{/if}

<style>
  .banner {
    border-left: 4px solid var(--accent);
  }

  .banner p {
    margin: 0 0 0.5rem;
  }
</style>
