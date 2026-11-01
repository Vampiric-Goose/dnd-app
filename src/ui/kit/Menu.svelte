<!--
  Menu: a pull-down. A trigger button opens a floating list in the top layer (native popover, so a scrolling
  panel never clips it; Escape and an outside click close it natively). Arrow keys, Home and End move between
  items; picking an item runs `onselect` and closes (unless `keepOpen`), returning focus to the trigger.
  Items may show a monospace count and a checkmark (`checked`: role="menuitemcheckbox"). Extra content
  (such as a search box) goes in the `children` snippet, which gets a `close` function. See README.md.
-->
<script lang="ts" module>
  export type MenuItem =
    | {
        label: string;
        onselect: () => void;
        /** shown right-aligned in monospace ("Rare 88") */
        count?: number;
        /** defined = a checkable item; true shows the checkmark */
        checked?: boolean;
        danger?: boolean;
        disabled?: boolean;
        /** keep the menu open after picking (multi-select filters) */
        keepOpen?: boolean;
      }
    | { separator: true };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    ariaLabel,
    items = [],
    children,
    active = false,
    primary = false,
    caret = true,
    align = 'start',
    disabled = false,
  }: {
    /** the trigger's text ("+ Add", "⋯", "Rare") */
    label: string;
    /** the trigger's accessible name when the text is a glyph ("More actions" for "⋯") */
    ariaLabel?: string;
    items?: MenuItem[];
    children?: Snippet<[close: () => void]>;
    /** accent trigger: a filter that is set */
    active?: boolean;
    primary?: boolean;
    caret?: boolean;
    align?: 'start' | 'end';
    disabled?: boolean;
  } = $props();

  const uid = $props.id();
  let btn: HTMLButtonElement | undefined = $state();
  let pop: HTMLDivElement | undefined = $state();
  let isOpen = $state(false);
  let refocus = false;
  const checkable = $derived(items.some((it) => 'label' in it && it.checked !== undefined));

  const close = () => pop?.hidePopover();

  function place() {
    if (!btn || !pop) return;
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(8, Math.min(align === 'end' ? r.right - w : r.left, innerWidth - w - 8));
    let top = r.bottom + 4;
    if (top + h > innerHeight - 8 && r.top - h - 4 > 8) top = r.top - h - 4;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  const entries = () => [...(pop?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];

  function ontoggle(e: Event) {
    isOpen = (e as ToggleEvent).newState === 'open';
    if (isOpen) {
      place();
      (entries()[0] ?? pop?.querySelector<HTMLElement>('input, button, select, textarea'))?.focus();
    } else if (refocus) {
      refocus = false;
      btn?.focus();
    }
  }

  $effect(() => {
    if (!isOpen) return;
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    return () => {
      removeEventListener('scroll', place, true);
      removeEventListener('resize', place);
    };
  });

  // Listeners added here rather than as attributes: the popover is a plain container (the list inside is the menu).
  $effect(() => {
    const el = pop;
    if (!el) return;
    el.addEventListener('keydown', onkeydown);
    el.addEventListener('focusout', onfocusout);
    return () => {
      el.removeEventListener('keydown', onkeydown);
      el.removeEventListener('focusout', onfocusout);
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') refocus = true; // the popover closes itself
    const t = e.target as HTMLElement;
    if (!t.getAttribute('role')?.startsWith('menuitem')) return;
    const list = entries();
    const i = list.indexOf(t);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (next === undefined || !list.length) return;
    e.preventDefault();
    list[(next + list.length) % list.length].focus();
  }

  function onfocusout(e: FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (isOpen && to && !pop?.contains(to) && to !== btn) close();
  }

  function pick(it: Extract<MenuItem, { label: string }>) {
    it.onselect();
    if (!it.keepOpen) {
      refocus = true;
      close();
    }
  }
</script>

<button
  bind:this={btn}
  type="button"
  class="trigger"
  class:active
  class:primary
  popovertarget="{uid}-menu"
  aria-haspopup={children ? 'dialog' : 'menu'}
  aria-expanded={isOpen}
  aria-label={ariaLabel}
  {disabled}
>
  {label}{#if caret}<span class="caret" aria-hidden="true">▾</span>{/if}
</button>
<div bind:this={pop} id="{uid}-menu" class="pop" popover="auto" {ontoggle}>
  {#if items.length}
    <div role="menu" aria-label={ariaLabel ?? label} class:checkable>
      {#each items as it, i (i)}
        {#if 'separator' in it}
          <div role="separator" class="sep"></div>
        {:else}
          <button
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            tabindex="-1"
            class:danger={it.danger}
            class:on={it.checked}
            disabled={it.disabled}
            onclick={() => pick(it)}
          >
            {#if checkable}<span class="tick" aria-hidden="true">{it.checked ? '✓' : ''}</span>{/if}
            <span class="lbl">{it.label}</span>
            {#if it.count !== undefined}<span class="count num">{it.count}</span>{/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
  {#if children}<div class="extra">{@render children(close)}</div>{/if}
</div>

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }

  .trigger.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .trigger[aria-expanded='true'] {
    border-color: var(--accent);
  }

  .caret {
    font-size: 0.75em;
    opacity: 0.8;
  }

  .pop {
    position: fixed;
    inset: auto;
    margin: 0;
    min-width: 11rem;
    max-width: min(22rem, calc(100vw - 16px));
    max-height: min(24rem, calc(100dvh - 16px));
    overflow-y: auto;
    box-sizing: border-box;
    padding: 0.3rem;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    box-shadow: 0 10px 24px rgb(0 0 0 / 0.5);
  }

  [role='menu'] {
    display: flex;
    flex-direction: column;
  }

  [role^='menuitem'] {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.1rem;
    padding: 0.25rem 0.5rem;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    text-align: left;
  }

  [role^='menuitem']:hover:not(:disabled),
  [role^='menuitem']:focus-visible {
    background: var(--raised);
    border-color: transparent;
    outline: none;
  }

  [role^='menuitem']:focus-visible {
    box-shadow: inset 2px 0 var(--accent);
  }

  [role^='menuitem'].on {
    color: var(--accent);
  }

  [role^='menuitem'].danger {
    color: var(--danger);
  }

  .tick {
    flex: none;
    width: 1em;
    color: var(--accent);
  }

  .lbl {
    flex: 1;
    min-width: 0;
  }

  .count {
    color: var(--muted);
    font-size: 0.9em;
  }

  .sep {
    height: 1px;
    margin: 0.3rem 0.2rem;
    background: var(--line);
  }

  .extra {
    padding: 0.3rem;
  }

  [role='menu'] + .extra {
    border-top: 1px solid var(--line);
    margin-top: 0.3rem;
  }

  @media (max-width: 767px) {
    [role^='menuitem'] {
      min-height: 44px;
    }
  }
</style>
