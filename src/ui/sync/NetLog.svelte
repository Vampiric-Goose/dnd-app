<script lang="ts">
  // Connection details: the steps of the last connection attempts, for diagnosing a join that fails (no addresses are shown).
  import { netlog } from '../../lib/sync/netlog.svelte.ts';
  import Drawer from '../kit/Drawer.svelte';

  let copied = $state(false);
  async function copy() {
    try { await navigator.clipboard.writeText(netlog.lines.join('\n')); copied = true; } catch { copied = false; }
  }
</script>

<Drawer title="Connection details">
  {#snippet summary()}{netlog.lines.length ? `${netlog.lines.length} ${netlog.lines.length === 1 ? 'step' : 'steps'}` : 'Nothing yet'}{/snippet}
  {#if netlog.lines.length}
    <pre>{netlog.lines.join('\n')}</pre>
    <button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy details'}</button>
  {:else}
    <p class="muted">Nothing yet.</p>
  {/if}
</Drawer>

<style>
  pre {
    white-space: pre-wrap;
    font-family: var(--mono);
    font-size: 0.8rem;
    max-height: 18rem;
    overflow: auto;
    margin: 0 0 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--rail);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
</style>
