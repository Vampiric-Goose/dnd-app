<script lang="ts">
  // The read-only tracker players see (spec 3.6): built by trackerForPlayers, so nothing hidden is here to show. No edit controls.
  import { INIT_MAX, INIT_MIN, initOk } from '../../lib/combat/combat.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import type { TrackerView } from '../../lib/sync/project.ts';
  import { sendInitiative } from '../../lib/sync/session.svelte.ts';
  import type { CampaignSettings, Character } from '../../lib/types.ts';
  import Bar from '../kit/Bar.svelte';
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
  <div class="turnbar">
    <h2 class="round">
      {#if view.round === 0}<span class="caption">Setup</span>{:else}<span class="caption">Round</span> <span class="num">{view.round}</span>{/if}
    </h2>
    {#if turnName && view.round}<span class="who">{turnName}'s turn</span>{/if}
  </div>
  <p class="sr-only" aria-live="polite">{status}</p>
  {#if view.rows.length}
    <ol class="list">
      {#each view.rows as r (r.id)}
        {@const mine = r.characterId ? ownById.get(r.characterId) : undefined}
        <li aria-current={r.id === view.current ? 'true' : undefined}>
          <div class="crow">
            <span class="init num">{#if r.characterId}{r.init ?? '—'}{/if}</span>
            <strong class="name">{r.name}</strong>
            <span class="hp">
              {#if r.characterId && r.hp !== undefined}
                {#if r.maxHp !== undefined}<Bar value={r.hp} max={r.maxHp} label="{r.name} hit points" />{/if}
                <span class="hpn num">{r.hp}<span class="muted">/{r.maxHp}</span></span>
              {:else if r.health}
                <span class="health">{r.health}</span>
              {/if}
            </span>
          </div>
          {#if mine && r.init === undefined}
            <div class="row entry">
              <label class="row"><span class="caption">Initiative</span>
                <input type="number" class="num" min={INIT_MIN} max={INIT_MAX} step="1" inputmode="numeric" aria-label="Initiative of {r.name}" bind:value={totals[mine.id]} />
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
  .turnbar {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem 0.9rem;
    margin: 0 0 0.5rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--line);
  }

  .round {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0;
    font-size: 1rem;
    font-weight: 400;
  }

  .round .num {
    font-size: 1.35rem;
    color: var(--text-strong);
  }

  .who {
    color: var(--text-strong);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    border-bottom: 1px solid var(--line);
    border-radius: var(--radius);
  }

  li[aria-current='true'] {
    background: var(--raised);
    box-shadow: inset 2px 0 var(--accent);
  }

  .crow {
    display: grid;
    grid-template-columns: 2.2rem minmax(6rem, 14rem) minmax(5rem, 11rem);
    align-items: center;
    gap: 0.25rem 0.9rem;
    padding: 0.2rem 0.5rem;
    min-height: 2.6rem;
  }

  .init {
    color: var(--text-strong);
    text-align: right;
  }

  .name {
    color: var(--text-strong);
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hp {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .hp :global(.bar) {
    flex: 1;
  }

  .hpn {
    flex: none;
    font-size: 0.85rem;
  }

  .health {
    color: var(--muted);
  }

  .entry {
    padding: 0 0.5rem 0.5rem 3.6rem;
  }

  input {
    width: 4.5rem;
  }

  @media (max-width: 767px) {
    .crow {
      grid-template-columns: 2rem minmax(0, 1fr) 6.5rem;
      min-height: 44px;
      padding: 0.15rem 0.4rem;
    }

    .entry {
      padding-left: 0.4rem;
    }
  }
</style>
