<script lang="ts">
  import type { OverrideKey } from '../../lib/types.ts';

  // A computed number: optionally a roll button, with an edit control that writes c.overrides[okey].
  let { label, okey, value, overridden, onset, onroll, format = String }: {
    label: string;
    okey: OverrideKey;
    value: number;
    overridden: boolean;
    onset: (key: OverrideKey, value: number | undefined) => void;
    onroll?: () => void;
    format?: (n: number) => string;
  } = $props();

  let editing = $state(false);
  let draft: number | null = $state(null);
  let input: HTMLInputElement | undefined = $state();
  const valid = $derived(typeof draft === 'number' && Number.isInteger(draft));

  $effect(() => { if (editing) input?.focus(); });

  function start() {
    draft = value;
    editing = true;
  }

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    onset(okey, draft!);
    editing = false;
  }
</script>

<span class="ov">
  {#if editing}
    <form class="row" onsubmit={save}>
      <label>
        <span class="sr-only">Override {label}</span>
        <input bind:this={input} type="number" step="1" bind:value={draft} onkeydown={(e) => e.key === 'Escape' && (editing = false)} />
      </label>
      <button type="submit" class="primary mini" disabled={!valid}>Set</button>
      <button type="button" class="mini" onclick={() => (editing = false)}>Cancel</button>
    </form>
  {:else}
    {#if onroll}
      <button type="button" class="num" class:over={overridden} onclick={onroll} aria-label="Roll {label}, {format(value)}">{format(value)}</button>
    {:else}
      <strong class="val" class:over={overridden}>{format(value)}</strong>
    {/if}
    {#if overridden}
      <span class="badge" title="This value is overridden"><span aria-hidden="true">✎</span><span class="sr-only">{label} is overridden</span></span>
      <button type="button" class="mini" aria-label="Reset {label} to its computed value" onclick={() => onset(okey, undefined)}>Reset</button>
    {/if}
    <button type="button" class="mini edit" aria-label="Override {label}" onclick={start}>✎</button>
  {/if}
</span>

<style>
  .ov {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }

  .val {
    font-size: 1.1rem;
    padding: 0 0.3rem;
  }

  .num {
    min-width: 3rem;
    font-weight: 700;
  }

  .over {
    color: var(--accent);
  }

  .badge {
    padding: 0 0.35rem;
    border-radius: 0.35rem;
    background: var(--accent);
    color: var(--bg);
    font-size: 0.8rem;
  }

  .mini {
    min-height: 2rem;
    padding: 0.1rem 0.5rem;
    font-size: 0.85rem;
  }

  .edit {
    color: var(--muted);
  }

  input {
    width: 5rem;
    min-height: 2rem;
  }
</style>
