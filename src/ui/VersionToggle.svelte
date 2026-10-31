<script lang="ts">
  // One button per book that prints its own version of the same entry (e.g. Orc in two books).
  let { versions, value, label, onchange }: {
    versions: { id: string; source: string }[];
    value: string;
    label: (source: string) => string;
    onchange: (id: string) => void;
  } = $props();
</script>

<div class="row" role="group" aria-label="Ruleset">
  {#each versions as v (v.id)}
    <button type="button" aria-pressed={v.id === value} class:primary={v.id === value} onclick={() => onchange(v.id)}>{label(v.source)}</button>
  {/each}
</div>
