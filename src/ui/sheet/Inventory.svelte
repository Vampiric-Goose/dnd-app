<script lang="ts">
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
    update((x) => ({ ...x, inventory: x.inventory.map((e) => (e.id === id ? fn(e) : e)) }));
</script>

<section aria-labelledby="inv-h">
  <h2 id="inv-h">Inventory</h2>

  <fieldset class="card coins">
    <legend>Currency</legend>
    <div class="row">
      {#each COINS as k (k)}
        <label class="field">{k.toUpperCase()} <input type="number" min="0" step="1" value={c.currency[k]} onchange={(e) => setCoin(k, e.currentTarget)} /></label>
      {/each}
    </div>
  </fieldset>

  <p>
    Attuned: <strong>{sheet.attunedCount} of {ATTUNEMENT_LIMIT}</strong>
    {#if settings.encumbrance !== 'off'}
      · Carrying <strong>{lb(sheet.carrying.weight)} lb</strong> of {sheet.carrying.capacity} lb
      {#if settings.encumbrance === 'variant'}(encumbered over {5 * unit} lb, heavily over {10 * unit} lb){/if}
    {/if}
  </p>
  {#if settings.encumbrance !== 'off'}
    <p class:error={sheet.carrying.encumbrance !== 'none'} role="status">{STATUS[sheet.carrying.encumbrance]}</p>
  {/if}

  <div class="row">
    <button type="button" class="primary" aria-expanded={adding} onclick={() => (adding = !adding)}>{adding ? 'Done adding' : 'Add item'}</button>
    <button type="button" onclick={dawn}>Dawn</button>
    <span class="muted">Dawn restores the charges of items that recharge at dawn.</span>
  </div>

  {#if adding}
    {#if pool}
      <ItemPicker {pool} viewer={app.viewer} onpick={(entry) => update((x) => ({ ...x, inventory: [...x.inventory, entry] }))} />
    {:else if error}<p role="alert" class="error">{error}</p>
    {:else}<p class="muted">Loading items…</p>{/if}
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
</section>

<style>
  .coins {
    border: 1px solid var(--border);
  }

  .coins .field {
    margin: 0;
  }

  .coins input {
    width: 5.5rem;
  }
</style>
