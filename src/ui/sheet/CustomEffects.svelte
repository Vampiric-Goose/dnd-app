<script lang="ts">
  import { describeEffect } from '../../lib/character/customEffect.ts';
  import type { Character } from '../../lib/types.ts';
  import EffectForm from '../EffectForm.svelte';

  let { c, update }: { c: Character; update: (fn: (c: Character) => Character) => void } = $props();
</script>

<section class="effects" aria-labelledby="effects-h">
  <h3 id="effects-h" class="cap">Custom effects</h3>
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
</section>

<style>
  .effects {
    margin-top: 0.75rem;
    padding-left: 0.75rem;
    border-left: 2px solid var(--accent);
  }

  .cap {
    margin: 0 0 0.3rem;
    color: var(--label);
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  li {
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--line);
  }

  .grow {
    flex: 1 1 12rem;
  }
</style>
