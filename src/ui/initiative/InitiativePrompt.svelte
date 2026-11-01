<script lang="ts">
  // The DM asked the party for initiative (Combat page, or the map's Start combat): each of the player's characters in the fight without
  // one rolls here, in an in-app window on whatever page is open. It closes once the DM's tracker carries every roll.
  import { db } from '../../lib/db.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { sendInitiative, session } from '../../lib/sync/session.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, Character } from '../../lib/types.ts';
  import { message, signed } from '../creator/labels.ts';
  import { rollD20 } from '../sheet/roll.ts';

  let { campaign }: { campaign: Campaign } = $props();

  let chars: Character[] = $state.raw([]);
  $effect(() => { void session.rev; const id = campaign.id; db.characters.list(id).then((c) => { if (id === campaign.id) chars = c; }, (e) => toast(message(e), true)); });
  const bonus = (c: Character) => { try { return computeSheet(c, { settings: campaign.settings, viewer: 'player' }).initiative; } catch { return 0; } };
  const toRoll = $derived(session.tracker?.ask ? session.tracker.rows.flatMap((r) => {
    const c = chars.find((x) => x.id === r.characterId && x.ownerId !== undefined && x.ownerId === campaign.sync?.playerId);
    return c && r.init === undefined ? [c] : [];
  }) : []);
  /** Rolls sent, until the tracker carries them. */
  let sent: Record<string, number> = $state({});

  let dlg: HTMLDialogElement | undefined = $state();
  $effect(() => {
    if (!dlg) return;
    if (toRoll.length && !dlg.open) dlg.showModal();
    else if (!toRoll.length && dlg.open) dlg.close();
  });

  function roll(c: Character) {
    if (session.status !== 'online') { toast("You're offline: that wasn't sent.", true); return; }
    const r = rollD20(`${c.name}: initiative`, bonus(c));
    if (!r) return;
    sendInitiative(c.id, r.total);
    sent[c.id] = r.total;
  }
</script>

<!-- Players roll their own: Escape doesn't dismiss it, it closes once the DM has the rolls. -->
<dialog bind:this={dlg} aria-labelledby="init-title" oncancel={(e) => e.preventDefault()}>
  <h2 id="init-title">Roll initiative</h2>
  <p class="muted">The DM is starting combat.</p>
  <ul class="plain">
    {#each toRoll as c (c.id)}
      <li>
        {#if sent[c.id] !== undefined}
          <span><strong>{c.name}</strong>: <span class="num">{sent[c.id]}</span>, sent</span>
        {:else}
          <button type="button" class="primary" onclick={() => roll(c)}>Roll for {c.name} <span class="num">({signed(bonus(c))})</span></button>
        {/if}
      </li>
    {/each}
  </ul>
</dialog>

<style>
  dialog {
    padding: 1rem 1.25rem;
  }

  h2 {
    margin: 0 0 0.2rem;
    font-size: 1.2rem;
  }

  li {
    display: flex;
    align-items: center;
    min-height: 44px;
    margin-top: 0.5rem;
  }

  button {
    min-height: 44px;
  }
</style>
