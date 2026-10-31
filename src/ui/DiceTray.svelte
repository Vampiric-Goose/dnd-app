<script lang="ts">
  import { natD20, roll, rollLog, rollMode, rollVisibility, shownRolls } from '../lib/rolls.svelte.ts';
  import { app } from '../lib/store.svelte.ts';

  const DICE = [4, 6, 8, 10, 12, 20, 100];
  const MODES = [['normal', 'Normal'], ['adv', 'Advantage'], ['dis', 'Disadvantage']] as const;

  let open = $state(false);
  let expr = $state('');
  let error = $state('');
  let toggle: HTMLButtonElement | undefined = $state();

  function go(label: string, e: string) {
    try {
      roll(label, e);
      error = '';
      return true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  function submit(ev: SubmitEvent) {
    ev.preventDefault();
    if (go(expr.trim(), expr)) expr = '';
  }

  function onkeydown(ev: KeyboardEvent) {
    if (open && ev.key === 'Escape') {
      open = false;
      toggle?.focus();
    }
  }
</script>

<svelte:window {onkeydown} />

<button bind:this={toggle} class="fab primary" aria-expanded={open} aria-controls="dice-tray" onclick={() => (open = !open)}>
  <span aria-hidden="true">🎲</span> Dice
</button>

{#if open}
  <section id="dice-tray" class="tray" aria-label="Dice tray">
    <form class="row" onsubmit={submit}>
      <label class="grow">
        <span class="muted">Expression</span>
        <input bind:value={expr} placeholder="2d6+3" autocomplete="off" spellcheck="false" aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'dice-error' : undefined} />
      </label>
      <button class="primary" type="submit">Roll</button>
    </form>
    {#if error}<p id="dice-error" role="alert" class="error">{error}</p>{/if}

    <div class="row dice" role="group" aria-label="Quick dice">
      {#each DICE as n}
        <button type="button" onclick={() => go('d' + n, '1d' + n)}>d{n}</button>
      {/each}
    </div>

    <div class="row" role="group" aria-label="Advantage for the next roll">
      {#each MODES as [value, text]}
        <button type="button" aria-pressed={rollMode.value === value} onclick={() => (rollMode.value = value)}>{text}</button>
      {/each}
    </div>

    <label class="check"><input type="checkbox" bind:checked={rollVisibility.public} /> Public roll</label>

    <ol class="plain log" role="log" aria-label="Roll log">
      {#each shownRolls(rollLog, app.viewer) as r (r.id)}
        {@const nat = natD20(r.detail)}
        <li class:nat20={nat === 'nat20'} class:nat1={nat === 'nat1'}>
          <strong class="total">{r.total}</strong>
          <span>
            {r.label}{#if nat === 'nat20'} <b>Natural 20!</b>{:else if nat === 'nat1'} <b>Natural 1</b>{/if}
            {#if !r.public}<span class="muted">(private)</span>{/if}
            <br /><small class="muted">{r.label === r.expr ? "" : r.expr + ": "}{r.detail}</small>
          </span>
        </li>
      {:else}
        <li class="muted">No rolls yet.</li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .fab {
    position: fixed;
    right: 1rem;
    bottom: 4.5rem; /* clear the fixed bottom tab bar */
    z-index: 20;
    border-radius: 2rem;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
  }

  .tray {
    position: fixed;
    right: 1rem;
    bottom: 8rem;
    z-index: 20;
    width: min(22rem, calc(100vw - 2rem));
    max-height: calc(100vh - 10rem);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 0.75rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.35);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .grow {
    flex: 1 1 8rem;
    display: flex;
    flex-direction: column;
  }

  .dice button {
    flex: 1 1 3rem;
  }

  button[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .error,
  .check {
    margin: 0;
  }

  .log {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .log li {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    overflow-wrap: anywhere;
  }

  .total {
    font-size: 1.4rem;
    min-width: 2.2ch;
    text-align: right;
  }

  .nat20 {
    border-color: var(--accent);
    border-width: 2px;
    background: color-mix(in srgb, var(--accent) 18%, var(--surface));
  }

  .nat1 {
    border: 2px dashed #b3261e;
  }

  @media (prefers-color-scheme: dark) {
    .nat1 {
      border-color: #f2938c;
    }
  }

  @media (min-width: 768px) {
    .fab {
      bottom: 1rem;
    }

    .tray {
      bottom: 4.5rem;
      max-height: calc(100vh - 6rem);
    }
  }
</style>
