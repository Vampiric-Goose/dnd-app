<script lang="ts">
  // Amount, Damage, Heal (with the crit box at 0 HP) and Temp HP / Set temp HP: the sheet's Combat block and the tracker's HP module.
  let { label, dead = false, atZero = false, ondamage, onheal, ontemp }: {
    label: string; dead?: boolean; atZero?: boolean;
    ondamage: (n: number, crit: boolean) => void; onheal: (n: number) => void; ontemp: (n: number) => void;
  } = $props();

  let amount: number | null = $state(null);
  let temp: number | null = $state(null);
  let crit = $state(false);

  // The engine only reads the crit flag at 0 HP (2 death-save failures), so the box exists only then.
  $effect(() => { if (!atZero) crit = false; });
  const whole = (n: number | null): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

  function damage() {
    if (!whole(amount) || !amount) return;
    ondamage(amount, crit);
    amount = null;
    crit = false;
  }

  function heal() {
    if (!whole(amount) || !amount) return;
    onheal(amount);
    amount = null;
  }

  function setTemp() {
    if (!whole(temp)) return;
    ontemp(temp);
    temp = null;
  }
</script>

<div class="row hpc">
  <label class="row"><span>Amount</span><input type="number" min="0" step="1" inputmode="numeric" aria-label="{label} amount" bind:value={amount} /></label>
  <button type="button" class="danger" aria-label="Damage {label}" disabled={!whole(amount) || !amount || dead} onclick={damage}>Damage</button>
  <button type="button" aria-label="Heal {label}" disabled={!whole(amount) || !amount || dead} onclick={heal}>Heal</button>
  {#if atZero}
    <label class="check"><input type="checkbox" bind:checked={crit} /> Critical hit (2 failed death saves)</label>
  {/if}
</div>
<div class="row hpc">
  <label class="row"><span>Temp HP</span><input type="number" min="0" step="1" inputmode="numeric" aria-label="{label} temp HP" bind:value={temp} /></label>
  <button type="button" aria-label="Set temp HP for {label}" disabled={!whole(temp)} onclick={setTemp}>Set temp HP</button>
</div>

<style>
  /* Sized for a 260-320 px side panel (the sheet's status panel, the tracker's row panel): one row each, wrapping if narrower. */
  .hpc {
    gap: 0.35rem;
    margin: 0.4rem 0;
  }

  label.row {
    gap: 0.35rem;
  }

  label.row > span {
    color: var(--label);
    font-size: 0.72rem;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  input {
    width: 4.25rem;
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }

  .check {
    margin: 0.2rem 0;
    font-size: 0.9rem;
  }
</style>
