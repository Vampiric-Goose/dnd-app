<script lang="ts">
  import { addLevel, type Problem } from '../../lib/character/build.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { roll } from '../../lib/rolls.svelte.ts';
  import type { CampaignSettings, Character } from '../../lib/types.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import FilterSelect from '../FilterSelect.svelte';
  import { byName, entityOption } from './labels.ts';

  let { c = $bindable(), index, settings }: { c: Character; index: ContentIndex; settings: CampaignSettings } = $props();

  const classes = $derived(index.all('class').sort(byName));
  const current = $derived(c.build.levels[0]?.classId ?? '');
  const cls = $derived(index.resolve(current));
  let problems: Problem[] = $state([]);
  const rolled = $derived(c.build.levels.flatMap((l) => (l.hpRoll === undefined ? [] : [l.hpRoll])));

  /**
   * Rebuilds the levels: `n` levels of `classId` through addLevel. Drops what the removed levels or the old class
   * owned (choice answers above level n, a subclass not reached yet, and the spells of another class). With the same
   * class, surviving levels keep their HP rolls; only new levels roll, so re-picking can't fish for better HP.
   */
  function build(classId: string, n: number) {
    problems = [];
    const sameClass = classId === current;
    const k = index.resolve(classId);
    const old = c.build.levels;
    const subclasses = sameClass ? { ...c.build.subclasses } : {};
    if (k?.kind === 'class' && n < k.subclassLevel) delete subclasses[classId];
    const top = k?.kind === 'class' ? n : 0; // choice keys are `level|source|i`; level 0 is race and background
    const choices = Object.fromEntries(Object.entries(c.build.choices).filter(([key]) => Number(key.split('|')[0]) <= top));
    let next: Character = { ...c, build: { ...c.build, levels: [], subclasses, choices, spells: sameClass ? c.build.spells : {} } };
    if (!classId || k?.kind !== 'class') return void (c = next);
    for (let i = 0; i < n; i++) {
      const kept = sameClass ? old[i]?.hpRoll : undefined;
      const hpRoll = i > 0 && settings.hpMethod === 'roll' ? kept ?? roll(`HP: ${k.name} level ${i + 1}`, `1d${k.hitDie}`).total : undefined;
      const r = addLevel(next, classId, index, settings, hpRoll);
      problems.push(...r.problems);
      if (r.character === next) break;
      next = r.character;
    }
    c = next;
  }
</script>

<FilterSelect id="class" label="Class" options={classes.map(entityOption)} value={cls?.id ?? current} onchange={(id) => build(id, Math.max(1, c.build.levels.length))} />

<div class="field">
  <label for="start-level">Start at level</label>
  <select id="start-level" value={Math.max(1, c.build.levels.length)} disabled={!current} onchange={(e) => build(current, Number(e.currentTarget.value))}>
    {#each Array.from({ length: 20 }, (_, i) => i + 1) as n}<option value={n}>{n}</option>{/each}
  </select>
</div>

<p class="muted">
  Hit points: maximum at 1st level, then {settings.hpMethod === 'roll' ? 'a roll per level (logged in the dice tray)' : 'the average per level'}, plus your Constitution modifier.
  {#if rolled.length}HP rolls: {rolled.join(', ')}.{/if}
</p>
<p class="muted">Multiclassing: create the character in one class, then add levels in other classes from Level up.</p>

{#each problems as p}<p class:error={p.blocking} class:muted={!p.blocking} role="alert">{p.message}</p>{/each}

{#if cls}
  <details class="card">
    <summary>About the {cls.name}</summary>
    <EntityDetail entity={cls} {index} />
  </details>
{/if}
