<script lang="ts">
  import type { Problem } from '../../lib/character/build.ts';
  import type { PendingChoice } from '../../lib/character/choices.ts';
  import { fold } from '../../lib/content/ids.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { ABILITIES, SKILL_ABILITY } from '../../lib/rules/constants.ts';
  import type { Ability, CampaignSettings, Character, ChoiceAnswer, RichText as RT, Sheet } from '../../lib/types.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import FilterSelect from '../FilterSelect.svelte';
  import RichText from '../RichText.svelte';
  import { ABILITY_NAMES, LANGUAGES, byName, entityOption, titleCase } from './labels.ts';

  // Renders one PendingChoice of any type. Nested choices are separate PendingChoices (ChoicesStep lists them).
  let { pending: p, c, index, settings, sheet, problem, onanswer }: {
    pending: PendingChoice; c: Character; index: ContentIndex; settings: CampaignSettings; sheet: Sheet; problem?: Problem; onanswer: (a: ChoiceAnswer) => void;
  } = $props();

  const uid = $props.id();
  const ch = $derived(p.choice);
  const a = $derived(p.answer);
  const picked = $derived<string[]>(a?.type === 'ids' ? a.ids : a?.type === 'abilities' ? Object.keys(a.abilities).filter((k) => a.abilities[k as Ability]) : []);
  const count = $derived('count' in ch ? ch.count : 1);
  const feats = $derived(index.all('feat').sort(byName).map(entityOption));
  const uniq = (xs: string[]) => [...new Set(xs)];

  type Opt = { value: string; label: string; hint?: string; text?: RT };
  const options = $derived.by((): Opt[] => {
    const plain = (xs: string[]) => xs.map((x) => ({ value: x, label: titleCase(x) }));
    switch (ch.type) {
      case 'skill': return plain(ch.from === 'any' ? Object.keys(SKILL_ABILITY) : ch.from);
      case 'expertise': return plain(uniq([...Object.entries(sheet.skills).filter(([, s]) => s.proficient).map(([k]) => k), ...sheet.proficiencies.tools, ...picked]));
      case 'language': return (ch.from ?? LANGUAGES).filter((l) => picked.includes(l) || !sheet.proficiencies.languages.includes(l)).map((l) => ({ value: l, label: l }));
      case 'tool': return plain(ch.from ?? uniq(index.all('item').filter((i) => i.type === 'tool' && !i.magic).map((i) => i.name.toLowerCase())).sort());
      case 'ability': return ch.from.map((x) => ({ value: x, label: ABILITY_NAMES[x] }));
      case 'optionalFeature':
        return index.optionalFeatures(ch.featureTypes).sort(byName).map((o) => ({ ...entityOption(o), hint: o.prerequisite && `Prerequisite: ${o.prerequisite}`, text: o.text }));
      case 'option': return ch.options.map((t) => ({ value: t.name, label: t.name, text: t.text }));
      default: return [];
    }
  });
  const what = $derived(({ skill: 'skills', expertise: 'proficiencies for expertise', language: 'languages', tool: 'tools', ability: `abilities to raise by ${'amount' in ch ? ch.amount : 1}`, optionalFeature: 'options', option: 'options' } as Record<string, string>)[ch.type]);

  // Long lists (imported invocations, tools) get a search box and show at most 100 matches.
  let q = $state('');
  const shown = $derived.by(() => {
    if (options.length <= 30) return options;
    const n = fold(q.trim());
    return options.filter((o) => picked.includes(o.value) || fold(o.label).includes(n)).slice(0, 100);
  });

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

  const subclasses = $derived.by(() => {
    const owner = c.build.levels[p.level - 1]?.classId;
    return owner ? index.subclassesOf(owner).sort(byName).map(entityOption) : [];
  });
  const selectedFeat = $derived(index.resolve((ch.type === 'feat' ? picked[0] : asi?.featId) ?? ''));
</script>

<fieldset class="card" aria-describedby={problem ? `${uid}-problem` : undefined}>
  <legend>{p.sourceName}</legend>

  {#if ch.type === 'subclass'}
    <FilterSelect id="{uid}-sub" label="Subclass" options={subclasses} value={picked[0] ?? ''} onchange={(id) => onanswer({ type: 'ids', ids: id ? [id] : [] })} />
  {:else if ch.type === 'feat'}
    <FilterSelect id="{uid}-feat" label="Feat" options={feats} value={picked[0] ?? ''} onchange={(id) => onanswer({ type: 'ids', ids: id ? [id] : [] })} />
  {:else if ch.type === 'asi'}
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
      <FilterSelect id="{uid}-asifeat" label="Feat" options={feats} value={asi?.featId ?? ''} onchange={(id) => onanswer(id ? { type: 'asi', featId: id } : { type: 'asi' })} />
    {/if}
  {:else}
    <p class="muted">Choose {count} {what} ({picked.length} chosen).</p>
    {#if options.length > 30}
      <input type="search" aria-label="Search {p.sourceName}" placeholder="Search {options.length}…" bind:value={q} />
    {/if}
    <ul class="plain">
      {#each shown as o (o.value)}
        {@const on = picked.includes(o.value)}
        <li>
          <label class="check">
            <input type={count === 1 ? 'radio' : 'checkbox'} name="{uid}-pick" checked={on} disabled={!on && count > 1 && picked.length >= count}
              onchange={(e) => toggle(o.value, e.currentTarget.checked)} />
            <span>{o.label}{#if o.hint}<br /><small class="muted">{o.hint}</small>{/if}</span>
          </label>
          {#if o.text?.length}
            <details class="more"><summary>About {o.label}</summary><RichText text={o.text} /></details>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !options.length}<p class="muted">Nothing to pick from (no matching content is loaded).</p>{/if}
  {/if}

  {#if selectedFeat}
    <details class="more"><summary>About {selectedFeat.name}</summary><EntityDetail entity={selectedFeat} {index} /></details>
  {/if}

  {#if problem}
    <p id="{uid}-problem" class:error={problem.blocking} class:muted={!problem.blocking}>{problem.message.slice(p.sourceName.length + 2)}</p>
  {/if}
</fieldset>

<style>
  legend { font-weight: 600; padding: 0 0.25rem; }
  .more { margin: 0 0 0.5rem 1.8rem; }
  .check { margin: 0.25rem 0; }
</style>
