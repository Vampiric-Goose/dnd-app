<script lang="ts">
  import { setAt, spellList } from '../../lib/character/play.ts';
  import type { Character, OverrideKey, Sheet } from '../../lib/types.ts';
  import { ABILITY_NAMES, signed, titleCase } from '../creator/labels.ts';
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

<section aria-labelledby="spells-h">
  <h2 id="spells-h">Spells</h2>

  {#if sheet.slots.some((n) => n > 0) || sheet.pact}
    <div class="card">
      <h3>Spell slots</h3>
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
    </div>
  {/if}

  {#each sheet.spellcasting as sc (sc.classId)}
    {@const list = spellList(c, sc.classId)}
    {@const levels = [...new Set(list.map((x) => x.spell.level))]}
    <div class="card">
      <h3>{c.embedded[sc.classId]?.name ?? 'Spellcasting'} <span class="muted">({ABILITY_NAMES[sc.ability]})</span></h3>
      <p class="row">
        <span>Save DC <OverrideNumber label="Spell save DC" okey="spellDc" value={sc.dc} overridden={has('spellDc')} {onset} /></span>
        <span>Attack <OverrideNumber label="Spell attack" okey="spellAttack" value={sc.attack} overridden={has('spellAttack')} {onset} format={signed} onroll={() => rollD20('Spell attack', sc.attack)} /></span>
      </p>
      <p class="muted">
        Cantrips {sc.cantrips}{sc.known !== undefined ? `, spells known ${sc.known}` : ''}{sc.prepared !== undefined ? `, prepared ${sc.prepared}` : ''}, up to level {sc.maxLevel}
      </p>
      {#each levels as lv (lv)}
        <h4>{levelName(lv)}</h4>
        <ul class="plain">
          {#each list.filter((x) => x.spell.level === lv) as { spell, prepared, always } (spell.id)}
            <li>
              <details>
                <summary>
                  {spell.name}
                  {#if always}<span class="tag">always prepared</span>{:else if prepared && lv > 0}<span class="tag">prepared</span>{/if}
                  {#if spell.concentration}<span class="tag">concentration</span>{/if}
                  {#if spell.ritual}<span class="tag">ritual</span>{/if}
                </summary>
                <p class="muted small">{titleCase(spell.school)} · {spell.castingTime} · {spell.range} · {parts(spell.components)} · {spell.duration}</p>
                <RichText text={spell.text} />
                {#if spell.higherLevels?.length}<RichText text={spell.higherLevels} />{/if}
              </details>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No spells picked yet.</p>
      {/each}
    </div>
  {/each}
</section>

<style>
  h3,
  h4 {
    margin: 0 0 0.4rem;
  }

  h4 {
    margin-top: 0.75rem;
  }

  .slot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    padding: 0.25rem 0;
  }

  summary {
    cursor: pointer;
    padding: 0.3rem 0;
  }

  .tag {
    margin-left: 0.3rem;
    padding: 0 0.4rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    font-size: 0.75rem;
    color: var(--muted);
  }

  .small {
    font-size: 0.85rem;
  }
</style>
