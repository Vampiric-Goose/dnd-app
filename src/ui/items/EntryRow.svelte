<script lang="ts">
  import { useCharge, useItem } from '../../lib/items/inventory.ts';
  import { normalizeView, rowView } from '../../lib/items/rows.ts';
  import type { InventoryEntry, PlayerView } from '../../lib/types.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import Pips from '../sheet/Pips.svelte';
  import PlayerViewEditor from './PlayerViewEditor.svelte';

  // One inventory or loot entry, shown the way `viewer` may see it. `gear` adds what a character does with an item
  // (equip, attune, use, charges); party loot is just quantity, notes and the menu.
  let { entry, viewer, gear = false, warnAttune = false, targets, moveLabel, canRefresh, onchange, onremove, onrefresh, onmove }: {
    entry: InventoryEntry;
    viewer: 'dm' | 'player';
    gear?: boolean;
    warnAttune?: boolean;
    targets: { id: string; label: string }[];
    moveLabel: string; // 'Transfer' or 'Give to…'
    canRefresh: boolean;
    onchange: (e: InventoryEntry) => void;
    onremove: () => void;
    onrefresh: () => void;
    onmove: (targetId: string, qty: number) => Promise<void>;
  } = $props();

  const v = $derived(rowView(entry, viewer));
  const uid = $props.id();

  let panel: 'details' | 'view' | 'move' | 'remove' | undefined = $state();
  let menu = $state(false);
  let draft: PlayerView | undefined = $state.raw();
  let target = $state('');
  let qty: number | null = $state(1);
  let busy = $state(false);

  const open = (p: NonNullable<typeof panel>) => {
    menu = false;
    panel = p;
    draft = entry.view;
    target = targets[0]?.id ?? '';
    qty = 1;
  };
  const patch = (p: Partial<InventoryEntry>) => onchange({ ...entry, ...p });
  const amount = $derived(Math.min(entry.quantity, Math.max(1, Math.floor(qty ?? 1))));
  const meta = $derived([v.shown.type, v.shown.magic ? v.shown.rarity : undefined, v.shown.weight !== undefined ? `${v.shown.weight} lb` : undefined].filter(Boolean).join(' · '));

  function use() {
    const next = useItem(entry);
    if (next) onchange(next);
    else onremove();
  }

  async function move() {
    busy = true;
    try { await onmove(target, amount); } finally { busy = false; panel = undefined; }
  }
</script>

<li class="card entry">
  <div class="row top">
    <strong class="name">{v.name}</strong>
    {#if v.secret}<span class="badge">Secret</span>{/if}
    <span class="muted meta">{meta}</span>
    <span class="row qty" role="group" aria-label="Quantity of {v.name}">
      <button type="button" aria-label="One fewer {v.name}" disabled={entry.quantity <= 1} onclick={() => patch({ quantity: entry.quantity - 1 })}>−</button>
      <output>{entry.quantity}</output>
      <button type="button" aria-label="One more {v.name}" onclick={() => patch({ quantity: entry.quantity + 1 })}>+</button>
    </span>
    <details class="menu" bind:open={menu}>
      <summary aria-label="Actions for {v.name}">Actions</summary>
      <div class="pop">
        <button type="button" onclick={() => open('details')}>Details</button>
        {#if viewer === 'dm'}<button type="button" onclick={() => open('view')}>Edit player view</button>{/if}
        <button type="button" disabled={!canRefresh} title={canRefresh ? '' : 'The source item is no longer available'} onclick={() => { menu = false; onrefresh(); }}>Update from source</button>
        <button type="button" disabled={!targets.length} title={targets.length ? '' : 'There is nowhere to send it'} onclick={() => open('move')}>{moveLabel}</button>
        <button type="button" class="danger" onclick={() => open('remove')}>Remove</button>
      </div>
    </details>
  </div>

  {#if gear}
    <div class="row">
      {#if v.canEquip}
        <label class="check"><input type="checkbox" checked={entry.equipped} onchange={(e) => patch({ equipped: e.currentTarget.checked })} /> Equipped</label>
      {/if}
      {#if v.needsAttune}
        <label class="check"><input type="checkbox" checked={entry.attuned} aria-describedby={warnAttune ? `${uid}-warn` : undefined} onchange={(e) => patch({ attuned: e.currentTarget.checked })} /> Attuned</label>
      {/if}
      {#if v.consumable}<button type="button" onclick={use}>Use</button>{/if}
    </div>
    {#if warnAttune && v.needsAttune}<p id="{uid}-warn" class="error" role="note">Over the limit of 3; allowed only with an override, for example artificer.</p>{/if}
    {#if v.maxCharges > 0}
      <div class="row">
        <Pips total={v.maxCharges} used={Math.min(entry.chargesUsed, v.maxCharges)} label="{v.name} charges" onchange={(n) => patch({ chargesUsed: n })} />
        <button type="button" disabled={entry.chargesUsed >= v.maxCharges} onclick={() => onchange(useCharge(entry))}>Use charge</button>
        <span class="muted">{v.maxCharges - entry.chargesUsed} of {v.maxCharges} left</span>
      </div>
    {/if}
  {/if}

  <label class="field notes">Notes <input type="text" autocomplete="off" value={entry.notes} onchange={(e) => patch({ notes: e.currentTarget.value })} /></label>

  {#if panel === 'details'}
    <div class="panel">
      <EntityDetail entity={v.shown} />
      <button type="button" onclick={() => (panel = undefined)}>Close</button>
    </div>
  {:else if panel === 'view'}
    <div class="panel" role="group" aria-label="Player view of {v.name}">
      <PlayerViewEditor item={entry.item} view={draft} onchange={(next) => (draft = next)} />
      <div class="row">
        <button type="button" class="primary" onclick={() => { patch({ view: normalizeView(draft) }); panel = undefined; }}>Save view</button>
        <button type="button" onclick={() => (panel = undefined)}>Cancel</button>
      </div>
    </div>
  {:else if panel === 'move'}
    <div class="panel" role="group" aria-label="{moveLabel} {v.name}">
      <div class="row">
        <label class="field">To <select bind:value={target}>{#each targets as t (t.id)}<option value={t.id}>{t.label}</option>{/each}</select></label>
        {#if entry.quantity > 1}
          <label class="field">How many <input type="number" min="1" max={entry.quantity} step="1" bind:value={qty} /></label>
        {/if}
      </div>
      <p>Move {amount} × {v.name} to {targets.find((t) => t.id === target)?.label}? It arrives unequipped and unattuned.</p>
      <div class="row">
        <button type="button" class="primary" disabled={busy || !target} onclick={move}>Confirm</button>
        <button type="button" onclick={() => (panel = undefined)}>Cancel</button>
      </div>
    </div>
  {:else if panel === 'remove'}
    <div class="panel" role="alertdialog" aria-label="Remove {v.name}">
      <p>Remove {entry.quantity > 1 ? `all ${entry.quantity} × ` : ''}{v.name}? This cannot be undone.</p>
      <div class="row">
        <button type="button" class="danger" onclick={onremove}>Remove</button>
        <button type="button" onclick={() => (panel = undefined)}>Cancel</button>
      </div>
    </div>
  {/if}
</li>

<style>
  .top {
    justify-content: space-between;
  }

  .name {
    overflow-wrap: anywhere;
  }

  .meta {
    flex: 1 1 8rem;
  }

  .badge {
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 0.3rem;
    padding: 0 0.4rem;
    font-size: 0.8rem;
  }

  .qty output {
    min-width: 1.6rem;
    text-align: center;
  }

  .qty button {
    min-width: 2.5rem;
  }

  .menu {
    position: relative;
  }

  summary {
    cursor: pointer;
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    min-height: 2.5rem;
    box-sizing: border-box;
    display: flex;
    align-items: center;
  }

  .pop {
    position: absolute;
    right: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    min-width: 11rem;
  }

  .check {
    margin: 0;
    align-items: center;
  }

  .notes {
    margin: 0.4rem 0 0;
  }

  .panel {
    margin-top: 0.6rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
  }

  input[type='number'] {
    width: 5rem;
  }
</style>
