<script lang="ts">
  import { embedContent, newCharacter, validateCharacter, type Problem } from '../../lib/character/build.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { leaveGuard, navigate } from '../../lib/router.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { DEFAULT_SETTINGS } from '../../lib/settings.ts';
  import { app, getFullIndex, getIndex } from '../../lib/store.svelte.ts';
  import type { Character } from '../../lib/types.ts';
  import AbilitiesStep from './AbilitiesStep.svelte';
  import BackgroundStep from './BackgroundStep.svelte';
  import ChoicesStep from './ChoicesStep.svelte';
  import ClassStep from './ClassStep.svelte';
  import DetailsStep from './DetailsStep.svelte';
  import { equipmentSources, startingInventory, type Equip } from '../../lib/character/equipment.ts';
  import { untrack } from 'svelte';
  import EquipmentStep from './EquipmentStep.svelte';
  import { ABILITIES } from '../../lib/rules/constants.ts';
  import Stat from '../kit/Stat.svelte';
  import Workspace from '../kit/Workspace.svelte';
  import { message, signed } from './labels.ts';
  import RaceStep from './RaceStep.svelte';
  import ReviewStep from './ReviewStep.svelte';
  import SpellsStep from './SpellsStep.svelte';

  // The one working character. Steps get it with bind:c and either edit it in place or assign the
  // result of answerChoice/addLevel; nothing is stored until Save.
  const fresh = newCharacter('', app.campaign?.id);
  fresh.build.baseScores = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }; // standard array, nothing assigned yet
  let c: Character = $state(fresh);
  // Step state that outlives a step's component: the rolled-score pool and the equipment picks.
  let rolls: number[] = $state([]);
  let hpRolls: Record<string, number> = $state({}); // `level|classId` → its HP roll, kept so re-picking can't fish
  let equip: Equip = $state({ mode: 'pack', picks: {}, cats: {}, gold: { dice: '', times: 1 } });

  // The SRD plus the character's campaign's packs; a character in no campaign sees every pack (spec 3.2).
  let index: ContentIndex | undefined = $state.raw();
  let loadError = $state('');
  let seq = 0;
  $effect(() => {
    const id = c.campaignId;
    const s = ++seq;
    (id ? getIndex(id) : getFullIndex()).then(
      (ix) => { if (s === seq) { index = ix; loadError = ''; } },
      (e) => { if (s === seq) loadError = message(e); },
    );
  });

  /** The starting kit (or gold) from the picks, for the current first class and background (R35). */
  function withKit(ch: Character, ix: ContentIndex): Character {
    const item = (id: string) => { const e = ix.resolve(id); return e?.kind === 'item' ? e : undefined; };
    const { inventory, gp } = startingInventory(equipmentSources(ch, (id) => ix.resolve(id)), $state.snapshot(equip) as Equip, item);
    return { ...ch, inventory, currency: { ...ch.currency, gp } };
  }
  // Re-applied whenever the first class, the background or a pick changes, even if the Equipment step is never opened.
  const kitKey = $derived(`${c.build.levels[0]?.classId ?? ''}|${c.build.backgroundId}`);
  $effect(() => {
    kitKey;
    JSON.stringify(equip); // track every pick
    const ix = index;
    if (ix) untrack(() => { const k = withKit(c, ix); c.inventory = k.inventory; c.currency.gp = k.currency.gp; });
  });

  const settings = $derived(app.campaigns.find((x) => x.id === c.campaignId)?.settings ?? DEFAULT_SETTINGS);
  const sheet = $derived(index && computeSheet(embedContent(c, index), { settings, viewer: 'dm' }));

  // validateCharacter doesn't check the custom origin's shape: +2/+1 or +1/+1/+1.
  const originProblem = $derived.by((): Problem[] => {
    const o = c.build.customOrigin;
    if (!o) return [];
    const pattern = Object.values(o).filter((n) => n).sort().reverse().join(',');
    return pattern === '2,1' || pattern === '1,1,1' ? [] : [{ step: 'abilities', message: 'Custom origin: +2 and +1, or +1 to three different scores', blocking: !settings.allowOverrides }];
  });
  const problems = $derived(index ? [...validateCharacter(c, index, settings), ...originProblem] : []);
  const blocking = $derived(problems.some((p) => p.blocking));

  const steps = [
    ['race', 'Race'], ['class', 'Class'], ['abilities', 'Abilities'], ['background', 'Background'], ['choices', 'Choices'],
    ['equipment', 'Equipment'], ['spells', 'Spells'], ['details', 'Details'], ['review', 'Review'],
  ] as const;
  type StepId = (typeof steps)[number][0];
  let step: StepId = $state('race');
  const at = $derived(steps.findIndex(([id]) => id === step));
  const stepProblems = $derived(problems.filter((p) => p.step === step));
  let heading: HTMLHeadingElement | undefined = $state();

  function go(id: StepId) {
    step = id;
    queueMicrotask(() => heading?.focus());
  }

  // Unsaved work (R43): any change to what the user has entered, compared with the empty start. The starting kit
  // is derived from those choices, so it is left out.
  const snapshotKey = () => JSON.stringify([c.name, c.build, c.details, rolls, hpRolls, equip]);
  let baseline = $state(snapshotKey());
  const dirty = $derived(snapshotKey() !== baseline);
  $effect(() => {
    const guard = () => !dirty || confirm('Discard this unsaved character?');
    leaveGuard.fn = guard;
    return () => { if (leaveGuard.fn === guard) leaveGuard.fn = undefined; };
  });

  let saving = $state(false);
  let saveError = $state('');
  async function save() {
    if (!index || blocking) return;
    saving = true;
    saveError = '';
    try {
      const done = embedContent(withKit($state.snapshot(c) as Character, index), index);
      done.state = { ...done.state, hp: computeSheet(done, { settings, viewer: 'dm' }).maxHp };
      await db.characters.put(done);
      baseline = snapshotKey(); // saved: the leave guard must not ask
      navigate(`characters/${done.id}`);
    } catch (e) {
      saveError = message(e);
    } finally {
      saving = false;
    }
  }

  // Layout only: the live summary panel (a bottom sheet on phones, opened from the header).
  let summaryOpen = $state(false);
  const nameOf = (id?: string) => (id && index ? index.resolve(id)?.name ?? '' : '');
  const classLine = $derived.by(() => {
    const n: Record<string, number> = {};
    for (const l of c.build.levels) n[l.classId] = (n[l.classId] ?? 0) + 1;
    return Object.entries(n).map(([id, lv]) => `${nameOf(id) || id} ${lv}`).join(' / ');
  });
  const stepLabel = (id: string) => steps.find(([s]) => s === id)?.[1] ?? id;
</script>

<svelte:window onbeforeunload={(e) => { if (dirty) e.preventDefault(); }} />

<Workspace panelLabel="Summary" open={summaryOpen} onclose={() => (summaryOpen = false)}>
  <header class="head">
    <h1>New character</h1>
    <button type="button" class="summary-btn" aria-expanded={summaryOpen} onclick={() => (summaryOpen = true)}>Summary</button>
  </header>

  {#if loadError}<p role="alert" class="error">Could not load the rules content: {loadError}</p>{/if}

  <div class="creator">
    <nav aria-label="Creator steps" class="steps">
      <ol>
        {#each steps as [id, label], i (id)}
          {@const n = problems.filter((p) => p.step === id).length}
          {@const block = problems.some((p) => p.step === id && p.blocking)}
          <li>
            <button type="button" aria-current={step === id ? 'step' : undefined} onclick={() => go(id)}>
              <span class="n num" aria-hidden="true">{i + 1}</span><span class="sr-only">{i + 1}.</span> <span class="lbl">{label}</span>
              {#if n && id !== 'review'}<span class="badge num" class:warn={!block} aria-hidden="true">{n}</span><span class="sr-only">, {n} {n === 1 ? 'problem' : 'problems'}</span>{/if}
            </button>
          </li>
        {/each}
      </ol>
    </nav>

    <div class="stage">
      <p class="caption">Step {at + 1} of {steps.length}</p>
      <h2 tabindex="-1" bind:this={heading}>{steps[at][1]}</h2>

      {#if !index || !sheet}
        <p class="muted">Loading rules content…</p>
      {:else}
        {#if step !== 'review' && stepProblems.length}
          <ul class="problems" aria-label="Problems on this step">
            {#each stepProblems as p}
              <li class:error={p.blocking} class:muted={!p.blocking}>{p.blocking ? '' : 'Warning: '}{p.message}</li>
            {/each}
          </ul>
        {/if}

        {#if step === 'race'}
          <RaceStep bind:c {index} />
        {:else if step === 'class'}
          <ClassStep bind:c bind:hpRolls {index} {settings} />
        {:else if step === 'abilities'}
          <AbilitiesStep bind:c bind:rolls {settings} {sheet} />
        {:else if step === 'background'}
          <BackgroundStep bind:c {index} />
        {:else if step === 'choices'}
          <ChoicesStep bind:c {index} {settings} {sheet} {problems} />
        {:else if step === 'equipment'}
          <EquipmentStep {c} bind:equip {index} />
        {:else if step === 'spells'}
          <SpellsStep bind:c {index} {settings} />
        {:else if step === 'details'}
          <DetailsStep bind:c />
        {:else}
          <ReviewStep {c} {sheet} {index} {problems} />
          {#if saveError}<p role="alert" class="error">{saveError}</p>{/if}
          <p class="row">
            <button class="primary" disabled={blocking || saving} onclick={save}>Save character</button>
            {#if blocking}<span class="muted">Fix the problems marked above to save.</span>{/if}
          </p>
        {/if}

        <p class="row pager">
          {#if at > 0}<button type="button" onclick={() => go(steps[at - 1][0])}><span class="gb" aria-hidden="true">◀</span>Back: {steps[at - 1][1]}</button>{/if}
          {#if at < steps.length - 1}<button type="button" class="next" onclick={() => go(steps[at + 1][0])}>Next: {steps[at + 1][1]}<span class="ga" aria-hidden="true">▶</span></button>{/if}
        </p>
      {/if}
    </div>
  </div>

  {#snippet panel()}
    <h2 class="pname">{c.name || 'Unnamed'}</h2>
    <p class="muted sub">{[nameOf(c.build.subraceId) || nameOf(c.build.raceId), classLine, nameOf(c.build.backgroundId)].filter(Boolean).join(' · ') || 'Pick a race, class and background.'}</p>
    {#if sheet}
      <div class="pstats">
        <Stat label="AC" value={sheet.ac} />
        <Stat label="HP" value={sheet.maxHp} />
        <Stat label="Speed" value="{sheet.speed.walk} ft" />
        <Stat label="Init" value={signed(sheet.initiative)} />
      </div>
      <div class="pabs">
        {#each ABILITIES as a (a)}<Stat label={a} value={signed(sheet.mods[a])} size="sm" box>{sheet.scores[a] || '—'}</Stat>{/each}
      </div>
    {/if}
    <h3 class="caption ph">Problems</h3>
    {#if problems.length}
      <ul class="plain pprob">
        {#each problems as p}
          <li>
            <button type="button" class="link" class:error={p.blocking} onclick={() => { go(p.step); summaryOpen = false; }}>
              <span class="caption">{stepLabel(p.step)}</span> {p.blocking ? '' : 'Warning: '}{p.message}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted sub">{index ? 'None. Ready to save on the Review step.' : '…'}</p>
    {/if}
  {/snippet}
</Workspace>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 0 0.4rem;
  }

  h1 {
    margin: 0;
  }

  .summary-btn {
    display: none;
  }

  /* Step list on the left, the current step beside it. */
  .creator {
    display: grid;
    grid-template-columns: 11rem minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }

  .steps {
    position: sticky;
    top: calc(var(--topbar-h) + 0.5rem);
  }

  .steps ol {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    border-left: 1px solid var(--line);
    position: relative; /* contains the absolutely positioned sr-only badge text, so it can't widen the page */
  }

  .steps button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.3rem;
    padding: 0.2rem 0.6rem;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    text-align: left;
    white-space: nowrap;
  }

  .steps button:hover:not(:disabled) {
    color: var(--text);
    background: color-mix(in srgb, var(--raised) 50%, transparent);
  }

  .steps button[aria-current='step'] {
    background: var(--raised);
    box-shadow: inset 2px 0 var(--accent);
    color: var(--text-strong);
  }

  .n {
    width: 1.2rem;
    color: var(--label);
    font-size: 0.8rem;
  }

  [aria-current='step'] .n {
    color: var(--accent);
  }

  .lbl {
    flex: 1;
  }

  .badge {
    min-width: 1.3em;
    padding: 0 0.3em;
    border-radius: 3px;
    background: var(--danger);
    color: var(--bg);
    font-size: 0.75rem;
    text-align: center;
  }

  .badge.warn {
    background: var(--muted);
  }

  .stage {
    min-width: 0;
  }

  .stage > .caption {
    margin: 0.6rem 0 0;
  }

  /* focus moves here on a step change, for screen readers; no ring on a heading */
  .stage > h2:focus {
    outline: none;
  }

  .stage > h2 {
    margin: 0.1rem 0 0.75rem;
    font-size: 1.3rem;
  }

  .problems {
    padding-left: 1.2rem;
  }

  .pager {
    justify-content: space-between;
    margin-top: 1.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--line);
  }

  .ga {
    margin-left: 0.4rem;
  }

  .gb {
    margin-right: 0.4rem;
  }

  .next {
    margin-left: auto;
  }

  /* Summary panel */
  .pname {
    margin: 0;
    font-size: 1.3rem;
  }

  .sub {
    margin: 0.15rem 0 0;
  }

  .pstats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.4rem;
    margin: 0.9rem 0 0.7rem;
  }

  .pabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.35rem;
  }

  .ph {
    margin: 1rem 0 0.3rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
  }

  .pprob li + li {
    border-top: 1px solid var(--line);
  }

  .link {
    display: block;
    width: 100%;
    min-height: 0;
    padding: 0.35rem 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    text-align: left;
    font-size: 0.9rem;
  }

  .link.error {
    color: var(--danger);
  }

  .link:hover:not(:disabled) {
    background: transparent;
    color: var(--text);
  }

  .link .caption {
    margin-right: 0.3rem;
  }

  @media (max-width: 767px) {
    .summary-btn {
      display: inline-flex;
      align-items: center;
    }

    /* Phones: the step list becomes a sideways scroller over the step. */
    .creator {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.25rem;
    }

    .steps {
      position: static;
    }

    .steps ol {
      display: flex;
      gap: 0.25rem;
      overflow-x: auto;
      border-left: 0;
      border-bottom: 1px solid var(--line);
      padding-bottom: 0.25rem;
    }

    .steps button {
      min-height: 44px;
      border-radius: var(--radius);
    }

    .steps button[aria-current='step'] {
      box-shadow: inset 0 -2px var(--accent);
    }

    .link {
      min-height: 44px;
    }
  }
</style>
