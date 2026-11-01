<script lang="ts">
  import { useCharge, useItem } from '../../lib/items/inventory.ts';
  import { normalizeView, rowView } from '../../lib/items/rows.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { InventoryEntry, PlayerView } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import { downloadPdf, fileName } from '../download.ts';
  import EntityDetail from '../EntityDetail.svelte';
  import Drawer from '../kit/Drawer.svelte';
  import Menu, { type MenuItem } from '../kit/Menu.svelte';
  import Pill from '../kit/Pill.svelte';
  import Pips from '../sheet/Pips.svelte';
  import PlayerViewEditor from './PlayerViewEditor.svelte';

  // One inventory or Unassigned entry, shown the way `viewer` may see it. `gear` adds what a character does with an item
  // (equip, attune, use, charges); an Unassigned entry is just quantity, notes and the menu.
  let { entry, viewer, gear = false, warnAttune = false, targets, moveLabel, canRefresh, onchange, onremove, onrefresh, onmove }: {
    entry: InventoryEntry;
    viewer: 'dm' | 'player';
    gear?: boolean;
    warnAttune?: boolean;
    targets: { id: string; label: string }[];
    moveLabel: string; // 'Transfer to…' or 'Give to…'
    canRefresh: boolean;
    onchange: (fn: (e: InventoryEntry) => InventoryEntry) => void; // applied to the latest copy of the entry
    onremove: () => void;
    onrefresh: () => void;
    onmove: (targetId: string, qty: number) => Promise<void>;
  } = $props();

  const v = $derived(rowView(entry, viewer));
  const uid = $props.id();

  let panel: 'view' | 'move' | 'remove' | undefined = $state();
  let details = $state(false);
  let draft: PlayerView | undefined = $state.raw();
  let target = $state('');
  let qty: number | null = $state(1);
  let busy = $state(false);

  const open = (p: NonNullable<typeof panel>) => {
    panel = p;
    draft = entry.view;
    target = targets[0]?.id ?? '';
    qty = 1;
  };
  const patch = (p: Partial<InventoryEntry>) => onchange((x) => ({ ...x, ...p }));

  // The player view is the DM's: it can't stay on screen after switching to Player.
  $effect(() => { if (viewer !== 'dm' && panel === 'view') panel = undefined; });

  const amount = $derived(Math.min(entry.quantity, Math.max(1, Math.floor(qty ?? 1))));
  const meta = $derived([v.shown.type, v.shown.magic ? v.shown.rarity : undefined, v.shown.weight !== undefined ? `${v.shown.weight} lb` : undefined].filter(Boolean).join(' · '));
  // On the Unassigned list a player must not read the DM's notes; on their own inventory the notes are theirs.
  const showNotes = $derived(gear || viewer === 'dm');

  function use() {
    if (useItem(entry)) onchange((x) => useItem(x) ?? x);
    else onremove();
  }

  // The card holds what this viewer may see: v.shown is playerItem(entry.item, entry.view) for a player.
  async function exportPdf() {
    try {
      const { exportItemPdf } = await import('../../lib/pdf/exportPdf.ts');
      downloadPdf(await exportItemPdf(v.shown), fileName(v.name, 'pdf', 'item'));
    } catch (e) {
      toast(`Could not export the PDF: ${message(e)}`, true);
    }
  }

  async function move() {
    busy = true;
    try { await onmove(target, amount); } finally { busy = false; panel = undefined; }
  }

  const actions = $derived<MenuItem[]>([
    { label: 'Details', onselect: () => (details = true) },
    ...(viewer === 'dm' ? [{ label: 'Edit player view', onselect: () => open('view') }] : []),
    { label: 'Export PDF', onselect: exportPdf },
    { label: canRefresh ? 'Update from source' : 'Update from source (source gone)', disabled: !canRefresh, onselect: onrefresh },
    { label: targets.length ? moveLabel : `${moveLabel} (nowhere to send it)`, disabled: !targets.length, onselect: () => open('move') },
    { separator: true },
    { label: 'Remove', danger: true, onselect: () => open('remove') },
  ]);
</script>

{#snippet notesLine()}{entry.notes}{/snippet}

<li class="entry">
  <div class="top">
    <span class="name">{v.name}</span>
    {#if v.secret}<Pill label="Secret" accent />{/if}
    <span class="muted meta">{meta}</span>
    <span class="qty" role="group" aria-label="Quantity of {v.name}">
      <button type="button" aria-label="One fewer {v.name}" disabled={entry.quantity <= 1} onclick={() => onchange((x) => ({ ...x, quantity: Math.max(1, x.quantity - 1) }))}>−</button>
      <output class="num">{entry.quantity}</output>
      <button type="button" aria-label="One more {v.name}" onclick={() => onchange((x) => ({ ...x, quantity: x.quantity + 1 }))}>+</button>
    </span>
    <Menu label="⋯" ariaLabel="Actions for {v.name}" caret={false} align="end" items={actions} />
  </div>

  {#if gear}
    {#if v.canEquip || v.needsAttune || v.consumable || v.maxCharges > 0}
      <div class="gear">
        {#if v.canEquip}
          <label class="check"><input type="checkbox" aria-label="Equipped: {v.name}" checked={entry.equipped} onchange={(e) => patch({ equipped: e.currentTarget.checked })} /> Equipped</label>
        {/if}
        {#if v.needsAttune}
          <label class="check"><input type="checkbox" aria-label="Attuned: {v.name}" checked={entry.attuned} aria-describedby={warnAttune ? `${uid}-warn` : undefined} onchange={(e) => patch({ attuned: e.currentTarget.checked })} /> Attuned</label>
        {/if}
        {#if v.consumable}<button type="button" onclick={use}>Use</button>{/if}
        {#if v.maxCharges > 0}
          <span class="charges">
            <Pips total={v.maxCharges} used={Math.min(entry.chargesUsed, v.maxCharges)} label="{v.name} charges" onchange={(n) => patch({ chargesUsed: n })} />
            <button type="button" disabled={entry.chargesUsed >= v.maxCharges} onclick={() => onchange((x) => useCharge(x))}>Use charge</button>
            <span class="muted"><span class="num">{v.maxCharges - entry.chargesUsed}</span> of <span class="num">{v.maxCharges}</span> left</span>
          </span>
        {/if}
      </div>
    {/if}
    {#if warnAttune && v.needsAttune}<p id="{uid}-warn" class="error warn" role="note">Over the limit of 3 (artificers can attune to more)</p>{/if}
  {/if}

  <div class="drawers">
    <Drawer title="Details" bind:open={details} summary={showNotes && entry.notes ? notesLine : undefined}>
      {#if showNotes}
        <label class="field notes">Notes <input type="text" aria-label="Notes: {v.name}" autocomplete="off" value={entry.notes} onchange={(e) => patch({ notes: e.currentTarget.value })} /></label>
      {/if}
      {#if details}<EntityDetail entity={v.shown} />{/if}
    </Drawer>

    {#if panel === 'view' && viewer === 'dm'}
      <Drawer title="Player view" open>
        <div role="group" aria-label="Player view of {v.name}">
          <PlayerViewEditor item={entry.item} view={draft} onchange={(next) => (draft = next)} />
          <div class="row">
            <button type="button" class="primary" onclick={() => { patch({ view: normalizeView(draft) }); panel = undefined; }}>Save view</button>
            <button type="button" onclick={() => (panel = undefined)}>Cancel</button>
          </div>
        </div>
      </Drawer>
    {/if}
  </div>

  {#if panel === 'move'}
    <div class="confirm" role="group" aria-label="{moveLabel} {v.name}">
      <div class="row">
        <label class="field">To <select bind:value={target}>{#each targets as t (t.id)}<option value={t.id}>{t.label}</option>{/each}</select></label>
        {#if entry.quantity > 1}
          <label class="field">How many <input class="num" type="number" min="1" max={entry.quantity} step="1" bind:value={qty} /></label>
        {/if}
      </div>
      <p>Move {amount} × {v.name} to {targets.find((t) => t.id === target)?.label}? It arrives unequipped and unattuned.</p>
      <div class="row">
        <button type="button" class="primary" disabled={busy || !target} onclick={move}>Confirm</button>
        <button type="button" onclick={() => (panel = undefined)}>Cancel</button>
      </div>
    </div>
  {:else if panel === 'remove'}
    <div class="confirm" role="group" aria-label="Remove {v.name}">
      <p>Remove {entry.quantity > 1 ? `all ${entry.quantity} × ` : ''}{v.name}? This cannot be undone.</p>
      <div class="row">
        <button type="button" class="danger" onclick={onremove}>Remove</button>
        <button type="button" onclick={() => (panel = undefined)}>Cancel</button>
      </div>
    </div>
  {/if}
</li>

<style>
  .entry {
    border-top: 1px solid var(--line);
    padding: 0.35rem 0 0.1rem;
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.6rem;
  }

  .name {
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }

  .meta {
    flex: 1 1 8rem;
    font-size: 0.875rem;
  }

  .qty {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .qty output {
    min-width: 1.6rem;
    text-align: center;
    color: var(--text-strong);
  }

  .qty button {
    min-width: 2.25rem;
    padding: 0.2rem 0.4rem;
  }

  .gear {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 1rem;
    margin-top: 0.25rem;
  }

  .charges {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .check {
    margin: 0;
    align-items: center;
  }

  .warn {
    margin: 0.25rem 0 0;
  }

  /* Inside a row the drawers are sub-lines: the row's own rule already separates it. */
  .drawers > :global(.drawer:first-child) {
    border-top: 0;
  }

  .drawers :global(.drawer > summary) {
    padding: 0.3rem 0;
    font-size: 0.875rem;
  }

  .notes {
    margin: 0 0 0.5rem;
  }

  .confirm {
    padding: 0.5rem 0 0.6rem;
    border-top: 1px solid var(--line);
  }

  .confirm .field {
    margin: 0;
  }

  .confirm p {
    margin: 0.4rem 0;
  }

  input[type='number'] {
    width: 5rem;
  }

  @media (max-width: 767px) {
    .qty button {
      min-width: 44px;
    }
  }
</style>
