<script lang="ts">
  import { arcaneRecovery, longRest, recoveryBudget, shortRest } from '../../lib/character/rest.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Character, Sheet } from '../../lib/types.ts';
  import { rollTo } from './roll.ts';

  let { mode = $bindable(), c, sheet, update }: {
    mode: 'short' | 'long' | undefined;
    c: Character;
    sheet: Sheet;
    update: (fn: (c: Character) => Character) => void;
  } = $props();

  let dlg: HTMLDialogElement | undefined = $state();
  let spend: Record<number, number> = $state({});
  let refusal = $state('');
  let recover: number[] = $state([]); // Arcane Recovery: slots to get back, by level
  const budget = $derived(recoveryBudget(c, sheet));
  const spentLevels = $derived(c.state.slotsUsed.slice(0, 5).flatMap((n, i) => (n > 0 ? [{ i, n }] : [])));
  const picked = $derived(recover.reduce((t, n, i) => t + (Math.floor(n) || 0) * (i + 1), 0));

  const left = (die: number, total: number) => Math.max(0, total - (c.state.hitDiceUsed[die] ?? 0));

  // Open and close the native dialog with `mode`; it traps focus and closes on Escape. Its `close` event can arrive late (after a quick
  // reopen), so onclose only resets `mode` when the dialog really is closed.
  $effect(() => {
    if (!dlg) return;
    if (mode && !dlg.open) {
      spend = {};
      recover = [];
      refusal = '';
      dlg.showModal();
    } else if (!mode && dlg.open) dlg.close();
  });

  function doShort() {
    const counts = recover.map((n) => Math.max(0, Math.floor(n) || 0));
    const back = counts.some((n) => n > 0) ? arcaneRecovery(c, sheet, counts) : undefined;
    if (typeof back === 'string') { refusal = back.charAt(0).toUpperCase() + back.slice(1) + '.'; return; }
    const spent = sheet.hitDice.map(({ die, total }) => ({
      die,
      rolls: Array.from({ length: Math.min(Math.max(0, Math.floor(spend[die] || 0)), left(die, total)) }, () => rollTo(`Hit die (d${die})`, `1d${die}`)?.total ?? 0),
    }));
    const next = shortRest(back ?? c, spent, sheet), before = c.state.hp; // read before update(): `c` then points at the result
    update(() => next);
    const n = spent.reduce((t, s) => t + s.rolls.length, 0);
    toast(`Short rest: spent ${n} hit ${n === 1 ? 'die' : 'dice'}, healed ${next.state.hp - before} HP.${back ? ` Arcane Recovery: ${counts.reduce((t, k) => t + k, 0)} spell slot${counts.reduce((t, k) => t + k, 0) === 1 ? '' : 's'} back.` : ''}`);
    mode = undefined;
  }

  function doLong() {
    const next = longRest(c, sheet);
    if (next === c) { // R26: no benefit when dead or at 0 HP
      refusal = c.state.dead ? 'A dead character gets no benefit from a long rest.' : 'A character at 0 HP gets no benefit from a long rest. Heal first, then rest.';
      return;
    }
    update(() => next);
    toast('Long rest taken: HP, spell slots, resources and some hit dice restored.');
    mode = undefined;
  }
</script>

<dialog bind:this={dlg} aria-labelledby="rest-h" onclose={() => { if (!dlg?.open) mode = undefined; }}>
  {#if mode === 'short'}
    <h2 id="rest-h">Short rest</h2>
    <p class="muted">Spend hit dice to heal: each rolls its die plus your Constitution modifier ({sheet.mods.con >= 0 ? '+' : ''}{sheet.mods.con}). Rolls are logged in the dice tray.</p>
    {#each sheet.hitDice as h (h.die)}
      <div class="field">
        <label for="hd-{h.die}">d{h.die} hit dice to spend ({left(h.die, h.total)} of {h.total} left)</label>
        <input id="hd-{h.die}" type="number" min="0" max={left(h.die, h.total)} step="1" bind:value={spend[h.die]} />
      </div>
    {:else}
      <p class="muted">This character has no hit dice.</p>
    {/each}
    {#if budget && spentLevels.length}
      <fieldset oninput={() => (refusal = '')}>
        <legend>Arcane Recovery: up to {budget} slot level{budget === 1 ? '' : 's'} (no 6th level or higher), once a day</legend>
        {#each spentLevels as { i, n } (i)}
          <div class="field">
            <label for="ar-{i}">{['1st', '2nd', '3rd', '4th', '5th'][i]}-level slots to recover ({n} spent)</label>
            <input id="ar-{i}" type="number" min="0" max={n} step="1" bind:value={recover[i]} />
          </div>
        {/each}
        <p class="muted" class:error={picked > budget}>{picked} of {budget} slot levels picked.</p>
      </fieldset>
    {/if}
    <p class="muted">Pact slots and short-rest resources recharge.</p>
    {#if refusal}<p role="alert" class="error">{refusal}</p>{/if}
    {#if c.state.dead}<p role="alert" class="error">A dead character gets no benefit from a rest. Revive them first.</p>{/if}
    <div class="row">
      <button type="button" class="primary" disabled={c.state.dead} onclick={doShort}>Rest</button>
      <button type="button" onclick={() => (mode = undefined)}>Cancel</button>
    </div>
  {:else if mode === 'long'}
    <h2 id="rest-h">Long rest</h2>
    <p>Restores hit points to the maximum, clears temporary HP and death saves, recovers spell slots, pact slots and resources, regains half your hit dice (at least one) and lowers exhaustion by one.</p>
    {#if refusal}<p role="alert" class="error">{refusal}</p>{/if}
    <div class="row">
      <button type="button" class="primary" onclick={doLong}>Take a long rest</button>
      <button type="button" onclick={() => (mode = undefined)}>Cancel</button>
    </div>
  {/if}
</dialog>

<style>
  /* Colours, border and backdrop come from the global dialog style. */
  dialog {
    width: min(26rem, calc(100vw - 2rem));
    box-sizing: border-box;
  }

  h2 {
    margin-top: 0;
  }
</style>
