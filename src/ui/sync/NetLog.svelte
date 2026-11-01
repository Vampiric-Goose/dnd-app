<script lang="ts">
  // Connection details: the steps of the last connection attempts, for diagnosing a join that fails (no addresses are shown).
  import { netlog } from '../../lib/sync/netlog.svelte.ts';

  let copied = $state(false);
  async function copy() {
    try { await navigator.clipboard.writeText(netlog.lines.join('\n')); copied = true; } catch { copied = false; }
  }
</script>

<details class="netlog">
  <summary>Connection details</summary>
  {#if netlog.lines.length}
    <pre>{netlog.lines.join('\n')}</pre>
    <button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy details'}</button>
  {:else}
    <p class="muted">Nothing yet.</p>
  {/if}
</details>

<style>
  .netlog {
    margin: 0.75rem 0;
  }

  pre {
    white-space: pre-wrap;
    font-size: 0.8rem;
    max-height: 18rem;
    overflow: auto;
  }
</style>
