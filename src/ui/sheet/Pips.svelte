<script lang="ts">
  // `total` toggle buttons; the first `used` are spent. Clicking a spent pip restores it and every pip after it; clicking a free one spends it and the ones before.
  let { total, used, label, onchange }: { total: number; used: number; label: string; onchange: (used: number) => void } = $props();
</script>

<span class="pips" role="group" aria-label="{label}: {Math.max(0, total - used)} of {total} left">
  {#each Array.from({ length: total }, (_, i) => i) as i (i)}
    <button type="button" class="pip" aria-pressed={i < used} aria-label="{label} {i + 1} of {total}, {i < used ? 'spent' : 'available'}" onclick={() => onchange(i < used ? i : i + 1)}>
      <span aria-hidden="true">{i < used ? '' : '●'}</span>
    </button>
  {/each}
</span>

<style>
  .pips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  /* Available = a filled teal dot, spent = an empty dashed ring. */
  .pip {
    width: 1.75rem;
    min-height: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border-radius: 50%;
    color: var(--accent);
    font-size: 0.85rem;
    line-height: 1;
  }

  .pip[aria-pressed='true'] {
    border-style: dashed;
    border-color: var(--line-strong);
    background: transparent;
  }

  @media (max-width: 767px) {
    .pip {
      width: 44px;
      min-height: 44px;
      height: 44px;
    }
  }
</style>
