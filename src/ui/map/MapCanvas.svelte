<script module lang="ts">
  import type { Token } from '../../lib/types.ts';
  export type CanvasToken = Pick<Token, 'id' | 'name' | 'x' | 'y' | 'size' | 'color' | 'portrait' | 'hidden'> & { hp?: number; maxHp?: number; conditions?: string[]; health?: string };
</script>

<script lang="ts">
  // The battle map canvas, shared by the DM's map and (Task B2) the players' map. Draws only on change: schedule() sets a dirty flag and
  // asks for one frame. Pan, wheel zoom, pinch, drag with a snapped ghost, tap and box select, and a ruler.
  import { untrack } from 'svelte';
  import { db } from '../../lib/db.ts';
  import { decodeFog, FOG_CELL, fogSize, newFog, paintBrush, paintRect, type FogEdit } from '../../lib/map/fog.ts';
  import { cellCenter, cellsIn, feetBetween, hexCorners, snap, type Cell, type Pt } from '../../lib/map/grid.ts';
  import { initials, radius, tokenAt, tokensInRect } from '../../lib/map/scene.ts';
  import { affectedCells, tokensInTemplate, type Shape, type Template } from '../../lib/map/templates.ts';
  import { fit, pinch, toScreen, toWorld, zoomAt, type View } from '../../lib/map/view.ts';
  import type { Grid, Scene } from '../../lib/types.ts';

  // fog: drawn only when set (the caller passes it only with the Fog of war setting on); black for players, a shade for the DM.
  // onfog: the DM's fog tools, shown only when it is set; one call per stroke, rectangle or Reveal all / Hide all.
  let { width, height, image, grid, tokens, dm, diagonal, selected, canDrag, speedOf, onselect, onmove, rev = 0, fog, fogStyle = dm ? 'shade' : 'black', onfog }: {
    width: number; height: number; image?: string; grid: Grid; tokens: CanvasToken[]; dm: boolean; diagonal: '5-5-5' | '5-10-5'; selected: string[];
    canDrag: (id: string) => boolean; speedOf?: (id: string) => number | undefined;
    onselect: (ids: string[]) => void; onmove: (ids: string[], primary: string, to: Pt) => void; rev?: number;
    fog?: string; fogStyle?: 'black' | 'shade'; onfog?: (e: FogEdit) => void;
  } = $props();

  let tool: 'select' | 'box' | 'ruler' | 'fog' | 'template' = $state('select');
  $effect(() => { if (!onfog && tool === 'fog') tool = 'select'; });

  // Fog tools
  let fogTool = $state<'brush' | 'rect'>('brush');
  let brush = $state(48);
  let reveal = $state(true);
  // Templates: local to this device, never synced.
  const SHAPES: [Shape, string][] = [['cone', 'Cone'], ['sphere', 'Sphere / circle'], ['cube', 'Cube'], ['line', 'Line'], ['cylinder', 'Cylinder']];
  let shape = $state<Shape>('cone');
  let tplFeet = $state(20);
  let lineWidth = $state(5);
  let tplAt: { origin: Pt; aim: Pt } | undefined = $state.raw();
  const ft = (n: number, lo: number, hi: number, d: number) => (Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d);
  const template = $derived<Template | undefined>(tplAt && { shape, ...tplAt, feet: ft(tplFeet, 1, 1000, 20), ...(shape === 'line' && { width: ft(lineWidth, 1, 100, 5) }) });
  const inside = $derived(template ? new Set(tokensInTemplate(template, grid, tokens)) : new Set<string>());
  const insideNames = $derived(tokens.filter((t) => inside.has(t.id)).map((t) => t.name));
  let tplCells: Cell[] = [];
  $effect(() => { tplCells = template ? affectedCells(template, grid, width, height) : []; untrack(schedule); });
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
    | { k: 'pinch'; a0: Pt; b0: Pt; view0: View }
    | { k: 'brush'; points: Pt[] }
    | { k: 'fogRect'; a: Pt; b: Pt }
    | { k: 'template' };
  let mode: Mode = { k: 'none' };

  // Fog: the decoded bits (a stroke paints a local copy at once; it is dropped when the fog prop next changes), drawn from a cols×rows
  // canvas, one pixel per fog cell, rebuilt only when the bits change.
  let fogBits: Uint8Array | undefined;
  let strokeBits: Uint8Array | undefined;
  let fogCanvas: HTMLCanvasElement | undefined;
  let fogBuilt: Uint8Array | undefined;
  let brushAt: Pt | undefined;
  $effect(() => {
    const f = fog, w = width, h = height;
    untrack(() => {
      fogBits = f === undefined ? undefined : decodeFog(f, w, h) ?? newFog(w, h, false); // damaged: all fogged
      strokeBits = undefined;
      schedule();
    });
  });

  function fogImage(bits: Uint8Array): HTMLCanvasElement {
    if (fogCanvas && fogBuilt === bits) return fogCanvas;
    const { cols, rows } = fogSize(width, height);
    fogCanvas ??= document.createElement('canvas');
    fogCanvas.width = cols;
    fogCanvas.height = rows;
    const c = fogCanvas.getContext('2d')!, img = c.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) if (!((bits[i >> 3] >> (i & 7)) & 1)) img.data[i * 4 + 3] = 255; // fogged: opaque black
    c.putImageData(img, 0, 0);
    fogBuilt = bits;
    return fogCanvas;
  }

  /** Adds a brush sample, filling gaps so a fast stroke leaves no holes. */
  function brushTo(m: { points: Pt[] }, p: Pt) {
    const last = m.points[m.points.length - 1], step = brush / 2;
    const d = last ? Math.hypot(p.x - last.x, p.y - last.y) : 0, n = Math.floor(d / step);
    for (let i = 1; i <= n; i++) m.points.push({ x: last.x + ((p.x - last.x) * i * step) / d, y: last.y + ((p.y - last.y) * i * step) / d });
    m.points.push(p);
    let f = strokeBits ?? fogBits ?? newFog(width, height, false);
    for (const q of m.points.slice(-(n + 1))) f = paintBrush(f, width, height, q, brush, reveal);
    strokeBits = f;
  }
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

    // fog, scaled up from one pixel per fog cell with smoothing off
    const bits = strokeBits ?? fogBits;
    if (bits) {
      const { cols, rows } = fogSize(width, height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = fogStyle === 'black' ? 1 : 0.5;
      ctx.drawImage(fogImage(bits), 0, 0, cols * FOG_CELL, rows * FOG_CELL);
      ctx.restore();
    }
    if (tool === 'fog' && fogTool === 'brush' && brushAt) {
      ctx.beginPath();
      ctx.arc(brushAt.x, brushAt.y, brush, 0, Math.PI * 2);
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = reveal ? '#ffffff' : '#000000';
      ctx.stroke();
    }

    // the template: affected cells tinted, and the aim
    if (template) {
      ctx.save();
      ctx.fillStyle = 'rgba(230, 110, 20, 0.35)';
      ctx.beginPath();
      for (const c of tplCells) {
        if (grid.type === 'square') { const p = cellCenter(grid, c); ctx.rect(p.x - grid.size / 2, p.y - grid.size / 2, grid.size, grid.size); continue; }
        const [first, ...rest] = hexCorners(grid, c);
        ctx.moveTo(first.x, first.y);
        for (const p of rest) ctx.lineTo(p.x, p.y);
        ctx.closePath();
      }
      ctx.fill();
      ctx.strokeStyle = 'rgb(200, 80, 0)';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(template.origin.x, template.origin.y, 4 * px, 0, Math.PI * 2);
      if (template.shape !== 'sphere' && template.shape !== 'cylinder') { ctx.moveTo(template.origin.x, template.origin.y); ctx.lineTo(template.aim.x, template.aim.y); }
      ctx.stroke();
      ctx.restore();
    }

    // screen-space overlays: box, fog rectangle, ruler, drag label
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode.k === 'box' || mode.k === 'fogRect') {
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
      if (mode.k === 'brush') strokeBits = undefined; // ... or a fog stroke
      mode = { k: 'pinch', a0, b0, view0: view };
      schedule();
      return;
    }
    if (pointers.size > 2) return;
    const w = toWorld(view, p), shift = e.shiftKey || e.ctrlKey || e.metaKey;
    if (ruler) { ruler = undefined; schedule(); } // the next tap clears the ruler
    if (tool === 'ruler') { ruler = { a: w, b: w }; mode = { k: 'ruler' }; return; }
    if (tool === 'fog') {
      if (fogTool === 'brush') { const m: Mode = { k: 'brush', points: [] }; brushTo(m, w); brushAt = w; mode = m; }
      else mode = { k: 'fogRect', a: w, b: w };
      schedule();
      return;
    }
    if (tool === 'template') { // the origin on a grid intersection (a hex centre on hex grids)
      const o = snap(grid, w, 'L');
      tplAt = { origin: o, aim: { x: o.x + 1, y: o.y } };
      mode = { k: 'template' };
      return;
    }
    const hit = tool === 'select' ? tokenAt(scene(), w, dm) : undefined;
    if (hit) mode = { k: 'press', from: p, id: hit.id, grab: { x: w.x - hit.x, y: w.y - hit.y }, shift };
    else if (tool === 'box' || (e.shiftKey && e.pointerType === 'mouse')) mode = { k: 'box', a: w, b: w, shift };
    else mode = { k: 'pan', from: p, view0: view, moved: false, shift };
  }

  function move(e: PointerEvent) {
    const p = local(e);
    if (!pointers.has(e.pointerId)) { // hover (mouse, no button)
      if (tool === 'fog' && fogTool === 'brush') { brushAt = toWorld(view, p); schedule(); return; }
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
      case 'brush':
        brushTo(mode, w);
        brushAt = w;
        break;
      case 'fogRect':
        mode.b = w;
        break;
      case 'template':
        if (tplAt) tplAt = { origin: tplAt.origin, aim: w };
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
    if (cancel && m.k === 'brush') strokeBits = undefined;
    if (cancel || m.k === 'pinch') { schedule(); return; }
    if (m.k === 'brush') onfog?.({ k: 'brush', points: m.points, radius: brush, reveal }); // one write per stroke
    else if (m.k === 'fogRect') {
      strokeBits = paintRect(strokeBits ?? fogBits ?? newFog(width, height, false), width, height, m.a, m.b, reveal);
      onfog?.({ k: 'rect', a: m.a, b: m.b, reveal });
    }
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
    {#if onfog}<button type="button" aria-pressed={tool === 'fog'} onclick={() => (tool = 'fog')}>Fog</button>{/if}
    <button type="button" aria-pressed={tool === 'template'} onclick={() => (tool = 'template')}>Template</button>
  </div>
  {#if tool === 'fog' && onfog}
    <div class="tools" role="group" aria-label="Fog">
      <button type="button" aria-pressed={fogTool === 'brush'} onclick={() => (fogTool = 'brush')}>Brush</button>
      <button type="button" aria-pressed={fogTool === 'rect'} onclick={() => (fogTool = 'rect')}>Rectangle</button>
      {#if fogTool === 'brush'}<label class="opt">Brush size <input type="range" min="16" max="256" step="8" bind:value={brush} /></label>{/if}
      <button type="button" aria-pressed={reveal} onclick={() => (reveal = true)}>Reveal</button>
      <button type="button" aria-pressed={!reveal} onclick={() => (reveal = false)}>Hide</button>
      <button type="button" onclick={() => confirm('Reveal the whole scene to players?') && onfog({ k: 'all', reveal: true })}>Reveal all</button>
      <button type="button" onclick={() => confirm('Hide the whole scene under fog?') && onfog({ k: 'all', reveal: false })}>Hide all</button>
    </div>
  {/if}
  {#if tool === 'template' || template}
    <div class="tools" role="group" aria-label="Template">
      <label class="opt">Shape
        <select bind:value={shape}>{#each SHAPES as [v, name] (v)}<option value={v}>{name}</option>{/each}</select>
      </label>
      <label class="opt">Size (ft) <input class="ft" type="number" min="1" max="1000" bind:value={tplFeet} /></label>
      {#if shape === 'line'}<label class="opt">Width (ft) <input class="ft" type="number" min="1" max="100" bind:value={lineWidth} /></label>{/if}
      {#if template}<button type="button" onclick={() => (tplAt = undefined)}>Clear template</button>{/if}
    </div>
    {#if template}<p class="inside" role="status">Inside: {insideNames.length ? insideNames.join(', ') : 'none'}</p>
    {:else}<p class="inside muted">Drag on the map from the origin toward the aim.</p>{/if}
  {/if}
  <div class="frame" bind:this={wrap}>
    <canvas
      bind:this={canvas}
      aria-label="Battle map"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={(e) => up(e)}
      onpointercancel={(e) => up(e, true)}
      onpointerleave={() => { if (hover || brushAt) { hover = brushAt = undefined; schedule(); } }}
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

  .opt {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.85rem;
  }

  .opt input[type='range'] {
    width: 6rem;
  }

  .ft {
    width: 4.5rem;
  }

  .inside {
    margin: 0 0 0.25rem;
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
