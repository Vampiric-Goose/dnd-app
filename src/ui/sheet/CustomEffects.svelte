<script lang="ts">
  import { describeEffect } from '../../lib/character/customEffect.ts';
  import type { Character } from '../../lib/types.ts';
  import EffectForm from '../EffectForm.svelte';

  let { c, update }: { c: Character; update: (fn: (c: Character) => Character) => void } = $props();
</script>

<section aria-labelledby="effects-h">
  <h2 id="effects-h">Custom effects</h2>
  <div class="card">
    <p class="muted">Add a bonus, proficiency or other effect that is not part of the character's build. It applies to every number on the sheet.</p>

    {#if c.customEffects.length}
      <ul class="plain">
        {#each c.customEffects as e, i (i)}
          <li class="row">
            <span class="grow">{describeEffect(e)}</span>
            <button type="button" class="danger" aria-label="Remove custom effect: {describeEffect(e)}" onclick={() => update((x) => ({ ...x, customEffects: x.customEffects.filter((_, k) => k !== i) }))}>Remove</button>
          </li>
        {/each}
      </ul>
    {/if}

    <EffectForm onadd={(e) => update((x) => ({ ...x, customEffects: [...x.customEffects, e] }))} />
  </div>
</section>

<style>
  .grow {
    flex: 1 1 12rem;
  }
</style>
