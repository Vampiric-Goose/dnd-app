<script lang="ts">
  // The #/map page (its own lazy chunk): the DM's map, or (Task B2) the players' live map.
  import { app } from '../../lib/store.svelte.ts';
  import DmMap from '../map/DmMap.svelte';

  let { params: _params }: { params: Record<string, string> } = $props();
</script>

<h1>Map</h1>
{#if !app.campaign}
  <p class="muted">Open a campaign to use the map.</p>
{:else if app.campaign.sync?.role === 'player' || app.viewer === 'player'}
  <p class="muted">The DM isn't showing a map right now.</p>
{:else}
  {#key app.campaign.id}<DmMap campaign={app.campaign} />{/key}
{/if}
