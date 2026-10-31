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
  import { message } from './labels.ts';
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
</script>

<svelte:window onbeforeunload={(e) => { if (dirty) e.preventDefault(); }} />

<h1>New character</h1>

{#if loadError}<p role="alert" class="error">Could not load the rules content: {loadError}</p>{/if}

<nav aria-label="Creator steps" class="steps">
  <ol>
    {#each steps as [id, label], i (id)}
      {@const n = problems.filter((p) => p.step === id).length}
      {@const block = problems.some((p) => p.step === id && p.blocking)}
      <li>
        <button type="button" aria-current={step === id ? 'step' : undefined} onclick={() => go(id)}>
          {i + 1}. {label}
          {#if n && id !== 'review'}<span class="badge" class:warn={!block} aria-hidden="true">{n}</span><span class="sr-only">, {n} {n === 1 ? 'problem' : 'problems'}</span>{/if}
        </button>
      </li>
    {/each}
  </ol>
</nav>

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
    {#if at > 0}<button type="button" onclick={() => go(steps[at - 1][0])}>Back: {steps[at - 1][1]}</button>{/if}
    {#if at < steps.length - 1}<button type="button" onclick={() => go(steps[at + 1][0])}>Next: {steps[at + 1][1]}</button>{/if}
  </p>
{/if}

<style>
  .steps ol {
    display: flex;
    gap: 0.35rem;
    list-style: none;
    padding: 0 0 0.25rem;
    margin: 0;
    overflow-x: auto;
    position: relative; /* contains the absolutely positioned sr-only badge text, so it can't widen the page */
  }

  .steps button {
    white-space: nowrap;
  }

  .steps button[aria-current='step'] {
    border-color: var(--accent);
    box-shadow: inset 0 -3px var(--accent);
  }

  .badge {
    display: inline-block;
    min-width: 1.2em;
    margin-left: 0.3em;
    border-radius: 1em;
    background: #b3261e;
    color: #fff;
    font-size: 0.75em;
    text-align: center;
  }

  .badge.warn {
    background: var(--muted);
  }

  .problems {
    padding-left: 1.2rem;
  }

  .pager {
    justify-content: space-between;
    margin-top: 1.5rem;
  }
</style>
