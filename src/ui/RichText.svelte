<script lang="ts">
  import { parseInline } from '../lib/content/richtext.ts';
  import type { Block, RichText } from '../lib/types.ts';

  // Callers pass already-redacted text; redaction markers are not interpreted here.
  let { text }: { text: RichText } = $props();
</script>

{#snippet inline(s: string)}
  {#each parseInline(s) as m}
    {#if m.b && m.i}<strong><em>{m.t}</em></strong>{:else if m.b}<strong>{m.t}</strong>{:else if m.i}<em>{m.t}</em>{:else}{m.t}{/if}
  {/each}
{/snippet}

{#snippet blocks(bs: Block[])}
  {#each bs as b}
    {#if 'p' in b}
      <p>{@render inline(b.p)}</p>
    {:else if 'list' in b}
      <ul>{#each b.list as li}<li>{@render inline(li)}</li>{/each}</ul>
    {:else if 'table' in b}
      <div class="scroll">
        <table>
          {#if b.table.caption}<caption>{@render inline(b.table.caption)}</caption>{/if}
          <thead><tr>{#each b.table.head as c}<th scope="col">{@render inline(c)}</th>{/each}</tr></thead>
          <tbody>{#each b.table.rows as row}<tr>{#each row as c}<td>{@render inline(c)}</td>{/each}</tr>{/each}</tbody>
        </table>
      </div>
    {:else}
      <h4>{@render inline(b.h)}</h4>
      {@render blocks(b.blocks)}
    {/if}
  {/each}
{/snippet}

{@render blocks(text)}

<style>
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; margin: 0.5rem 0; }
  th, td { padding: 0.25em 0.5em; text-align: left; }
</style>
