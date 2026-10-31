<script lang="ts">
  import { ABILITIES, SKILL_ABILITY } from '../../lib/rules/constants.ts';
  import type { OverrideKey, Sheet, Skill } from '../../lib/types.ts';
  import { ABILITY_NAMES, signed, titleCase } from '../creator/labels.ts';
  import OverrideNumber from './OverrideNumber.svelte';
  import { rollD20 } from './roll.ts';

  let { sheet, onset }: { sheet: Sheet; onset: (key: OverrideKey, value: number | undefined) => void } = $props();

  const skillsOf = (a: (typeof ABILITIES)[number]) => (Object.keys(SKILL_ABILITY) as Skill[]).filter((s) => SKILL_ABILITY[s] === a);
  const has = (k: OverrideKey) => sheet.overridden.includes(k);
</script>

<section aria-labelledby="abilities-h">
  <h2 id="abilities-h">Abilities, saves and skills</h2>
  <div class="grid">
    {#each ABILITIES as a (a)}
      <div class="card ability">
        <h3>{ABILITY_NAMES[a]}</h3>
        <dl>
          <div>
            <dt>Score</dt>
            <dd><OverrideNumber label="{ABILITY_NAMES[a]} score" okey={`score.${a}` as const} value={sheet.scores[a]} overridden={has(`score.${a}`)} {onset} /></dd>
          </div>
          <div>
            <dt>Check</dt>
            <dd><button type="button" class="num" aria-label="Roll {ABILITY_NAMES[a]} check, {signed(sheet.mods[a])}" onclick={() => rollD20(`${ABILITY_NAMES[a]} check`, sheet.mods[a])}>{signed(sheet.mods[a])}</button></dd>
          </div>
          <div>
            <dt>Save{sheet.saves[a].proficient ? ' (proficient)' : ''}</dt>
            <dd>
              <OverrideNumber label="{ABILITY_NAMES[a]} save" okey={`save.${a}` as const} value={sheet.saves[a].bonus} overridden={has(`save.${a}`)} {onset}
                format={signed} onroll={() => rollD20(`${ABILITY_NAMES[a]} save`, sheet.saves[a].bonus)} />
            </dd>
          </div>
        </dl>
        <ul class="plain skills">
          {#each skillsOf(a) as s (s)}
            {@const k = sheet.skills[s]}
            <li>
              <span class="name">
                <span aria-hidden="true" class="pip" class:on={k.proficient}>{k.expertise ? '◆' : k.proficient ? '●' : '○'}</span>
                {titleCase(s)}<span class="sr-only">{k.expertise ? ', expertise' : k.proficient ? ', proficient' : ''}</span>
              </span>
              <OverrideNumber label={titleCase(s)} okey={`skill.${s}` as const} value={k.bonus} overridden={has(`skill.${s}`)} {onset}
                format={signed} onroll={() => rollD20(`${titleCase(s)} check`, k.bonus)} />
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
</section>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
    gap: 0 0.75rem;
  }

  h3 {
    margin: 0 0 0.25rem;
  }

  dl {
    margin: 0;
  }

  dl div,
  .skills li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem;
    padding: 0.15rem 0;
  }

  dt,
  dd {
    margin: 0;
  }

  .skills {
    margin-top: 0.4rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--border);
  }

  .pip.on {
    color: var(--accent);
  }

  .num {
    min-width: 3rem;
    font-weight: 700;
  }
</style>
