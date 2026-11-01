<script lang="ts">
  import { app, setCampaign } from '../lib/store.svelte.ts';
</script>

{#if app.campaigns.length}
  <label class="picker">
    <span class="caption">Campaign</span>
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
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  select {
    min-width: 0;
    max-width: 14rem;
    min-height: 2rem;
    padding: 0.15rem 0.5rem;
    color: var(--text-strong);
  }

  @media (max-width: 767px) {
    select {
      max-width: 11rem;
    }
  }
</style>
