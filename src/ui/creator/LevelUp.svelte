<script lang="ts">
  import { addLevel, classesFor, embedContent, validateCharacter, type Problem } from '../../lib/character/build.ts';
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
  import Stat from '../kit/Stat.svelte';
  import Workspace from '../kit/Workspace.svelte';
  import { byName, entityOption, message, signed } from './labels.ts';
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
    const dm = app.viewer === 'dm' && app.campaigns.find((x) => x.id === c!.campaignId)?.sync?.role !== 'player'; // R11
    const others = classesFor(all.filter((k) => !mine.has(k.id)), dm);
    return [...all.filter((k) => mine.has(k.id)), ...others].map((k) => ({ ...entityOption(k), label: mine.has(k.id) ? `${entityOption(k).label} (current)` : entityOption(k).label }));
  });
  let classId = $state('');
  $effect(() => { if (!classId && c?.build.levels.length) classId = index?.resolve(c.build.levels.at(-1)!.classId)?.id ?? c.build.levels.at(-1)!.classId; });

  // A dry run shows a multiclass problem before the button is pressed; with overrides on it's a warning.
  const preview = $derived(c && index && classId ? addLevel(c, classId, index, settings) : undefined);
  const blocked = $derived(!!preview?.problems.some((p) => p.blocking));
  let added = $state(0);
  let notes: string[] = $state([]);
  const hpRolls: Record<string, number> = {}; // `characterId|level|classId` → the roll made for it on this page

  function addOne() {
    if (!c || !index || blocked) return;
    const cls = index.resolve(classId);
    if (cls?.kind !== 'class') return;
    const lv = c.build.levels.length + 1;
    // A level re-added after Start over keeps its first roll, so starting over can't fish for better HP.
    const key = `${params.id}|${lv}|${cls.id}`;
    const hpRoll = settings.hpMethod === 'roll' ? (hpRolls[key] ??= roll(`HP: ${cls.name}, character level ${lv}`, `1d${cls.hitDie}`).total) : undefined;
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

  // Layout only: a compact stepper (choices and spells open once a level is added) and the live summary panel.
  const steps = [['level', 'Add a level'], ['choices', 'New choices'], ['spells', 'Spells']] as const;
  let step: (typeof steps)[number][0] = $state('level');
  $effect(() => { if (!added) step = 'level'; }); // Start over: back to the first step
  let summaryOpen = $state(false);
</script>

<Workspace panelLabel="Summary" open={summaryOpen} onclose={() => (summaryOpen = false)}>
  <header class="head">
    <h1>Level up{c ? `: ${c.name}` : ''}</h1>
    {#if app.viewer === 'dm' && c && sheet}<button type="button" class="summary-btn" aria-expanded={summaryOpen} onclick={() => (summaryOpen = true)}>Summary</button>{/if}
  </header>
  {#if error}<p role="alert" class="error">{error}</p>{/if}

  {#if app.viewer !== 'dm'}
    <p class="muted">Levelling up is done in DM view.</p>
  {:else if c && index && sheet && oldSheet}
    <p>Level <span class="num">{base?.build.levels.length}</span> → <strong class="num">{c.build.levels.length}</strong>. Max HP <span class="num">{oldSheet.maxHp}</span> → <strong class="num">{sheet.maxHp}</strong>.</p>

    <nav aria-label="Level up steps">
      <ol class="stepper">
        {#each steps as [id, label], i (id)}
          <li>
            <button type="button" aria-current={step === id ? 'step' : undefined} disabled={id !== 'level' && !added} onclick={() => (step = id)}>
              <span class="n num" aria-hidden="true">{i + 1}</span> {label}
            </button>
          </li>
        {/each}
      </ol>
    </nav>

    {#if step === 'level'}
      <section class="stage" aria-labelledby="lu-add-h">
        <h2 id="lu-add-h">Add a level</h2>
        <FilterSelect id="lu-class" label="Class" options={classOptions} value={classId} onchange={(id) => (classId = id)} />
        <p class="muted">Hit points: {settings.hpMethod === 'roll' ? 'rolled when you add the level (logged in the dice tray)' : 'the average for the hit die'}, plus your Constitution modifier.</p>
        {#each preview?.problems ?? [] as p}
          <p role="alert" class:error={p.blocking} class:muted={!p.blocking}>{p.blocking ? '' : 'Warning (rule overrides are on): '}{p.message}</p>
        {/each}
        <p class="row">
          <button class="primary" disabled={!classId || blocked || c.build.levels.length >= 20} onclick={addOne}>Add a level</button>
          {#if added}<button onclick={startOver}>Start over</button>{/if}
        </p>
        {#if notes.length}<ul class="notes">{#each notes as n}<li>{n}</li>{/each}</ul>{/if}
      </section>
    {:else if step === 'choices'}
      <section class="stage" aria-labelledby="lu-ch-h">
        <h2 id="lu-ch-h">New choices</h2>
        <ChoicesStep bind:c {index} {settings} {sheet} {problems} fromLevel={(base?.build.levels.length ?? 0) + 1} />
      </section>
    {:else}
      <section class="stage" aria-labelledby="lu-sp-h">
        <h2 id="lu-sp-h">Spells</h2>
        <SpellsStep bind:c {index} {settings} />
      </section>
    {/if}

    {#if problems.length}
      <h2 class="caption probs-h">Problems</h2>
      <ul class="probs">{#each problems as p}<li class:error={p.blocking} class:muted={!p.blocking}>{p.blocking ? '' : 'Warning: '}{p.message}</li>{/each}</ul>
    {/if}
    <p class="row footer">
      <button class="primary" disabled={!added || blocking || saving} onclick={save}>Save</button>
      <a href="#/characters">Cancel</a>
      {#if added && step !== 'spells'}
        {@const next = steps[steps.findIndex(([id]) => id === step) + 1]}
        <button type="button" class="next" onclick={() => (step = next[0])}>Next: {next[1]}<span class="ga" aria-hidden="true">▶</span></button>
      {/if}
    </p>
  {:else if !error}
    <p class="muted">Loading…</p>
  {/if}

  {#snippet panel()}
    {#if c && sheet && oldSheet}
      <h2 class="pname">{c.name || 'Unnamed'}</h2>
      <div class="pstats">
        <Stat label="Level" value="{base?.build.levels.length ?? 0} → {c.build.levels.length}" />
        <Stat label="Max HP" value="{oldSheet.maxHp} → {sheet.maxHp}" />
      </div>
      <div class="pstats">
        <Stat label="AC" value={sheet.ac} size="sm" />
        <Stat label="Prof" value={signed(sheet.prof)} size="sm" />
        <Stat label="Init" value={signed(sheet.initiative)} size="sm" />
      </div>
      <h3 class="caption ph">Added on this page</h3>
      {#if notes.length}
        <ul class="plain pnotes">{#each notes as n}<li>{n}</li>{/each}</ul>
      {:else}
        <p class="muted">Nothing yet. Pick a class and add a level.</p>
      {/if}
      {#if problems.length}
        <p class="sub" class:error={blocking} class:muted={!blocking}><span class="num">{problems.length}</span> {problems.length === 1 ? 'problem' : 'problems'}{blocking ? ': fix them to save' : ' (warnings)'}</p>
      {/if}
    {:else}
      <p class="muted">Loading…</p>
    {/if}
  {/snippet}
</Workspace>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 0 0.2rem;
  }

  h1 {
    margin: 0;
  }

  .summary-btn {
    display: none;
  }

  .stepper {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    border-bottom: 1px solid var(--line);
  }

  .stepper button {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    box-shadow: inset 0 -2px transparent;
  }

  .stepper button:hover:not(:disabled) {
    background: transparent;
    color: var(--text);
  }

  .stepper button[aria-current='step'] {
    color: var(--text-strong);
    box-shadow: inset 0 -2px var(--accent);
  }

  .n {
    color: var(--label);
    font-size: 0.8rem;
  }

  [aria-current='step'] .n {
    color: var(--accent);
  }

  .stage {
    max-width: 60rem;
  }

  .stage > h2 {
    margin: 0.9rem 0 0.5rem;
    font-size: 1.2rem;
  }

  .notes {
    padding-left: 1.2rem;
  }

  .probs-h {
    margin: 1.5rem 0 0.25rem;
  }

  .probs {
    margin: 0;
    padding-left: 1.2rem;
  }

  .footer {
    margin-top: 1.25rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--line);
  }

  .ga {
    margin-left: 0.4rem;
  }

  .next {
    margin-left: auto;
  }

  .pname {
    margin: 0 0 0.6rem;
    font-size: 1.3rem;
  }

  .pstats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.4rem;
    margin-bottom: 0.7rem;
  }

  .ph {
    margin: 0.6rem 0 0.3rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
  }

  .pnotes li {
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--line);
    font-size: 0.9rem;
  }

  .sub {
    margin: 0.6rem 0 0;
  }

  @media (max-width: 767px) {
    .summary-btn {
      display: inline-flex;
      align-items: center;
    }

    .stepper {
      flex-wrap: nowrap;
      overflow-x: auto;
    }

    .stepper button {
      white-space: nowrap;
    }
  }
</style>
