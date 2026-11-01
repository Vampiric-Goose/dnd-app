<script lang="ts">
  import type { FeatureItem } from '../../lib/character/play.ts';
  import type { Sheet } from '../../lib/types.ts';
  import RichText from '../RichText.svelte';

  // The "Features" drawer. The sheet computes the list (featureList) once, for this and the drawer's summary.
  let { sheet, features }: { sheet: Sheet; features: FeatureItem[] } = $props();

  const profs = $derived(
    ([['Armor', sheet.proficiencies.armor], ['Weapons', sheet.proficiencies.weapons], ['Tools', sheet.proficiencies.tools], ['Languages', sheet.proficiencies.languages]] as const).filter(([, v]) => v.length),
  );
</script>

{#if profs.length}
  <h3 class="cap">Proficiencies</h3>
  <ul class="plain profs">{#each profs as [name, list] (name)}<li><span class="k">{name}</span> {list.join(', ')}</li>{/each}</ul>
{/if}

<h3 class="cap">Features and traits</h3>
<ul class="plain feats">
  {#each features as f, i (i)}
    <li>
      <details>
        <summary>{f.name} <span class="muted small">{f.source}</span></summary>
        <div class="text">{#if f.text.length}<RichText text={f.text} />{:else}<p class="muted">No description.</p>{/if}</div>
      </details>
    </li>
  {:else}
    <li class="muted">No features yet.</li>
  {/each}
</ul>

<style>
  .cap {
    margin: 0.4rem 0 0.3rem;
    color: var(--label);
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .profs li {
    padding: 0.1rem 0;
  }

  .k {
    display: inline-block;
    min-width: 6rem;
    color: var(--muted);
  }

  .feats {
    margin-top: 0.75rem;
  }

  .feats li {
    border-bottom: 1px solid var(--line);
  }

  summary {
    padding: 0.35rem 0;
    color: var(--text-strong);
  }

  .text {
    padding: 0 0 0.5rem 1rem;
  }

  .small {
    font-size: 0.85rem;
  }

  @media (max-width: 767px) {
    summary {
      padding: 0.65rem 0; /* a 44 px tap target, and the marker stays (no flex) */
    }
  }
</style>
