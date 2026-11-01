<!--
  Pill: a small label. With `onremove` it is a removable filter pill ("Rare ✕", a button named "Remove Rare");
  without it, a static chip (conditions, sizes). `accent` = teal outline (an active or notable chip). See README.md.
-->
<script lang="ts">
  let {
    label,
    onremove,
    accent = false,
  }: {
    label: string;
    onremove?: () => void;
    accent?: boolean;
  } = $props();
</script>

{#if onremove}
  <button type="button" class="pill remove" aria-label="Remove {label}" onclick={onremove}>{label}<span aria-hidden="true">✕</span></button>
{:else}
  <span class="pill" class:accent>{label}</span>
{/if}

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.05rem 0.55rem;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    color: var(--text);
    font-size: 0.8rem;
    line-height: 1.5;
    white-space: nowrap;
  }

  .accent {
    border-color: var(--accent);
    color: var(--accent);
  }

  .remove {
    position: relative;
    min-height: 0;
    border-color: transparent;
    background: var(--raised);
    color: color-mix(in srgb, var(--accent) 45%, var(--text-strong));
  }

  .remove span {
    font-size: 0.85em;
    opacity: 0.75;
  }

  .remove:hover:not(:disabled) {
    border-color: var(--accent);
  }

  /* Phones: a 44 px tall hit area without a 44 px tall pill */
  @media (max-width: 767px) {
    .remove {
      min-height: 0;
    }

    .remove::before {
      content: '';
      position: absolute;
      inset: -0.6rem 0;
    }
  }
</style>
