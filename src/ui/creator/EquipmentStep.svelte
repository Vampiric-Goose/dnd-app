<script lang="ts" module>
  /** The equipment picks, kept by Creator so they survive leaving the step. Keys: `<sourceId>|<group>` and `<sourceId>|<group>|<option>|<item>|<n>`. */
  export interface Equip { mode: 'pack' | 'gold'; picks: Record<string, number>; cats: Record<string, string>; gold: { dice: string; times: number; total?: number } }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { goldFormula, itemsInCategory } from '../../lib/character/equipment.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { makeEntry } from '../../lib/items/inventory.ts';
  import { roll } from '../../lib/rolls.svelte.ts';
  import type { Character, InventoryEntry, ItemDef, StartingEquipment } from '../../lib/types.ts';
  import FilterSelect from '../FilterSelect.svelte';
  import RichText from '../RichText.svelte';
  import { entityOption, message, titleCase } from './labels.ts';

  let { c = $bindable(), equip = $bindable(), index }: { c: Character; equip: Equip; index: ContentIndex } = $props();

  const cls = $derived(index.resolve(c.build.levels[0]?.classId ?? ''));
  const bg = $derived(index.resolve(c.build.backgroundId));
  const sources = $derived<{ id: string; name: string; eq: StartingEquipment }[]>([
    ...(cls?.kind === 'class' ? [{ id: cls.id, name: cls.name, eq: cls.startingEquipment }] : []),
    ...(bg?.kind === 'background' ? [{ id: bg.id, name: bg.name, eq: bg.equipment }] : []),
  ]);
  const items = $derived(index.all('item'));
  const item = (id: string) => { const e = index.resolve(id); return e?.kind === 'item' ? e : undefined; };

  // ItemPicker arrives in Task 19; until then a select of the category's items (FilterSelect caps long lists).
  const catOptions = (cat: string) => itemsInCategory(items, cat).map(entityOption);
  const label = (cat: string) => titleCase(cat);

  /** Rebuilds the inventory and gold from the picks. Armor (one suit), a shield and weapons start equipped. */
  function apply() {
    const out: InventoryEntry[] = [];
    let armored = false;
    const add = (def: ItemDef | undefined, quantity: number) => {
      if (!def) return;
      const e = makeEntry(def, { quantity });
      const body = def.armor && def.armor.category !== 'shield';
      e.equipped = !!def.weapon || def.armor?.category === 'shield' || (!!body && !armored);
      if (body) armored = true;
      out.push(e);
    };
    if (equip.mode === 'pack') {
      for (const s of sources) s.eq.choices.forEach((group, g) => {
        const o = equip.picks[`${s.id}|${g}`] ?? 0;
        group[o]?.items.forEach((it, i) => {
          if (it.itemId) return add(item(it.itemId), it.quantity);
          for (let n = 0; n < it.quantity; n++) add(item(equip.cats[`${s.id}|${g}|${o}|${i}|${n}`] ?? ''), 1);
        });
      });
    }
    c.inventory = out;
    c.currency = { ...c.currency, gp: equip.mode === 'gold' ? equip.gold.total ?? 0 : 0 };
  }

  let goldError = $state('');
  function rollGold() {
    goldError = '';
    try {
      equip.gold.total = roll('Starting gold', equip.gold.dice).total * (equip.gold.times || 1);
      apply();
    } catch (e) {
      goldError = message(e);
    }
  }

  onMount(() => {
    if (!equip.gold.dice) {
      const f = goldFormula(cls?.kind === 'class' ? cls.startingEquipment.gold : undefined);
      if (f) equip.gold = { dice: f.dice, times: f.times };
    }
    apply(); // the default picks (first option of each group) count even if nothing is touched
  });
</script>

{#if !sources.length}
  <p class="muted">Pick a class and background first.</p>
{:else}
  <fieldset>
    <legend>Start with</legend>
    <label class="check"><input type="radio" name="eq-mode" checked={equip.mode === 'pack'} onchange={() => { equip.mode = 'pack'; apply(); }} /> The class and background equipment</label>
    <label class="check"><input type="radio" name="eq-mode" checked={equip.mode === 'gold'} onchange={() => { equip.mode = 'gold'; apply(); }} /> Starting gold instead</label>
  </fieldset>

  {#if equip.mode === 'pack'}
    {#each sources as s (s.id)}
      <section class="card">
        <h3>{s.name}</h3>
        {#if s.eq.text.length}<RichText text={s.eq.text} />{/if}
        {#each s.eq.choices as group, g}
          {@const key = `${s.id}|${g}`}
          {@const o = equip.picks[key] ?? 0}
          <fieldset class="group">
            {#if group.length > 1}
              <legend>Choose one</legend>
              {#each group as opt, i}
                <label class="check"><input type="radio" name={key} checked={o === i} onchange={() => { equip.picks[key] = i; apply(); }} /> {opt.label}</label>
              {/each}
            {:else}
              <legend>You get</legend>
              <p>{group[0]?.label}</p>
            {/if}
            {#each group[o]?.items ?? [] as it, i}
              {#if it.category}
                {#each Array.from({ length: it.quantity }, (_, n) => n) as n}
                  {@const ck = `${key}|${o}|${i}|${n}`}
                  <FilterSelect id={ck} label="{label(it.category)}{it.quantity > 1 ? ` (${n + 1} of ${it.quantity})` : ''}" options={catOptions(it.category)}
                    value={equip.cats[ck] ?? ''} onchange={(id) => { equip.cats[ck] = id; apply(); }} />
                {/each}
              {/if}
            {/each}
          </fieldset>
        {/each}
        {#if !s.eq.choices.length && s.eq.text.length}
          <p class="muted">Add these on the character sheet's inventory.</p>
        {/if}
      </section>
    {/each}
  {:else}
    {#if !equip.gold.dice}<p class="muted">This class's data has no starting-gold formula. Enter the dice from your rulebook.</p>{/if}
    <div class="row">
      <label class="field">Dice <input bind:value={equip.gold.dice} placeholder="5d4" autocomplete="off" /></label>
      <label class="field">× <input type="number" min="1" bind:value={equip.gold.times} /></label>
      <button type="button" disabled={!equip.gold.dice} onclick={rollGold}>Roll starting gold</button>
    </div>
    {#if goldError}<p role="alert" class="error">{goldError}</p>{/if}
    {#if equip.gold.total !== undefined}<p aria-live="polite">Starting gold: <strong>{equip.gold.total} gp</strong></p>{/if}
  {/if}

  {#if c.inventory.length}
    <h3>Inventory</h3>
    <ul>
      {#each c.inventory as e (e.id)}<li>{e.quantity > 1 ? `${e.quantity} × ` : ''}{e.item.name}{e.equipped ? ' (equipped)' : ''}</li>{/each}
    </ul>
  {/if}
{/if}

<style>
  fieldset { border: 0; padding: 0; margin: 0.5rem 0; }
  legend { font-weight: 600; }
  .group { border-top: 1px solid var(--border); padding-top: 0.5rem; }
  input[type='number'] { width: 5rem; }
</style>
