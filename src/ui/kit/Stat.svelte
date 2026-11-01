<!--
  Stat: an uppercase caption over a monospace value ("AC 18", "STR +3"). `box` draws the hairline box of the
  ability row; `size` sets the value size. Anything extra (the score under a modifier, a roll button) goes in
  `children`, rendered under the value. See README.md.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    value,
    box = false,
    size = 'md',
    children,
  }: {
    label: string;
    value: string | number;
    box?: boolean;
    size?: 'sm' | 'md' | 'lg';
    children?: Snippet;
  } = $props();
</script>

<div class="stat {size}" class:box>
  <span class="caption">{label}</span>
  <strong class="num">{value}</strong>
  {#if children}<div class="extra">{@render children()}</div>{/if}
</div>

<style>
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .box {
    align-items: center;
    padding: 0.45rem 0.4rem;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    text-align: center;
  }

  strong {
    color: var(--text-strong);
    font-weight: 600;
    line-height: 1.2;
  }

  .sm strong {
    font-size: 1rem;
  }

  .md strong {
    font-size: 1.35rem;
  }

  .lg strong {
    font-size: 1.85rem;
  }

  .extra {
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
