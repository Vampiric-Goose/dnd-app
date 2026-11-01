<!--
  SettingsGroup: one group of a settings-style page (Campaigns, Settings, Packs, Join, About). The caption is the group's
  h2; on wide screens it sits in a left gutter beside a content column of up to ~900 px, on narrower ones above it.
  Groups are separated by a hairline; Drawers inside stack with their own rules. `danger` captions the group in red.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, danger = false, label, children }: { title: string; danger?: boolean; label?: string; children: Snippet } = $props();
  const id = $props.id();
</script>

<section class="group" aria-labelledby={label ? undefined : id} aria-label={label}>
  <h2 {id} class="caption" class:danger>{title}</h2>
  <div class="body">{@render children()}</div>
</section>

<style>
  .group {
    max-width: 900px;
    padding: 0.75rem 0 1rem;
    border-top: 1px solid var(--line);
  }

  h2 {
    margin: 0 0 0.5rem;
  }

  .danger {
    color: var(--danger);
  }

  .body {
    min-width: 0;
  }

  .body > :global(:first-child) {
    margin-top: 0;
  }

  .body > :global(:last-child) {
    margin-bottom: 0;
  }

  /* the group's own rule stands in for its first drawer's */
  .body > :global(.drawer:first-child) {
    border-top: 0;
  }

  @media (min-width: 1024px) {
    .group {
      display: grid;
      grid-template-columns: 11rem minmax(0, 1fr);
      column-gap: 2rem;
      max-width: calc(900px + 13rem);
    }

    h2 {
      margin: 0.7rem 0 0;
    }

    .body > :global(:first-child:not(.drawer)) {
      margin-top: 0.55rem;
    }
  }
</style>
