<script lang="ts">
  import { fold } from '../lib/content/ids.ts';

  // A plain <select>. Past CAP options it adds a search box and lists only the first CAP matches,
  // so a long list (imported feats, backgrounds, items) never renders thousands of <option>s.
  const CAP = 100;
  let { id, label, options, value, onchange, placeholder = 'Choose…' }: {
    id: string;
    label: string;
    options: { value: string; label: string }[];
    value: string;
    onchange: (value: string) => void;
    placeholder?: string;
  } = $props();

  let q = $state('');
  const shown = $derived.by(() => {
    if (options.length <= CAP) return options;
    const n = fold(q.trim());
    const hits = options.filter((o) => fold(o.label).includes(n)).slice(0, CAP);
    const current = options.find((o) => o.value === value);
    return current && !hits.includes(current) ? [current, ...hits] : hits;
  });
</script>

<div class="field">
  <label for={id}>{label}</label>
  {#if options.length > CAP}
    <input type="search" aria-label="Search {label}" placeholder="Search {options.length}…" bind:value={q} />
  {/if}
  <select {id} {value} onchange={(e) => onchange(e.currentTarget.value)}>
    <option value="">{placeholder}</option>
    {#each shown as o (o.value)}
      <option value={o.value}>{o.label}</option>
    {/each}
  </select>
</div>
