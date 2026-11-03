<script lang="ts">
  // Reactions: a small card docked at the bottom edge (not modal: the map stays usable). One row per creature that may react, with its
  // options and Pass; a thin bar counts the auto-pass down. The DM's device and a player's device both render it; they differ only in the
  // rows they hand over and in what the buttons do.
  import type { ReactOption } from '../../lib/combat/reactions.ts';

  export interface Row { id: string; name: string; options: ReactOption[] }
  /** `ms`: time left when the card was built; `also`: reactors somebody else answers (the DM may still pass for them). */
  export interface Card { ask: string; trigger: string; ms: number; rows: Row[]; also?: { id: string; name: string }[] }

  let { cards, note, onanswer, onpass }: {
    cards: Card[];
    note?: string;
    onanswer: (ask: string, id: string, option: ReactOption) => void;
    /** No `id`: every row of the card. */
    onpass: (ask: string, id?: string) => void;
  } = $props();

  /** The bar starts when it appears and keeps its first duration, however many updates the card gets after. */
  const countdown = (el: HTMLElement, ms: number) => { el.style.animationDuration = `${ms}ms`; };
</script>

{#if cards.length || note}
  <div class="dock" role="region" aria-label="Reactions" aria-live="polite">
    {#each cards as c (c.ask)}
      <section class="card">
        <p class="trigger">{c.trigger}</p>
        {#each c.rows as r (r.id)}
          <div class="row">
            <strong>{r.name}</strong>
            {#each r.options as o (o.id + (o.slot ?? ''))}
              <button type="button" class="primary" onclick={() => onanswer(c.ask, r.id, o)}>{o.label}</button>
            {/each}
            <button type="button" onclick={() => onpass(c.ask, r.id)}>Pass</button>
          </div>
        {/each}
        {#if c.rows.length > 1}<button type="button" class="all" onclick={() => onpass(c.ask)}>Pass all</button>{/if}
        {#if c.also?.length}
          <p class="muted also">Waiting on reactions: {c.also.map((a) => a.name).join(', ')}…
            {#each c.also as a (a.id)}<button type="button" onclick={() => onpass(c.ask, a.id)}>Pass {a.name}</button>{/each}
          </p>
        {/if}
        <div class="bar" aria-hidden="true"><span use:countdown={c.ms}></span></div>
      </section>
    {/each}
    {#if note}<p class="muted note">{note}</p>{/if}
  </div>
{/if}

<style>
  .dock {
    position: fixed;
    left: 50%;
    bottom: calc(var(--bottombar-h) + 0.5rem);
    transform: translateX(-50%);
    z-index: 35; /* above the bottom sheet (25) and the Dice button (20), below toasts (40) */
    width: min(34rem, calc(100vw - 1rem));
    max-height: 50dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    box-sizing: border-box;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.5);
    padding: 0.4rem 0.6rem 0;
    overflow: hidden;
  }

  p {
    margin: 0;
  }

  .trigger {
    color: var(--text-strong);
    font-weight: 600;
  }

  .row,
  .also {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
    margin-top: 0.3rem;
  }

  .row button,
  .also button,
  .all {
    min-height: 2rem;
    padding: 0.15rem 0.6rem;
  }

  .all {
    margin-top: 0.3rem;
  }

  .note {
    align-self: center;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
  }

  .bar {
    height: 3px;
    margin: 0.4rem -0.6rem 0;
    background: var(--line);
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transform-origin: left;
    animation: drain linear forwards;
  }

  @keyframes drain {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar span { animation-timing-function: steps(10, end); }
  }
</style>
