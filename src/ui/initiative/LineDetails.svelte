<script lang="ts">
  // A library line's own touches: the name its creatures take (numbered when several), a portrait, max HP and AC. Blank = the stat block's.
  import { onDestroy } from 'svelte';
  import { db } from '../../lib/db.ts';
  import { resizeImage } from '../../lib/images.ts';
  import type { Encounter, MonsterDef } from '../../lib/types.ts';

  let { line = $bindable(), monster }: { line: Encounter['monsters'][number]; monster: MonsterDef | undefined } = $props();

  let preview = $state(''), error = $state('');
  let dead = false;
  const show = (b: Blob | undefined) => { if (preview) URL.revokeObjectURL(preview); preview = b && !dead ? URL.createObjectURL(b) : ''; };
  $effect(() => { const h = line.portrait; if (h) db.blobs.get(h).then(show, () => {}); else show(undefined); });
  onDestroy(() => { dead = true; show(undefined); });

  async function onPortrait(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    error = '';
    try { line.portrait = await db.blobs.put(await resizeImage(file, 256)); } catch (err) { error = err instanceof Error ? err.message : String(err); }
  }
  /** A whole number in [lo, hi], or undefined (blank or out of range: the stat block's). */
  const num = (v: string, lo: number, hi: number) => { const n = Number(v); return v.trim() && Number.isInteger(n) && n >= lo && n <= hi ? n : undefined; };
  const avgHp = $derived(monster && 'average' in monster.hp ? monster.hp.average : undefined);
</script>

<div class="details">
  <label class="fld"><span class="caption">Name</span>
    <input maxlength="100" placeholder={monster?.name ?? ''} value={line.label ?? ''} oninput={(e) => { const v = e.currentTarget.value.trim(); line.label = v || undefined; }} /></label>
  <label class="fld"><span class="caption">Max HP</span>
    <input type="number" class="num" min="1" max="9999" inputmode="numeric" placeholder={avgHp === undefined ? '' : String(avgHp)} value={line.hp ?? ''}
      oninput={(e) => (line.hp = num(e.currentTarget.value, 1, 9999))} /></label>
  <label class="fld"><span class="caption">AC</span>
    <input type="number" class="num" min="0" max="50" inputmode="numeric" placeholder={String(monster?.ac[0]?.value ?? '')} value={line.ac ?? ''}
      oninput={(e) => (line.ac = num(e.currentTarget.value, 0, 50))} /></label>
  <div class="fld"><span class="caption">Portrait</span>
    <div class="row">
      {#if preview}<img src={preview} alt="" />{/if}
      <label class="file">{line.portrait ? 'Change' : 'Choose image'}<input type="file" accept="image/*" hidden onchange={onPortrait} /></label>
      {#if line.portrait}<button type="button" onclick={() => (line.portrait = undefined)}>Remove</button>{/if}
    </div>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="muted small">Blank fields use the stat block. For other stats, Duplicate the monster on the Monsters page and edit the copy.</p>
</div>

<style>
  .details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: 0.4rem 0.6rem;
    padding: 0.4rem 0 0.6rem;
  }

  .details > p {
    grid-column: 1 / -1;
    margin: 0;
  }

  .fld {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  img {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    object-fit: cover;
  }

  .file {
    cursor: pointer;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
  }

  .small {
    font-size: 0.85rem;
  }
</style>
