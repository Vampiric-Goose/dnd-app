<script lang="ts">
  import { slug } from '../../lib/content/ids.ts';
  import { parseDice } from '../../lib/dice.ts';
  import { db } from '../../lib/db.ts';
  import { editableToRich, richToEditable } from '../../lib/items/textEdit.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { getIndex } from '../../lib/store.svelte.ts';
  import type { ItemDef, ItemType, PlayerView, Rarity, Recharge, StoredItem } from '../../lib/types.ts';
  import { entityOption, message } from '../creator/labels.ts';
  import FilterSelect from '../FilterSelect.svelte';
  import EffectsEditor from './EffectsEditor.svelte';
  import PlayerViewEditor from './PlayerViewEditor.svelte';

  let { initial, isNew }: { initial: StoredItem; isNew: boolean } = $props();

  const TYPES: ItemType[] = ['weapon', 'armor', 'shield', 'ammunition', 'gear', 'pack', 'tool', 'wondrous', 'potion', 'ring', 'rod', 'scroll', 'staff', 'wand', 'other'];
  const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
  const RECHARGES: Recharge[] = ['short', 'long', 'dawn', 'dusk', 'none'];
  const BONUSES = [['attack', 'Attack rolls'], ['damage', 'Damage'], ['ac', 'Armor class'], ['save', 'Saving throws'], ['spellAttack', 'Spell attack'], ['spellDc', 'Spell save DC']] as const;

  // svelte-ignore state_referenced_locally
  let draft: StoredItem = $state($state.snapshot(initial) as StoredItem);
  // svelte-ignore state_referenced_locally
  let saved = $state(!isNew);
  let error = $state('');
  let notice = $state('');
  let confirmingDelete = $state(false);
  // The text areas keep their own strings so typing is never rewritten under the cursor; `text` and `curse` follow them.
  // svelte-ignore state_referenced_locally
  let textDraft = $state(richToEditable(initial.text));
  // svelte-ignore state_referenced_locally
  let curseDraft = $state(richToEditable(initial.curse ?? []));

  let bases: ItemDef[] = $state.raw([]);
  // svelte-ignore state_referenced_locally
  getIndex(initial.campaignId).then(
    (ix) => (bases = ix.all('item').filter((i) => i.weapon || i.armor).sort((a, b) => a.name.localeCompare(b.name))),
    (e) => (error = message(e)),
  );
  const baseName = $derived(bases.find((b) => b.id === draft.baseItemId)?.name);

  const num = (s: string): number | undefined => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s));
  const attune = $derived(draft.attunement === undefined || draft.attunement === false ? 'none' : draft.attunement === true ? 'required' : 'by');

  function setAttune(mode: string, by = '') {
    if (mode === 'none') delete draft.attunement;
    else draft.attunement = mode === 'required' ? true : `by ${by}`; // untrimmed while typing; save() trims it
  }

  function pickBase(id: string) {
    const b = bases.find((x) => x.id === id);
    if (!b) return void delete draft.baseItemId;
    draft.baseItemId = b.id;
    for (const k of ['weapon', 'armor', 'weight', 'costCp'] as const) {
      if (b[k] === undefined) delete draft[k];
      else (draft as unknown as Record<string, unknown>)[k] = structuredClone($state.snapshot(b[k]));
    }
    if (b.type === 'weapon' || b.type === 'armor' || b.type === 'shield') draft.type = b.type;
  }

  const setWeapon = (on: boolean) => {
    if (on) draft.weapon = { category: 'simple', ranged: false, damage: '1d6', damageType: 'slashing', properties: [] };
    else delete draft.weapon;
  };
  const setArmor = (on: boolean) => {
    if (on) draft.armor = { category: 'light', ac: 11 };
    else delete draft.armor;
  };
  function setRange(i: 0 | 1, s: string) {
    const w = draft.weapon!;
    const r: [number | undefined, number | undefined] = [w.range?.[0], w.range?.[1]];
    r[i] = num(s);
    if (r[0] !== undefined && r[1] !== undefined) w.range = [r[0], r[1]];
    else delete w.range;
  }
  function setBonus(k: (typeof BONUSES)[number][0], s: string) {
    const v = num(s);
    const b = { ...draft.bonuses };
    if (v === undefined) delete b[k];
    else b[k] = v;
    if (Object.keys(b).length) draft.bonuses = b;
    else delete draft.bonuses;
  }
  function setCharges(patch: Partial<NonNullable<ItemDef['charges']>> | undefined) {
    if (!patch) return void delete draft.charges;
    draft.charges = { max: 1, recharge: 'dawn', ...draft.charges, ...patch };
    if (!draft.charges.rechargeAmount) delete draft.charges.rechargeAmount;
  }
  const setView = (v: PlayerView | undefined) => {
    if (v) draft.defaultView = v;
    else delete draft.defaultView;
  };

  function problem(): string {
    if (!draft.name.trim()) return 'Give the item a name.';
    const dice = [['Weapon damage', draft.weapon?.damage], ['Versatile damage', draft.weapon?.versatile], ['Recharge amount', draft.charges?.rechargeAmount]] as const;
    for (const [label, expr] of dice) {
      if (!expr) continue;
      try { parseDice(expr); } catch { return `${label}: "${expr}" is not a dice expression such as 1d8+1.`; }
    }
    if (draft.weapon && !draft.weapon.damage.trim()) return 'Weapon damage is required.';
    return '';
  }

  async function save(item: StoredItem = draft): Promise<boolean> {
    error = notice = '';
    const p = problem();
    if (p) {
      error = p;
      return false;
    }
    const out = $state.snapshot(item) as StoredItem;
    out.name = out.name.trim();
    if (typeof out.attunement === 'string') {
      const by = out.attunement.replace(/^by\s*/, '').trim();
      out.attunement = by ? `by ${by}` : true;
    }
    out.text = editableToRich(textDraft);
    const curse = editableToRich(curseDraft);
    if (curse.length) out.curse = curse;
    else delete out.curse;
    if (!saved && item === draft) out.id = `item:${slug(out.name) || 'item'}-${crypto.randomUUID().slice(0, 8)}@HOMEBREW`;
    try {
      await db.items.put(out);
    } catch (e) {
      error = message(e);
      return false;
    }
    if (item === draft) {
      draft.id = out.id;
      saved = true;
      notice = 'Saved.';
      if (isNew) navigate(`items/${out.id}`);
    }
    return true;
  }

  async function duplicate() {
    const copy = $state.snapshot(draft) as StoredItem;
    copy.id = `item:${slug(copy.name) || 'item'}-${crypto.randomUUID().slice(0, 8)}@HOMEBREW`;
    copy.name = `${copy.name.trim()} (copy)`; // save() takes the text and curse from the text areas
    if (await save(copy)) navigate(`items/${copy.id}`);
  }

  async function remove() {
    try {
      await db.items.delete(draft.id);
      navigate('items');
    } catch (e) {
      error = message(e);
    }
  }
</script>

<p><a href="#/items">All items</a></p>
<h1>{isNew ? 'New item' : draft.name || 'Item'}</h1>

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
        <input id="it-attune-by" type="text" autocomplete="off" placeholder="a wizard" value={String(draft.attunement).replace(/^by\s*/, '')} oninput={(e) => setAttune('by', e.currentTarget.value)} />
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
      <input id="it-weight" type="text" inputmode="decimal" autocomplete="off" value={draft.weight ?? ''} oninput={(e) => { const v = num(e.currentTarget.value); if (v === undefined) delete draft.weight; else draft.weight = v; }} />
    </div>
    <div class="field">
      <label for="it-cost">Cost (gp)</label>
      <input id="it-cost" type="text" inputmode="decimal" autocomplete="off" value={draft.costCp === undefined ? '' : draft.costCp / 100} oninput={(e) => { const v = num(e.currentTarget.value); if (v === undefined) delete draft.costCp; else draft.costCp = Math.round(v * 100); }} />
    </div>
  </div>
</div>

<h2>Description</h2>
<div class="card">
  <div class="field">
    <label for="it-text">Description</label>
    <textarea id="it-text" rows="6" bind:value={textDraft}></textarea>
    <span class="muted">Blank line between paragraphs, "- " for list items, "| a | b |" for table rows, "## Heading" for a heading, **bold** and *italic*.</span>
  </div>
  <div class="field">
    <label for="it-curse">Curse (optional)</label>
    <textarea id="it-curse" rows="3" bind:value={curseDraft}></textarea>
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
      <div class="field"><label for="w-r1">Range (ft)</label><input id="w-r1" type="text" inputmode="numeric" autocomplete="off" value={draft.weapon.range?.[0] ?? ''} oninput={(e) => setRange(0, e.currentTarget.value)} /></div>
      <div class="field"><label for="w-r2">Long range (ft)</label><input id="w-r2" type="text" inputmode="numeric" autocomplete="off" value={draft.weapon.range?.[1] ?? ''} oninput={(e) => setRange(1, e.currentTarget.value)} /></div>
    </div>
  {/if}

  <label class="check"><input type="checkbox" checked={!!draft.armor} onchange={(e) => setArmor(e.currentTarget.checked)} /> Armor stats</label>
  {#if draft.armor}
    <div class="row">
      <div class="field">
        <label for="a-cat">Category</label>
        <select id="a-cat" bind:value={draft.armor.category}>{#each ['light', 'medium', 'heavy', 'shield'] as c (c)}<option value={c}>{c}</option>{/each}</select>
      </div>
      <div class="field"><label for="a-ac">Armor class</label><input id="a-ac" type="text" inputmode="numeric" autocomplete="off" value={draft.armor.ac} oninput={(e) => (draft.armor!.ac = num(e.currentTarget.value) ?? 0)} /></div>
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
  <label class="check"><input type="checkbox" checked={!!draft.charges} onchange={(e) => setCharges(e.currentTarget.checked ? {} : undefined)} /> Has charges</label>
  {#if draft.charges}
    <div class="row">
      <div class="field"><label for="c-max">Maximum charges</label><input id="c-max" type="text" inputmode="numeric" autocomplete="off" value={draft.charges.max} oninput={(e) => setCharges({ max: num(e.currentTarget.value) ?? 0 })} /></div>
      <div class="field">
        <label for="c-rec">Recharges on</label>
        <select id="c-rec" value={draft.charges.recharge} onchange={(e) => setCharges({ recharge: e.currentTarget.value as Recharge })}>{#each RECHARGES as r (r)}<option value={r}>{r}</option>{/each}</select>
      </div>
      <div class="field"><label for="c-amt">Recharge amount (e.g. 1d6+1; blank: all)</label><input id="c-amt" type="text" autocomplete="off" value={draft.charges.rechargeAmount ?? ''} oninput={(e) => setCharges({ rechargeAmount: e.currentTarget.value })} /></div>
    </div>
  {/if}

  <EffectsEditor effects={draft.effects ?? []} onchange={(es) => (es.length ? (draft.effects = es) : delete draft.effects)} />
</div>

<h2>Default player view</h2>
<div class="card">
  <p class="muted">What players see of this item in the compendium and when you give it to them, until you reveal more.</p>
  <PlayerViewEditor item={{ ...draft, text: editableToRich(textDraft), curse: curseDraft.trim() ? editableToRich(curseDraft) : undefined }} view={draft.defaultView} onchange={setView} />
</div>

{#if error}<p role="alert" class="error">{error}</p>{/if}
{#if notice}<p role="status">{notice}</p>{/if}
<div class="row">
  <button type="button" class="primary" onclick={() => save()}>Save item</button>
  {#if saved}<button type="button" onclick={duplicate}>Duplicate</button>
    <button type="button" class="danger" onclick={() => (confirmingDelete = true)}>Delete</button>{/if}
</div>
{#if confirmingDelete}
  <div role="alertdialog" aria-label="Confirm delete" class="row">
    <p>Delete “{draft.name}”? This cannot be undone.</p>
    <button type="button" class="danger" onclick={remove}>Delete item</button>
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
