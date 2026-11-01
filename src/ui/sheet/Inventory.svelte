<script lang="ts">
  import { equip, unequip } from '../../lib/items/hands.ts';
  import { db } from '../../lib/db.ts';
  import { rechargeEntry, refreshEntry } from '../../lib/items/inventory.ts';
  import { ATTUNEMENT_LIMIT } from '../../lib/rules/constants.ts';
  import { app } from '../../lib/store.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Character, CampaignSettings, Sheet } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import EntryRow from '../items/EntryRow.svelte';
  import { latestItem, loadPool, type Pool } from '../items/pool.ts';
  import ItemPicker from '../ItemPicker.svelte';

  let { c, sheet, settings, update, ontransfer }: {
    c: Character;
    sheet: Sheet;
    settings: CampaignSettings;
    update: (fn: (c: Character) => Character) => void;
    ontransfer: (entryId: string, qty: number, targetId: string) => Promise<void>; // 'loot' (Unassigned) or a character id
  } = $props();

  const campaignId = $derived(c.campaignId);
  let pool: Pool | undefined = $state.raw();
  let others: Character[] = $state.raw([]);
  let adding = $state(false);
  let error = $state('');

  // The character's own campaign decides the content and who it can trade with (R36).
  $effect(() => {
    const id = campaignId;
    let live = true;
    pool = undefined;
    loadPool(id).then((p) => { if (live) pool = p; }, (e) => { if (live) error = message(e); });
    return () => { live = false; };
  });

  async function loadOthers() {
    try {
      others = campaignId ? (await db.characters.list(campaignId)).filter((x) => x.id !== c.id).sort((a, b) => a.name.localeCompare(b.name)) : [];
    } catch { others = []; }
  }
  $effect(() => { campaignId; void loadOthers(); });

  // Unassigned is the DM's holding list: only DM view can hand an item back to it. A player can give to other characters.
  const targets = $derived([...(campaignId && app.viewer === 'dm' ? [{ id: 'loot', label: 'Unassigned (DM)' }] : []), ...others.map((o) => ({ id: o.id, label: o.name || 'Unnamed' }))]);

  const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
  function setCoin(k: (typeof COINS)[number], input: HTMLInputElement) {
    const n = Number.isFinite(input.valueAsNumber) ? Math.max(0, Math.floor(input.valueAsNumber)) : 0;
    update((x) => ({ ...x, currency: { ...x.currency, [k]: n } }));
    input.value = String(n); // show what was stored (no negatives, fractions or blanks)
  }

  const unit = $derived(sheet.carrying.capacity / 15); // Strength × size multiplier
  const lb = (n: number) => Math.round(n * 10) / 10;
  const STATUS = { none: 'Not encumbered.', over: 'Over capacity: cannot carry this much.', encumbered: 'Encumbered: speed reduced by 10 ft.', heavy: 'Heavily encumbered: speed reduced by 20 ft., and disadvantage on checks, attacks and Strength, Dexterity and Constitution saves.' };

  function dawn() {
    const before = c.inventory.reduce((n, e) => n + e.chargesUsed, 0);
    const inventory = c.inventory.map((e) => rechargeEntry(e, 'dawn'));
    update((x) => ({ ...x, inventory }));
    const n = before - inventory.reduce((t, e) => t + e.chargesUsed, 0);
    toast(n > 0 ? `Dawn: ${n} charge${n === 1 ? '' : 's'} restored.` : 'Dawn: nothing to recharge.');
  }

  const replace = (id: string, fn: (e: Character['inventory'][number]) => Character['inventory'][number]) =>
    update((x) => {
      const was = x.inventory.find((e) => e.id === id), now = was && fn(was);
      if (!was || !now) return x;
      let inventory = x.inventory.map((e) => (e.id === id ? { ...now, equipped: was.equipped } : e));
      if (now.equipped && !was.equipped) { // two hands, one suit of armor, one shield: what's in the way goes back; one from a stack (hands.ts)
        const r = equip(inventory, id);
        inventory = r.inventory;
        if (r.stowed.length) toast(`Unequipped ${r.stowed.join(', ')} to make room.`);
      } else if (!now.equipped && was.equipped) inventory = unequip(inventory, id); // back on its stack
      else inventory = inventory.map((e) => (e.id === id ? now : e));
      return { ...x, inventory };
    });
</script>

<!-- The "Inventory" drawer: coins, carrying, the item actions, then the rows. -->
<fieldset class="coins">
  <legend>Currency</legend>
  {#each COINS as k (k)}
    <label class="coin"><span>{k.toUpperCase()}</span> <input type="number" class="num" min="0" step="1" value={c.currency[k]} onchange={(e) => setCoin(k, e.currentTarget)} /></label>
  {/each}
</fieldset>

<p class="carry">
  Attuned: <strong class="num">{sheet.attunedCount} of {ATTUNEMENT_LIMIT}</strong>
  {#if settings.encumbrance !== 'off'}
    · Carrying <strong class="num">{lb(sheet.carrying.weight)} lb</strong> of <span class="num">{sheet.carrying.capacity}</span> lb
    {#if settings.encumbrance === 'variant'}<span class="muted">(encumbered over {5 * unit} lb, heavily over {10 * unit} lb)</span>{/if}
  {/if}
</p>
{#if settings.encumbrance !== 'off'}
  <p class="carry" class:error={sheet.carrying.encumbrance !== 'none'} class:muted={sheet.carrying.encumbrance === 'none'} role="status">{STATUS[sheet.carrying.encumbrance]}</p>
{/if}

<div class="row tools">
  <button type="button" class="primary" aria-expanded={adding} onclick={() => (adding = !adding)}>{adding ? 'Done adding' : 'Add item'}</button>
  <button type="button" onclick={dawn}>Dawn</button>
  <span class="muted small">Dawn restores the charges of items that recharge at dawn.</span>
</div>

{#if adding}
  <div class="picker">
    {#if pool}
      <ItemPicker {pool} viewer={app.viewer} onpick={(entry) => update((x) => ({ ...x, inventory: [...x.inventory, entry] }))} />
    {:else if error}<p role="alert" class="error">{error}</p>
    {:else}<p class="muted">Loading items…</p>{/if}
  </div>
{/if}

{#if c.inventory.length}
  <ul class="plain">
    {#each c.inventory as e (e.id)}
      <EntryRow
        entry={e} viewer={app.viewer} gear {targets} moveLabel="Transfer to…"
        warnAttune={e.attuned ? sheet.attunedCount > ATTUNEMENT_LIMIT : sheet.attunedCount >= ATTUNEMENT_LIMIT}
        canRefresh={!!pool && !!e.sourceId && !!latestItem(pool, e.sourceId)}
        onchange={(fn) => replace(e.id, fn)}
        onremove={() => update((x) => ({ ...x, inventory: x.inventory.filter((y) => y.id !== e.id) }))}
        onrefresh={() => {
          const latest = pool && e.sourceId ? latestItem(pool, e.sourceId) : undefined;
          if (latest) { replace(e.id, (x) => refreshEntry(x, latest)); toast("Updated from the source item."); }
        }}
        onmove={(target, qty) => ontransfer(e.id, qty, target).then(loadOthers)}
      />
    {/each}
  </ul>
{:else}
  <p class="muted">Nothing carried yet.</p>
{/if}

<style>
  .coins {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.5rem;
    margin: 0 0 0.6rem;
    padding: 0;
    border: 0;
  }

  .coins legend {
    padding: 0;
    margin-bottom: 0.3rem;
  }

  .coin {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .coin span {
    color: var(--label);
    font-size: 0.72rem;
    letter-spacing: 0.13em;
  }

  .coin input {
    width: 100%;
  }

  .carry {
    margin: 0.3rem 0;
  }

  .carry strong {
    color: var(--text-strong);
  }

  .tools {
    margin: 0.6rem 0;
  }

  .small {
    font-size: 0.85rem;
  }

  .picker {
    margin: 0.5rem 0 0.75rem;
    padding: 0.5rem 0 0.5rem 0.75rem;
    border-left: 2px solid var(--accent);
  }
</style>
