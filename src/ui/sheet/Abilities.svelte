<script lang="ts">
  import { ABILITIES, SKILL_ABILITY } from '../../lib/rules/constants.ts';
  import type { OverrideKey, Sheet, Skill } from '../../lib/types.ts';
  import { ABILITY_NAMES, signed, titleCase } from '../creator/labels.ts';
  import OverrideNumber from './OverrideNumber.svelte';
  import { rollD20 } from './roll.ts';

  // The "Skills & saves" drawer. Scores and ability checks are in the sheet's ability row.
  let { sheet, onset }: { sheet: Sheet; onset: (key: OverrideKey, value: number | undefined) => void } = $props();

  const skills = (Object.keys(SKILL_ABILITY) as Skill[]).sort((a, b) => a.localeCompare(b));
  const has = (k: OverrideKey) => sheet.overridden.includes(k);
</script>

<h3 class="cap">Saving throws</h3>
<ul class="plain grid saves">
  {#each ABILITIES as a (a)}
    {@const prof = sheet.saves[a].proficient}
    <li>
      <span class="name">
        <span aria-hidden="true" class="pip" class:on={prof}>{prof ? '●' : '○'}</span>
        {ABILITY_NAMES[a]}<span class="sr-only">{prof ? ', proficient' : ''}</span>
      </span>
      <OverrideNumber label="{ABILITY_NAMES[a]} save" okey={`save.${a}` as const} value={sheet.saves[a].bonus} overridden={has(`save.${a}`)} {onset}
        format={signed} onroll={() => rollD20(`${ABILITY_NAMES[a]} save`, sheet.saves[a].bonus)} />
    </li>
  {/each}
</ul>

<h3 class="cap">Skills</h3>
<ul class="plain grid skills">
  {#each skills as s (s)}
    {@const k = sheet.skills[s]}
    <li>
      <span class="name">
        <span aria-hidden="true" class="pip" class:on={k.proficient}>{k.expertise ? '◆' : k.proficient ? '●' : '○'}</span>
        {titleCase(s)}<span class="sr-only">{k.expertise ? ', expertise' : k.proficient ? ', proficient' : ''}</span>
        <span class="ab" aria-hidden="true">{SKILL_ABILITY[s]}</span>
      </span>
      <OverrideNumber label={titleCase(s)} okey={`skill.${s}` as const} value={k.bonus} overridden={has(`skill.${s}`)} {onset}
        format={signed} onroll={() => rollD20(`${titleCase(s)} check`, k.bonus)} />
    </li>
  {/each}
</ul>
<p class="muted legend"><span aria-hidden="true">● proficient · ◆ expertise</span></p>

<style>
  .cap {
    margin: 0.4rem 0 0.3rem;
    color: var(--label);
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .skills {
    margin-bottom: 0.25rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 13.5rem), 1fr));
    column-gap: 1.5rem;
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.15rem 0;
    border-bottom: 1px solid var(--line);
    --ov-size: 0.95rem;
  }

  .name {
    min-width: 0;
  }

  .pip {
    color: var(--muted);
    margin-right: 0.15rem;
  }

  .pip.on {
    color: var(--accent);
  }

  .ab {
    margin-left: 0.2rem;
    color: var(--label);
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .legend {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
  }
</style>
