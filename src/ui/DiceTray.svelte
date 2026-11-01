<script lang="ts">
  import { natD20, roll, rollLog, rollMode, rollViewer, rollVisibility, shownRolls } from '../lib/rolls.svelte.ts';
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

<button bind:this={toggle} class="fab" aria-expanded={open} aria-controls="dice-tray" onclick={() => (open = !open)}>
  <span class="glyph" aria-hidden="true">d20</span> Dice
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
        <button type="button" class="num" onclick={() => go('d' + n, '1d' + n)}>d{n}</button>
      {/each}
    </div>

    <div class="row" role="group" aria-label="Advantage for the next roll">
      {#each MODES as [value, text]}
        <button type="button" aria-pressed={rollMode.value === value} onclick={() => (rollMode.value = value)}>{text}</button>
      {/each}
    </div>

    <label class="check"><input type="checkbox" bind:checked={rollVisibility[rollViewer.value]} /> Public roll{#if rollViewer.value === 'dm'} <span class="muted">(shared with players)</span>{/if}</label>

    <ol class="plain log" role="log" aria-label="Roll log">
      {#each shownRolls(rollLog, app.viewer) as r (r.id)}
        {@const nat = natD20(r.detail)}
        <li class:nat20={nat === 'nat20'} class:nat1={nat === 'nat1'}>
          <strong class="total num">{r.total}</strong>
          <span>
            {#if r.from}<span class="from">{r.from}: </span>{/if}{r.label}{#if nat === 'nat20'} <b>Natural 20!</b>{:else if nat === 'nat1'} <b>Natural 1</b>{/if}
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
  /*
   * Phones: bottom right, above the tab bar; hidden while a kit Workspace bottom sheet is open and unfolded,
   * lifted above it while folded. Desktop: at the right end of the sticky top bar, out of the way of the right panel.
   */
  .fab {
    position: fixed;
    right: 1rem;
    bottom: calc(var(--bottombar-h) + 0.75rem);
    z-index: 20;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    background: var(--panel);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
  }

  .fab[aria-expanded='true'] {
    background: var(--accent);
    color: var(--on-accent);
  }

  .glyph {
    font-family: var(--mono);
    font-size: 0.75em;
    padding: 0 0.25rem;
    border: 1px solid currentColor;
    border-radius: 3px;
  }

  .tray {
    position: fixed;
    right: 1rem;
    bottom: calc(var(--bottombar-h) + 4.25rem);
    z-index: 20;
    width: min(22rem, calc(100vw - 2rem));
    max-height: calc(100dvh - var(--bottombar-h) - 6rem);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 0.75rem 0.9rem;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    box-shadow: 0 10px 24px rgb(0 0 0 / 0.5);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  @media (max-width: 767px) {
    :global(body:has(.ws-sheet-open:not(.folded))) .fab {
      display: none;
    }

    :global(body:has(.ws-sheet-open.folded)) .fab {
      bottom: calc(var(--bottombar-h) + 3.75rem);
    }
  }

  .grow {
    flex: 1 1 8rem;
    display: flex;
    flex-direction: column;
  }

  .grow .muted {
    font-size: 0.85rem;
  }

  .dice button {
    flex: 1 1 3rem;
    padding-inline: 0.3rem;
  }

  button[aria-pressed='true'] {
    background: var(--raised);
    border-color: var(--accent);
    color: var(--text-strong);
  }

  .error,
  .check {
    margin: 0;
  }

  .log {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0; /* the global .plain only covers ul */
  }

  .log li {
    display: flex;
    gap: 0.7rem;
    align-items: baseline;
    padding: 0.35rem 0.5rem;
    border-top: 1px solid var(--line);
    overflow-wrap: anywhere;
  }

  .from {
    font-weight: 600;
  }

  .total {
    color: var(--text-strong);
    font-size: 1.35rem;
    min-width: 2.2ch;
    text-align: right;
  }

  .nat20 {
    background: var(--raised);
    box-shadow: inset 2px 0 var(--accent);
  }

  .nat20 b {
    color: var(--accent);
  }

  .nat1 {
    box-shadow: inset 2px 0 var(--danger);
  }

  .nat1 b {
    color: var(--danger);
  }

  @media (min-width: 768px) {
    .fab {
      z-index: 15; /* above the sticky top bar (10) */
      top: calc((var(--topbar-h) - 2.25rem) / 2);
      bottom: auto;
      min-height: 2.25rem;
      padding-block: 0.15rem;
      box-shadow: none;
    }

    .tray {
      top: calc(var(--topbar-h) + 0.5rem);
      bottom: auto;
      max-height: calc(100dvh - var(--topbar-h) - 1rem);
    }
  }
</style>
