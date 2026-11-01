<script lang="ts">
  // The scene's tokens as a list: the keyboard and screen-reader way to edit them (the canvas is pointer-only).
  import { SIZE_NAMES } from '../../lib/monsters/library.ts';
  import type { Size, Token } from '../../lib/types.ts';

  let { tokens, selected, onselect, onpatch, onremove, onportrait }: {
    tokens: Token[]; selected: string[];
    onselect: (ids: string[]) => void; onpatch: (id: string, patch: Partial<Token>) => void;
    onremove: (ids: string[]) => void; onportrait: (id: string, file: File) => void;
  } = $props();

  const SIZES = Object.keys(SIZE_NAMES) as Size[];
  const value = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const hp = (e: Event) => { const v = value(e).trim(); const n = Math.round(Number(v)); return v === '' || !Number.isFinite(n) ? undefined : Math.max(0, Math.min(9999, n)); };
  // Selected tokens first, so the one tapped on the map is at hand.
  const rows = $derived([...tokens].sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id))));
</script>

{#if selected.length}
  <div class="row">
    <span>{selected.length} selected</span>
    <button type="button" class="danger" onclick={() => onremove(selected)}>Remove selected</button>
    <button type="button" onclick={() => onselect([])}>Clear selection</button>
  </div>
{/if}
{#if !tokens.length}<p class="muted">No tokens yet.</p>{/if}
<ul class="plain">
  {#each rows as t (t.id)}
    <li class="card token" class:on={selected.includes(t.id)}>
      <div class="row">
        <label class="name">Name
          <input maxlength="100" value={t.name} onchange={(e) => { const n = value(e).trim().slice(0, 100); if (n) onpatch(t.id, { name: n }); }} />
        </label>
        <label>Size
          <select value={t.size} onchange={(e) => onpatch(t.id, { size: value(e) as Size })}>
            {#each SIZES as s}<option value={s}>{SIZE_NAMES[s]}</option>{/each}
          </select>
        </label>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" checked={!!t.hidden} onchange={(e) => onpatch(t.id, { hidden: (e.currentTarget as HTMLInputElement).checked || undefined })} /> Hidden from players</label>
        {#if t.monsterId}
          <label class="small">HP <input type="number" min="0" value={t.hp ?? ''} onchange={(e) => onpatch(t.id, { hp: hp(e) })} /></label>
          <label class="small">Max HP <input type="number" min="0" value={t.maxHp ?? ''} onchange={(e) => onpatch(t.id, { maxHp: hp(e) })} /></label>
        {/if}
      </div>
      <div class="row">
        <label class="small">Portrait <input type="file" accept="image/*" onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) onportrait(t.id, f); }} /></label>
        <button type="button" onclick={() => onselect([t.id])} aria-label="Select {t.name}">Select</button>
        <button type="button" class="danger" onclick={() => onremove([t.id])} aria-label="Remove {t.name}">Remove</button>
      </div>
    </li>
  {/each}
</ul>

<style>
  .token.on {
    outline: 2px solid var(--accent);
  }

  label {
    font-size: 0.85rem;
  }

  .name {
    flex: 1 1 10rem;
    display: flex;
    flex-direction: column;
  }

  .small input[type='number'] {
    width: 4.5rem;
  }

  .small input[type='file'] {
    max-width: 12rem;
  }
</style>
