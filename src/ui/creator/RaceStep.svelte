<script lang="ts">
  import type { ContentIndex } from '../../lib/content/index.ts';
  import type { Character } from '../../lib/types.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import FilterSelect from '../FilterSelect.svelte';
  import { byName, entityOption } from './labels.ts';

  let { c = $bindable(), index }: { c: Character; index: ContentIndex } = $props();

  const races = $derived(index.all('race').sort(byName));
  const race = $derived(index.resolve(c.build.raceId));
  const subraces = $derived(race ? index.all('subrace').filter((s) => index.resolve(s.raceId)?.id === race.id).sort(byName) : []);
  const subrace = $derived(c.build.subraceId ? index.resolve(c.build.subraceId) : undefined);

  function setRace(id: string) {
    c.build.raceId = id;
    delete c.build.subraceId;
  }
</script>

<FilterSelect id="race" label="Race" options={races.map(entityOption)} value={race?.id ?? c.build.raceId} onchange={setRace} />
{#if subraces.length}
  <FilterSelect id="subrace" label="Subrace" options={subraces.map(entityOption)} value={subrace?.id ?? c.build.subraceId ?? ''}
    onchange={(id) => (id ? (c.build.subraceId = id) : delete c.build.subraceId)} />
{/if}

<!-- EntityDetail shows traits or text, not both (N12). -->
{#if race}<div class="card"><EntityDetail entity={race} {index} /></div>{/if}
{#if subrace}<div class="card"><EntityDetail entity={subrace} {index} /></div>{/if}
