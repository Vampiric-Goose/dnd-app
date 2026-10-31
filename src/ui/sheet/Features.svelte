<script lang="ts">
  import { featureList } from '../../lib/character/play.ts';
  import type { CampaignSettings, Character, Sheet } from '../../lib/types.ts';
  import RichText from '../RichText.svelte';

  let { c, sheet, settings }: { c: Character; sheet: Sheet; settings: CampaignSettings } = $props();

  const features = $derived(featureList(c, settings));
  const profs = $derived(
    ([['Armor', sheet.proficiencies.armor], ['Weapons', sheet.proficiencies.weapons], ['Tools', sheet.proficiencies.tools], ['Languages', sheet.proficiencies.languages]] as const).filter(([, v]) => v.length),
  );
</script>

<section aria-labelledby="features-h">
  <h2 id="features-h">Features and traits</h2>

  {#if profs.length}
    <div class="card">
      <h3>Proficiencies</h3>
      <ul class="plain">{#each profs as [name, list] (name)}<li><strong>{name}:</strong> {list.join(', ')}</li>{/each}</ul>
    </div>
  {/if}

  {#if sheet.notes.length}
    <div class="card">
      <h3>Notes</h3>
      <ul class="plain">{#each sheet.notes as n, i (i)}<li><strong>{n.source}:</strong> {n.text}</li>{/each}</ul>
    </div>
  {/if}

  <div class="card">
    {#each features as f, i (i)}
      <details>
        <summary>{f.name} <span class="muted small">{f.source}</span></summary>
        {#if f.text.length}<RichText text={f.text} />{:else}<p class="muted">No description.</p>{/if}
      </details>
    {:else}
      <p class="muted">No features yet.</p>
    {/each}
  </div>
</section>

<style>
  h3 {
    margin: 0 0 0.4rem;
  }

  summary {
    cursor: pointer;
    padding: 0.3rem 0;
  }

  .small {
    font-size: 0.85rem;
  }
</style>
