<script lang="ts">
  // S5-R1: "Retrying in N s." and a Retry now button while a reconnect is waiting (the header chip, HostPanel and the Join page).
  import { retryNow, session } from '../../lib/sync/session.svelte.ts';

  let { compact = false }: { compact?: boolean } = $props();
  let now = $state(Date.now());
  $effect(() => {
    if (session.retryAt === undefined) return;
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const secs = $derived(session.retryAt === undefined ? 0 : Math.max(0, Math.ceil((session.retryAt - now) / 1000)));
</script>

{#if session.retryAt !== undefined}
  {#if !compact}<span>Retrying in {secs} s.</span>{/if}
  <button type="button" class="retry" onclick={retryNow} aria-label={compact ? `Retry now (next try in ${secs} s)` : undefined}>Retry now</button>
{/if}

<style>
  .retry {
    font-size: 0.8rem;
    padding: 0.1rem 0.5rem;
  }
</style>
