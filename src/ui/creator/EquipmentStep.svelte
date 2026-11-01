<script lang="ts">
  import { onMount } from 'svelte';
  import { equipmentSources, goldFormula, itemsInCategory, type Equip } from '../../lib/character/equipment.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { roll } from '../../lib/rolls.svelte.ts';
  import type { Character } from '../../lib/types.ts';
  import FilterSelect from '../FilterSelect.svelte';
  import RichText from '../RichText.svelte';
  import { entityOption, message, titleCase } from './labels.ts';

  // Only edits the picks: Creator turns them into the inventory (startingInventory), whether or not this step was opened.
  let { c, equip = $bindable(), index }: { c: Character; equip: Equip; index: ContentIndex } = $props();

  const sources = $derived(equipmentSources(c, (id) => index.resolve(id)));
  const items = $derived(index.all('item'));

  // ItemPicker arrives in Task 19; until then a select of the category's items (FilterSelect caps long lists).
  const catOptions = (cat: string) => itemsInCategory(items, cat).map(entityOption);
  const label = (cat: string) => titleCase(cat);

  let goldError = $state('');
  function rollGold() {
    goldError = '';
    try {
      equip.gold.total = roll('Starting gold', equip.gold.dice).total * (equip.gold.times || 1);
    } catch (e) {
      goldError = message(e);
    }
  }

  onMount(() => {
    const cls = sources.find((s) => s.id.startsWith('class:'));
    const f = !equip.gold.dice && goldFormula(cls?.eq.gold);
    if (f) equip.gold = { dice: f.dice, times: f.times };
  });
</script>

{#if !sources.length}
  <p class="muted">Pick a class and background first.</p>
{:else}
  <fieldset>
    <legend>Start with</legend>
    <label class="check"><input type="radio" name="eq-mode" checked={equip.mode === 'pack'} onchange={() => { equip.mode = 'pack'; }} /> The class and background equipment</label>
    <label class="check"><input type="radio" name="eq-mode" checked={equip.mode === 'gold'} onchange={() => { equip.mode = 'gold'; }} /> Starting gold instead</label>
  </fieldset>

  {#if equip.mode === 'pack'}
    {#each sources as s (s.id)}
      <section class="src">
        <h3>{s.name}</h3>
        {#if s.eq.text.length}<RichText text={s.eq.text} />{/if}
        {#each s.eq.choices as group, g}
          {@const key = `${s.id}|${g}`}
          {@const o = equip.picks[key] ?? 0}
          <fieldset class="group">
            {#if group.length > 1}
              <legend>Choose one</legend>
              {#each group as opt, i}
                <label class="check"><input type="radio" name={key} checked={o === i} onchange={() => { equip.picks[key] = i; }} /> {opt.label}</label>
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
                    value={equip.cats[ck] ?? ''} onchange={(id) => { equip.cats[ck] = id; }} />
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
  .group { border-top: 1px solid var(--line); padding-top: 0.5rem; }
  .src { margin: 1rem 0; padding: 0.25rem 0 0.25rem 0.75rem; border-left: 2px solid var(--line-strong); }
  .src h3 { margin: 0 0 0.3rem; }
  input[type='number'] { width: 5rem; font-family: var(--mono); }
</style>
