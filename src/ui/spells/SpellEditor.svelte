<script lang="ts">
  import { slug } from '../../lib/content/ids.ts';
  import { db } from '../../lib/db.ts';
  import { editableToRich, richToEditable } from '../../lib/items/textEdit.ts';
  import { leaveGuard } from '../../lib/router.svelte.ts';
  import type { SpellDef } from '../../lib/types.ts';
  import { message, titleCase } from '../creator/labels.ts';

  /**
   * Reviews a spell read from pasted text and saves it into the local homebrew pack "My spells" (R3: `pack:MYSPELLS`, merged
   * with mergePack so a save adds or replaces one spell). Unsaved until Save: leaving or Cancel asks first.
   */
  let { initial, notes = [], onsaved, oncancel }: { initial: SpellDef; notes?: string[]; onsaved: (s: SpellDef) => void; oncancel: () => void } = $props();

  const SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];
  const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  // svelte-ignore state_referenced_locally
  let s: SpellDef = $state(structuredClone($state.snapshot(initial) as SpellDef));
  // svelte-ignore state_referenced_locally
  let text = $state(richToEditable(initial.text));
  // svelte-ignore state_referenced_locally
  let higher = $state(richToEditable(initial.higherLevels ?? []));
  // svelte-ignore state_referenced_locally
  let classes = $state(initial.classes.map(titleCase).join(', '));
  let saving = $state(false);
  let saved = $state(false);
  let error = $state('');

  const discard = () => saved || confirm('Discard this pasted spell?');
  $effect(() => {
    const guard = discard;
    leaveGuard.fn = guard;
    return () => { if (leaveGuard.fn === guard) leaveGuard.fn = undefined; };
  });

  async function save() {
    error = '';
    if (!s.name.trim()) { error = 'Give the spell a name.'; return; }
    const spell: SpellDef = {
      ...($state.snapshot(s) as SpellDef),
      name: s.name.trim(),
      text: editableToRich(text),
      classes: classes.split(',').map((c) => slug(c.trim())).filter(Boolean),
    };
    const h = editableToRich(higher);
    if (h.length) spell.higherLevels = h;
    else delete spell.higherLevels;
    if (!spell.components.m?.trim()) delete spell.components.m;
    saving = true;
    try {
      const { mergePack } = await import('../../lib/import/fivetools/index.ts'); // the importer's chunk, loaded only on save
      const pack = mergePack(await db.packs.get('pack:MYSPELLS'), { id: 'pack:MYSPELLS', name: 'My spells', source: 'MYSPELLS', homebrew: true, importedAt: 0, hash: '', entities: [spell], patches: [] });
      await db.packs.put(pack);
      saved = true;
      onsaved(spell);
    } catch (e) {
      error = message(e);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onbeforeunload={(e) => { if (!saved) e.preventDefault(); }} />

<section class="editor" aria-labelledby="sp-h">
  <h2 id="sp-h">New spell</h2>
  {#if notes.length}
    <div role="note">
      <strong>Read from pasted text.</strong> Check these before saving:
      <ul>{#each notes as n}<li>{n}</li>{/each}</ul>
    </div>
  {/if}
  <div class="field"><label for="sp-name">Name</label><input id="sp-name" type="text" autocomplete="off" bind:value={s.name} /></div>
  <div class="row">
    <div class="field">
      <label for="sp-level">Level</label>
      <select id="sp-level" bind:value={s.level}>{#each LEVELS as n}<option value={n}>{n === 0 ? 'Cantrip' : n}</option>{/each}</select>
    </div>
    <div class="field">
      <label for="sp-school">School</label>
      <select id="sp-school" bind:value={s.school}>
        {#if !SCHOOLS.includes(s.school)}<option value={s.school}>{s.school}</option>{/if}
        {#each SCHOOLS as x}<option value={x}>{x}</option>{/each}
      </select>
    </div>
    <label class="check"><input type="checkbox" bind:checked={s.ritual} /> Ritual</label>
    <label class="check"><input type="checkbox" bind:checked={s.concentration} /> Concentration</label>
  </div>
  <div class="row">
    <div class="field"><label for="sp-time">Casting time</label><input id="sp-time" type="text" autocomplete="off" bind:value={s.castingTime} /></div>
    <div class="field"><label for="sp-range">Range</label><input id="sp-range" type="text" autocomplete="off" bind:value={s.range} /></div>
    <div class="field"><label for="sp-dur">Duration{s.concentration ? ' (after “Concentration,”)' : ''}</label><input id="sp-dur" type="text" autocomplete="off" bind:value={s.duration} /></div>
  </div>
  <fieldset>
    <legend>Components</legend>
    <div class="row">
      <label class="check"><input type="checkbox" checked={!!s.components.v} onchange={(e) => (e.currentTarget.checked ? (s.components.v = true) : delete s.components.v)} /> Verbal</label>
      <label class="check"><input type="checkbox" checked={!!s.components.s} onchange={(e) => (e.currentTarget.checked ? (s.components.s = true) : delete s.components.s)} /> Somatic</label>
      <div class="field grow"><label for="sp-m">Material (blank: none)</label><input id="sp-m" type="text" autocomplete="off" value={s.components.m ?? ''} oninput={(e) => (s.components.m = e.currentTarget.value)} /></div>
    </div>
  </fieldset>
  <div class="field"><label for="sp-classes">Classes (comma separated)</label><input id="sp-classes" type="text" autocomplete="off" placeholder="Sorcerer, Wizard" bind:value={classes} /></div>
  <div class="field"><label for="sp-text">Description</label><textarea id="sp-text" rows="6" bind:value={text}></textarea></div>
  <div class="field"><label for="sp-higher">At higher levels (optional)</label><textarea id="sp-higher" rows="3" bind:value={higher}></textarea></div>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <div class="row">
    <button type="button" class="primary" disabled={saving} onclick={save}>Save to My spells</button>
    <button type="button" onclick={() => discard() && oncancel()}>Cancel</button>
  </div>
</section>

<style>
  .editor { border-top: 1px solid var(--line); padding-top: 0.25rem; margin: 0.75rem 0; }
  h2 { margin-top: 0.5rem; }
  [role='note'] { border-left: 2px solid var(--accent); padding: 0.25rem 0.75rem; background: var(--panel); }
  fieldset { border: 0; border-top: 1px solid var(--line); border-radius: 0; padding: 0.25rem 0 0; min-width: 0; }
  legend { padding: 0 0.4rem 0 0; }
  .grow { flex: 1 1 14rem; margin: 0; }
  textarea { width: 100%; }
</style>
