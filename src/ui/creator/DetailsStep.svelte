<script lang="ts">
  import { onDestroy } from 'svelte';
  import { db } from '../../lib/db.ts';
  import { resizeImage } from '../../lib/images.ts';
  import { app } from '../../lib/store.svelte.ts';
  import type { Character } from '../../lib/types.ts';
  import { ALIGNMENTS, message } from './labels.ts';

  let { c = $bindable() }: { c: Character } = $props();

  const texts: [keyof Character['details'], string][] = [
    ['personality', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws'],
    ['appearance', 'Appearance'], ['backstory', 'Backstory'], ['notes', 'Notes'],
  ];

  let preview = $state('');
  let error = $state('');
  let busy = $state(false);
  let destroyed = false; // a load or resize that finishes after the step closes must not create an unrevoked URL
  const show = (b: Blob | undefined) => {
    if (preview) URL.revokeObjectURL(preview);
    preview = b && !destroyed ? URL.createObjectURL(b) : '';
  };
  if (c.details.portrait) db.blobs.get(c.details.portrait).then(show, () => {});
  onDestroy(() => {
    destroyed = true;
    show(undefined);
  });

  async function onPortrait(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    error = '';
    busy = true;
    try {
      const small = await resizeImage(file, 256);
      c.details.portrait = await db.blobs.put(small);
      show(small);
    } catch (err) {
      error = 'Could not use that image: ' + message(err);
    } finally {
      busy = false;
    }
  }

  function setCampaign(id: string) {
    if (id) c.campaignId = id;
    else delete c.campaignId;
  }
</script>

<div class="field">
  <label for="char-name">Name</label>
  <input id="char-name" bind:value={c.name} autocomplete="off" />
</div>

<div class="field">
  <label for="alignment">Alignment</label>
  <select id="alignment" bind:value={c.details.alignment}>
    <option value="">—</option>
    {#each ALIGNMENTS as al}<option value={al}>{al}</option>{/each}
  </select>
</div>

<div class="field">
  <label for="char-campaign">Campaign</label>
  <select id="char-campaign" value={c.campaignId ?? ''} onchange={(e) => setCampaign(e.currentTarget.value)}>
    <option value="">None (every imported book)</option>
    {#each app.campaigns as camp (camp.id)}<option value={camp.id}>{camp.name}</option>{/each}
  </select>
  <small class="muted">A character in a campaign can use only the SRD and the books that campaign enables.</small>
</div>

<div class="field">
  <label for="portrait">Portrait</label>
  <input id="portrait" type="file" accept="image/*" disabled={busy} onchange={onPortrait} />
  {#if preview}<img src={preview} alt="Portrait preview" width="128" />{/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
</div>

{#each texts as [key, label]}
  <div class="field">
    <label for="d-{key}">{label}</label>
    <textarea id="d-{key}" rows="3" bind:value={c.details[key]}></textarea>
  </div>
{/each}

<style>
  /* Inputs and textareas use the global control style. */
  .field {
    max-width: 40rem;
  }

  img {
    border-radius: var(--radius);
    margin-top: 0.5rem;
  }
</style>
