<script lang="ts">
  import { describeEffect } from '../../lib/character/customEffect.ts';
  import type { Effect } from '../../lib/types.ts';
  import EffectForm from '../EffectForm.svelte';

  // The item's effects: the same form, validation and list as a character's custom effects (customEffect.ts).
  let { effects, onchange }: { effects: Effect[]; onchange: (effects: Effect[]) => void } = $props();
</script>

<section aria-labelledby="item-effects-h">
  <h3 id="item-effects-h">Effects</h3>
  <p class="muted">What the item does for its carrier while it is equipped (and attuned, if it needs that).</p>
  {#if effects.length}
    <ul class="plain">
      {#each effects as e, i (i)}
        <li class="row">
          <span class="grow">{describeEffect(e)}</span>
          <button type="button" class="danger" aria-label="Remove effect: {describeEffect(e)}" onclick={() => onchange(effects.filter((_, k) => k !== i))}>Remove</button>
        </li>
      {/each}
    </ul>
  {/if}
  <EffectForm onadd={(e) => onchange([...effects, e])} />
</section>

<style>
  .grow {
    flex: 1 1 12rem;
  }
</style>
