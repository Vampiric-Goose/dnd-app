<script lang="ts">
  import { embedContent, spellLimits, spellPool } from '../../lib/character/build.ts';
  import { fold } from '../../lib/content/ids.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import type { CampaignSettings, Character, SpellDef } from '../../lib/types.ts';
  import { byName } from './labels.ts';

  let { c = $bindable(), index, settings }: { c: Character; index: ContentIndex; settings: CampaignSettings } = $props();

  const limits = $derived(spellLimits(embedContent(c, index), settings));
  const spells = $derived(index.all('spell').sort(byName));
  const spell = (id: string) => { const e = index.resolve(id); return e?.kind === 'spell' ? e : undefined; };

  /** Cantrips go in `known`; leveled spells in `known` (spells known, or a wizard's spellbook) and/or `prepared`. */
  type Section = { key: string; title: string; list: 'known' | 'prepared'; cantrip: boolean; max: number; pool: SpellDef[]; extra?: boolean };
  const sections = $derived(limits.map((lim) => {
    const cls = index.resolve(lim.classId);
    const name = cls?.name ?? lim.classId;
    const book = cls?.kind === 'class' && !!cls.spellcasting?.spellbook;
    // ponytail: subclass casters (Eldritch Knight, Arcane Trickster) borrow a list no data field names, so they see every spell.
    const onList = spellPool(spells, cls?.kind === 'class' ? cls : undefined, lim.maxLevel); // the same pool validation caps shortfalls at
    const picked = c.build.spells[lim.classId] ?? { known: [], prepared: [] };
    const out: Section[] = [];
    if (lim.cantrips) out.push({ key: `${lim.classId}|c`, title: 'Cantrips', list: 'known', cantrip: true, max: lim.cantrips, pool: onList.filter((s) => s.level === 0) });
    if (lim.known !== undefined && lim.maxLevel >= 1) out.push({ key: `${lim.classId}|k`, title: book ? 'Spellbook' : 'Spells known', list: 'known', cantrip: false, max: lim.known, pool: onList.filter((s) => s.level > 0), extra: book });
    if (lim.prepared !== undefined && lim.maxLevel >= 1) {
      const pool = book ? picked.known.map(spell).filter((s): s is SpellDef => !!s && s.level > 0) : onList.filter((s) => s.level > 0);
      out.push({ key: `${lim.classId}|p`, title: book ? 'Prepared (from your spellbook)' : 'Prepared', list: 'prepared', cantrip: false, max: lim.prepared, pool });
    }
    return { classId: lim.classId, name, maxLevel: lim.maxLevel, picked, sections: out };
  }));

  let q: Record<string, string> = $state({});
  let lvl: Record<string, string> = $state({});
  // Filter first: at most 100 rows render, the picked ones always.
  const CAP = 100;
  function visible(s: Section, picked: string[]) {
    const n = fold((q[s.key] ?? '').trim()), l = lvl[s.key] ?? '';
    const hits = s.pool.filter((sp) => picked.includes(sp.id) || ((!l || sp.level === +l) && fold(sp.name).includes(n)));
    return { rows: hits.slice(0, CAP), more: hits.length - CAP };
  }
  const count = (ids: string[], cantrip: boolean) => ids.filter((id) => (spell(id)?.level === 0) === cantrip).length;

  function toggle(classId: string, list: 'known' | 'prepared', id: string, on: boolean) {
    const cur = c.build.spells[classId] ?? { known: [], prepared: [] };
    const next = { known: [...cur.known], prepared: [...cur.prepared] };
    next[list] = on ? [...next[list], id] : next[list].filter((x) => x !== id);
    if (!on && list === 'known') next.prepared = next.prepared.filter((x) => x !== id); // out of the book, so not prepared either
    c.build.spells = { ...c.build.spells, [classId]: next };
  }
</script>

{#if !limits.length}
  <p class="muted">No spellcasting at this level.</p>
{/if}

{#each sections as cl (cl.classId)}
  <section>
    <h3>{cl.name} {#if cl.maxLevel}<span class="muted">(spells up to level {cl.maxLevel})</span>{/if}</h3>
    {#if !cl.sections.length}<p class="muted">No spells to pick until this class has spell slots.</p>{/if}
    {#each cl.sections as s (s.key)}
      {@const ids = cl.picked[s.list]}
      {@const n = count(ids, s.cantrip)}
      {@const v = visible(s, ids)}
      <fieldset class="list-set">
        <legend>{s.title}: <span class:error={n > s.max && !s.extra}>{n} / {s.max}</span></legend>
        {#if n < Math.min(s.max, s.pool.length)}<p class="muted">Pick {Math.min(s.max, s.pool.length) - n} more.</p>{/if}
        <div class="row">
          <input type="search" aria-label="Search {s.title}" placeholder="Search…" value={q[s.key] ?? ''} oninput={(e) => (q[s.key] = e.currentTarget.value)} />
          {#if !s.cantrip && cl.maxLevel > 1}
            <select aria-label="{s.title} level" value={lvl[s.key] ?? ''} onchange={(e) => (lvl[s.key] = e.currentTarget.value)}>
              <option value="">All levels</option>
              {#each Array.from({ length: cl.maxLevel }, (_, i) => i + 1) as L}<option value={String(L)}>Level {L}</option>{/each}
            </select>
          {/if}
        </div>
        <ul class="plain list">
          {#each v.rows as sp (sp.id)}
            {@const on = ids.includes(sp.id)}
            <li>
              <label class="check">
                <input type="checkbox" checked={on} disabled={!on && n >= s.max && !s.extra && !settings.allowOverrides}
                  onchange={(e) => toggle(cl.classId, s.list, sp.id, e.currentTarget.checked)} />
                <span>{sp.name} <small class="muted">{sp.level ? `level ${sp.level}` : 'cantrip'}, {sp.school}{sp.source === 'SRD' ? '' : `, ${sp.source}`}</small></span>
              </label>
            </li>
          {/each}
        </ul>
        {#if v.more > 0}<p class="muted">{v.more} more match. Narrow the search.</p>{/if}
        {#if !s.pool.length}<p class="muted">{s.list === 'prepared' ? 'Add spells to the spellbook first.' : 'No spells on this list.'}</p>{/if}
      </fieldset>
    {/each}
  </section>
{/each}

<style>
  .list-set { margin: 0.75rem 0; }
  .list { max-height: 24rem; overflow-y: auto; }
  .check { margin: 0.2rem 0; }
</style>
