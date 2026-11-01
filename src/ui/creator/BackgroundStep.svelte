<script lang="ts">
  import type { ContentIndex } from '../../lib/content/index.ts';
  import type { Character } from '../../lib/types.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import FilterSelect from '../FilterSelect.svelte';
  import { byName, entityOption } from './labels.ts';

  let { c = $bindable(), index }: { c: Character; index: ContentIndex } = $props();

  const backgrounds = $derived(index.all('background').sort(byName));
  const bg = $derived(index.resolve(c.build.backgroundId));
</script>

<FilterSelect id="background" label="Background" options={backgrounds.map(entityOption)} value={bg?.id ?? c.build.backgroundId} onchange={(id) => (c.build.backgroundId = id)} />
<!-- EntityDetail shows the feature or the text, not both (N12). -->
{#if bg}<div class="detail"><EntityDetail entity={bg} {index} /></div>{/if}

<style>
  /* The picked entry: a hairline-ruled block, not a boxed card. */
  .detail {
    margin: 0.75rem 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line);
  }
</style>
