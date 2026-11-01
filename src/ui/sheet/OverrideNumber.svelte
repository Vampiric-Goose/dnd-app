<script lang="ts">
  import { getContext, tick } from 'svelte';
  import type { OverrideKey } from '../../lib/types.ts';

  // A computed number, optionally a roll button. In the sheet's Edit mode (DM only, R46) it becomes an inline number
  // input that writes c.overrides[okey], and an overridden value gets a Reset. Outside Edit mode an overridden value
  // only shows the ✎ badge.
  let { label, okey, value, overridden, onset, onroll, format = String }: {
    label: string;
    okey: OverrideKey;
    value: number;
    overridden: boolean;
    onset: (key: OverrideKey, value: number | undefined) => void;
    onroll?: () => void;
    format?: (n: number) => string;
  } = $props();

  const editing = getContext<(() => boolean) | undefined>('sheet-edit') ?? (() => false);
  let input: HTMLInputElement | undefined = $state();

  // Enter or leaving the field commits. Anything that isn't a whole number puts the shown value back.
  function commit(e: Event & { currentTarget: HTMLInputElement }) {
    const n = e.currentTarget.valueAsNumber;
    if (Number.isInteger(n) && n !== value) onset(okey, n);
    else e.currentTarget.value = String(value);
  }

  // The Reset button disappears with the override, so focus goes back to the field.
  async function reset() {
    onset(okey, undefined);
    await tick();
    input?.focus();
  }
</script>

<span class="ov">
  {#if editing()}
    <label>
      <span class="sr-only">{label}</span>
      <input bind:this={input} type="number" step="1" inputmode="numeric" class:over={overridden} value={value} onchange={commit} />
    </label>
  {:else if onroll}
    <button type="button" class="num" class:over={overridden} onclick={onroll} aria-label="Roll {label}, {format(value)}">{format(value)}</button>
  {:else}
    <strong class="val" class:over={overridden}>{format(value)}</strong>
  {/if}
  {#if overridden}
    <span class="badge" title="This value is overridden"><span aria-hidden="true">✎</span><span class="sr-only">{label} is overridden</span></span>
    {#if editing()}
      <button type="button" class="mini" aria-label="Reset {label} to its computed value" onclick={reset}>Reset</button>
    {/if}
  {/if}
</span>

<style>
  /* The value's size comes from the parent (--ov-size): header stats are large, skill rows small. */
  .ov {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--ov-size, 1rem);
  }

  .val,
  .num,
  input {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--text-strong);
  }

  .val {
    line-height: 1.2;
  }

  /* A roll button reads as the number itself, with a hairline box that lights up on hover. */
  .num {
    min-width: 2.6em;
    min-height: 0;
    padding: 0.1em 0.4em;
    font-size: 1em;
    line-height: 1.25;
  }

  .over {
    color: var(--accent);
  }

  .badge {
    padding: 0 0.3rem;
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--accent);
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .mini {
    min-height: 1.9rem;
    padding: 0.1rem 0.5rem;
    font-size: 0.8rem;
  }

  input {
    width: 4.5em;
    min-height: 0;
    padding: 0.1em 0.35em;
    font-size: 1em;
  }

  @media (max-width: 767px) {
    .num,
    input,
    .mini {
      min-height: 44px;
    }
  }
</style>
