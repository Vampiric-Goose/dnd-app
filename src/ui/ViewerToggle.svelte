<script lang="ts">
  import { app } from '../lib/store.svelte.ts';
</script>

<!-- Only with a campaign open: a DM runs the table, and without a campaign nothing is ever hidden. A joined campaign is always Player. -->
{#if app.campaign && app.campaign.sync?.role !== 'player'}
  <fieldset class="viewer">
    <legend class="sr-only">View as</legend>
    <span class="muted" aria-hidden="true">View as</span>
    <label><input type="radio" name="viewer" checked={app.viewer === 'dm'} onchange={() => (app.viewer = 'dm')} /> DM</label>
    <label><input type="radio" name="viewer" checked={app.viewer === 'player'} onchange={() => (app.viewer = 'player')} /> Player</label>
  </fieldset>
{/if}

<style>
  .viewer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: 0;
    margin: 0;
    padding: 0;
    font-size: 0.85rem;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  input {
    min-height: 0;
  }
</style>
