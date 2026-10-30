<script lang="ts">
  import { addLevel, embedContent, validateCharacter, type Problem } from '../../lib/character/build.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { roll } from '../../lib/rolls.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { DEFAULT_SETTINGS } from '../../lib/settings.ts';
  import { app, getFullIndex, getIndex } from '../../lib/store.svelte.ts';
  import type { Character } from '../../lib/types.ts';
  import FilterSelect from '../FilterSelect.svelte';
  import ChoicesStep from './ChoicesStep.svelte';
  import { byName, entityOption, message } from './labels.ts';
  import SpellsStep from './SpellsStep.svelte';

  let { params }: { params: { id: string } } = $props();

  let base: Character | undefined = $state.raw(); // as stored
  let c: Character | undefined = $state(); // with the levels added on this page
  let index: ContentIndex | undefined = $state.raw();
  let error = $state('');

  $effect(() => {
    const id = params.id;
    db.characters.get(id).then(async (found) => {
      if (!found) return void (error = 'Character not found.');
      index = await (found.campaignId ? getIndex(found.campaignId) : getFullIndex());
      base = found;
      c = structuredClone(found);
    }).catch((e) => (error = message(e)));
  });

  const settings = $derived(app.campaigns.find((x) => x.id === c?.campaignId)?.settings ?? DEFAULT_SETTINGS);
  const sheetOf = (ch: Character) => computeSheet(embedContent(ch, index!), { settings, viewer: 'dm' });
  const sheet = $derived(c && index ? sheetOf(c) : undefined);
  const oldSheet = $derived(base && index ? sheetOf(base) : undefined);

  // Existing classes first, then the rest.
  const classOptions = $derived.by(() => {
    if (!index || !c) return [];
    const mine = new Set(c.build.levels.map((l) => index!.resolve(l.classId)?.id ?? l.classId));
    const all = index.all('class').sort(byName);
    return [...all.filter((k) => mine.has(k.id)), ...all.filter((k) => !mine.has(k.id))].map((k) => ({ ...entityOption(k), label: mine.has(k.id) ? `${entityOption(k).label} (current)` : entityOption(k).label }));
  });
  let classId = $state('');
  $effect(() => { if (!classId && c?.build.levels.length) classId = index?.resolve(c.build.levels.at(-1)!.classId)?.id ?? c.build.levels.at(-1)!.classId; });

  // A dry run shows a multiclass problem before the button is pressed; with overrides on it's a warning.
  const preview = $derived(c && index && classId ? addLevel(c, classId, index, settings) : undefined);
  const blocked = $derived(!!preview?.problems.some((p) => p.blocking));
  let added = $state(0);
  let notes: string[] = $state([]);

  function addOne() {
    if (!c || !index || blocked) return;
    const cls = index.resolve(classId);
    if (cls?.kind !== 'class') return;
    const lv = c.build.levels.length + 1;
    const hpRoll = settings.hpMethod === 'roll' ? roll(`HP: ${cls.name}, character level ${lv}`, `1d${cls.hitDie}`).total : undefined;
    const r = addLevel(c, classId, index, settings, hpRoll);
    if (r.problems.some((p) => p.blocking)) return;
    c = r.character;
    added++;
    notes.push(`Level ${lv}: ${cls.name}${hpRoll !== undefined ? `, rolled ${hpRoll} for HP` : ', average HP'}${r.problems.length ? ` (warning: ${r.problems.map((p) => p.message).join('; ')})` : ''}`);
  }

  function startOver() {
    if (!base) return;
    c = structuredClone(base);
    added = 0;
    notes = [];
  }

  const problems = $derived<Problem[]>(c && index ? validateCharacter(c, index, settings) : []);
  const blocking = $derived(problems.some((p) => p.blocking));
  let saving = $state(false);
  async function save() {
    if (!c || !index || !base || blocking || !oldSheet) return;
    saving = true;
    error = '';
    try {
      const done = embedContent($state.snapshot(c) as Character, index);
      const max = computeSheet(done, { settings, viewer: 'dm' }).maxHp;
      done.state = { ...done.state, hp: Math.max(0, Math.min(max, done.state.hp + max - oldSheet.maxHp)) };
      await db.characters.put(done);
      navigate(`characters/${done.id}`);
    } catch (e) {
      error = message(e);
    } finally {
      saving = false;
    }
  }
</script>

<h1>Level up{c ? `: ${c.name}` : ''}</h1>
{#if error}<p role="alert" class="error">{error}</p>{/if}

{#if c && index && sheet && oldSheet}
  <p>Level {base?.build.levels.length} → <strong>{c.build.levels.length}</strong>. Max HP {oldSheet.maxHp} → <strong>{sheet.maxHp}</strong>.</p>

  <section class="card">
    <h2>Add a level</h2>
    <FilterSelect id="lu-class" label="Class" options={classOptions} value={classId} onchange={(id) => (classId = id)} />
    <p class="muted">Hit points: {settings.hpMethod === 'roll' ? 'rolled when you add the level (logged in the dice tray)' : 'the average for the hit die'}, plus your Constitution modifier.</p>
    {#each preview?.problems ?? [] as p}
      <p role="alert" class:error={p.blocking} class:muted={!p.blocking}>{p.blocking ? '' : 'Warning (rule overrides are on): '}{p.message}</p>
    {/each}
    <p class="row">
      <button class="primary" disabled={!classId || blocked || c.build.levels.length >= 20} onclick={addOne}>Add a level</button>
      {#if added}<button onclick={startOver}>Start over</button>{/if}
    </p>
    {#if notes.length}<ul>{#each notes as n}<li>{n}</li>{/each}</ul>{/if}
  </section>

  {#if added}
    <h2>New choices</h2>
    <ChoicesStep bind:c {index} {settings} {sheet} {problems} fromLevel={(base?.build.levels.length ?? 0) + 1} />
    <h2>Spells</h2>
    <SpellsStep bind:c {index} {settings} />
  {/if}

  {#if problems.length}
    <h2>Problems</h2>
    <ul>{#each problems as p}<li class:error={p.blocking} class:muted={!p.blocking}>{p.blocking ? '' : 'Warning: '}{p.message}</li>{/each}</ul>
  {/if}
  <p class="row">
    <button class="primary" disabled={!added || blocking || saving} onclick={save}>Save</button>
    <a href="#/characters">Cancel</a>
  </p>
{:else if !error}
  <p class="muted">Loading…</p>
{/if}
