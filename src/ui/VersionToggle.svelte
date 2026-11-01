<script lang="ts">
  // One button per book that prints its own version of the same entry (e.g. Orc in two books): a segmented control.
  let { versions, value, label, onchange }: {
    versions: { id: string; source: string }[];
    value: string;
    label: (source: string) => string;
    onchange: (id: string) => void;
  } = $props();
</script>

<div class="seg" role="group" aria-label="Ruleset">
  {#each versions as v (v.id)}
    <button type="button" aria-pressed={v.id === value} onclick={() => onchange(v.id)}>{label(v.source)}</button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    margin: 0.25rem 0 0.5rem;
  }

  .seg button {
    border-radius: 0;
    margin-left: -1px;
  }

  .seg button:first-child {
    margin-left: 0;
    border-radius: var(--radius) 0 0 var(--radius);
  }

  .seg button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  /* the pressed one draws its accent border over its neighbours' */
  .seg button[aria-pressed='true'] {
    position: relative;
    color: var(--accent);
  }
</style>
