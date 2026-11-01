<script lang="ts">
  // The #/map page (its own lazy chunk): the DM's map, or the players' live map (a joined campaign, or the DM's Player view).
  import { app } from '../../lib/store.svelte.ts';
  import DmMap from '../map/DmMap.svelte';
  import PlayerMap from '../map/PlayerMap.svelte';

  let { params: _params }: { params: Record<string, string> } = $props();
</script>

<h1>Map</h1>
{#if !app.campaign}
  <p class="muted">Open a campaign to use the map.</p>
{:else if app.campaign.sync?.role === 'player' || app.viewer === 'player'}
  {#key app.campaign.id}<PlayerMap campaign={app.campaign} />{/key}
{:else}
  {#key app.campaign.id}<DmMap campaign={app.campaign} />{/key}
{/if}
