<script lang="ts">
  import { navigate } from '../../lib/router.svelte.ts';
  import { app, setCampaign } from '../../lib/store.svelte.ts';
  import { codeFrom } from '../../lib/sync/code.ts';
  import { join, leaveJoin, session } from '../../lib/sync/session.svelte.ts';
  import NetLog from '../sync/NetLog.svelte';
  import RelaySettings from '../sync/RelaySettings.svelte';
  import RetryNow from '../sync/RetryNow.svelte';

  let { params }: { params: { code?: string } } = $props();

  // No code in the link: the player types the code or pastes the whole link.
  let typed = $state('');
  const typedCode = $derived(codeFrom(typed));

  const code = $derived(codeFrom(params.code ?? '')); // params can briefly be the next route's while leaving
  const valid = $derived(code !== '');
  // already joined with this code on this device: just open it (the session reconnects)
  const joined = $derived(app.campaigns.find((c) => c.sync?.role === 'player' && c.sync.code === code));

  let mode: 'new' | 'id' = $state('new');
  let name = $state('');
  let pid = $state('');
  let started = $state(false);
  const pidOk = $derived(/^[A-Z][1-9]$/.test(pid.trim().toUpperCase()));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (mode === 'id' && !pidOk) return;
    started = true;
    void join(mode === 'new' ? { code, name: name.trim() } : { code, playerId: pid.trim().toUpperCase() });
  }

  async function open() {
    await setCampaign(joined!.id);
    navigate('characters');
  }

  const packs = $derived(session.packs);
  const done = $derived(started && session.status === 'online' && session.welcomed && (!packs || packs.done >= packs.total));
  $effect(() => { if (done) navigate('characters'); }); // after the books have downloaded
  $effect(() => () => leaveJoin()); // leaving before a join succeeded: back to the open campaign's own session

  const reasons: Record<string, string> = {
    'wrong code': 'That join code is not in use. Ask your DM for the current link.',
    'unknown player': 'The DM does not know that player ID. Check it, or join as a new player.',
    removed: 'The DM removed that player ID from the campaign.',
  };
</script>

<h1>Join a campaign</h1>

{#if !params.code}
  <form onsubmit={(e) => { e.preventDefault(); if (typedCode) navigate(`join/${typedCode}`); }}>
    <div class="field">
      <label for="join-code">Join code or link from your DM</label>
      <input id="join-code" bind:value={typed} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD EFGH JKMN" aria-invalid={typed && !typedCode ? 'true' : undefined} />
    </div>
    {#if typed && !typedCode}<p class="muted">A join code has 12 letters and digits.</p>{/if}
    <button class="primary" type="submit" disabled={!typedCode}>Continue</button>
  </form>
{:else if !valid}
  <p role="alert" class="error">This join link is not complete. A join code has 12 letters and digits; ask your DM for the link again.</p>
{:else if !app.ready}
  <p class="muted">Loading…</p>
{:else if !started}
  <p>Join code <strong class="code">{code}</strong></p>
  {#if joined}
    <div class="card">
      <p>You have already joined <strong>{joined.name}</strong> as {joined.sync?.playerId}.</p>
      <button class="primary" onclick={open}>Open {joined.name}</button>
    </div>
  {/if}
  <form onsubmit={submit}>
    <fieldset>
      <legend>How are you joining?</legend>
      <label class="check"><input type="radio" name="mode" value="new" bind:group={mode} /> Join as a new player</label>
      <label class="check"><input type="radio" name="mode" value="id" bind:group={mode} /> I already have a player ID</label>
    </fieldset>
    {#if mode === 'new'}
      <div class="field">
        <label for="join-name">Display name (optional)</label>
        <input id="join-name" bind:value={name} maxlength="60" autocomplete="nickname" />
      </div>
    {:else}
      <div class="field">
        <label for="join-id">Player ID (a letter and a digit, such as A1)</label>
        <input id="join-id" bind:value={pid} maxlength="2" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-invalid={pid && !pidOk ? 'true' : undefined} />
      </div>
    {/if}
    <button class="primary" type="submit" disabled={mode === 'id' && !pidOk}>Join</button>
  </form>
  <p class="muted">Players can join from anywhere over the internet. A few networks (some mobile carriers, schools and workplaces) block direct connections; if joining fails, try another network.</p>
  <RelaySettings />
{:else}
  {#if session.confirm}
    <div role="alertdialog" aria-label="Confirm joining" class="card">
      <p>{session.confirm.text}</p>
      <div class="row">
        <button class="danger" onclick={() => session.confirm?.answer(true)}>Join anyway</button>
        <button class="primary" onclick={() => session.confirm?.answer(false)}>Cancel</button>
      </div>
    </div>
  {/if}
  <p role="status">
    {#if session.status === 'connecting'}Connecting to your DM…
    {:else if session.status === 'offline'}Could not reach your DM yet. {session.reason} <RetryNow />
    {:else if session.status === 'rejected'}Not joined. {reasons[session.reason] ?? session.reason}
    {:else if session.status === 'online'}Joined as {session.role === 'player' ? app.campaigns.find((c) => c.id === session.campaignId)?.sync?.playerId : ''}.
    {/if}
  </p>
  {#if packs && packs.total}
    <label class="field">
      <span>Downloading books: {packs.done} of {packs.total}</span>
      <progress value={packs.totalBytes ? packs.bytes : packs.done} max={packs.totalBytes || packs.total}></progress>
    </label>
  {/if}
  {#if packs?.error}<p role="alert" class="error">{packs.error}</p>{/if}
  {#if session.status === 'rejected'}<button onclick={() => (started = false)}>Back</button>{/if}
  <RelaySettings />
  <NetLog />
{/if}

<style>
  .code {
    font-family: ui-monospace, monospace;
    letter-spacing: 0.1em;
  }

  fieldset {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin: 0.75rem 0;
    min-width: 0;
  }

  progress {
    width: 100%;
  }
</style>
