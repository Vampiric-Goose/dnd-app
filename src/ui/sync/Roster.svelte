<script lang="ts">
  import { db } from '../../lib/db.ts';
  import { characterListProblem } from '../../lib/recordShape.ts';
  import { getIndex } from '../../lib/store.svelte.ts';
  import { rosterEntry, type RosterEntry } from '../../lib/sync/project.ts';
  import { session } from '../../lib/sync/session.svelte.ts';
  import type { Campaign } from '../../lib/types.ts';
  import Bar from '../kit/Bar.svelte';

  // The party of a synced campaign. The DM builds it from their own full records and links every sheet; a player sees what the DM
  // last sent (summaries only) and links only their own characters.
  let { campaign }: { campaign: Campaign } = $props();

  const dm = $derived(campaign.sync?.role === 'dm');
  const me = $derived(campaign.sync?.playerId);
  let local: RosterEntry[] = $state.raw([]);
  $effect(() => {
    void session.rev;
    if (!dm) return;
    const { id, settings } = campaign;
    Promise.all([db.characters.list(id), getIndex(id)]).then(([cs, index]) => {
      local = cs.filter((c) => !characterListProblem(c)).map((c) => rosterEntry(c, index, settings));
    }, () => {});
  });
  const entries = $derived((dm ? local : session.campaignId === campaign.id ? session.roster : []).slice().sort((a, b) => a.name.localeCompare(b.name)));
</script>

{#if entries.length}
  <section aria-label="Party">
    <h2 class="caption">Party</h2>
    <ul class="plain party">
      {#each entries as e (e.id)}
        <li>
          <div class="who">
            {#if dm || e.ownerId === me}<a href="#/characters/{e.id}"><strong>{e.name || 'Unnamed'}</strong></a>{:else}<strong>{e.name || 'Unnamed'}</strong>{/if}
            <span class="muted">{[e.race, e.classes].filter(Boolean).join(' · ')}{e.level ? ` · level ${e.level}` : ''}</span>
            {#if e.ownerId}<span class="muted num">· {e.ownerId}</span>{/if}
          </div>
          <div class="hp">
            <Bar value={e.hp} max={e.maxHp} label="Hit points of {e.name || 'Unnamed'}" />
            <span class="muted"><span class="num">{e.hp} / {e.maxHp}</span> HP</span>
          </div>
          {#if e.conditions.length}<div class="muted">{e.conditions.join(', ')}</div>{/if}
        </li>
      {/each}
    </ul>
  </section>
{:else if !dm && session.campaignId !== campaign.id}
  <p class="muted">The party shows here while you are connected to your DM.</p>
{/if}

<style>
  h2 {
    margin: 1rem 0 0.25rem;
  }

  .party li {
    padding: 0.5rem 0;
    border-top: 1px solid var(--line);
  }

  .who {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
  }

  .who strong {
    color: var(--text-strong);
  }

  .hp {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.25rem;
  }

  .hp > :global(.bar) {
    flex: 1 1 auto;
    max-width: 20rem;
  }

  .hp > span {
    white-space: nowrap;
    font-size: 0.85rem;
  }
</style>
