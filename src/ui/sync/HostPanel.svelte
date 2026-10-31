<script lang="ts">
  import { db } from '../../lib/db.ts';
  import { characterListProblem } from '../../lib/recordShape.ts';
  import { hostCampaign, removePlayer, rotateCode, session, stopHosting } from '../../lib/sync/session.svelte.ts';
  import type { Campaign, Character } from '../../lib/types.ts';

  let { campaign }: { campaign: Campaign } = $props();

  const hosting = $derived(session.role === 'dm' && session.campaignId === campaign.id);
  const code = $derived(campaign.sync?.code ?? '');
  const link = $derived(`${location.origin}${location.pathname}#/join/${code}`);
  const players = $derived(Object.entries(campaign.sync?.players ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));
  const onlineNames = $derived(players.filter(([id]) => session.online[id]).map(([id, p]) => (p.name ? `${p.name} (${id})` : id)));

  let chars: Character[] = $state.raw([]);
  $effect(() => {
    void session.rev;
    db.characters.list(campaign.id).then((cs) => (chars = cs.filter((c) => !characterListProblem(c))), () => {});
  });
  const charsOf = (id: string) => chars.filter((c) => c.ownerId === id).map((c) => c.name || 'Unnamed').join(', ');

  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let confirming: 'rotate' | { remove: string } | undefined = $state();

  async function act(f: () => Promise<void>) {
    busy = true;
    error = '';
    try {
      await f();
      confirming = undefined;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      notice = `${what} copied.`;
    } catch {
      notice = `Could not copy. Select the ${what.toLowerCase()} and copy it yourself.`;
    }
  }
</script>

<h2>Play together</h2>
{#if error}<p role="alert" class="error">{error}</p>{/if}

{#if !hosting}
  <p>Host this campaign so your players can join from their own devices with a code. Their characters sync with yours; what you hide stays on this device.</p>
  <button class="primary" disabled={busy} onclick={() => act(() => hostCampaign(campaign.id))}>{campaign.sync ? 'Host again' : 'Host this campaign'}</button>
{:else}
  <p role="status">
    {#if session.status === 'hosting'}Hosting. {onlineNames.length} {onlineNames.length === 1 ? 'player' : 'players'} online.
    {:else if session.status === 'retrying'}Not reachable right now ({session.reason}). Trying again…
    {:else}Starting…{/if}
  </p>
  <div class="field">
    <span>Join code</span>
    <div class="row"><strong class="code">{code}</strong><button onclick={() => copy(code, 'Code')}>Copy code</button></div>
  </div>
  <div class="field">
    <label for="join-link">Join link</label>
    <div class="row"><input id="join-link" class="grow" readonly value={link} onfocus={(e) => e.currentTarget.select()} /><button onclick={() => copy(link, 'Link')}>Copy link</button></div>
  </div>
  {#if notice}<p role="status" class="muted">{notice}</p>{/if}

  <h3>Players</h3>
  {#if !players.length}
    <p class="muted">No one has joined yet.</p>
  {:else}
    <ul class="plain">
      {#each players as [id, p] (id)}
        <li class="card">
          <div class="row">
            <strong>{id}</strong>
            {#if p.name}<span>{p.name}</span>{/if}
            <span class="muted">{p.removed ? 'removed' : session.online[id] ? 'online' : 'offline'}</span>
          </div>
          <div class="muted">{charsOf(id) || 'No characters yet'}</div>
          {#if !p.removed}
            {#if typeof confirming === 'object' && confirming.remove === id}
              <div role="alertdialog" aria-label="Confirm removing a player" class="row">
                <p>Remove {p.name ? `${p.name} (${id})` : id}? They are disconnected and can't join with this ID again. Their characters stay with you.</p>
                <button class="danger" disabled={busy} onclick={() => act(() => removePlayer(id))}>Remove {id}</button>
                <button onclick={() => (confirming = undefined)}>Keep them</button>
              </div>
            {:else}
              <button class="danger" onclick={() => (confirming = { remove: id })}>Remove player {id}</button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="row">
    <button onclick={() => (confirming = 'rotate')}>Issue a new join code</button>
    <button disabled={busy} onclick={() => act(() => stopHosting(campaign.id))}>Stop hosting</button>
  </div>
  {#if confirming === 'rotate'}
    <div role="alertdialog" aria-label="Confirm a new join code" class="card">
      <p>
        Issue a new join code? The old code and link stop working at once.
        {#if onlineNames.length}{onlineNames.join(', ')} {onlineNames.length === 1 ? 'is' : 'are'} disconnected and must rejoin with the new link (their player IDs stay).{:else}No one is online now.{/if}
      </p>
      <div class="row">
        <button class="danger" disabled={busy} onclick={() => act(rotateCode)}>Issue a new code</button>
        <button onclick={() => (confirming = undefined)}>Cancel</button>
      </div>
    </div>
  {/if}
{/if}
<p class="muted">Players on the same Wi-Fi connect reliably; some mobile and school networks block direct connections.</p>

<style>
  .code {
    font-family: ui-monospace, monospace;
    letter-spacing: 0.1em;
  }

  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
</style>
