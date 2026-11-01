<script lang="ts">
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { parseInline } from '../../lib/content/richtext.ts';
  import { legendaryIntro, rollParts, SIZE_NAMES, spellLine } from '../../lib/monsters/library.ts';
  import { ABILITIES } from '../../lib/rules/constants.ts';
  import { abilityMod } from '../../lib/rules/constants.ts';
  import { crProf, monsterXp } from '../../lib/rules/monsters.ts';
  import type { Block, MonsterDef, RichText as RT, Trait } from '../../lib/types.ts';
  import { signed, titleCase } from '../creator/labels.ts';
  import RichText from '../RichText.svelte';
  import { rollTo } from '../sheet/roll.ts';

  let { monster: m, index }: { monster: MonsterDef; index?: ContentIndex } = $props();

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  // Entries that already hold commas ("bludgeoning, piercing, and slashing from nonmagical attacks") are separated by semicolons, as in the book.
  const list = (xs: readonly string[]) => xs.join(xs.some((x) => x.includes(',')) ? '; ' : ', ');
  const skillName = (s: string) => titleCase(s).replace(/ Of /g, ' of ');

  const ac = $derived(m.ac.map((a) => `${a.value}${a.from ? ` (${a.from})` : ''}`).join(', '));
  const speed = $derived.by(() => {
    const { walk, hover, note, ...rest } = m.speed;
    const parts = [`${walk} ft.`, ...Object.entries(rest).map(([k, v]) => `${k} ${v} ft.${k === 'fly' && hover ? ' (hover)' : ''}`)];
    return parts.join(', ') + (note ? `, ${note}` : '');
  });
  const saves = $derived(ABILITIES.filter((a) => m.saves[a] !== undefined).map((a) => `${cap(a)} ${signed(m.saves[a]!)}`).join(', '));
  const skills = $derived(Object.entries(m.skills).map(([s, n]) => `${skillName(s)} ${signed(n)}`).join(', '));
  const xp = $derived(monsterXp(m));
  const prof = $derived(crProf(m.cr));
  const facts = $derived<[string, string][]>(([
    ['Saving Throws', saves],
    ['Skills', skills],
    ['Damage Vulnerabilities', list(m.vulnerable)],
    ['Damage Resistances', list(m.resist)],
    ['Damage Immunities', list(m.immune)],
    ['Condition Immunities', list(m.conditionImmune)],
    ['Senses', [...m.senses, `passive Perception ${m.passive}`].join(', ')],
    ['Languages', m.languages.join(', ') || '—'],
    ['Challenge', `${m.cr}${xp !== undefined ? ` (${xp.toLocaleString('en-US')} XP)` : ''}`],
    ['Proficiency Bonus', prof !== undefined ? signed(prof) : ''],
  ] as [string, string][]).filter(([, v]) => v));

  const secret = (label: string, expr: string) => rollTo(label, expr, { public: false }); // R6: stat-block rolls are always private
  const label = (t: Trait, hit: boolean) => `${m.name}: ${t.name.replace(/\s*\(.*\)$/, '')} ${hit ? 'attack' : 'damage'}`;
  const ended = (name: string) => (/[.!?:]$/.test(name) ? name : `${name}.`);
  const isSpells = (t: Trait) => /spellcasting/i.test(t.name);
</script>

<!-- One string: marks as in RichText, with attack bonuses and dice as buttons that roll in the dice tray. -->
{#snippet inline(s: string, t?: Trait)}
  {#each parseInline(s) as span}
    {#snippet body()}
      {#each rollParts(span.t) as p}
        {#if 'expr' in p && t}
          <button type="button" class="roll" aria-label="Roll {label(t, p.hit)}, {p.t}" onclick={() => secret(label(t, p.hit), p.expr)}>{p.t}</button>
        {:else}{p.t}{/if}
      {/each}
    {/snippet}
    {#if span.b && span.i}<strong><em>{@render body()}</em></strong>{:else if span.b}<strong>{@render body()}</strong>{:else if span.i}<em>{@render body()}</em>{:else}{@render body()}{/if}
  {/each}
{/snippet}

<!-- A spellcasting group on its own line: the label, then the spell names in italics. -->
{#snippet line(s: string, t: Trait)}
  {@const sp = isSpells(t) ? spellLine(s) : undefined}
  {#if sp}<p class="spells">{sp.label}: <em>{sp.spells}</em></p>{:else}<p>{@render inline(s, t)}</p>{/if}
{/snippet}

<!-- Paragraphs and lists roll; tables and headings go through RichText unchanged. -->
{#snippet blocks(bs: RT, t?: Trait)}
  {#each bs as b}
    {#if 'p' in b}
      {#if t}{@render line(b.p, t)}{:else}<p>{@render inline(b.p)}</p>{/if}
    {:else if 'list' in b && t && isSpells(t) && b.list.every((s) => spellLine(s))}
      {#each b.list as s}{@render line(s, t)}{/each}
    {:else if 'list' in b}
      <ul>{#each b.list as s}<li>{@render inline(s, t)}</li>{/each}</ul>
    {:else}
      <RichText text={[b as Block]} />
    {/if}
  {/each}
{/snippet}

{#snippet traits(ts: Trait[])}
  {#each ts as t}
    {@const [first, ...rest] = t.text}
    <div class="trait">
      {#if first && 'p' in first && !(isSpells(t) && spellLine(first.p))}
        <p><strong><em>{ended(t.name)}</em></strong> {@render inline(first.p, t)}</p>
        {@render blocks(rest, t)}
      {:else}
        <p><strong><em>{ended(t.name)}</em></strong></p>
        {@render blocks(t.text, t)}
      {/if}
    </div>
  {/each}
{/snippet}

{#snippet section(title: string, ts: Trait[], intro?: RT | string)}
  {#if ts.length}
    <h3>{title}</h3>
    {#if typeof intro === 'string'}<p>{intro}</p>{:else if intro?.length}{@render blocks(intro)}{/if}
    {@render traits(ts)}
  {/if}
{/snippet}

{#snippet prose(title: string, text: RT | undefined)}
  {#if text?.length}
    <h3>{title}</h3>
    {@render blocks(text, { name: title, text })}
  {/if}
{/snippet}

<article class="statblock">
  <h2>{m.name}</h2>
  <p class="sub"><em>{m.size.map((s) => SIZE_NAMES[s]).join(' or ')} {m.type}, {m.alignment}</em>
    · <span class="muted" title={m.source}>{index?.label(m.source) ?? m.source}</span></p>
  <hr />
  <p><strong>Armor Class</strong> {ac}</p>
  <p><strong>Hit Points</strong>
    {#if 'special' in m.hp}{m.hp.special}{:else}{@const f = m.hp.formula}{m.hp.average}{#if f}{' '}(<button type="button" class="roll" aria-label="Roll {m.name} hit points, {f}" onclick={() => secret(`${m.name}: hit points`, f.replace(/[−–]/g, '-'))}>{f}</button>){/if}{/if}
  </p>
  <p><strong>Speed</strong> {speed}</p>
  <hr />
  <dl class="scores">
    {#each ABILITIES as a}
      <div><dt>{a.toUpperCase()}</dt><dd class="num">{m.scores[a]} ({signed(abilityMod(m.scores[a]))})</dd></div>
    {/each}
  </dl>
  <hr />
  {#each facts as [k, v]}<p><strong>{k}</strong> {v}</p>{/each}
  <hr />
  {@render traits(m.traits)}
  {@render section('Actions', m.actions)}
  {@render section('Bonus Actions', m.bonusActions)}
  {@render section('Reactions', m.reactions)}
  {@render section('Legendary Actions', m.legendary, m.legendaryIntro?.length ? m.legendaryIntro : legendaryIntro(m))}
  {@render section('Mythic Actions', m.mythic ?? [], m.mythicIntro)}
  {@render prose('Lair Actions', m.lair)}
  {@render prose('Regional Effects', m.regional)}
</article>

<style>
  /* Container query: a very narrow container gets a 3-column score grid. */
  .statblock { max-width: 42rem; container-type: inline-size; }
  h2 { margin: 0.25rem 0 0; font-variant: small-caps; letter-spacing: 0.02em; }
  h3 { margin: 1rem 0 0.25rem; padding-bottom: 0.15rem; border-bottom: 1px solid var(--line-strong); color: var(--accent); font-variant: small-caps; font-weight: 600; letter-spacing: 0.03em; }
  .sub { margin: 0 0 0.5rem; }
  p { margin: 0.25rem 0; }
  strong { color: var(--text-strong); }
  hr { border: 0; border-top: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line)); margin: 0.5rem 0; }
  .scores { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0.25rem; margin: 0; text-align: center; }
  .scores dt { color: var(--label); font-size: 0.72rem; letter-spacing: 0.12em; }
  .scores dd { margin: 0; font-size: 0.9rem; color: var(--text-strong); } /* wraps "23 (+6)" to two lines in a narrow column */
  .trait { margin: 0.5rem 0; }
  .spells { padding-left: 1rem; }
  ul { margin: 0.25rem 0; padding-left: 1.25rem; }
  .roll {
    min-height: 0;
    padding: 0;
    border: 0;
    border-bottom: 1px dashed var(--accent);
    border-radius: 0;
    background: none;
    color: var(--accent);
    font: inherit;
  }

  .roll:hover:not(:disabled) {
    background: none;
    border-bottom-style: solid;
  }

  @container (max-width: 15rem) {
    .scores { grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 0.4rem; }
  }
</style>
