<script lang="ts">
  import type { Problem } from '../../lib/character/build.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { ABILITIES } from '../../lib/rules/constants.ts';
  import type { Character, Sheet } from '../../lib/types.ts';
  import { ABILITY_NAMES, signed, titleCase } from './labels.ts';

  let { c, sheet, index, problems }: { c: Character; sheet: Sheet; index: ContentIndex; problems: Problem[] } = $props();

  const name = (id?: string) => (id ? index.resolve(id)?.name ?? c.embedded[id]?.name ?? id : '');
  const classes = $derived.by(() => {
    const n: Record<string, number> = {};
    for (const l of c.build.levels) n[l.classId] = (n[l.classId] ?? 0) + 1;
    return Object.entries(n).map(([id, lv]) => `${name(id)}${c.build.subclasses[id] ? ` (${name(c.build.subclasses[id])})` : ''} ${lv}`).join(' / ');
  });
  const skills = $derived(Object.entries(sheet.skills).filter(([, s]) => s.proficient).map(([k, s]) => `${titleCase(k)} ${signed(s.bonus)}${s.expertise ? ' (expertise)' : ''}`));
</script>

<section class="card" aria-label="Character summary">
  <h3>{c.name || 'Unnamed'}</h3>
  <p>{[name(c.build.subraceId) || name(c.build.raceId), classes, name(c.build.backgroundId)].filter(Boolean).join(' · ')}</p>
  <dl class="stats">
    <div><dt>AC</dt><dd data-testid="ac">{sheet.ac}</dd></div>
    <div><dt>HP</dt><dd data-testid="hp">{sheet.maxHp}</dd></div>
    <div><dt>Speed</dt><dd>{sheet.speed.walk} ft.</dd></div>
    <div><dt>Initiative</dt><dd>{signed(sheet.initiative)}</dd></div>
    <div><dt>Proficiency</dt><dd>{signed(sheet.prof)}</dd></div>
    <div><dt>Passive Perception</dt><dd>{sheet.passivePerception}</dd></div>
  </dl>
  <dl class="stats">
    {#each ABILITIES as a}
      <div><dt>{ABILITY_NAMES[a].slice(0, 3)}</dt><dd>{sheet.scores[a]} ({signed(sheet.mods[a])}){sheet.saves[a].proficient ? ' ✓' : ''}</dd></div>
    {/each}
  </dl>
  <p class="muted">✓ = saving throw proficiency</p>
  {#if skills.length}<p><strong>Skills:</strong> {skills.join(', ')}</p>{/if}
  {#if sheet.attacks.length}
    <p><strong>Attacks:</strong> {sheet.attacks.map((x) => `${x.name} ${signed(x.toHit)} (${x.damage} ${x.damageType})`).join('; ')}</p>
  {/if}
  {#each sheet.spellcasting as sc}
    <p><strong>{name(sc.classId)} spells:</strong> save DC {sc.dc}, attack {signed(sc.attack)}</p>
  {/each}
  {#if c.inventory.length}<p><strong>Equipment:</strong> {c.inventory.map((e) => (e.quantity > 1 ? `${e.quantity} × ${e.item.name}` : e.item.name)).join(', ')}</p>{/if}
  {#if c.currency.gp}<p><strong>Gold:</strong> {c.currency.gp} gp</p>{/if}
</section>

{#if problems.length}
  <h3>Problems</h3>
  <ul>
    {#each problems as p}
      <li class:error={p.blocking}>{p.blocking ? '' : 'Warning: '}{p.message} <span class="muted">({p.step})</span></li>
    {/each}
  </ul>
{:else}
  <p>No problems found.</p>
{/if}

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    gap: 0.5rem;
    margin: 0.5rem 0;
  }

  .stats div {
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    padding: 0.25rem 0.5rem;
  }

  dt { font-size: 0.8rem; color: var(--muted); }
  dd { margin: 0; font-weight: 600; }
</style>
