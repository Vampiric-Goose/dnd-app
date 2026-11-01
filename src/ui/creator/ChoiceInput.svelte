<script lang="ts">
  import { skillOptions, type Problem } from '../../lib/character/build.ts';
  import type { PendingChoice } from '../../lib/character/choices.ts';
  import { choiceSummary } from '../../lib/character/choiceSummary.ts';
  import { fold } from '../../lib/content/ids.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { ABILITIES, SKILL_ABILITY } from '../../lib/rules/constants.ts';
  import type { Ability, CampaignSettings, Character, ChoiceAnswer, Entity, RichText as RT, Sheet } from '../../lib/types.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import RichText from '../RichText.svelte';
  import { ABILITY_NAMES, LANGUAGES, byName, entityOption, titleCase } from './labels.ts';

  // Renders one PendingChoice of any type as a bordered group: a heading, where it comes from, and the options as cards.
  // Nested choices are separate PendingChoices (ChoicesStep lists them).
  // `taken`: what the character already has from elsewhere (takenElsewhere), never offered again unless this choice picked it.
  let { pending: p, c, index, settings, sheet, taken, problem, onanswer }: {
    pending: PendingChoice; c: Character; index: ContentIndex; settings: CampaignSettings; sheet: Sheet; taken?: Set<string>; problem?: Problem; onanswer: (a: ChoiceAnswer) => void;
  } = $props();

  const uid = $props.id();
  const ch = $derived(p.choice);
  const a = $derived(p.answer);
  const picked = $derived<string[]>(a?.type === 'ids' ? a.ids : a?.type === 'abilities' ? Object.keys(a.abilities).filter((k) => a.abilities[k as Ability]) : []);
  const count = $derived('count' in ch ? ch.count : 1);
  const uniq = (xs: string[]) => [...new Set(xs)];

  // `text` and `entity` feed the card's summary and its More details; `prereq` is shown when there is no text.
  type Opt = { value: string; label: string; text?: RT; prereq?: string; entity?: Entity };
  const ofEntity = (e: Entity & { prerequisite?: unknown }): Opt => ({ ...entityOption(e), text: e.text, entity: e, ...(typeof e.prerequisite === 'string' && { prereq: `Prerequisite: ${e.prerequisite}` }) });
  const feats = $derived(index.all('feat').sort(byName).map(ofEntity));
  const options = $derived.by((): Opt[] => {
    const free = (xs: string[]) => xs.filter((x) => picked.includes(x) || !taken?.has(x.toLowerCase()));
    const plain = (xs: string[]) => free(xs).map((x) => ({ value: x, label: titleCase(x) }));
    switch (ch.type) {
      case 'skill': return plain(skillOptions(ch, taken, picked));
      case 'expertise': return plain(uniq([...Object.entries(sheet.skills).filter(([, s]) => s.proficient).map(([k]) => k), ...sheet.proficiencies.tools, ...picked]));
      case 'language': return free(ch.from ?? LANGUAGES).map((l) => ({ value: l, label: l }));
      case 'tool': return plain(ch.from ?? uniq(index.all('item').filter((i) => i.type === 'tool' && !i.magic).map((i) => i.name.toLowerCase())).sort());
      case 'ability': return ch.from.map((x) => ({ value: x, label: ABILITY_NAMES[x] }));
      case 'optionalFeature': return index.optionalFeatures(ch.featureTypes).sort(byName).map(ofEntity);
      case 'option': return ch.options.map((t) => ({ value: t.name, label: t.name, text: t.text }));
      case 'subclass': {
        const owner = c.build.levels[p.level - 1]?.classId;
        return owner ? index.subclassesOf(owner).sort(byName).map(ofEntity) : [];
      }
      case 'feat': return feats;
      default: return [];
    }
  });
  const KIND: Record<string, string> = { skill: 'Skills', expertise: 'Expertise', language: 'Languages', tool: 'Tools', subclass: 'Subclass', feat: 'Feat', asi: 'Ability score improvement' };
  // Where it comes from: the class (or race, background) behind it, and its level. Anything the heading already says is left out.
  const owner = $derived.by(() => {
    const id = p.level === 0 ? p.sourceId.split('/')[0] : c.build.levels[p.level - 1]?.classId;
    return id ? index.resolve(id)?.name : undefined;
  });
  const meta = $derived(
    [ch.type === 'ability' ? `Ability scores, +${ch.amount} each` : KIND[ch.type], owner, p.level ? `level ${p.level}` : undefined]
      .filter((x, i, all) => x && fold(x) !== fold(p.sourceName) && all.indexOf(x) === i).join(' · '),
  );

  // Long lists (feats, imported invocations, tools) get a search box and show at most 100 matches.
  const LONG = 12;
  let q = $state('');
  function visible(list: Opt[], sel: string[]): Opt[] {
    if (list.length <= LONG) return list;
    const n = fold(q.trim());
    // Selected options always stay; only the other matches are capped.
    const rest = list.filter((o) => !sel.includes(o.value) && fold(o.label).includes(n)).slice(0, Math.max(0, 100 - sel.length));
    return list.filter((o) => sel.includes(o.value) || rest.includes(o));
  }
  // The full text opens on demand, so a long list doesn't render a hundred of them up front.
  let opened: Record<string, boolean> = $state({});

  function commit(next: string[]) {
    if (ch.type === 'ability') onanswer({ type: 'abilities', abilities: Object.fromEntries(next.map((x) => [x, ch.amount])) });
    else onanswer({ type: 'ids', ids: next });
  }
  const toggle = (v: string, on: boolean) => commit(count === 1 ? [v] : on ? [...picked, v] : picked.filter((x) => x !== v));

  // Ability score improvement: +2 / +1+1, or a feat when the campaign allows feats.
  let asiPick: string | undefined = $state(); // the radio, until the answer itself says
  const asiMode = $derived(asiPick ?? (a?.type === 'asi' && a.featId ? 'feat' : 'scores'));
  const asi = $derived(a?.type === 'asi' ? a : undefined);
  function setAsi(ab: Ability, n: number) {
    const abilities = { ...asi?.abilities };
    if (n) abilities[ab] = n;
    else delete abilities[ab];
    onanswer({ type: 'asi', abilities });
  }
  function setMode(m: string) {
    asiPick = m;
    onanswer({ type: 'asi' });
  }
</script>

{#snippet cards(list: Opt[], sel: string[], max: number, pick: (value: string, on: boolean) => void)}
  {#if list.length > LONG}
    <input type="search" aria-label="Search {p.sourceName}" placeholder="Search {list.length}…" bind:value={q} />
  {/if}
  {@const shown = visible(list, sel)}
  <ul class="plain cards">
    {#each shown as o (o.value)}
      {@const on = sel.includes(o.value)}
      {@const sum = choiceSummary(o.text, o.prereq)}
      <li class="opt">
        <label>
          <input type={max === 1 ? 'radio' : 'checkbox'} name="{uid}-pick" checked={on} disabled={!on && max > 1 && sel.length >= max}
            onchange={(e) => pick(o.value, e.currentTarget.checked)} />
          <span class="body">
            <strong>{o.label}</strong>
            {#if sum}<span class="sum">{sum}</span>{/if}
            {#if o.prereq && sum !== o.prereq && sum}<small class="muted">{o.prereq}</small>{/if}
          </span>
        </label>
        {#if o.text?.length || o.entity}
          <details class="more" ontoggle={(e) => (opened[o.value] = e.currentTarget.open)}>
            <summary>More<span class="sr-only"> about {o.label}</span></summary>
            {#if opened[o.value]}
              {#if o.entity}<EntityDetail entity={o.entity} {index} />{:else if o.text}<RichText text={o.text} />{/if}
            {/if}
          </details>
        {/if}
      </li>
    {/each}
  </ul>
  {#if shown.length < list.length}<p class="muted small">Showing {shown.length} of {list.length}. Search to narrow it down.</p>{/if}
  {#if !list.length}<p class="muted">Nothing to pick from (no matching content is loaded).</p>{/if}
{/snippet}

<fieldset class="card choice" aria-describedby="{uid}-meta{problem ? ` ${uid}-problem` : ''}">
  <legend>{p.sourceName}</legend>
  <p id="{uid}-meta" class="meta">
    {#if meta}<span class="muted">{meta}</span>{/if}
    {#if ch.type !== 'asi'}<strong class="pick">Pick {count}</strong><span class="muted">{picked.length} chosen</span>{/if}
  </p>

  {#if ch.type === 'asi'}
    <div class="row">
      <label class="check"><input type="radio" name="{uid}-mode" checked={asiMode === 'scores'} onchange={() => setMode('scores')} /> +2 to one score, or +1 to two</label>
      {#if settings.feats || asiMode === 'feat'}
        <label class="check"><input type="radio" name="{uid}-mode" checked={asiMode === 'feat'} onchange={() => setMode('feat')} /> A feat</label>
      {/if}
    </div>
    {#if asiMode === 'scores'}
      <div class="row">
        {#each ABILITIES as ab}
          <label class="field">
            {ABILITY_NAMES[ab]} ({sheet.scores[ab]})
            <select value={String(asi?.abilities?.[ab] ?? 0)} onchange={(e) => setAsi(ab, Number(e.currentTarget.value))}>
              <option value="0">—</option><option value="1">+1</option><option value="2">+2</option>
            </select>
          </label>
        {/each}
      </div>
    {:else}
      {@render cards(feats, asi?.featId ? [asi.featId] : [], 1, (v) => onanswer({ type: 'asi', featId: v }))}
    {/if}
  {:else}
    {@render cards(options, picked, count, toggle)}
  {/if}

  {#if problem}
    <p id="{uid}-problem" class:error={problem.blocking} class:muted={!problem.blocking}>{problem.message.slice(p.sourceName.length + 2)}</p>
  {/if}
</fieldset>

<style>
  /* One choice = a hairline group with its name as the legend (not a boxed card). */
  .choice {
    margin: 0.75rem 0;
    padding: 0.5rem 0 0.5rem 0.75rem;
    background: transparent;
    border: 0;
    border-left: 2px solid var(--line-strong);
    border-radius: 0;
  }

  legend {
    padding: 0;
    color: var(--text-strong);
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.6rem;
    margin: 0 0 0.5rem;
  }

  .pick {
    padding: 0 0.45rem;
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--accent);
    font-size: 0.85rem;
  }

  .small {
    font-size: 0.85rem;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: 0.5rem;
    align-items: start;
    margin: 0.5rem 0;
  }

  .opt {
    min-width: 0;
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .opt:hover {
    border-color: var(--line-strong);
  }

  /* Picked: the selected style (raised + accent bar). */
  .opt:has(input:checked) {
    border-color: var(--line-strong);
    box-shadow: inset 2px 0 var(--accent);
    background: var(--raised);
  }

  .opt:has(input:checked) strong {
    color: var(--text-strong);
  }

  .opt:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .opt:has(input:disabled) {
    opacity: 0.6;
  }

  .opt label {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.6rem 0.75rem;
    min-height: 2.75rem;
    box-sizing: border-box;
    cursor: pointer;
  }

  .opt input {
    flex: none;
    margin: 0.2rem 0 0;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .sum {
    font-size: 0.9rem;
    color: var(--muted);
  }

  .more {
    padding: 0 0.75rem 0.6rem 2.35rem;
  }

  .more summary {
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--accent);
    padding: 0.25rem 0;
  }
</style>
