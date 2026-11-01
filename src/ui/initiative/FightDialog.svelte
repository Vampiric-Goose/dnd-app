<script lang="ts" module>
  /** 'name': name a new encounter. 'first': save the running fight before another replaces it. 'end': End combat on a linked fight. */
  export type FightAsk = 'name' | 'first' | 'end';
  /** `{ name }`: save as a new encounter with that name; undefined: Cancel (or Escape). */
  export type FightAnswer = { name: string } | 'discard' | 'keep' | 'delete' | undefined;
</script>

<script lang="ts">
  // The tracker's saved-fight questions in one native dialog (traps focus, Escape cancels). `ask` opens it and resolves with the answer.
  let dlg: HTMLDialogElement | undefined = $state();
  let kind = $state<FightAsk>('name');
  let naming = $state(false);
  let name = $state('');
  let done: ((a: FightAnswer) => void) | undefined;

  export function ask(k: FightAsk): Promise<FightAnswer> {
    done?.(undefined);
    kind = k;
    naming = k === 'name';
    name = '';
    dlg?.showModal();
    return new Promise((r) => (done = r));
  }

  function answer(a: FightAnswer) {
    const d = done;
    done = undefined;
    if (dlg?.open) dlg.close();
    d?.(a);
  }

  const title = $derived(kind === 'end' ? 'End combat' : kind === 'first' ? 'Save the current fight first?' : 'Save as encounter');
</script>

<dialog bind:this={dlg} aria-labelledby="fight-h" onclose={() => { if (!dlg?.open) answer(undefined); }}>
  <h2 id="fight-h">{title}</h2>
  {#if naming}
    <form class="col" onsubmit={(e) => { e.preventDefault(); if (name.trim()) answer({ name: name.trim() }); }}>
      <label class="fld"><span class="caption">Encounter name</span><!-- svelte-ignore a11y_autofocus --><input bind:value={name} maxlength="200" autofocus /></label>
      <div class="row">
        <button type="submit" class="primary" disabled={!name.trim()}>Save</button>
        <button type="button" onclick={() => answer(undefined)}>Cancel</button>
      </div>
    </form>
  {:else if kind === 'first'}
    <p class="muted">The fight in progress is not saved in an encounter. Save it, or discard it?</p>
    <div class="row">
      <button type="button" class="primary" onclick={() => (naming = true)}>Save as encounter…</button>
      <button type="button" class="danger" onclick={() => answer('discard')}>Discard</button>
      <button type="button" onclick={() => answer(undefined)}>Cancel</button>
    </div>
  {:else}
    <p class="muted">This fight came from a saved encounter. The order, monster HP and condition durations are cleared from the tracker.</p>
    <div class="row">
      <button type="button" class="primary" onclick={() => answer('keep')}>Keep the encounter for later</button>
      <button type="button" class="danger" onclick={() => answer('delete')}>Delete it</button>
      <button type="button" onclick={() => answer(undefined)}>Cancel</button>
    </div>
  {/if}
</dialog>

<style>
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
    color: var(--text-strong);
  }

  .col,
  .fld {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .fld {
    gap: 0.2rem;
  }
</style>
