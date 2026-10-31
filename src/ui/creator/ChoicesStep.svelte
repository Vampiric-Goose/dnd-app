<script lang="ts">
  import { answerChoice, listChoices, type Problem } from '../../lib/character/build.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import type { CampaignSettings, Character, Sheet } from '../../lib/types.ts';
  import ChoiceInput from './ChoiceInput.svelte';

  // Every pending choice, grouped by level. listChoices re-runs after each answer, so whatever an answer
  // picks (a subclass, an option, a feat...) shows its own choices underneath, however deep they nest.
  // `fromLevel` (level-up) hides answered choices below that level.
  let { c = $bindable(), index, settings, sheet, problems, fromLevel = 0 }: {
    c: Character; index: ContentIndex; settings: CampaignSettings; sheet: Sheet; problems: Problem[]; fromLevel?: number;
  } = $props();

  const racial = (sourceId: string) => [c.build.raceId, c.build.subraceId].includes(sourceId.split('/')[0]);
  const groups = $derived.by(() => {
    const out = new Map<number, ReturnType<typeof listChoices>>();
    for (const p of listChoices(c, index, settings)) {
      if (c.build.customOrigin && p.choice.type === 'ability' && racial(p.sourceId)) continue; // R24: the custom origin replaces these
      if (p.level < fromLevel && p.answer) continue;
      out.set(p.level, [...(out.get(p.level) ?? []), p]);
    }
    return [...out].sort((a, b) => a[0] - b[0]);
  });
</script>

{#if !groups.length}
  <p class="muted">{fromLevel ? 'No new choices.' : 'Nothing to choose yet. Pick a race, class and background first.'}</p>
{/if}
{#each groups as [level, list] (level)}
  <section class="level" aria-labelledby="lv-{level}">
    <h3 id="lv-{level}">{level === 0 ? 'Race and background' : `Level ${level}`}</h3>
    {#each list as p (p.key)}
      <ChoiceInput pending={p} {c} {index} {settings} {sheet} problem={problems.find((x) => x.key === p.key)}
        onanswer={(a) => (c = answerChoice(c, p.key, a))} />
    {/each}
  </section>
{/each}

<style>
  /* Each level is its own band: a thick rule and a heading, so choices from different levels never run together. */
  .level {
    margin-top: 2rem;
    padding-top: 0.5rem;
    border-top: 4px solid var(--accent);
  }

  .level:first-of-type {
    margin-top: 1rem;
  }

  h3 {
    margin: 0 0 0.25rem;
    color: var(--accent);
  }
</style>
