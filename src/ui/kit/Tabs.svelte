<!--
  Tabs: underline tabs (accent underline on the active one), role="tablist", roving tabindex,
  Left/Right/Home/End move and activate. `value` is bindable; `onchange` fires on a user change
  (use it when the tab lives in the URL). With a `panel` snippet the active tab's content renders in a
  role="tabpanel" wired to its tab; without one, render the content yourself. See README.md.
-->
<script lang="ts" module>
  export type Tab = { id: string; label: string; count?: number };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    tabs,
    value = $bindable(),
    label,
    onchange,
    panel,
  }: {
    tabs: Tab[];
    value: string;
    /** aria-label of the tablist */
    label: string;
    onchange?: (id: string) => void;
    panel?: Snippet<[string]>;
  } = $props();

  const uid = $props.id();
  let list: HTMLDivElement | undefined = $state();

  function pick(id: string) {
    if (id === value) return;
    value = id;
    onchange?.(id);
  }

  function onkeydown(e: KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === value);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const n = (next + tabs.length) % tabs.length;
    pick(tabs[n].id);
    (list?.children[n] as HTMLElement | undefined)?.focus();
  }
</script>

<div class="tabs" role="tablist" aria-label={label} bind:this={list}>
  {#each tabs as t (t.id)}
    <button
      type="button"
      role="tab"
      id="{uid}-tab-{t.id}"
      aria-selected={t.id === value}
      aria-controls={panel ? `${uid}-panel` : undefined}
      tabindex={t.id === value ? 0 : -1}
      onclick={() => pick(t.id)}
      {onkeydown}
    >
      {t.label}{#if t.count !== undefined}<span class="count num">{t.count}</span>{/if}
    </button>
  {/each}
</div>
{#if panel}
  <div role="tabpanel" id="{uid}-panel" aria-labelledby="{uid}-tab-{value}" tabindex="-1">{@render panel(value)}</div>
{/if}

<style>
  .tabs {
    display: flex;
    gap: 1.1rem;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    scrollbar-width: none;
  }

  button {
    flex: none;
    border: 0;
    border-radius: 0;
    background: transparent;
    min-height: 2.25rem;
    padding: 0.25rem 0.1rem;
    color: var(--muted);
    box-shadow: inset 0 -2px transparent;
    white-space: nowrap;
  }

  button:hover:not(:disabled) {
    background: transparent;
    color: var(--text);
  }

  button[aria-selected='true'] {
    color: var(--text-strong);
    box-shadow: inset 0 -2px var(--accent);
  }

  button:focus-visible {
    outline-offset: -2px;
  }

  .count {
    margin-left: 0.4em;
    color: var(--muted);
    font-size: 0.85em;
  }

  [role='tabpanel'] {
    padding-top: 0.75rem;
  }

  [role='tabpanel']:focus-visible {
    outline: none;
  }

  @media (max-width: 767px) {
    button {
      min-height: 44px;
    }
  }
</style>
