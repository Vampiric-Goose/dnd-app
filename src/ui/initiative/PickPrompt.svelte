<script lang="ts">
  // Targeting: the player's own hit waits for them to pick the die that sets its damage type (Chaos Bolt). The DM's device knows each
  // pick's damage and applies the one sent; the player learns the faces and types only. Matching dice: the bolt can leap, and it says so.
  // It closes once the DM's tracker no longer asks.
  import type { PickPrompt } from '../../lib/sync/project.ts';
  import { sendPick, session } from '../../lib/sync/session.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';

  const picks = $derived(session.tracker?.picks ?? []);
  /** Picks sent, until the tracker drops them. */
  let sent: Record<string, string> = $state({});

  let dlg: HTMLDialogElement | undefined = $state();
  $effect(() => {
    if (!dlg) return;
    if (picks.length && !dlg.open) dlg.showModal();
    else if (!picks.length && dlg.open) dlg.close();
  });

  function pick(p: PickPrompt, type: string) {
    if (session.status !== 'online') { toast("You're offline: that wasn't sent.", true); return; }
    sendPick(p.resolution, p.characterId, type);
    sent[p.resolution] = type;
  }
</script>

<!-- The player's own pick: Escape doesn't dismiss it; it closes once the DM's device has it. -->
<dialog bind:this={dlg} aria-labelledby="pick-title" oncancel={(e) => e.preventDefault()}>
  <h2 id="pick-title">Pick the damage type</h2>
  {#each picks as p (p.resolution)}
    <section>
      <p><strong>{p.spell}</strong> hit. {p.options.length > 1 ? 'Pick one of its d8s: its face sets the damage type.' : `Both d8s show ${p.options[0].face}.`}</p>
      {#if sent[p.resolution]}
        <p class="muted">{sent[p.resolution]}: sent</p>
      {:else}
        <div class="row">
          {#each p.options as o (o.face)}
            <button type="button" class="primary" onclick={() => pick(p, o.type)}>d8 <span class="num">{o.face}</span>: {o.type}</button>
          {/each}
        </div>
      {/if}
      {#if p.leap}<p class="leap" role="status">The d8s match: the bolt leaps! You can send it at another creature within 30 ft of this one.</p>{/if}
    </section>
  {/each}
</dialog>

<style>
  dialog {
    padding: 1rem 1.25rem;
  }

  h2 {
    margin: 0 0 0.2rem;
    font-size: 1.2rem;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .row button {
    min-height: 44px;
  }

  .leap {
    color: var(--accent);
    font-weight: 600;
  }
</style>
