<script lang="ts">
  import { db } from '../../lib/db.ts';
  import { characterListProblem } from '../../lib/recordShape.ts';
  import { getIndex } from '../../lib/store.svelte.ts';
  import { rosterEntry, type RosterEntry } from '../../lib/sync/project.ts';
  import { session } from '../../lib/sync/session.svelte.ts';
  import type { Campaign } from '../../lib/types.ts';

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
  const pct = (e: RosterEntry) => (e.maxHp > 0 ? Math.max(0, Math.min(100, (e.hp / e.maxHp) * 100)) : 0);
</script>

{#if entries.length}
  <section aria-label="Party">
    <h2>Party</h2>
    <ul class="plain party">
      {#each entries as e (e.id)}
        <li class="card">
          <div class="row">
            {#if dm || e.ownerId === me}<a href="#/characters/{e.id}"><strong>{e.name || 'Unnamed'}</strong></a>{:else}<strong>{e.name || 'Unnamed'}</strong>{/if}
            <span class="muted">{[e.race, e.classes].filter(Boolean).join(' · ')}{e.level ? ` · level ${e.level}` : ''}</span>
            {#if e.ownerId}<span class="muted">· {e.ownerId}</span>{/if}
          </div>
          <div class="hp">
            <span class="bar" role="meter" aria-label="Hit points of {e.name || 'Unnamed'}" aria-valuemin="0" aria-valuemax={e.maxHp} aria-valuenow={e.hp}><span style="width: {pct(e)}%"></span></span>
            <span class="muted">{e.hp} / {e.maxHp} HP</span>
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
  .hp {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .bar {
    flex: 1 1 auto;
    height: 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    overflow: hidden;
  }

  .bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
</style>
