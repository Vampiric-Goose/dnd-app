<script lang="ts">
  // The scene's tokens as a list (the panel's Tokens tab): the keyboard and screen-reader way to pick them (the canvas is pointer-only).
  // A row selects its token; Shift or Ctrl adds it to the selection. The Selected tab edits what is picked.
  import type { Token } from '../../lib/types.ts';

  let { tokens, selected, onselect }: {
    tokens: (Token & { conditions?: string[] })[]; selected: string[]; onselect: (ids: string[]) => void;
  } = $props();

  const pick = (id: string, e: MouseEvent) =>
    onselect(e.shiftKey || e.ctrlKey || e.metaKey ? (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]) : [id]);
</script>

{#if !tokens.length}<p class="muted">No tokens yet.</p>{/if}
<ul class="plain list" aria-label="Tokens">
  {#each tokens as t (t.id)}
    <li>
      <button type="button" class:on={selected.includes(t.id)} aria-pressed={selected.includes(t.id)} onclick={(e) => pick(t.id, e)}>
        <span class="dot" style:background={t.color} aria-hidden="true"></span>
        <span class="name"><span class="sr-only">Select </span>{t.name}</span>
        {#if t.hidden}<span class="tag">hidden</span>{/if}
        {#if t.hp !== undefined}<span class="num hp">{t.hp}{#if t.maxHp}<span class="muted">&nbsp;/ {t.maxHp}</span>{/if}</span>{/if}
      </button>
    </li>
  {/each}
</ul>

<style>
  .list {
    margin: 0 -1rem; /* rows run to the panel edges, as selected rows do everywhere */
  }

  .list li + li {
    border-top: 1px solid var(--line);
  }

  button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 0.45rem 1rem;
    text-align: left;
  }

  /* the pressed state uses the selected-row style, not the global pressed-button one */
  button.on,
  button[aria-pressed='true'] {
    background: var(--raised);
    box-shadow: inset 2px 0 var(--accent);
    color: var(--text-strong);
    border: 0;
  }

  .dot {
    flex: none;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .hp {
    color: var(--text-strong);
  }
</style>
