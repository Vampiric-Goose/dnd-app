<script lang="ts">
  import { dismissToast, toasts } from '../lib/toast.svelte.ts';

  let box: HTMLDivElement | undefined = $state();

  // Shown in the top layer, re-fronted on every change, so a message is visible above an open modal <dialog>.
  // Without popover support the container is just a fixed element (z-index below).
  $effect(() => {
    const n = toasts.length;
    if (!box?.showPopover) return;
    if (box.matches(':popover-open')) box.hidePopover();
    if (n) box.showPopover();
  });
</script>

<div class="toasts" popover="manual" bind:this={box}>
  {#each toasts as t (t.id)}
    <div class="toast" class:error={t.error} role={t.error ? 'alert' : 'status'}>
      <span>{t.text}</span>
      <button type="button" aria-label="Dismiss message" onclick={() => dismissToast(t.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    top: 0.5rem;
    left: 0.5rem;
    right: 0.5rem;
    z-index: 40;
    /* reset the popover defaults */
    inset: 0.5rem 0.5rem auto;
    width: auto;
    height: auto;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    overflow: visible;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    max-width: min(32rem, 100%);
    padding: 0.35rem 0.35rem 0.35rem 0.8rem;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent);
    border-radius: 5px;
    box-shadow: 0 10px 24px rgb(0 0 0 / 0.5);
    overflow-wrap: anywhere;
  }

  .toast.error {
    border-left-color: var(--danger);
    color: var(--text-strong);
  }

  button {
    flex: none;
    min-height: 2rem;
    padding: 0 0.6rem;
    border-color: transparent;
    color: var(--muted);
  }

  @media (max-width: 767px) {
    button {
      min-height: 44px;
      min-width: 44px;
    }
  }
</style>
