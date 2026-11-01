<script lang="ts">
  import { app } from '../lib/store.svelte.ts';
</script>

<!-- Only with a campaign open: a DM runs the table, and without a campaign nothing is ever hidden. A joined campaign is always Player. -->
{#if app.campaign && app.campaign.sync?.role !== 'player'}
  <fieldset class="viewer">
    <legend class="sr-only">View as</legend>
    <span class="caption" aria-hidden="true">View as</span>
    <span class="seg">
      <label><input type="radio" name="viewer" checked={app.viewer === 'dm'} onchange={() => (app.viewer = 'dm')} /> DM</label>
      <label><input type="radio" name="viewer" checked={app.viewer === 'player'} onchange={() => (app.viewer = 'player')} /> Player</label>
    </span>
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

  /* A segmented control; the radios stay (keyboard: arrow keys) but are drawn as the segments */
  .seg {
    display: inline-flex;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }

  label {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 2rem;
    padding: 0 0.7rem;
    color: var(--muted);
    cursor: pointer;
  }

  label + label {
    border-left: 1px solid var(--line-strong);
  }

  label:has(input:checked) {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -4px;
  }

  label:has(input:checked:focus-visible) {
    outline-color: var(--on-accent);
  }

  input {
    position: absolute;
    opacity: 0;
    margin: 0;
    pointer-events: none;
  }

  @media (max-width: 767px) {
    label {
      min-height: 44px;
    }
  }
</style>
