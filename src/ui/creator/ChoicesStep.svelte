<script lang="ts">
  import { answerChoice, embedContent, listChoices, takenElsewhere, type Problem } from '../../lib/character/build.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import type { CampaignSettings, Character, Sheet } from '../../lib/types.ts';
  import ChoiceInput from './ChoiceInput.svelte';

  // Every pending choice, grouped by level. listChoices re-runs after each answer, so whatever an answer
  // picks (a subclass, an option, a feat...) shows its own choices underneath, however deep they nest.
  // `fromLevel` (level-up) hides answered choices below that level; `hidden` (Choices to make) hides the ones answered before the page
  // opened, so a choice stays in view while it is being answered.
  let { c = $bindable(), index, settings, sheet, problems, fromLevel = 0, hidden }: {
    c: Character; index: ContentIndex; settings: CampaignSettings; sheet: Sheet; problems: Problem[]; fromLevel?: number; hidden?: Set<string>;
  } = $props();

  const racial = (sourceId: string) => [c.build.raceId, c.build.subraceId].includes(sourceId.split('/')[0]);
  const all = $derived(listChoices(c, index, settings));
  const taken = $derived(takenElsewhere(embedContent(c, index), all, settings)); // proficiencies already had, offered nowhere else
  const groups = $derived.by(() => {
    const out = new Map<number, ReturnType<typeof listChoices>>();
    for (const p of all) {
      if (c.build.customOrigin && p.choice.type === 'ability' && racial(p.sourceId)) continue; // R24: the custom origin replaces these
      if (p.level < fromLevel && p.answer) continue;
      if (hidden?.has(p.key)) continue;
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
      <ChoiceInput pending={p} {c} {index} {settings} {sheet} taken={taken.get(p.key)} problem={problems.find((x) => x.key === p.key)}
        onanswer={(a) => (c = answerChoice(c, p.key, a))} />
    {/each}
  </section>
{/each}

<style>
  /* Each level is its own band: a rule and an accent caption, so choices from different levels never run together. */
  .level {
    margin-top: 1.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line-strong);
  }

  .level:first-of-type {
    margin-top: 0.5rem;
  }

  h3 {
    margin: 0 0 0.25rem;
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }
</style>
