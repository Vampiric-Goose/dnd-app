<script lang="ts">
  import type { ContentIndex } from '../lib/content/index.ts';
  import type { Ability, Entity, Proficiencies, RichText as RT, Scores } from '../lib/types.ts';
  import { displayItem } from '../lib/items/playerView.ts';
  import { app } from '../lib/store.svelte.ts';
  import RichText from './RichText.svelte';

  let { entity: raw, index }: { entity: Entity; index?: ContentIndex } = $props();
  // Items go through displayItem (R31): the DM sees the true text, the player the cover and bars.
  const entity = $derived<Entity>(raw.kind === 'item' ? displayItem(raw, app.viewer) : raw);

  const ordinal = (n: number) => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const list = (xs: readonly string[]) => xs.join(', ');
  const feet = (n: number) => `${n} ft.`;
  const nameOf = (id: string) => index?.resolve(id)?.name ?? id.replace(/^[a-z]+:|@.*$/gi, '').replace(/-/g, ' ');
  const scores = (s: Partial<Scores>) => Object.entries(s).map(([a, n]) => `${a.toUpperCase()} ${n >= 0 ? '+' : ''}${n}`).join(', ');
  const abil = (a: Ability[]) => a.map((x) => x.toUpperCase()).join(', ');
  const hasText = (t: RT | undefined) => !!t && t.length > 0;
  const cost = (cp: number) => (cp % 100 === 0 ? `${cp / 100} gp` : cp % 10 === 0 ? `${cp / 10} sp` : `${cp} cp`);

  function profRows(p: Proficiencies): [string, string][] {
    const rows: [string, string][] = [['Armor', list(p.armor)], ['Weapons', list(p.weapons)], ['Tools', list(p.tools)], ['Skills', list(p.skills)], ['Languages', list(p.languages)]];
    return rows.filter(([, v]) => v);
  }

  function featPrereq(e: Extract<Entity, { kind: 'feat' }>): string {
    const p = e.prerequisite;
    if (!p) return '';
    const parts: string[] = [];
    for (const a of p.abilities ?? []) parts.push(scores(a).replace(/ \+/g, ' '));
    if (p.spellcasting) parts.push('Spellcasting');
    if (p.races?.length) parts.push(list(p.races.map(nameOf)));
    if (p.text) parts.push(p.text);
    return parts.join('; ');
  }

  function spellLine(e: Extract<Entity, { kind: 'spell' }>): string {
    const school = cap(e.school);
    return (e.level === 0 ? `${school} cantrip` : `${ordinal(e.level)}-level ${e.school}`) + (e.ritual ? ' (ritual)' : '');
  }

  function components(c: Extract<Entity, { kind: 'spell' }>['components']): string {
    return [c.v && 'V', c.s && 'S', c.m && `M (${c.m})`].filter(Boolean).join(', ') || 'None';
  }

  function itemLine(e: Extract<Entity, { kind: 'item' }>): string {
    const parts = [cap(e.type)];
    if (e.magic) parts.push(e.rarity ? cap(e.rarity) : 'Magic');
    if (e.attunement) parts.push(typeof e.attunement === 'string' ? `requires attunement ${e.attunement}` : 'requires attunement');
    return parts.join(', ');
  }

</script>

{#snippet facts(rows: [string, string | undefined][])}
  <dl class="facts">
    {#each rows.filter((r) => r[1]) as [k, v]}
      <dt>{k}</dt>
      <dd>{v}</dd>
    {/each}
  </dl>
{/snippet}

{#snippet traitsOrText(traits: { name: string; text: RT }[], text: RT)}
  <!-- Imported entities repeat their traits inside `text`: show the structured traits when there are any, else the text. -->
  {#if traits.length}
    {#each traits as t}
      <h4>{t.name}</h4>
      <RichText text={t.text} />
    {/each}
  {:else}
    <RichText {text} />
  {/if}
{/snippet}

{#snippet featureList(refs: { level: number; id: string }[])}
  {#each refs as f (f.id)}
    {@const feature = index?.get(f.id)}
    <h4>{nameOf(f.id)} <span class="muted">(level {f.level})</span></h4>
    {#if feature}<RichText text={feature.text} />{/if}
  {/each}
{/snippet}

<article>
  <h2>{entity.name}</h2>
  <p class="muted sub">
    {#if entity.kind === 'spell'}{spellLine(entity)}
    {:else if entity.kind === 'item'}{itemLine(entity)}
    {:else if entity.kind === 'class'}Class
    {:else if entity.kind === 'subclass'}Subclass of {nameOf(entity.classId)}
    {:else if entity.kind === 'subrace'}Subrace of {nameOf(entity.raceId)}
    {:else if entity.kind === 'optionalFeature'}Option ({list(entity.featureTypes)})
    {:else if entity.kind === 'feature'}Feature, {nameOf(entity.classId)} level {entity.level}
    {:else}{cap(entity.kind)}{/if}
    · {entity.source}
  </p>

  {#if entity.kind === 'spell'}
    {@render facts([
      ['Casting time', entity.castingTime],
      ['Range', entity.range],
      ['Components', components(entity.components)],
      ['Duration', (entity.concentration ? 'Concentration, ' : '') + entity.duration],
      ['Classes', list(entity.classes.map(cap))],
    ])}
    <RichText text={entity.text} />
    {#if hasText(entity.higherLevels)}
      <h4>At higher levels</h4>
      <RichText text={entity.higherLevels ?? []} />
    {/if}
  {:else if entity.kind === 'item'}
    {@render facts([
      ['Cost', entity.costCp ? cost(entity.costCp) : undefined],
      ['Weight', entity.weight ? `${entity.weight} lb.` : undefined],
      ['Damage', entity.weapon ? `${entity.weapon.damage} ${entity.weapon.damageType}${entity.weapon.versatile ? ` (versatile ${entity.weapon.versatile})` : ''}` : undefined],
      ['Properties', entity.weapon?.properties.length ? list(entity.weapon.properties) : undefined],
      ['Range', entity.weapon?.range ? `${entity.weapon.range[0]}/${entity.weapon.range[1]} ft.` : undefined],
      ['Armor class', entity.armor ? `${entity.armor.ac}${entity.armor.category === 'shield' ? '' : entity.armor.category === 'heavy' ? '' : ` + Dex${entity.armor.dexCap !== undefined ? ` (max ${entity.armor.dexCap})` : ''}`}` : undefined],
      ['Strength', entity.armor?.strReq ? String(entity.armor.strReq) : undefined],
      ['Stealth', entity.armor?.stealthDisadvantage ? 'Disadvantage' : undefined],
      ['Charges', entity.charges ? `${entity.charges.max} (${entity.charges.recharge})` : undefined],
    ])}
    <RichText text={entity.text} />
    {#if hasText(entity.curse)}
      <h4>Curse</h4>
      <RichText text={entity.curse ?? []} />
    {/if}
  {:else if entity.kind === 'race' || entity.kind === 'subrace'}
    {@render facts([
      ['Size', entity.kind === 'race' ? { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' }[entity.size] : undefined],
      ['Speed', entity.speed ? Object.entries(entity.speed).map(([m, n]) => (m === 'walk' ? feet(n) : `${m} ${feet(n)}`)).join(', ') : undefined],
      ['Ability scores', scores(entity.abilityBonuses) || undefined],
      ['Darkvision', entity.darkvision ? feet(entity.darkvision) : undefined],
      ['Resistances', entity.resist?.length ? list(entity.resist) : undefined],
      ...profRows(entity.proficiencies),
    ])}
    {@render traitsOrText(entity.traits, entity.text)}
  {:else if entity.kind === 'class'}
    {@render facts([['Hit die', `d${entity.hitDie}`]])}
    <table>
      <tbody>
        <tr><th scope="row">Saving throws</th><td>{abil(entity.saves)}</td></tr>
        {#each profRows(entity.proficiencies) as [k, v]}<tr><th scope="row">{k}</th><td>{v}</td></tr>{/each}
        <tr><th scope="row">Skills</th><td>Choose {entity.skillChoice.count}{entity.skillChoice.from === 'any' ? '' : ` from ${list(entity.skillChoice.from)}`}</td></tr>
      </tbody>
    </table>
    <RichText text={entity.text} />
    {#if entity.table.length}
      <div class="scroll">
        <table>
          <thead><tr><th scope="col">Level</th>{#each entity.table as c}<th scope="col">{c.label}</th>{/each}</tr></thead>
          <tbody>
            {#each entity.table[0].values as _, i}
              <tr><th scope="row">{i + 1}</th>{#each entity.table as c}<td>{c.values[i] ?? ''}</td>{/each}</tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {@render featureList([...entity.features].sort((a, b) => a.level - b.level))}
  {:else if entity.kind === 'subclass'}
    <RichText text={entity.text} />
    {@render featureList([...entity.features].sort((a, b) => a.level - b.level))}
  {:else if entity.kind === 'background'}
    {@render facts(profRows(entity.proficiencies))}
    {#if entity.feature.name && hasText(entity.feature.text)}
      <h4>Feature: {entity.feature.name}</h4>
      <RichText text={entity.feature.text} />
    {:else}
      <RichText text={entity.text} />
    {/if}
    {#if hasText(entity.equipment.text)}
      <h4>Equipment</h4>
      <RichText text={entity.equipment.text} />
    {/if}
  {:else if entity.kind === 'feat'}
    {@render facts([['Prerequisite', featPrereq(entity) || undefined], ['Ability scores', entity.abilityBonus ? scores(entity.abilityBonus) : undefined]])}
    <RichText text={entity.text} />
  {:else if entity.kind === 'optionalFeature'}
    {@render facts([['Prerequisite', entity.prerequisite]])}
    <RichText text={entity.text} />
  {:else}
    <RichText text={entity.text} />
  {/if}
</article>

<style>
  h2 { margin: 0.25rem 0 0; }
  .sub { margin: 0 0 0.75rem; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.75rem; margin: 0 0 0.75rem; }
  dt { font-weight: 600; }
  dd { margin: 0; }
  table { border-collapse: collapse; margin: 0.5rem 0; }
  th, td { border: 1px solid var(--border); padding: 0.2em 0.5em; text-align: left; vertical-align: top; }
  .scroll { overflow-x: auto; }
</style>
