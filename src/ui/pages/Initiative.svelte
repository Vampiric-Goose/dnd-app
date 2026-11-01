<script lang="ts">
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { app, getIndex } from '../../lib/store.svelte.ts';
  import { trackerForPlayers } from '../../lib/sync/project.ts';
  import { session } from '../../lib/sync/session.svelte.ts';
  import type { Character, Combat, Encounter, MonsterDef } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import Encounters from '../initiative/Encounters.svelte';
  import PlayerTracker from '../initiative/PlayerTracker.svelte';
  import Tracker from '../initiative/Tracker.svelte';

  const campaign = $derived(app.campaign);
  const asPlayer = $derived(campaign?.sync?.role === 'player' || app.viewer === 'player');

  let combat: Combat | undefined = $state();
  let chars: Character[] = $state([]);
  let encounters: Encounter[] = $state([]);
  let index: ContentIndex | undefined = $state();
  let homebrew: MonsterDef[] = $state([]);
  let error = $state('');

  const cid = $derived(campaign?.id);

  async function load() {
    const id = cid;
    if (!id) return;
    try {
      const [c, cs, es] = await Promise.all([db.combat.get(id), db.characters.list(id), asPlayer ? [] : db.encounters.list(id)]);
      if (id !== cid) return;
      error = '';
      combat = c;
      chars = cs.sort((a, b) => a.name.localeCompare(b.name));
      encounters = es.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      error = message(e);
    }
  }

  // The combat and the characters again whenever sync stored something (a player's roll, a sheet edit).
  $effect(() => { void session.rev; void load(); });

  // The monster pool: the campaign's own monsters plus its content index (both already drop 2024, R60).
  $effect(() => {
    const id = cid;
    if (!id || asPlayer) return;
    Promise.all([getIndex(id), db.monsters.list(id)]).then(([i, m]) => { if (id === cid) { index = i; homebrew = m; } }, (e) => { error = message(e); });
  });
  // Players: a joined campaign shows what the DM sent; the DM's own Player view builds the same projection locally (R12).
  const joined = $derived(campaign?.sync?.role === 'player');
  const view = $derived(joined ? session.tracker : campaign && trackerForPlayers(combat, chars, campaign.settings));
  const mine = $derived(joined ? chars.filter((c) => c.ownerId !== undefined && c.ownerId === campaign?.sync?.playerId) : []);
  const pool = $derived<MonsterDef[]>(index ? [...homebrew, ...index.all('monster')] : []);
</script>

<h1>Initiative</h1>
{#if !campaign}
  <p>Open a campaign to run combat.</p>
{:else if asPlayer}
  <PlayerTracker {view} own={mine} settings={campaign.settings} />
{:else}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <Tracker {campaign} {combat} {chars} {pool} {index} reload={load} />
  <Encounters {campaign} {encounters} {pool} reload={load} />
{/if}
