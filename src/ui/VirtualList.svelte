<script lang="ts" generics="T">
  import { untrack, type Snippet } from 'svelte';
  import { visibleRange } from '../lib/virtual.ts';

  // Fixed-height rows, only the visible ones in the DOM. Arrow keys move the highlight; Enter or a click selects.
  let { items, row, onselect, selected, label, rowHeight = 44 }: {
    items: T[];
    row: Snippet<[T]>;
    onselect: (item: T) => void;
    selected?: T;
    label: string;
    rowHeight?: number;
  } = $props();

  const uid = $props.id();
  let el: HTMLDivElement | undefined = $state();
  let top = $state(0);
  let height = $state(0);
  let active = $state(0);

  const range = $derived(visibleRange(top, height, rowHeight, items.length, 5));
  const shown = $derived(items.slice(range[0], range[1]));

  // New list: back to the top.
  $effect(() => {
    items;
    untrack(() => {
      active = 0;
      top = 0;
      if (el) el.scrollTop = 0;
    });
  });

  // A hidden list (display: none) loses its scroll offset; restore it when it is shown again.
  $effect(() => {
    if (height > 0 && el) {
      const t = untrack(() => top);
      if (el.scrollTop !== t) el.scrollTop = t;
    }
  });

  function reveal(i: number) {
    if (!el) return;
    if (i * rowHeight < el.scrollTop) el.scrollTop = i * rowHeight;
    else if ((i + 1) * rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * rowHeight - el.clientHeight;
  }

  function onkeydown(e: KeyboardEvent) {
    const page = Math.max(1, Math.floor(height / rowHeight) - 1);
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page }[e.key];
    if (step !== undefined) {
      active = Math.min(items.length - 1, Math.max(0, active + step));
      reveal(active);
    } else if (e.key === 'Home') { active = 0; reveal(0); }
    else if (e.key === 'End') { active = Math.max(0, items.length - 1); reveal(active); }
    else if (e.key === 'Enter' && items[active] !== undefined) onselect(items[active]);
    else return;
    e.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={el}
  bind:clientHeight={height}
  class="list"
  role="listbox"
  tabindex="0"
  aria-label={label}
  aria-activedescendant={items.length ? `${uid}-${active}` : undefined}
  onscroll={() => { if (el && el.clientHeight > 0) top = el.scrollTop; }}
  {onkeydown}
>
  <div class="spacer" style:height="{items.length * rowHeight}px">
    {#each shown as item, k (range[0] + k)}
      {@const i = range[0] + k}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
      <div
        id="{uid}-{i}"
        class="item"
        class:active={i === active}
        class:selected={item === selected}
        role="option"
        aria-selected={item === selected}
        style:top="{i * rowHeight}px"
        style:height="{rowHeight}px"
        onclick={() => { active = i; onselect(item); }}
      >
        {@render row(item)}
      </div>
    {/each}
  </div>
</div>

<style>
  .list {
    overflow-y: auto;
    height: 100%;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--surface);
  }

  .spacer {
    position: relative;
  }

  .item {
    position: absolute;
    left: 0;
    right: 0;
    box-sizing: border-box;
    padding: 0 0.75rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    overflow: hidden;
  }

  .selected {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .list:focus-visible .active {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>
