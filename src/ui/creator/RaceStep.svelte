<script lang="ts">
  import type { ContentIndex } from '../../lib/content/index.ts';
  import type { Character } from '../../lib/types.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import FilterSelect from '../FilterSelect.svelte';
  import VersionToggle from '../VersionToggle.svelte';
  import { byName, entityOption, versions } from './labels.ts';

  let { c = $bindable(), index }: { c: Character; index: ContentIndex } = $props();

  // One option per race name; a book's own version of it is picked with the ruleset toggle.
  const groups = $derived(versions(index.all('race')));
  const race = $derived(index.resolve(c.build.raceId));
  const group = $derived(race ? groups.find((g) => g.some((r) => r.id === race.id)) : undefined);
  const options = $derived(groups.map((g) => ({ value: g.find((r) => r.id === race?.id)?.id ?? g[0].id, label: g[0].name })));
  const subraces = $derived(race ? index.all('subrace').filter((s) => index.resolve(s.raceId)?.id === race.id).sort(byName) : []);
  const subrace = $derived(c.build.subraceId ? index.resolve(c.build.subraceId) : undefined);

  function setRace(id: string) {
    c.build.raceId = id;
    delete c.build.subraceId;
  }
</script>

<FilterSelect id="race" label="Race" {options} value={race?.id ?? c.build.raceId} onchange={setRace} />
{#if race && group && group.length > 1}
  <VersionToggle versions={group} value={race.id} label={(s) => index.label(s)} onchange={(id) => id !== race.id && setRace(id)} />
{/if}
{#if subraces.length}
  <FilterSelect id="subrace" label="Subrace" options={subraces.map(entityOption)} value={subrace?.id ?? c.build.subraceId ?? ''}
    onchange={(id) => (id ? (c.build.subraceId = id) : delete c.build.subraceId)} />
{/if}

<!-- EntityDetail shows traits or text, not both (N12). -->
{#if race}<div class="detail"><EntityDetail entity={race} {index} /></div>{/if}
{#if subrace}<div class="detail"><EntityDetail entity={subrace} {index} /></div>{/if}

<style>
  /* The picked entry: a hairline-ruled block, not a boxed card. */
  .detail {
    margin: 0.75rem 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line);
  }
</style>
