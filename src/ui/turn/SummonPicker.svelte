<script lang="ts">
  // What a summon cast calls (summons.ts): a TCE spirit (its stat block from the shared books, a variant such as Air, Land or Water), a
  // conjure option (that many creatures up to its challenge rating and type), or one of a list of forms (Find Familiar).
  import { checkPick, summonCount, type SummonSpec } from '../../lib/combat/summons.ts';
  import type { MonsterDef } from '../../lib/types.ts';

  let { spec, pool, slot, level, disabled = false, onpick }: {
    spec: SummonSpec; pool: MonsterDef[]; slot: number; level: number; disabled?: boolean;
    onpick: (p: { option?: number; monsters: MonsterDef[]; variant?: string }) => void;
  } = $props();

  let option = $state(0), creature = $state(''), variant = $state('');
  const cr = (m: MonsterDef) => { const [a, b] = String(m.cr ?? '0').split('/'); return b ? +a / +b : +a || 0; };
  // ponytail: a conjure option calls that many of one kind (the common case); mixed kinds by hand
  const fits = $derived.by((): MonsterDef[] => {
    if ('creature' in spec) return pool.filter((m) => m.name === spec.creature);
    if ('forms' in spec) return pool.filter((m) => spec.forms.some((f) => f.toLowerCase().includes(m.name.toLowerCase())));
    const o = spec.options[option];
    if (!o) return [];
    const cap = o.cr + (spec.crPerSlot ? Math.max(0, slot - spec.crPerSlot.above) : 0);
    return pool.filter((m) => cr(m) <= cap && (!o.type || m.type.toLowerCase().startsWith(o.type))).sort((a, b) => cr(b) - cr(a) || a.name.localeCompare(b.name));
  });
  const count = $derived(summonCount(spec, 'options' in spec ? option : undefined, slot));
  const chosen = $derived(fits.find((m) => m.id === creature) ?? fits[0]);
  const pick = $derived(chosen && { ...('options' in spec && { option }), monsters: Array(count).fill(chosen), ...(variant && { variant }) });
  const why = $derived(!chosen ? ('creature' in spec ? `Import the book with the ${spec.creature} to summon it.` : 'No creature in the books fits.') : checkPick(spec, pick!, slot, level));
</script>

<span class="summon">
  {#if 'options' in spec}
    <select aria-label="What appears" bind:value={option}>
      {#each spec.options as o, i (i)}<option value={i}>{summonCount(spec, i, slot)} × CR {o.cr < 1 ? `1/${Math.round(1 / o.cr)}` : o.cr}{o.type ? ` ${o.type}` : ''}</option>{/each}
    </select>
  {/if}
  {#if fits.length > 1}
    <select aria-label="Which creature" value={chosen?.id} onchange={(e) => (creature = e.currentTarget.value)}>
      {#each fits as m (m.id)}<option value={m.id}>{m.name}{'options' in spec ? ` (CR ${m.cr})` : ''}</option>{/each}
    </select>
  {/if}
  {#if 'creature' in spec && spec.variants}
    <select aria-label="Its form" bind:value={variant}>
      <option value="">Form…</option>
      {#each spec.variants as v (v)}<option value={v}>{v}</option>{/each}
    </select>
  {/if}
  <button type="button" class="use" disabled={disabled || !!why || ('creature' in spec && !!spec.variants && !variant)} onclick={() => pick && onpick(pick)}>Summon</button>
  {#if why}<span class="muted small">{why}</span>{/if}
</span>

<style>
  .summon {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
</style>
