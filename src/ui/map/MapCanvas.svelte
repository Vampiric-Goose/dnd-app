<script module lang="ts">
  import type { Token } from '../../lib/types.ts';
  export type CanvasToken = Pick<Token, 'id' | 'name' | 'x' | 'y' | 'size' | 'color' | 'portrait' | 'hidden'> & { hp?: number; maxHp?: number; conditions?: string[]; health?: string };
</script>

<script lang="ts">
  // The battle map canvas, shared by the DM's map and (Task B2) the players' map. Draws only on change: schedule() sets a dirty flag and
  // asks for one frame. Pan, wheel zoom, pinch, drag with a snapped ghost, tap and box select, and a ruler.
  import { untrack } from 'svelte';
  import { db } from '../../lib/db.ts';
  import { cellsIn, feetBetween, hexCorners, snap, type Pt } from '../../lib/map/grid.ts';
  import { initials, radius, tokenAt, tokensInRect } from '../../lib/map/scene.ts';
  import { fit, pinch, toScreen, toWorld, zoomAt, type View } from '../../lib/map/view.ts';
  import type { Grid, Scene } from '../../lib/types.ts';

  let { width, height, image, grid, tokens, dm, diagonal, selected, canDrag, speedOf, onselect, onmove, rev = 0 }: {
    width: number; height: number; image?: string; grid: Grid; tokens: CanvasToken[]; dm: boolean; diagonal: '5-5-5' | '5-10-5'; selected: string[];
    canDrag: (id: string) => boolean; speedOf?: (id: string) => number | undefined;
    onselect: (ids: string[]) => void; onmove: (ids: string[], primary: string, to: Pt) => void; rev?: number;
  } = $props();

  let tool: 'select' | 'box' | 'ruler' = $state('select');
  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;

  // Plain (non-reactive) drawing state: changes call schedule() themselves.
  let view: View = { x: 0, y: 0, scale: 1 };
  let vw = 0, vh = 0, dpr = 1;
  let dirty = false;
  const bitmaps = new Map<string, ImageBitmap | 'loading' | 'failed'>();
  const pointers = new Map<number, Pt>();
  type Mode =
    | { k: 'none' }
    | { k: 'pan'; from: Pt; view0: View; moved: boolean; shift: boolean }
    | { k: 'press'; from: Pt; id: string; grab: Pt; shift: boolean }
    | { k: 'drag'; id: string; ids: string[]; grab: Pt; ghost: Pt }
    | { k: 'box'; a: Pt; b: Pt; shift: boolean }
    | { k: 'ruler' }
    | { k: 'pinch'; a0: Pt; b0: Pt; view0: View };
  let mode: Mode = { k: 'none' };
  let ruler: { a: Pt; b: Pt } | undefined;
  let hover: string | undefined;

  const scene = () => ({ grid, tokens }) as unknown as Scene; // tokenAt and tokensInRect read only these two

  function schedule() {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(draw);
  }

  function bitmap(hash: string): ImageBitmap | undefined {
    const b = bitmaps.get(hash);
    if (b === undefined) {
      bitmaps.set(hash, 'loading');
      db.blobs.get(hash)
        .then((blob) => (blob ? createImageBitmap(blob) : undefined))
        .then((bmp) => { bitmaps.set(hash, bmp ?? 'failed'); schedule(); }, () => bitmaps.set(hash, 'failed'));
      return undefined;
    }
    return typeof b === 'string' ? undefined : b;
  }

  function fitView() {
    if (!vw || !vh) return;
    view = fit(width, height, vw, vh);
    schedule();
  }

  // Redraw on any prop change; refit when the scene's sides or image change; reload images when rev bumps.
  $effect(() => { void [width, height, image, grid, tokens, selected, dm]; untrack(schedule); });
  let fitKey = '';
  $effect(() => {
    const k = `${width}x${height}:${image ?? ''}`;
    untrack(() => { if (k !== fitKey && vw) { fitKey = k; fitView(); } });
  });
  $effect(() => {
    void rev;
    untrack(() => { for (const b of bitmaps.values()) if (typeof b !== 'string') b.close(); bitmaps.clear(); schedule(); });
  });

  $effect(() => {
    const ro = new ResizeObserver(([e]) => {
      vw = e.contentRect.width;
      vh = e.contentRect.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      if (!fitKey) { fitKey = `${width}x${height}:${image ?? ''}`; view = fit(width, height, vw, vh); }
      schedule();
    });
    ro.observe(wrap);
    // wheel must be non-passive to stop the page scrolling
    const wheel = (e: WheelEvent) => { e.preventDefault(); view = zoomAt(view, local(e), e.deltaY < 0 ? 1.1 : 1 / 1.1); schedule(); };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); canvas.removeEventListener('wheel', wheel); };
  });

  const css = (name: string, fallback: string) => getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;

  function draw() {
    dirty = false;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !vw) return;
    const accent = css('--accent', '#8a5200');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    const px = 1 / view.scale; // one screen pixel in scene units

    // background
    const bg = image ? bitmap(image) : undefined;
    if (bg) ctx.drawImage(bg, 0, 0, width, height);
    else { ctx.fillStyle = '#e9e4d8'; ctx.fillRect(0, 0, width, height); }

    // grid: only the visible cells, and not at all when a cell is under 6 screen px
    if (grid.size * view.scale >= 6 && grid.opacity > 0) {
      const tl = toWorld(view, { x: 0, y: 0 }), br = toWorld(view, { x: vw, y: vh });
      const x0 = Math.max(0, tl.x), y0 = Math.max(0, tl.y), x1 = Math.min(width, br.x), y1 = Math.min(height, br.y);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();
      ctx.globalAlpha = grid.opacity;
      ctx.strokeStyle = grid.color;
      ctx.lineWidth = px;
      ctx.beginPath();
      if (grid.type === 'square') {
        const s = grid.size;
        for (let x = grid.offsetX + Math.ceil((x0 - grid.offsetX) / s) * s; x <= x1; x += s) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
        for (let y = grid.offsetY + Math.ceil((y0 - grid.offsetY) / s) * s; y <= y1; y += s) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      } else {
        for (const c of cellsIn(grid, x0 - grid.size, y0 - grid.size, x1 + grid.size, y1 + grid.size)) {
          const [first, ...rest] = hexCorners(grid, c);
          ctx.moveTo(first.x, first.y);
          for (const p of rest) ctx.lineTo(p.x, p.y);
          ctx.closePath();
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // tokens (a dragged group drawn at the ghost's offset)
    const sel = new Set(selected);
    const drag = mode.k === 'drag' ? mode : undefined;
    const dragged = new Set(drag?.ids ?? []);
    const primary = drag && tokens.find((t) => t.id === drag.id);
    const dx = drag && primary ? drag.ghost.x - primary.x : 0, dy = drag && primary ? drag.ghost.y - primary.y : 0;
    const at = (t: CanvasToken) => (dragged.has(t.id) ? { x: t.x + dx, y: t.y + dy } : { x: t.x, y: t.y });
    for (const t of tokens) {
      const p = at(t), r = radius(grid, t.size);
      ctx.save();
      ctx.globalAlpha = t.hidden ? 0.4 : 1;
      const face = t.portrait ? bitmap(t.portrait) : undefined;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (face) {
        ctx.save();
        ctx.clip();
        ctx.drawImage(face, p.x - r, p.y - r, 2 * r, 2 * r);
        ctx.restore();
      } else {
        ctx.fillStyle = t.color;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${r * 0.75}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials(t.name), p.x, p.y, r * 1.8);
      }
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = '#1c1a17';
      if (t.hidden) ctx.setLineDash([5 * px, 4 * px]);
      ctx.stroke();
      ctx.restore();
      if (sel.has(t.id)) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3 * px, 0, Math.PI * 2);
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = accent;
        ctx.stroke();
      }
    }

    // HP bars and condition badges (DM, selected or hovered tokens)
    if (dm) {
      for (const t of tokens) {
        if (!sel.has(t.id) && hover !== t.id) continue;
        const p = at(t), r = radius(grid, t.size);
        if (t.hp !== undefined && t.maxHp) {
          const w = 2 * r, h = 6 * px, k = Math.max(0, Math.min(1, t.hp / t.maxHp));
          ctx.fillStyle = '#222222';
          ctx.fillRect(p.x - r, p.y + r + 2 * px, w, h);
          ctx.fillStyle = k > 0.5 ? '#2e9e44' : k > 0.25 ? '#d4a017' : '#c0392b';
          ctx.fillRect(p.x - r, p.y + r + 2 * px, w * k, h);
        }
        (t.conditions ?? []).forEach((c, i) => {
          const s = 16 * px, bx = p.x - r + i * (s + 2 * px), by = p.y - r - s - 2 * px;
          ctx.fillStyle = '#5b2a86';
          ctx.fillRect(bx, by, s, s);
          ctx.fillStyle = '#ffffff';
          ctx.font = `600 ${10 * px}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(c.slice(0, 2), bx + s / 2, by + s / 2);
        });
      }
    }

    // screen-space overlays: box, ruler, drag label
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode.k === 'box') {
      const a = toScreen(view, mode.a), b = toScreen(view, mode.b);
      ctx.fillStyle = 'rgba(80, 140, 220, 0.15)';
      ctx.strokeStyle = 'rgb(80, 140, 220)';
      ctx.lineWidth = 1;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    if (ruler) {
      const a = toScreen(view, ruler.a), b = toScreen(view, ruler.b);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, `${feetBetween(grid, ruler.a, ruler.b, diagonal)} ft`, b);
    }
    if (drag && primary) {
      const feet = feetBetween(grid, primary, drag.ghost, diagonal), speed = speedOf?.(drag.id);
      label(ctx, speed !== undefined && feet > speed ? `${feet} ft · past speed ${speed} ft` : `${feet} ft`, toScreen(view, drag.ghost));
    }
  }

  function label(ctx: CanvasRenderingContext2D, text: string, at: Pt) {
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 12;
    const x = Math.min(Math.max(4, at.x + 14), vw - w - 4), y = Math.max(14, at.y - 22);
    ctx.fillStyle = 'rgba(20, 20, 20, 0.85)';
    ctx.fillRect(x, y - 12, w, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + 6, y);
  }

  function local(e: { clientX: number; clientY: number }): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e: PointerEvent) {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a pointer that is no longer active */ }
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a0, b0] = [...pointers.values()];
      if (mode.k === 'ruler') ruler = undefined; // the first finger started a ruler: it was a pinch
      mode = { k: 'pinch', a0, b0, view0: view };
      schedule();
      return;
    }
    if (pointers.size > 2) return;
    const w = toWorld(view, p), shift = e.shiftKey || e.ctrlKey || e.metaKey;
    if (ruler) { ruler = undefined; schedule(); } // the next tap clears the ruler
    if (tool === 'ruler') { ruler = { a: w, b: w }; mode = { k: 'ruler' }; return; }
    const hit = tool === 'select' ? tokenAt(scene(), w, dm) : undefined;
    if (hit) mode = { k: 'press', from: p, id: hit.id, grab: { x: w.x - hit.x, y: w.y - hit.y }, shift };
    else if (tool === 'box' || (e.shiftKey && e.pointerType === 'mouse')) mode = { k: 'box', a: w, b: w, shift };
    else mode = { k: 'pan', from: p, view0: view, moved: false, shift };
  }

  function move(e: PointerEvent) {
    const p = local(e);
    if (!pointers.has(e.pointerId)) { // hover (mouse, no button)
      if (!dm || e.pointerType !== 'mouse') return;
      const id = tokenAt(scene(), toWorld(view, p), dm)?.id;
      if (id !== hover) { hover = id; schedule(); }
      return;
    }
    pointers.set(e.pointerId, p);
    const w = toWorld(view, p);
    switch (mode.k) {
      case 'pinch': {
        if (pointers.size < 2) return;
        const [a1, b1] = [...pointers.values()];
        view = pinch(mode.view0, mode.a0, mode.b0, a1, b1);
        break;
      }
      case 'press': {
        if (Math.hypot(p.x - mode.from.x, p.y - mode.from.y) < 4) return;
        const id = mode.id;
        if (!canDrag(id)) { mode = { k: 'pan', from: mode.from, view0: view, moved: true, shift: false }; return move(e); }
        const ids = selected.includes(id) ? selected.filter(canDrag) : [id];
        if (!selected.includes(id)) onselect([id]);
        mode = { k: 'drag', id, ids, grab: mode.grab, ghost: { x: 0, y: 0 } };
        return move(e);
      }
      case 'drag': {
        const t = tokens.find((x) => x.id === (mode as { id: string }).id);
        if (!t) { mode = { k: 'none' }; break; }
        mode.ghost = snap(grid, { x: w.x - mode.grab.x, y: w.y - mode.grab.y }, t.size);
        break;
      }
      case 'pan':
        if (Math.hypot(p.x - mode.from.x, p.y - mode.from.y) >= 4) mode.moved = true;
        view = { ...mode.view0, x: mode.view0.x + p.x - mode.from.x, y: mode.view0.y + p.y - mode.from.y };
        break;
      case 'box':
        mode.b = w;
        break;
      case 'ruler':
        if (ruler) ruler.b = w;
        break;
      default:
        return;
    }
    schedule();
  }

  function up(e: PointerEvent, cancel = false) {
    if (!pointers.delete(e.pointerId)) return;
    const m = mode;
    mode = { k: 'none' }; // after a pinch the remaining finger does nothing until it lifts
    if (cancel || m.k === 'pinch') { schedule(); return; }
    if (m.k === 'press') onselect(m.shift ? (selected.includes(m.id) ? selected.filter((x) => x !== m.id) : [...selected, m.id]) : [m.id]);
    else if (m.k === 'drag') {
      const t = tokens.find((x) => x.id === m.id);
      if (t && (t.x !== m.ghost.x || t.y !== m.ghost.y)) onmove(m.ids, m.id, m.ghost); // a single write per drop
    } else if (m.k === 'box') {
      const ids = tokensInRect(scene(), m.a, m.b, dm);
      onselect(m.shift ? [...new Set([...selected, ...ids])] : ids);
    } else if (m.k === 'pan' && !m.moved && !m.shift && selected.length) onselect([]);
    schedule();
  }

  function zoomBy(f: number) {
    view = zoomAt(view, { x: vw / 2, y: vh / 2 }, f);
    schedule();
  }
</script>

<div class="map">
  <div class="tools" role="toolbar" aria-label="Map tools">
    <button type="button" aria-pressed={tool === 'select'} onclick={() => (tool = 'select')}>Select</button>
    <button type="button" aria-pressed={tool === 'box'} onclick={() => (tool = 'box')}>Box select</button>
    <button type="button" aria-pressed={tool === 'ruler'} onclick={() => (tool = 'ruler')}>Ruler</button>
    <button type="button" onclick={() => zoomBy(1.25)}>Zoom in</button>
    <button type="button" onclick={() => zoomBy(0.8)}>Zoom out</button>
    <button type="button" onclick={fitView}>Fit</button>
  </div>
  <div class="frame" bind:this={wrap}>
    <canvas
      bind:this={canvas}
      aria-label="Battle map"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={(e) => up(e)}
      onpointercancel={(e) => up(e, true)}
      onpointerleave={() => { if (hover) { hover = undefined; schedule(); } }}
    ></canvas>
  </div>
</div>

<style>
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }

  .tools button {
    padding: 0.35rem 0.55rem;
    font-size: 0.85rem;
  }

  .tools button[aria-pressed='true'] {
    outline: 2px solid var(--accent);
    color: var(--accent);
  }

  .frame {
    position: relative;
    height: min(65vh, 720px);
    min-height: 260px;
    border: 1px solid var(--border);
    background: #5a5650;
    overflow: hidden;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
    display: block;
  }
</style>
