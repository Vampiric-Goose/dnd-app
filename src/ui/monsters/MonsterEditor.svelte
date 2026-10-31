<script lang="ts">
  import { tick } from 'svelte';
  import { db } from '../../lib/db.ts';
  import { editableToRich, richToEditable } from '../../lib/items/textEdit.ts';
  import { estimateAttack, estimateDpr, joinList, splitList } from '../../lib/monsters/editing.ts';
  import { blankMonster, duplicateMonster, newMonsterId, soundMonster } from '../../lib/monsters/homebrew.ts';
  import { SIZE_NAMES } from '../../lib/monsters/library.ts';
  import { leaveGuard, navigate } from '../../lib/router.svelte.ts';
  import { ABILITIES, abilityMod, ALIGNMENTS, SKILL_ABILITY } from '../../lib/rules/constants.ts';
  import { CR_LADDER, crProf, hitDieFor, hpAverage, hpFormula, monsterXp, suggestCr } from '../../lib/rules/monsters.ts';
  import { app } from '../../lib/store.svelte.ts';
  import type { Ability, MonsterDef, RichText, Size, Skill, StoredMonster, Trait } from '../../lib/types.ts';
  import { ABILITY_NAMES, message, signed, titleCase } from '../creator/labels.ts';
  import TraitListEditor from './TraitListEditor.svelte';

  /**
   * `initial`: a stored monster to edit. Without it the editor makes a new one: from `draft` when given (a Duplicate, or R1: a
   * stat block parsed from pasted text), else blank. A draft is unsaved until Save, so leaving asks first.
   */
  let { campaignId, initial, draft }: { campaignId: string; initial?: StoredMonster; draft?: MonsterDef } = $props();

  const SKILLS = Object.keys(SKILL_ABILITY) as Skill[];
  const SPEEDS = ['walk', 'fly', 'swim', 'climb', 'burrow'] as const;
  const SECTIONS = [['traits', 'Traits'], ['actions', 'Actions'], ['bonusActions', 'Bonus actions'], ['reactions', 'Reactions'], ['legendary', 'Legendary actions']] as const;
  const num = (s: string): number | undefined => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));
  const whole = (s: string) => /^\d+$/.test(s.trim());
  const skillName = (s: string) => titleCase(s).replace(/ Of /g, ' of ');
  const edit = (r: RichText | undefined) => richToEditable(r ?? []);

  // svelte-ignore state_referenced_locally
  const start: StoredMonster = initial ? $state.snapshot(initial) as StoredMonster : draft ? duplicateMonster($state.snapshot(draft) as MonsterDef, campaignId) : blankMonster(campaignId);
  let m: StoredMonster = $state(structuredClone(start));
  // svelte-ignore state_referenced_locally
  let saved = $state(!!initial); // stored at least once, so `m.id` is real
  let saving = $state(false);
  let error = $state('');
  let notice = $state('');
  let confirmingDelete = $state(false);
  let delBtn: HTMLButtonElement | undefined = $state();

  // Fields that need typing room keep their own strings; `assembled` folds them into the monster and problem() checks them.
  let hpMode = $state<'dice' | 'special'>('special' in start.hp ? 'special' : 'dice');
  let hpCount = $state(String('formula' in start.hp && /^\s*(\d+)\s*d/.exec(start.hp.formula ?? '')?.[1] || 1));
  let hpSpecial = $state('special' in start.hp ? start.hp.special : '');
  let speeds = $state(Object.fromEntries(SPEEDS.map((k) => [k, start.speed[k] === undefined ? '' : String(start.speed[k])])) as Record<(typeof SPEEDS)[number], string>);
  const passiveDefault = (x: MonsterDef) => 10 + (x.skills.perception ?? abilityMod(x.scores.wis));
  let passive = $state(start.passive === passiveDefault(start) ? '' : String(start.passive));
  let lists = $state({ vulnerable: joinList(start.vulnerable), resist: joinList(start.resist), immune: joinList(start.immune), conditionImmune: joinList(start.conditionImmune), senses: joinList(start.senses), languages: joinList(start.languages) });
  let texts = $state({ legendaryIntro: edit(start.legendaryIntro), mythicIntro: edit(start.mythicIntro), lair: edit(start.lair), regional: edit(start.regional) });

  const size = $derived<Size>(m.size[0] ?? 'M');
  const formula = $derived(whole(hpCount) && +hpCount > 0 ? hpFormula(+hpCount, size, m.scores.con) : '');
  const prof = $derived(crProf(m.cr) ?? 2);

  // The monster as it would be saved.
  const assembled = $derived.by((): StoredMonster => {
    const out = $state.snapshot(m) as StoredMonster;
    out.name = out.name.trim();
    out.type = out.type.trim();
    out.alignment = out.alignment.trim();
    out.ac = out.ac.map((a) => (a.from?.trim() ? { value: a.value, from: a.from.trim() } : { value: a.value }));
    out.hp = hpMode === 'special' ? { special: hpSpecial.trim() } : { average: hpAverage(formula) ?? 0, formula };
    const sp: StoredMonster['speed'] = { walk: num(speeds.walk) ?? 0 };
    for (const k of SPEEDS.slice(1)) { const v = num(speeds[k]); if (v) sp[k] = v; }
    if (sp.fly && m.speed.hover) sp.hover = true;
    if (m.speed.note?.trim()) sp.note = m.speed.note.trim();
    out.speed = sp;
    for (const k of Object.keys(lists) as (keyof typeof lists)[]) out[k] = splitList(lists[k]);
    out.passive = num(passive) ?? passiveDefault(out);
    for (const k of Object.keys(texts) as (keyof typeof texts)[]) {
      const r = editableToRich(texts[k]);
      if (r.length) out[k] = r;
      else delete out[k];
    }
    if (out.mythic && !out.mythic.length) delete out.mythic;
    return out;
  });

  // Unsaved work: everything the editor holds, compared with what it held at the last load or save.
  const snapshotKey = (id = m.id) => JSON.stringify([{ ...$state.snapshot(m), id }, hpMode, hpCount, hpSpecial, speeds, passive, lists, texts]);
  let baseline = $state(snapshotKey());
  const dirty = $derived((!saved && !!draft) || snapshotKey() !== baseline);

  $effect(() => {
    const guard = () => !dirty || confirm('Discard unsaved changes to this monster?');
    leaveGuard.fn = guard;
    return () => { if (leaveGuard.fn === guard) leaveGuard.fn = undefined; };
  });

  // CR: changing it drops a printed XP figure, which belonged to the old CR.
  const setCr = (cr: string) => { m.cr = cr; delete m.xp; };
  const setBonus = (k: 'saves' | 'skills', key: string, s: string) => {
    const v = num(s), o = m[k] as Record<string, number>;
    if (v === undefined) delete o[key];
    else o[key] = v;
  };
  const profBonus = (a: Ability) => abilityMod(m.scores[a] ?? 10) + prof;
  const setTraits = (k: (typeof SECTIONS)[number][0] | 'mythic', ts: Trait[]) => { m[k] = ts; };

  // CR suggestion (campaign setting): DPR and attack/DC start from the actions and can be overwritten.
  const showCr = $derived(!!app.campaign?.settings.crSuggestion);
  const est = $derived({ dpr: estimateDpr(assembled), ...estimateAttack(assembled) });
  let dprIn: string | undefined = $state();
  let attackIn: string | undefined = $state();
  let dcIn: string | undefined = $state();
  const dpr = $derived(dprIn ?? String(est.dpr));
  const attack = $derived(attackIn ?? (est.attack === undefined ? '' : String(est.attack)));
  const dc = $derived(dcIn ?? (est.dc === undefined ? '' : String(est.dc)));
  const suggestion = $derived(suggestCr({ hp: 'average' in assembled.hp ? assembled.hp.average : 0, ac: assembled.ac[0]?.value ?? 10, dpr: num(dpr) ?? 0, attack: num(attack), dc: num(dc) }));

  function problem(): string {
    const x = assembled;
    if (!x.name) return 'Give the monster a name.';
    if (!x.type) return 'Give the monster a type, such as humanoid or dragon.';
    if (!x.ac.length || x.ac.some((a) => !Number.isFinite(a.value))) return 'Each armor class needs a number.';
    if (hpMode === 'dice' && !(whole(hpCount) && +hpCount > 0 && +hpCount < 1000)) return 'Hit dice must be a whole number from 1 to 999.';
    if (hpMode === 'special' && !hpSpecial.trim()) return 'Describe the special hit points, or switch to hit dice.';
    if (ABILITIES.some((a) => !Number.isInteger(m.scores[a]) || m.scores[a] < 1 || m.scores[a] > 30)) return 'Ability scores must be whole numbers from 1 to 30.';
    for (const k of SPEEDS) if (speeds[k].trim() && !whole(speeds[k])) return `${titleCase(k)} speed must be a whole number of feet (or blank).`;
    if (passive.trim() && num(passive) === undefined) return 'Passive Perception must be a number (or blank for the default).';
    if (!soundMonster(x)) return 'Something in this monster is not valid; check the numbers.';
    return '';
  }

  async function save(): Promise<boolean> {
    if (saving) return false;
    error = notice = '';
    const p = problem();
    if (p) { error = p; return false; }
    const out = { ...assembled, id: saved ? m.id : newMonsterId(), campaignId };
    const key = snapshotKey(out.id); // taken before the write: an edit made while it runs must stay unsaved (dirty)
    saving = true;
    try {
      await db.monsters.put(out);
    } catch (e) {
      error = message(e);
      return false;
    } finally {
      saving = false;
    }
    const fresh = !saved;
    m.id = out.id;
    saved = true;
    baseline = key; // before navigating: the leave guard must see a clean editor
    notice = 'Saved.';
    if (fresh) navigate(`monsters/${out.id}/edit`);
    return true;
  }

  async function askDelete() {
    confirmingDelete = true;
    await tick();
    delBtn?.focus();
  }

  async function remove() {
    try {
      await db.monsters.delete(m.id);
      baseline = snapshotKey(); // deleted: nothing left to lose
      saved = false;
      navigate('monsters');
    } catch (e) {
      error = message(e);
    }
  }
</script>

<svelte:window onbeforeunload={(e) => { if (dirty) e.preventDefault(); }} />

<p><a href={saved ? `#/monsters?id=${encodeURIComponent(m.id)}` : '#/monsters'}>Back to monsters</a></p>
<h1>{saved ? m.name || 'Monster' : 'New monster'}</h1>

<div class="card">
  <div class="field"><label for="mo-name">Name</label><input id="mo-name" type="text" autocomplete="off" bind:value={m.name} /></div>
  <div class="row">
    <div class="field">
      <label for="mo-size">Size</label>
      <select id="mo-size" value={size} onchange={(e) => (m.size = [e.currentTarget.value as Size])}>
        {#each Object.entries(SIZE_NAMES) as [k, v]}<option value={k}>{v}</option>{/each}
      </select>
    </div>
    <div class="field"><label for="mo-type">Type</label><input id="mo-type" type="text" autocomplete="off" placeholder="humanoid (goblinoid)" bind:value={m.type} /></div>
    <div class="field">
      <label for="mo-align">Alignment</label>
      <input id="mo-align" type="text" autocomplete="off" list="mo-aligns" bind:value={m.alignment} />
      <datalist id="mo-aligns">{#each [...ALIGNMENTS.map((a) => a.toLowerCase()), 'unaligned', 'any alignment'] as a}<option value={a}></option>{/each}</datalist>
    </div>
  </div>
</div>

<h2>Defense</h2>
<div class="card">
  <fieldset>
    <legend>Armor class</legend>
    {#each m.ac as a, i}
      <div class="row">
        <div class="field"><label for="mo-ac-{i}">Armor class</label><input id="mo-ac-{i}" type="number" bind:value={a.value} /></div>
        <div class="field"><label for="mo-acf-{i}">From (optional)</label><input id="mo-acf-{i}" type="text" autocomplete="off" placeholder="natural armor" value={a.from ?? ''} oninput={(e) => (a.from = e.currentTarget.value)} /></div>
        {#if m.ac.length > 1}<button type="button" class="danger" onclick={() => m.ac.splice(i, 1)}>Remove</button>{/if}
      </div>
    {/each}
    <button type="button" onclick={() => m.ac.push({ value: m.ac[0]?.value ?? 10 })}>Add another armor class</button>
  </fieldset>

  <fieldset>
    <legend>Hit points</legend>
    <div class="row">
      <label class="check"><input type="radio" name="mo-hp" value="dice" bind:group={hpMode} /> Hit dice</label>
      <label class="check"><input type="radio" name="mo-hp" value="special" bind:group={hpMode} /> Special</label>
    </div>
    {#if hpMode === 'dice'}
      <div class="row">
        <div class="field"><label for="mo-hd">Hit dice (d{hitDieFor(size)} for {SIZE_NAMES[size]})</label><input id="mo-hd" type="text" inputmode="numeric" autocomplete="off" bind:value={hpCount} /></div>
        <p aria-live="polite">{#if formula}<strong>{hpAverage(formula)}</strong> ({formula}){/if}</p>
      </div>
    {:else}
      <div class="field"><label for="mo-hps">Special hit points</label><input id="mo-hps" type="text" autocomplete="off" placeholder="equal to the summoner's level × 5" bind:value={hpSpecial} /></div>
    {/if}
  </fieldset>

  <div class="row">
    {#each SPEEDS as k}
      <div class="field narrow"><label for="mo-sp-{k}">{titleCase(k)} (ft)</label><input id="mo-sp-{k}" type="text" inputmode="numeric" autocomplete="off" bind:value={speeds[k]} /></div>
    {/each}
    <label class="check"><input type="checkbox" checked={!!m.speed.hover} onchange={(e) => (e.currentTarget.checked ? (m.speed.hover = true) : delete m.speed.hover)} /> Hovers</label>
  </div>
  <div class="field"><label for="mo-spn">Speed note (optional)</label><input id="mo-spn" type="text" autocomplete="off" value={m.speed.note ?? ''} oninput={(e) => (m.speed.note = e.currentTarget.value)} /></div>

  {#each [['vulnerable', 'Damage vulnerabilities'], ['resist', 'Damage resistances'], ['immune', 'Damage immunities'], ['conditionImmune', 'Condition immunities']] as const as [k, label]}
    <div class="field"><label for="mo-{k}">{label} (comma separated)</label><input id="mo-{k}" type="text" autocomplete="off" bind:value={lists[k]} /></div>
  {/each}
</div>

<h2>Abilities</h2>
<div class="card">
  <div class="row">
    {#each ABILITIES as a}
      <div class="field narrow"><label for="mo-{a}">{ABILITY_NAMES[a]}</label><input id="mo-{a}" type="number" min="1" max="30" bind:value={m.scores[a]} /></div>
    {/each}
  </div>
  <p class="muted">“Proficient” fills the ability modifier plus the proficiency bonus for CR {m.cr} ({signed(prof)}); you can change the number after.</p>
  <h3>Saving throws</h3>
  <div class="grid">
    {#each ABILITIES as a}
      <div class="bonus">
        <label for="mo-save-{a}">{ABILITY_NAMES[a]}</label>
        <input id="mo-save-{a}" type="text" inputmode="numeric" autocomplete="off" value={m.saves[a] ?? ''} oninput={(e) => setBonus('saves', a, e.currentTarget.value)} />
        <button type="button" aria-label="{ABILITY_NAMES[a]} save proficient" onclick={() => (m.saves[a] = profBonus(a))}>Proficient</button>
      </div>
    {/each}
  </div>
  <h3>Skills</h3>
  <div class="grid">
    {#each SKILLS as s}
      <div class="bonus">
        <label for="mo-skill-{s}">{skillName(s)}</label>
        <input id="mo-skill-{s}" type="text" inputmode="numeric" autocomplete="off" value={m.skills[s] ?? ''} oninput={(e) => setBonus('skills', s, e.currentTarget.value)} />
        <button type="button" aria-label="{skillName(s)} proficient" onclick={() => (m.skills[s] = profBonus(SKILL_ABILITY[s]))}>Proficient</button>
      </div>
    {/each}
  </div>
  <div class="field"><label for="mo-senses">Senses (comma separated)</label><input id="mo-senses" type="text" autocomplete="off" placeholder="darkvision 60 ft." bind:value={lists.senses} /></div>
  <div class="field narrow"><label for="mo-passive">Passive Perception</label><input id="mo-passive" type="text" inputmode="numeric" autocomplete="off" placeholder={String(passiveDefault(assembled))} bind:value={passive} /></div>
  <div class="field"><label for="mo-langs">Languages (comma separated)</label><input id="mo-langs" type="text" autocomplete="off" bind:value={lists.languages} /></div>
</div>

<h2>Challenge</h2>
<div class="card">
  <div class="row">
    <div class="field">
      <label for="mo-cr">Challenge rating</label>
      <select id="mo-cr" value={m.cr} onchange={(e) => setCr(e.currentTarget.value)}>
        {#if !CR_LADDER.includes(m.cr)}<option value={m.cr}>{m.cr}</option>{/if}
        {#each CR_LADDER as c}<option value={c}>{c}</option>{/each}
      </select>
    </div>
    <p>{(monsterXp(m) ?? 0).toLocaleString('en-US')} XP · Proficiency Bonus {signed(prof)}</p>
  </div>
  {#if showCr}
    <section class="suggest" aria-labelledby="mo-sugg">
      <p id="mo-sugg"><strong>Suggested CR: {suggestion.cr}</strong> (defensive {suggestion.defensive}, offensive {suggestion.offensive})</p>
      <div class="row">
        <div class="field narrow"><label for="mo-dpr">Damage per round</label><input id="mo-dpr" type="text" inputmode="numeric" autocomplete="off" value={dpr} oninput={(e) => (dprIn = e.currentTarget.value)} /></div>
        <div class="field narrow"><label for="mo-atk">Attack bonus</label><input id="mo-atk" type="text" inputmode="numeric" autocomplete="off" value={attack} oninput={(e) => (attackIn = e.currentTarget.value)} /></div>
        <div class="field narrow"><label for="mo-dc">Save DC (used without an attack bonus)</label><input id="mo-dc" type="text" inputmode="numeric" autocomplete="off" value={dc} oninput={(e) => (dcIn = e.currentTarget.value)} /></div>
        <button type="button" disabled={suggestion.cr === m.cr} onclick={() => setCr(suggestion.cr)}>Use {suggestion.cr}</button>
      </div>
      <p class="muted">Hit points and armor class come from above; damage and attack start from the actions.</p>
    </section>
  {/if}
</div>

<h2>Traits and actions</h2>
<p class="muted">Text: blank line between paragraphs, "- " for list items, **bold** and *italic*. Write attacks as in the book (“+4 to hit … Hit: 5 (1d6 + 2) slashing damage”) so they roll from the stat block.</p>
{#each SECTIONS as [k, label]}
  <TraitListEditor id="mo-{k}" {label} traits={m[k]} onchange={(ts) => setTraits(k, ts)} />
  {#if k === 'legendary'}
    <div class="row">
      <div class="field narrow"><label for="mo-lcount">Legendary actions per round</label><input id="mo-lcount" type="number" min="1" value={m.legendaryCount ?? ''} oninput={(e) => { const v = num(e.currentTarget.value); if (v) m.legendaryCount = v; else delete m.legendaryCount; }} /></div>
    </div>
    <div class="field"><label for="mo-lintro">Legendary actions intro (optional; blank uses the standard text)</label><textarea id="mo-lintro" rows="2" bind:value={texts.legendaryIntro}></textarea></div>
  {/if}
{/each}
<TraitListEditor id="mo-mythic" label="Mythic actions" traits={m.mythic ?? []} onchange={(ts) => setTraits('mythic', ts)} />
<div class="field"><label for="mo-mintro">Mythic actions intro (optional)</label><textarea id="mo-mintro" rows="2" bind:value={texts.mythicIntro}></textarea></div>
<div class="field"><label for="mo-lair">Lair actions</label><textarea id="mo-lair" rows="4" bind:value={texts.lair}></textarea></div>
<div class="field"><label for="mo-regional">Regional effects</label><textarea id="mo-regional" rows="4" bind:value={texts.regional}></textarea></div>

{#if error}<p role="alert" class="error">{error}</p>{/if}
{#if notice && !dirty}<p role="status">{notice}</p>{/if}
<div class="row">
  <button type="button" class="primary" disabled={saving} onclick={save}>Save monster</button>
  {#if saved}<button type="button" class="danger" onclick={askDelete}>Delete</button>{/if}
  {#if dirty}<span class="muted">Unsaved changes</span>{/if}
</div>
{#if confirmingDelete}
  <div role="alertdialog" aria-label="Confirm delete" aria-describedby="mo-del-msg" class="row">
    <p id="mo-del-msg">Delete “{m.name}”? This cannot be undone.</p>
    <button type="button" class="danger" bind:this={delBtn} onclick={remove}>Delete monster</button>
    <button type="button" onclick={() => (confirmingDelete = false)}>Keep it</button>
  </div>
{/if}

<style>
  fieldset { border: 1px solid var(--border); border-radius: 0.5rem; margin: 0.75rem 0; min-width: 0; }
  .narrow input { width: 7rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.25rem 1rem; }
  .bonus { display: grid; grid-template-columns: 1fr 4rem auto; align-items: center; gap: 0.4rem; }
  .bonus input { width: 4rem; }
  .suggest { border-top: 1px solid var(--border); margin-top: 0.5rem; }
  textarea {
    font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--border); border-radius: 0.35rem;
    padding: 0.4rem 0.7rem; width: 100%; box-sizing: border-box;
  }
</style>
