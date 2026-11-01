<script lang="ts">
  import { setAt, spellList } from '../../lib/character/play.ts';
  import type { Character, OverrideKey, Sheet } from '../../lib/types.ts';
  import { ABILITY_NAMES, signed, titleCase } from '../creator/labels.ts';
  import Pill from '../kit/Pill.svelte';
  import RichText from '../RichText.svelte';
  import OverrideNumber from './OverrideNumber.svelte';
  import Pips from './Pips.svelte';
  import { rollD20 } from './roll.ts';

  let { c, sheet, patch, onset }: {
    c: Character;
    sheet: Sheet;
    patch: (s: Partial<Character['state']>) => void;
    onset: (key: OverrideKey, value: number | undefined) => void;
  } = $props();

  const has = (k: OverrideKey) => sheet.overridden.includes(k);
  const ordinal = (n: number) => ['Cantrip', '1st', '2nd', '3rd'][n] ?? `${n}th`;
  const levelName = (n: number) => (n === 0 ? 'Cantrips' : `${ordinal(n)} level`);
  const parts = (s: { v?: boolean; s?: boolean; m?: string }) => [s.v && 'V', s.s && 'S', s.m && `M (${s.m})`].filter(Boolean).join(', ');
</script>

<!-- The "Spells" drawer: slots first (touched every fight), then each casting class's list. -->
{#if sheet.slots.some((n) => n > 0) || sheet.pact}
  <h3 class="cap">Spell slots</h3>
  <ul class="plain">
    {#each sheet.slots as total, i (i)}
      {#if total > 0}
        <li class="slot">
          <span>{ordinal(i + 1)} level</span>
          <Pips {total} used={Math.min(total, c.state.slotsUsed[i] ?? 0)} label="{ordinal(i + 1)}-level slot" onchange={(n) => patch({ slotsUsed: setAt(c.state.slotsUsed, i, n) })} />
        </li>
      {/if}
    {/each}
    {#if sheet.pact}
      <li class="slot">
        <span>Pact magic ({ordinal(sheet.pact.level)} level)</span>
        <Pips total={sheet.pact.slots} used={Math.min(sheet.pact.slots, c.state.pactSlotsUsed)} label="Pact slot" onchange={(n) => patch({ pactSlotsUsed: n })} />
      </li>
    {/if}
  </ul>
{/if}

{#each sheet.spellcasting as sc (sc.classId)}
  {@const list = spellList(c, sc.classId)}
  {@const levels = [...new Set(list.map((x) => x.spell.level))]}
  <section class="caster">
    <h3>{c.embedded[sc.classId]?.name ?? 'Spellcasting'} <span class="muted">({ABILITY_NAMES[sc.ability]})</span></h3>
    <p class="nums">
      <span class="n"><span class="k">Save DC</span> <OverrideNumber label="Spell save DC" okey="spellDc" value={sc.dc} overridden={has('spellDc')} {onset} /></span>
      <span class="n"><span class="k">Attack</span> <OverrideNumber label="Spell attack" okey="spellAttack" value={sc.attack} overridden={has('spellAttack')} {onset} format={signed} onroll={() => rollD20('Spell attack', sc.attack)} /></span>
    </p>
    <p class="muted small">
      Cantrips {sc.cantrips}{sc.known !== undefined ? `, spells known ${sc.known}` : ''}{sc.prepared !== undefined ? `, prepared ${sc.prepared}` : ''}, up to level {sc.maxLevel}
    </p>
    {#each levels as lv (lv)}
      <h4 class="cap">{levelName(lv)}</h4>
      <ul class="plain spells">
        {#each list.filter((x) => x.spell.level === lv) as { spell, prepared, always } (spell.id)}
          <li>
            <details>
              <summary>
                {spell.name}
                {#if always}<Pill label="always prepared" accent />{:else if prepared && lv > 0}<Pill label="prepared" accent />{/if}
                {#if spell.concentration}<Pill label="concentration" />{/if}
                {#if spell.ritual}<Pill label="ritual" />{/if}
              </summary>
              <div class="text">
                <p class="muted small">{titleCase(spell.school)} · {spell.castingTime} · {spell.range} · {parts(spell.components)} · {spell.duration}</p>
                <RichText text={spell.text} />
                {#if spell.higherLevels?.length}<RichText text={spell.higherLevels} />{/if}
              </div>
            </details>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No spells picked yet.</p>
    {/each}
  </section>
{/each}

<style>
  .cap {
    margin: 0.6rem 0 0.25rem;
    color: var(--label);
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .slot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--line);
  }

  .caster {
    margin-top: 0.9rem;
  }

  .caster h3 {
    margin: 0 0 0.3rem;
  }

  .nums {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.5rem;
    margin: 0;
    --ov-size: 1.1rem;
  }

  .n {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .k {
    color: var(--muted);
  }

  .spells li {
    border-bottom: 1px solid var(--line);
  }

  summary {
    padding: 0.3rem 0;
    color: var(--text-strong);
  }

  .text {
    padding: 0 0 0.5rem 1rem;
  }

  .small {
    font-size: 0.85rem;
  }

  @media (max-width: 767px) {
    summary {
      padding: 0.65rem 0;
    }
  }
</style>
