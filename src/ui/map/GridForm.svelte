<script lang="ts">
  // A scene's grid settings. Each change is clamped to what storage and backups accept (sceneProblem) and saved at once.
  import type { Grid } from '../../lib/types.ts';

  let { grid, onchange }: { grid: Grid; onchange: (patch: Partial<Grid>) => void } = $props();

  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
</script>

<div class="grid-form">
  <label>Grid type
    <select value={grid.type} onchange={(e) => onchange({ type: (e.currentTarget as HTMLSelectElement).value as Grid['type'] })}>
      <option value="square">Square</option>
      <option value="hex-flat">Hex (flat top)</option>
      <option value="hex-pointy">Hex (pointy top)</option>
    </select>
  </label>
  <label>Cell size (px)
    <input type="number" min="10" max="500" step="0.5" value={grid.size} onchange={(e) => onchange({ size: clamp(num(e), 10, 500, grid.size) })} />
  </label>
  <label>X offset (px)
    <input type="number" step="0.5" value={grid.offsetX} onchange={(e) => onchange({ offsetX: clamp(num(e), -500, 500, grid.offsetX) })} />
  </label>
  <label>Y offset (px)
    <input type="number" step="0.5" value={grid.offsetY} onchange={(e) => onchange({ offsetY: clamp(num(e), -500, 500, grid.offsetY) })} />
  </label>
  <label>Grid color
    <input type="color" value={grid.color} onchange={(e) => onchange({ color: (e.currentTarget as HTMLInputElement).value })} />
  </label>
  <label>Grid opacity
    <input type="range" min="0" max="1" step="0.05" value={grid.opacity} onchange={(e) => onchange({ opacity: clamp(num(e), 0, 1, grid.opacity) })} />
  </label>
  <label>Feet per cell
    <input type="number" min="1" max="100" step="1" value={grid.feet} onchange={(e) => onchange({ feet: clamp(Math.round(num(e)), 1, 100, grid.feet) })} />
  </label>
</div>

<style>
  .grid-form {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: 0.6rem 0.75rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    color: var(--muted);
    font-size: 0.85rem;
  }

  input,
  select {
    width: 100%;
    box-sizing: border-box;
  }

  input[type='number'] {
    font-family: var(--mono);
  }
</style>
