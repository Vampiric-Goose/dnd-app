<!--
  Drawer: a <details> fold with a caption, an accent chevron, and an optional one-line `summary`
  snippet shown beside the caption only while closed ("14 items · 92 lb"). `open` is bindable.
  Drawers stack with hairline rules between them, no boxes. See README.md.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    open = $bindable(false),
    summary,
    children,
  }: {
    title: string;
    open?: boolean;
    /** one line, shown only while closed */
    summary?: Snippet;
    children: Snippet;
  } = $props();
</script>

<details class="drawer" bind:open>
  <summary>
    <span class="chev" aria-hidden="true">▶</span>
    <span class="title">{title}</span>
    {#if summary && !open}<span class="sum">{@render summary()}</span>{/if}
  </summary>
  <div class="body">{@render children()}</div>
</details>

<style>
  .drawer {
    border-top: 1px solid var(--line);
  }

  summary {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.55rem 0;
    list-style: none;
    cursor: pointer;
    min-width: 0;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:focus-visible {
    outline-offset: -2px;
  }

  .chev {
    flex: none;
    color: var(--accent);
    font-size: 0.6em;
    transition: transform 0.12s;
  }

  [open] > summary .chev {
    transform: rotate(90deg);
  }

  .title {
    flex: none;
    color: var(--text-strong);
  }

  .sum {
    flex: 1;
    min-width: 0;
    text-align: right;
    color: var(--muted);
    font-size: 0.9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .body {
    padding: 0 0 0.75rem;
  }

  @media (max-width: 767px) {
    summary {
      min-height: 44px;
      box-sizing: border-box;
      align-items: center;
    }
  }
</style>
