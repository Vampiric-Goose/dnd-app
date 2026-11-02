<script lang="ts">
  // Targeting: an area caught one of the player's characters. They roll its save here, in an in-app window on whatever page is open;
  // the DM's device works out the damage. It closes once the DM's tracker no longer asks.
  import { roll as rollDie } from '../../lib/rolls.svelte.ts';
  import { db } from '../../lib/db.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import type { SavePrompt } from '../../lib/sync/project.ts';
  import { sendSave, session } from '../../lib/sync/session.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, Character } from '../../lib/types.ts';
  import { ABILITY_NAMES, message, signed } from '../creator/labels.ts';

  let { campaign }: { campaign: Campaign } = $props();

  let chars: Character[] = $state.raw([]);
  $effect(() => { void session.rev; const id = campaign.id; db.characters.list(id).then((c) => { if (id === campaign.id) chars = c; }, (e) => toast(message(e), true)); });
  const saves = $derived(session.tracker?.saves ?? []);
  const charOf = (s: SavePrompt) => chars.find((c) => c.id === s.characterId);
  const bonus = (s: SavePrompt) => { const c = charOf(s); try { return c ? computeSheet(c, { settings: campaign.settings, viewer: 'player' }).saves[s.ability].bonus : 0; } catch { return 0; } };
  /** Rolls sent, until the tracker drops them. */
  let sent: Record<string, number> = $state({});

  let dlg: HTMLDialogElement | undefined = $state();
  $effect(() => {
    if (!dlg) return;
    if (saves.length && !dlg.open) dlg.showModal();
    else if (!saves.length && dlg.open) dlg.close();
  });

  function roll(s: SavePrompt) {
    if (session.status !== 'online') { toast("You're offline: that wasn't sent.", true); return; }
    const r = rollDie(`${charOf(s)?.name ?? 'Save'}: ${ABILITY_NAMES[s.ability]} save (${s.spell})`, `1d20${signed(bonus(s))}`, { mode: 'normal' }); // one d20: the DM's device adds the bonus
    sendSave(s.resolution, s.characterId, r.faces[0]);
    sent[s.resolution + s.characterId] = r.total;
  }
</script>

<!-- Players roll their own: Escape doesn't dismiss it; it closes once the DM's device has the roll. -->
<dialog bind:this={dlg} aria-labelledby="save-title" oncancel={(e) => e.preventDefault()}>
  <h2 id="save-title">Saving throw</h2>
  <ul class="plain">
    {#each saves as s (s.resolution + s.characterId)}
      <li>
        <span><strong>{charOf(s)?.name ?? 'Your character'}</strong>: {ABILITY_NAMES[s.ability]} save against {s.spell}</span>
        {#if sent[s.resolution + s.characterId] !== undefined}
          <span class="num">{sent[s.resolution + s.characterId]}</span><span class="muted">sent</span>
        {:else}
          <button type="button" class="primary" onclick={() => roll(s)}>Roll <span class="num">({signed(bonus(s))})</span></button>
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
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
  }
</style>
