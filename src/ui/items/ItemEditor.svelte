<script lang="ts">
  import { tick } from 'svelte';
  import { parseDice } from '../../lib/dice.ts';
  import { exportRecord } from '../../lib/backup.ts';
  import { db } from '../../lib/db.ts';
  import { redactionIds } from '../../lib/content/richtext.ts';
  import { newHomebrewId } from '../../lib/items/homebrew.ts';
  import { choiceTexts } from '../../lib/items/playerView.ts';
  import { stripStored } from '../../lib/items/rows.ts';
  import { editableToRich, expandWithCaret, highestRedactionId, richToEditable, seqTaken } from '../../lib/items/textEdit.ts';
  import { leaveGuard, navigate } from '../../lib/router.svelte.ts';
  import { getIndex } from '../../lib/store.svelte.ts';
  import type { ItemDef, ItemType, PlayerView, Rarity, Recharge, StoredItem } from '../../lib/types.ts';
  import { entityOption, message } from '../creator/labels.ts';
  import { download, downloadPdf, fileName } from '../download.ts';
  import FilterSelect from '../FilterSelect.svelte';
  import EffectsEditor from './EffectsEditor.svelte';
  import PlayerViewEditor from './PlayerViewEditor.svelte';

  let { initial, isNew }: { initial: StoredItem; isNew: boolean } = $props();

  const TYPES: ItemType[] = ['weapon', 'armor', 'shield', 'ammunition', 'gear', 'pack', 'tool', 'wondrous', 'potion', 'ring', 'rod', 'scroll', 'staff', 'wand', 'other'];
  const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
  const RECHARGES: Recharge[] = ['short', 'long', 'dawn', 'dusk', 'none'];
  const BONUSES = [['attack', 'Attack rolls'], ['damage', 'Damage'], ['ac', 'Armor class'], ['save', 'Saving throws'], ['spellAttack', 'Spell attack'], ['spellDc', 'Spell save DC']] as const;

  const newId = newHomebrewId;
  const num = (s: string): number | undefined => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));
  const whole = (s: string) => /^\d+$/.test(s.trim());
  const text = (n: number | undefined) => (n === undefined ? '' : String(n));

  // I3: the redaction high-water mark, seeded from the ids already in use (an item saved before it existed has none).
  const withSeq = (i: StoredItem): StoredItem => {
    const n = highestRedactionId([i.text, i.curse ?? [], ...choiceTexts(i.choices), i.defaultView?.text ?? []], i.redactionSeq);
    return n ? { ...i, redactionSeq: n } : i;
  };
  // svelte-ignore state_referenced_locally
  let draft: StoredItem = $state(withSeq($state.snapshot(initial) as StoredItem));
  /** Raises the high-water mark when an id is issued, here or in the default view's text. */
  const bump = (n: number) => { if (n > (draft.redactionSeq ?? 0)) draft.redactionSeq = n; };
  // svelte-ignore state_referenced_locally
  let saved = $state(!isNew); // stored at least once, so `draft.id` is real
  let saving = $state(false);
  let error = $state('');
  let notice = $state('');
  let confirmingDelete = $state(false);
  let delBtn: HTMLButtonElement | undefined = $state();

  // Fields that need typing room keep their own strings, so a half-typed or cleared value is never rewritten
  // under the cursor or turned into 0. `assembled` folds them into the item; problem() checks them.
  // svelte-ignore state_referenced_locally
  let textDraft = $state(richToEditable(initial.text));
  // svelte-ignore state_referenced_locally
  let curseDraft = $state(richToEditable(initial.curse ?? []));
  // svelte-ignore state_referenced_locally
  let weightDraft = $state(text(initial.weight));
  // svelte-ignore state_referenced_locally
  let costDraft = $state(text(initial.costCp === undefined ? undefined : initial.costCp / 100));
  // svelte-ignore state_referenced_locally
  let acDraft = $state(text(initial.armor?.ac));
  // svelte-ignore state_referenced_locally
  let maxDraft = $state(text(initial.charges?.max));
  // svelte-ignore state_referenced_locally
  let rangeNear = $state(text(initial.weapon?.range?.[0]));
  // svelte-ignore state_referenced_locally
  let rangeFar = $state(text(initial.weapon?.range?.[1]));

  let bases: ItemDef[] = $state.raw([]);
  // svelte-ignore state_referenced_locally
  getIndex(initial.campaignId).then(
    (ix) => (bases = ix.all('item').filter((i) => i.weapon || i.armor).sort((a, b) => a.name.localeCompare(b.name))),
    (e) => (error = message(e)),
  );
  const baseName = $derived(bases.find((b) => b.id === draft.baseItemId)?.name);
  const attune = $derived(draft.attunement === undefined || draft.attunement === false ? 'none' : draft.attunement === true ? 'required' : 'by');

  // The item as it would be saved: the draft with the text areas and typed numbers folded in (invalid ones left out).
  const assembled = $derived.by((): StoredItem => {
    const out = $state.snapshot(draft) as StoredItem;
    out.name = out.name.trim();
    out.text = editableToRich(textDraft);
    const curse = editableToRich(curseDraft);
    if (curse.length) out.curse = curse;
    else delete out.curse;
    if (typeof out.attunement === 'string') {
      const by = out.attunement.replace(/^by\s*/, '').trim();
      out.attunement = by ? `by ${by}` : true;
    }
    const w = num(weightDraft), cost = num(costDraft);
    if (w !== undefined && w >= 0) out.weight = w;
    else delete out.weight;
    if (cost !== undefined && cost >= 0) out.costCp = Math.round(cost * 100);
    else delete out.costCp;
    if (out.weapon) {
      if (whole(rangeNear) && whole(rangeFar)) out.weapon.range = [Number(rangeNear), Number(rangeFar)];
      else delete out.weapon.range;
    }
    if (out.armor && whole(acDraft)) out.armor.ac = Number(acDraft);
    if (out.charges && whole(maxDraft)) out.charges.max = Number(maxDraft);
    return out;
  });

  // Unsaved work: everything the editor holds, compared with what it held at the last load or save.
  const snapshotKey = (id = draft.id) => JSON.stringify([{ ...$state.snapshot(draft), id }, textDraft, curseDraft, weightDraft, costDraft, acDraft, maxDraft, rangeNear, rangeFar]);
  let baseline = $state(snapshotKey());
  const dirty = $derived(snapshotKey() !== baseline);

  $effect(() => {
    const guard = () => !dirty || confirm('Discard unsaved changes to this item?');
    leaveGuard.fn = guard;
    return () => { if (leaveGuard.fn === guard) leaveGuard.fn = undefined; };
  });

  function setAttune(mode: string, by = '') {
    if (mode === 'none') delete draft.attunement;
    else draft.attunement = mode === 'required' ? true : `by ${by}`; // untrimmed while typing; `assembled` trims it
  }

  function pickBase(id: string) {
    const b = bases.find((x) => x.id === id);
    if (!b) return void delete draft.baseItemId;
    draft.baseItemId = b.id;
    for (const k of ['weapon', 'armor'] as const) {
      if (b[k] === undefined) delete draft[k];
      else (draft as unknown as Record<string, unknown>)[k] = structuredClone($state.snapshot(b[k]));
    }
    weightDraft = text(b.weight);
    costDraft = text(b.costCp === undefined ? undefined : b.costCp / 100);
    acDraft = text(b.armor?.ac);
    rangeNear = text(b.weapon?.range?.[0]);
    rangeFar = text(b.weapon?.range?.[1]);
    if (b.type === 'weapon' || b.type === 'armor' || b.type === 'shield') draft.type = b.type;
  }

  const setWeapon = (on: boolean) => {
    if (on) draft.weapon = { category: 'simple', ranged: false, damage: '1d6', damageType: 'slashing', properties: [] };
    else delete draft.weapon;
    rangeNear = rangeFar = '';
  };
  const setArmor = (on: boolean) => {
    if (on) draft.armor = { category: 'light', ac: 11 };
    else delete draft.armor;
    acDraft = on ? '11' : '';
  };
  function setBonus(k: (typeof BONUSES)[number][0], s: string) {
    const v = num(s);
    const b = { ...draft.bonuses };
    if (v === undefined) delete b[k];
    else b[k] = v;
    if (Object.keys(b).length) draft.bonuses = b;
    else delete draft.bonuses;
  }
  function setCharges(on: boolean) {
    if (on) draft.charges = { max: 1, recharge: 'dawn' };
    else delete draft.charges;
    maxDraft = on ? '1' : '';
  }
  function setRechargeAmount(s: string) {
    if (s) draft.charges!.rechargeAmount = s;
    else delete draft.charges!.rechargeAmount;
  }
  // ||secret|| in Description or Curse becomes a numbered redaction as you type, like the players' text. A new id must
  // not collide with one in the other area, the item's choices, or the default view (its own text, and revealed ids).
  async function typed(el: HTMLTextAreaElement, field: 'text' | 'curse') {
    const other = field === 'text' ? curseDraft : textDraft;
    const v = draft.defaultView;
    const taken = [...redactionIds([...editableToRich(other), ...choiceTexts(draft.choices).flat(), ...(v?.text ?? [])]), ...(v?.revealed ?? []), ...seqTaken(draft)];
    const { text: next, caret } = expandWithCaret(el.value, taken, el.selectionStart);
    bump(highestRedactionId([editableToRich(next)]));
    if (field === 'text') textDraft = next;
    else curseDraft = next;
    if (next !== el.value) {
      await tick();
      el.setSelectionRange(caret, caret);
    }
  }

  const setView = (v: PlayerView | undefined) => {
    if (v) draft.defaultView = v;
    else delete draft.defaultView;
  };

  function problem(): string {
    if (!draft.name.trim()) return 'Give the item a name.';
    for (const [label, s] of [['Weight', weightDraft], ['Cost', costDraft]]) {
      if (s.trim() !== '' && !(num(s) !== undefined && num(s)! >= 0)) return `${label} must be a number, 0 or more.`;
    }
    if (draft.weapon) {
      if (!draft.weapon.damage.trim()) return 'Weapon damage is required.';
      const dice = [['Weapon damage', draft.weapon.damage], ['Versatile damage', draft.weapon.versatile], ['Recharge amount', draft.charges?.rechargeAmount]] as const;
      for (const [label, expr] of dice) {
        if (!expr) continue;
        try { parseDice(expr); } catch { return `${label}: "${expr}" is not a dice expression such as 1d8+1.`; }
      }
      const a = rangeNear.trim(), b = rangeFar.trim();
      if ((a || b) && !(whole(a) && whole(b) && Number(a) > 0 && Number(b) > 0)) return 'A range needs both the normal and the long range, as whole numbers above 0 (or leave both blank).';
    }
    if (draft.armor && !whole(acDraft)) return 'Armor class must be a whole number.';
    if (draft.charges && !(whole(maxDraft) && Number(maxDraft) > 0)) return 'Maximum charges must be a whole number, 1 or more.';
    if (draft.charges?.rechargeAmount) {
      try { parseDice(draft.charges.rechargeAmount); } catch { return `Recharge amount: "${draft.charges.rechargeAmount}" is not a dice expression such as 1d6+1.`; }
    }
    return '';
  }

  async function write(out: StoredItem): Promise<boolean> {
    saving = true;
    try {
      await db.items.put($state.snapshot(out) as StoredItem);
      return true;
    } catch (e) {
      error = message(e);
      return false;
    } finally {
      saving = false;
    }
  }

  async function save(): Promise<boolean> {
    if (saving) return false;
    error = notice = '';
    const p = problem();
    if (p) {
      error = p;
      return false;
    }
    const out = { ...assembled, id: saved ? draft.id : newId() };
    const key = snapshotKey(out.id); // taken before the write: an edit made while it runs must stay unsaved (dirty)
    if (!(await write(out))) return false;
    draft.id = out.id;
    saved = true;
    baseline = key; // before navigating: the leave guard must see a clean editor
    notice = 'Saved.';
    if (isNew) navigate(`items/${out.id}`);
    return true;
  }

  async function duplicate() {
    if (dirty && !(await save())) return; // the copy is of the saved item, so keep the edits first
    const copy = { ...assembled, id: newId(), name: `${draft.name.trim()} (copy)` };
    if (await write(copy)) navigate(`items/${copy.id}`);
  }

  // Exports the form as it stands (the DM's full item, with its default player view), once it passes the same checks as Save.
  function exportJson() {
    error = notice = '';
    const p = problem();
    if (p) { error = p; return; }
    download(exportRecord('item', { ...assembled, id: draft.id }), fileName(draft.name, 'json', 'item'));
  }

  async function exportPdf() {
    error = notice = '';
    const p = problem();
    if (p) { error = p; return; }
    try {
      const { exportItemPdf } = await import('../../lib/pdf/exportPdf.ts');
      downloadPdf(await exportItemPdf(stripStored({ ...assembled, id: draft.id })), fileName(draft.name, 'pdf', 'item'));
    } catch (e) {
      error = `Could not export the PDF: ${message(e)}`;
    }
  }

  async function askDelete() {
    confirmingDelete = true;
    await tick();
    delBtn?.focus();
  }

  async function remove() {
    try {
      await db.items.delete(draft.id);
      baseline = snapshotKey(); // deleted: nothing left to lose
      navigate('items');
    } catch (e) {
      error = message(e);
    }
  }
</script>

<svelte:window onbeforeunload={(e) => { if (dirty) e.preventDefault(); }} />

<p><a href="#/items">Back to items</a></p>
<h1>{isNew && !saved ? 'New item' : draft.name || 'Item'}</h1>

<div class="card">
  <div class="field">
    <label for="it-name">Name</label>
    <input id="it-name" type="text" autocomplete="off" bind:value={draft.name} />
  </div>
  <div class="row">
    <div class="field">
      <label for="it-type">Type</label>
      <select id="it-type" bind:value={draft.type}>{#each TYPES as t (t)}<option value={t}>{t}</option>{/each}</select>
    </div>
    <div class="field">
      <label for="it-rarity">Rarity</label>
      <select id="it-rarity" value={draft.rarity ?? ''} onchange={(e) => (e.currentTarget.value ? (draft.rarity = e.currentTarget.value as Rarity) : delete draft.rarity)}>
        <option value="">None</option>
        {#each RARITIES as r (r)}<option value={r}>{r}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="it-attune">Attunement</label>
      <select id="it-attune" value={attune} onchange={(e) => setAttune(e.currentTarget.value)}>
        <option value="none">Not needed</option>
        <option value="required">Required</option>
        <option value="by">Required by…</option>
      </select>
    </div>
    {#if attune === 'by'}
      <div class="field">
        <label for="it-attune-by">Attunement requires</label>
        <input id="it-attune-by" type="text" autocomplete="off" placeholder="a wizard" value={String(draft.attunement).replace(/^by\s?/, '')} oninput={(e) => setAttune('by', e.currentTarget.value)} />
      </div>
    {/if}
  </div>
  <div class="row">
    <label class="check"><input type="checkbox" bind:checked={draft.magic} /> Magic item</label>
    <label class="check"><input type="checkbox" checked={!!draft.consumable} onchange={(e) => (e.currentTarget.checked ? (draft.consumable = true) : delete draft.consumable)} /> Consumable</label>
  </div>
  <div class="row">
    <div class="field">
      <label for="it-weight">Weight (lb)</label>
      <input id="it-weight" type="text" inputmode="decimal" autocomplete="off" bind:value={weightDraft} />
    </div>
    <div class="field">
      <label for="it-cost">Cost (gp)</label>
      <input id="it-cost" type="text" inputmode="decimal" autocomplete="off" bind:value={costDraft} />
    </div>
  </div>
</div>

<h2>Description</h2>
<div class="card">
  <div class="field">
    <label for="it-text">Description</label>
    <textarea id="it-text" rows="6" value={textDraft} oninput={(e) => typed(e.currentTarget, 'text')}></textarea>
    <span class="muted">Blank line between paragraphs, "- " for list items, "| a | b |" for table rows, "## Heading" for a heading, **bold** and *italic*, ||secret|| to hide words from players until revealed.</span>
  </div>
  <div class="field">
    <label for="it-curse">Curse (optional)</label>
    <textarea id="it-curse" rows="3" value={curseDraft} oninput={(e) => typed(e.currentTarget, 'curse')}></textarea>
  </div>
</div>

<h2>Base item</h2>
<div class="card">
  <FilterSelect id="it-base" label="Copy weapon or armor stats from" options={bases.map(entityOption)} value={draft.baseItemId ?? ''} onchange={pickBase} placeholder="None" />
  {#if baseName}<p class="muted">Based on {baseName}. Its weapon or armor stats, weight and cost were copied; change them below.</p>{/if}

  <label class="check"><input type="checkbox" checked={!!draft.weapon} onchange={(e) => setWeapon(e.currentTarget.checked)} /> Weapon stats</label>
  {#if draft.weapon}
    <div class="row">
      <div class="field">
        <label for="w-cat">Category</label>
        <select id="w-cat" bind:value={draft.weapon.category}><option value="simple">simple</option><option value="martial">martial</option></select>
      </div>
      <label class="check"><input type="checkbox" bind:checked={draft.weapon.ranged} /> Ranged</label>
      <div class="field"><label for="w-dmg">Damage</label><input id="w-dmg" type="text" autocomplete="off" bind:value={draft.weapon.damage} /></div>
      <div class="field"><label for="w-type">Damage type</label><input id="w-type" type="text" autocomplete="off" bind:value={draft.weapon.damageType} /></div>
      <div class="field">
        <label for="w-vers">Versatile damage</label>
        <input id="w-vers" type="text" autocomplete="off" value={draft.weapon.versatile ?? ''} oninput={(e) => (e.currentTarget.value ? (draft.weapon!.versatile = e.currentTarget.value) : delete draft.weapon!.versatile)} />
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="w-props">Properties (comma separated)</label>
        <input id="w-props" type="text" autocomplete="off" value={draft.weapon.properties.join(', ')} oninput={(e) => (draft.weapon!.properties = e.currentTarget.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </div>
      <div class="field"><label for="w-r1">Range (ft)</label><input id="w-r1" type="text" inputmode="numeric" autocomplete="off" bind:value={rangeNear} /></div>
      <div class="field"><label for="w-r2">Long range (ft)</label><input id="w-r2" type="text" inputmode="numeric" autocomplete="off" bind:value={rangeFar} /></div>
    </div>
  {/if}

  <label class="check"><input type="checkbox" checked={!!draft.armor} onchange={(e) => setArmor(e.currentTarget.checked)} /> Armor stats</label>
  {#if draft.armor}
    <div class="row">
      <div class="field">
        <label for="a-cat">Category</label>
        <select id="a-cat" bind:value={draft.armor.category}>{#each ['light', 'medium', 'heavy', 'shield'] as c (c)}<option value={c}>{c}</option>{/each}</select>
      </div>
      <div class="field"><label for="a-ac">Armor class</label><input id="a-ac" type="text" inputmode="numeric" autocomplete="off" bind:value={acDraft} /></div>
      <div class="field"><label for="a-dex">Dex bonus cap (blank: none)</label><input id="a-dex" type="text" inputmode="numeric" autocomplete="off" value={draft.armor.dexCap ?? ''} oninput={(e) => { const v = num(e.currentTarget.value); if (v === undefined) delete draft.armor!.dexCap; else draft.armor!.dexCap = v; }} /></div>
      <div class="field"><label for="a-str">Strength needed</label><input id="a-str" type="text" inputmode="numeric" autocomplete="off" value={draft.armor.strReq ?? ''} oninput={(e) => { const v = num(e.currentTarget.value); if (v === undefined) delete draft.armor!.strReq; else draft.armor!.strReq = v; }} /></div>
      <label class="check"><input type="checkbox" checked={!!draft.armor.stealthDisadvantage} onchange={(e) => (e.currentTarget.checked ? (draft.armor!.stealthDisadvantage = true) : delete draft.armor!.stealthDisadvantage)} /> Stealth disadvantage</label>
    </div>
  {/if}
</div>

<h2>Bonuses, charges and effects</h2>
<div class="card">
  <h3>Bonuses</h3>
  <div class="row">
    {#each BONUSES as [k, label] (k)}
      <div class="field"><label for="b-{k}">{label}</label><input id="b-{k}" type="text" inputmode="numeric" autocomplete="off" value={draft.bonuses?.[k] ?? ''} oninput={(e) => setBonus(k, e.currentTarget.value)} /></div>
    {/each}
  </div>

  <h3>Charges</h3>
  <label class="check"><input type="checkbox" checked={!!draft.charges} onchange={(e) => setCharges(e.currentTarget.checked)} /> Has charges</label>
  {#if draft.charges}
    <div class="row">
      <div class="field"><label for="c-max">Maximum charges</label><input id="c-max" type="text" inputmode="numeric" autocomplete="off" bind:value={maxDraft} /></div>
      <div class="field">
        <label for="c-rec">Recharges on</label>
        <select id="c-rec" bind:value={draft.charges.recharge}>{#each RECHARGES as r (r)}<option value={r}>{r}</option>{/each}</select>
      </div>
      <div class="field"><label for="c-amt">Recharge amount (e.g. 1d6+1; blank: all)</label><input id="c-amt" type="text" autocomplete="off" value={draft.charges.rechargeAmount ?? ''} oninput={(e) => setRechargeAmount(e.currentTarget.value)} /></div>
    </div>
  {/if}

  <EffectsEditor effects={draft.effects ?? []} onchange={(es) => (es.length ? (draft.effects = es) : delete draft.effects)} />
</div>

<h2>Default player view</h2>
<div class="card">
  <p class="muted">What players see of this item in the compendium and when you give it to them, until you reveal more.</p>
  <PlayerViewEditor item={assembled} view={draft.defaultView} onchange={setView} onseq={bump} />
</div>

{#if error}<p role="alert" class="error">{error}</p>{/if}
{#if notice && !dirty}<p role="status">{notice}</p>{/if}
<div class="row">
  <button type="button" class="primary" disabled={saving} onclick={save}>Save item</button>
  {#if saved}
    <button type="button" disabled={saving} onclick={duplicate}>Duplicate</button>
    <button type="button" onclick={exportJson}>Export JSON</button>
    <button type="button" onclick={exportPdf}>Export PDF</button>
    <button type="button" class="danger" onclick={askDelete}>Delete</button>
  {/if}
  {#if dirty}<span class="muted">Unsaved changes</span>{/if}
</div>
{#if confirmingDelete}
  <div role="alertdialog" aria-label="Confirm delete" aria-describedby="it-del-msg" class="row">
    <p id="it-del-msg">Delete “{draft.name}”? This cannot be undone.</p>
    <button type="button" class="danger" bind:this={delBtn} onclick={remove}>Delete item</button>
    <button type="button" onclick={() => (confirmingDelete = false)}>Keep it</button>
  </div>
{/if}

<style>
  textarea {
    font: inherit;
    color: inherit;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    padding: 0.4rem 0.7rem;
    max-width: 100%;
    box-sizing: border-box;
  }
</style>
