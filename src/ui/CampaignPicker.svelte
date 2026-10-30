<script lang="ts">
  import { app, setCampaign } from '../lib/store.svelte.ts';
</script>

{#if app.campaigns.length}
  <label class="picker">
    <span class="muted">Campaign</span>
    <select value={app.campaign?.id ?? ''} onchange={(e) => setCampaign(e.currentTarget.value || undefined).catch(() => {})}>
      <option value="">None</option>
      {#each app.campaigns as c (c.id)}
        <option value={c.id}>{c.name}</option>
      {/each}
    </select>
  </label>
{:else if app.ready}
  <a href="#/">Create a campaign</a>
{/if}

<style>
  .picker {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }

  select {
    min-width: 0;
    max-width: 10rem;
  }
</style>
