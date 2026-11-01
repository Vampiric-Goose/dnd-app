<!--
  Workspace: the page body as main column + optional right panel (spec "navigation · workspace · right panel").
  Desktop >= 1024 px: panel 320 px on the right, full height under the top bar, scrolls on its own.
  768-1023 px: a narrower 260 px panel. < 768 px: the panel is a bottom sheet, shown while `open` is true,
  with a handle (fold to a one-line bar) and, when `onclose` is given, a close button.
  The Workspace cancels the shell's page padding so the panel sits flush with the screen edge; `fill` makes it exactly
  one screen tall (no page scroll), for the map canvas. See README.md.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    panel,
    panelLabel = 'Details',
    open = false,
    onclose,
    fill = false,
  }: {
    children: Snippet;
    panel?: Snippet;
    /** aria-label of the panel region, also the sheet's title on phones */
    panelLabel?: string;
    /** phones only: show the bottom sheet (usually "something is selected"); the desktop panel is always shown */
    open?: boolean;
    /** phones only: adds a close button to the sheet */
    onclose?: () => void;
    fill?: boolean;
  } = $props();

  let folded = $state(false);
  // A new selection opens the sheet unfolded.
  $effect(() => {
    if (open) folded = false;
  });
</script>

<div class="ws" class:has-panel={panel} class:fill>
  <div class="ws-main">{@render children()}</div>
  {#if panel}
    <aside class="ws-panel" class:ws-sheet-open={open} class:folded aria-label={panelLabel}>
      <div class="sheet-bar">
        <button type="button" class="handle" aria-expanded={!folded} onclick={() => (folded = !folded)}>
          <span class="grip" aria-hidden="true"></span>
          <span class="sheet-title">{panelLabel}</span>
          <span class="sr-only">{folded ? 'Expand' : 'Fold'}</span>
        </button>
        {#if onclose}<button type="button" class="close" aria-label="Close {panelLabel}" onclick={onclose}>✕</button>{/if}
      </div>
      <div class="ws-panel-body">{@render panel()}</div>
    </aside>
  {/if}
</div>

<style>
  .ws {
    /* the shell's main pads pages by --page-pad (sides) and --page-pad-bottom; the workspace takes the full width instead */
    margin: 0 calc(-1 * var(--page-pad, 0px)) calc(-1 * var(--page-pad-bottom, 0px));
    min-height: calc(100dvh - var(--topbar-h) - var(--bottombar-h));
    min-width: 0;
  }

  .ws-main {
    padding: 0 var(--page-pad, 1rem) 5rem; /* phones: the floating Dice button must not cover the last controls */
    min-width: 0;
  }

  .fill {
    height: calc(100dvh - var(--topbar-h) - var(--bottombar-h) - var(--banner-h, 0px));
    min-height: 0;
  }

  .fill .ws-main {
    padding: 0;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .ws-panel {
    background: var(--panel);
    box-sizing: border-box;
    min-width: 0;
  }

  .ws-panel-body {
    padding: 0.75rem 1rem 1rem;
  }

  /* Phones: bottom sheet */
  @media (max-width: 767px) {
    .ws-panel {
      display: none;
      position: fixed;
      left: 0;
      right: 0;
      bottom: var(--bottombar-h);
      z-index: 25; /* above the page and the Dice button, below the bottom bar's More menu */
      max-height: 70dvh;
      overflow-y: auto;
      overscroll-behavior: contain;
      border-top: 1px solid var(--line-strong);
      border-radius: 10px 10px 0 0;
      box-shadow: 0 -12px 32px rgb(0 0 0 / 0.5);
      transition: transform 0.2s ease-out;
    }

    .ws-panel.ws-sheet-open {
      display: block;
      @starting-style {
        transform: translateY(100%);
      }
    }

    .folded .ws-panel-body {
      display: none;
    }

    .sheet-bar {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
    }

    .handle {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      border: 0;
      border-radius: 0;
      background: transparent;
      min-height: 3rem;
      text-align: left;
    }

    .grip {
      width: 2rem;
      height: 4px;
      border-radius: 2px;
      background: var(--line-strong);
    }

    .sheet-title {
      color: var(--label);
      font-size: 0.72rem;
      letter-spacing: 0.13em;
      text-transform: uppercase;
    }

    .close {
      border: 0;
      min-width: 3rem;
      min-height: 3rem;
      background: transparent;
      color: var(--muted);
    }

  }

  @media (min-width: 768px) {
    .ws.has-panel {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 260px;
      align-items: start;
    }

    .ws-main {
      padding-top: 0.25rem;
      padding-bottom: 1.5rem;
    }

    .fill .ws-main {
      padding: 0;
    }

    .ws-panel {
      position: sticky;
      top: var(--topbar-h);
      height: calc(100dvh - var(--topbar-h));
      overflow-y: auto;
      border-left: 1px solid var(--line);
    }

    .fill .ws-panel {
      height: 100%;
    }

    .sheet-bar {
      display: none;
    }
  }

  @media (min-width: 1024px) {
    .ws.has-panel {
      grid-template-columns: minmax(0, 1fr) 320px;
    }
  }
</style>
