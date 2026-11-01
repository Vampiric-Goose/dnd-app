<script lang="ts">
  // The read-only tracker players see (spec 3.6): built by trackerForPlayers, so nothing hidden is here to show. No edit controls.
  import { INIT_MAX, INIT_MIN, initOk } from '../../lib/combat/combat.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import type { TrackerView } from '../../lib/sync/project.ts';
  import { sendInitiative } from '../../lib/sync/session.svelte.ts';
  import type { CampaignSettings, Character } from '../../lib/types.ts';
  import { rollD20 } from '../sheet/roll.ts';

  let { view, own, settings }: { view: TrackerView | undefined; own: Character[] /* joined campaign: the player's characters */; settings: CampaignSettings } = $props();

  const ownById = $derived(new Map(own.map((c) => [c.id, c])));
  const turnName = $derived(view?.rows.find((r) => r.id === view?.current)?.name);
  const status = $derived(!view ? '' : view.round === 0 ? 'Setup' : `Round ${view.round}${turnName ? ` · ${turnName}'s turn` : ''}`);

  // Typed or rolled totals per own character, and the ones sent (the input goes once the DM's tracker carries the roll).
  let totals: Record<string, number | null> = $state({});
  let sent: Record<string, boolean> = $state({});

  function roll(c: Character) {
    const r = rollD20('Initiative', computeSheet(c, { settings, viewer: 'player' }).initiative);
    if (r) totals[c.id] = r.total;
  }

  function send(id: string) {
    const n = totals[id];
    if (!initOk(n)) return;
    sendInitiative(id, n);
    sent[id] = true;
  }
</script>

{#if !view}
  <p>No fight in progress.</p>
{:else}
  <h2>{view.round === 0 ? 'Setup' : `Round ${view.round}`}</h2>
  <p class="sr-only" aria-live="polite">{status}</p>
  {#if view.rows.length}
    <ol class="plain">
      {#each view.rows as r (r.id)}
        {@const mine = r.characterId ? ownById.get(r.characterId) : undefined}
        <li class="card" aria-current={r.id === view.current ? 'true' : undefined}>
          <div class="row">
            <strong class="name">{r.name}</strong>
            {#if r.characterId}
              <span>Init {r.init ?? '—'}</span>
              {#if r.hp !== undefined}<span>HP {r.hp}/{r.maxHp}</span>{/if}
            {:else if r.health}
              <span class="health">{r.health}</span>
            {/if}
          </div>
          {#if mine && r.init === undefined}
            <div class="row">
              <label class="row"><span>Initiative</span>
                <input type="number" min={INIT_MIN} max={INIT_MAX} step="1" inputmode="numeric" aria-label="Initiative of {r.name}" bind:value={totals[mine.id]} />
              </label>
              <button type="button" aria-label="Roll initiative for {r.name}" onclick={() => roll(mine)}>Roll</button>
              <button type="button" class="primary" aria-label="Send initiative for {r.name}" disabled={!initOk(totals[mine.id])} onclick={() => send(mine.id)}>Send</button>
              {#if sent[mine.id]}<span class="muted" role="status">Sent. Waiting for the DM.</span>{/if}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="muted">Nobody you can see is in the fight yet.</p>
  {/if}
{/if}

<style>
  li.card {
    margin: 0.4rem 0;
  }

  li[aria-current='true'] {
    border-color: var(--accent);
    box-shadow: inset 4px 0 var(--accent);
  }

  .name {
    flex: 1 1 8rem;
  }

  .health {
    color: var(--muted);
  }

  input {
    width: 4rem;
  }
</style>
