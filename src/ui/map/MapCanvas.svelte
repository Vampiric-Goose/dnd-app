<script module lang="ts">
  import type { Token } from '../../lib/types.ts';
  export type CanvasToken = Pick<Token, 'id' | 'name' | 'x' | 'y' | 'size' | 'color' | 'portrait' | 'hidden'> & { monsterId?: string; hp?: number; maxHp?: number; conditions?: string[]; health?: string };
</script>

<script lang="ts">
  // The battle map canvas, shared by the DM's map and (Task B2) the players' map. Draws only on change: schedule() sets a dirty flag and
  // asks for one frame. Pan, wheel zoom, pinch, drag with a snapped ghost, tap and box select, and a ruler.
  import { untrack, type Snippet } from 'svelte';
  import { db } from '../../lib/db.ts';
  import type { Arrow } from '../../lib/map/actions.ts';
  import { decodeFog, FOG_CELL, fogSize, newFog, paintBrush, paintRect, type FogEdit } from '../../lib/map/fog.ts';
  import { cellCenter, cellsIn, feetBetween, hexCorners, snap, type Cell, type Pt } from '../../lib/map/grid.ts';
  import { clampMove } from '../../lib/combat/movement.ts';
  import { initials, radius, tokenAt, tokensInRect } from '../../lib/map/scene.ts';
  import { affectedCells, tokensInTemplate, type Shape, type Template } from '../../lib/map/templates.ts';
  import { fit, pinch, toScreen, toWorld, zoomAt, type View } from '../../lib/map/view.ts';
  import type { Grid, Scene } from '../../lib/types.ts';

  // fog: drawn only when set (the caller passes it only with the Fog of war setting on); black for players, a shade for the DM.
  // onfog: the DM's fog tools, shown only when it is set; one call per stroke, rectangle or Reveal all / Hide all.
  // corner: extra controls floated top-right, beside the tool switcher (the DM's scene picker).
  // limitOf: a token's movement budget this turn (feet left); with `clamp` the drag ghost stops at it, without, the label turns red past it.
  // arrows: declared actions to draw; ondeclare: a right-drag (touch: long-press then drag) drew one (unset = no arrow gesture);
  // onclear: the ✕ on a clearable arrow's head was tapped.
  // ondelete: Delete / Backspace with tokens selected (unset = the key does nothing, as for players).
  let { width, height, image, grid, tokens, dm, diagonal, selected, canDrag, speedOf, limitOf, onselect, onmove, rev = 0, fog, fogStyle = dm ? 'shade' : 'black', onfog, corner, arrows = [], ondeclare, onclear, ondelete }: {
    width: number; height: number; image?: string; grid: Grid; tokens: CanvasToken[]; dm: boolean; diagonal: '5-5-5' | '5-10-5'; selected: string[];
    canDrag: (id: string) => boolean; speedOf?: (id: string) => number | undefined; limitOf?: (id: string) => { left: number; clamp: boolean } | undefined;
    onselect: (ids: string[]) => void; onmove: (ids: string[], primary: string, to: Pt) => void; rev?: number;
    fog?: string; fogStyle?: 'black' | 'shade'; onfog?: (e: FogEdit) => void; corner?: Snippet;
    arrows?: Arrow[]; ondeclare?: (d: { from: Pt; fromToken?: string; to: Pt; toToken?: string }) => void; onclear?: (id: string) => void;
    ondelete?: (ids: string[]) => void;
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
    | { k: 'template' }
    | { k: 'arrow'; a: Pt; b: Pt; fromToken?: string };
  let mode: Mode = { k: 'none' };
  /** Touch: the long-press timer that turns a still press or pan into an arrow. */
  let hold: ReturnType<typeof setTimeout> | undefined;

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
        .then((bmp) => { if (gone) return bmp?.close(); bitmaps.set(hash, bmp ?? 'failed'); schedule(); }, () => bitmaps.set(hash, 'failed'));
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
  $effect(() => { void [width, height, image, grid, tokens, selected, dm, arrows]; untrack(schedule); });
  let fitKey = '';
  $effect(() => {
    const k = `${width}x${height}:${image ?? ''}`;
    untrack(() => { if (k !== fitKey && vw) { fitKey = k; fitView(); } });
  });
  $effect(() => {
    void rev;
    // final M1: blobs are content-addressed, so only images that failed (not stored yet) are tried again; decoded ones stay
    untrack(() => { for (const [h, b] of bitmaps) if (b === 'failed') bitmaps.delete(h); schedule(); });
  });
  // M2: a 4096 px background is ~64 MB decoded: freed when the canvas goes (a scene switch remounts it), not left to the GC
  let gone = false;
  $effect(() => () => { gone = true; for (const b of bitmaps.values()) if (typeof b !== 'string') b.close(); bitmaps.clear(); });

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
    // M3: a horizontal swipe does nothing; trackpad pinches (many small ctrl+wheel events) zoom smoothly
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!e.deltaY) return;
      view = zoomAt(view, local(e), Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      schedule();
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); canvas.removeEventListener('wheel', wheel); };
  });

  /** The theme tokens the canvas draws with, read once per frame (the fallbacks are the spec's values). */
  function palette() {
    const cs = getComputedStyle(canvas), v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    return {
      accent: v('--accent', '#2dd4bf'), danger: v('--danger', '#e5484d'), ground: v('--panel', '#0c1719'), rail: v('--rail', '#070d0e'),
      line: v('--line-strong', '#1d3a3a'), muted: v('--muted', '#7d9d99'), strong: v('--text-strong', '#eafffb'),
    };
  }
  /** Whether a #rrggbb colour (what the grid colour input stores) is light. */
  const isLight = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.5; };

  function draw() {
    dirty = false;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !vw) return;
    const pal = palette(), accent = pal.accent;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    const px = 1 / view.scale; // one screen pixel in scene units

    // background: the map image, or a dark ground with a hairline edge for a blank scene
    const bg = image ? bitmap(image) : undefined;
    if (bg) ctx.drawImage(bg, 0, 0, width, height);
    else {
      ctx.fillStyle = pal.ground;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = px;
      ctx.strokeRect(0, 0, width, height);
    }

    // grid: only the visible cells, and not at all when a cell is under 6 screen px
    if (grid.size * view.scale >= 6 && grid.opacity > 0) {
      const tl = toWorld(view, { x: 0, y: 0 }), br = toWorld(view, { x: vw, y: vh });
      const x0 = Math.max(0, tl.x), y0 = Math.max(0, tl.y), x1 = Math.min(width, br.x), y1 = Math.min(height, br.y);
      const light = isLight(grid.color);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();
      ctx.globalAlpha = grid.opacity;
      ctx.strokeStyle = bg || light ? grid.color : pal.muted; // a dark grid colour (the default black) would vanish on the dark ground
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
      if (bg) { // over map art: a faint halo in the opposite tone keeps the lines readable on light and dark images alike
        ctx.save();
        ctx.globalAlpha = grid.opacity * 0.5;
        ctx.strokeStyle = light ? pal.rail : pal.strong;
        ctx.lineWidth = 3 * px;
        ctx.stroke();
        ctx.restore();
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
        ctx.fillStyle = pal.strong;
        ctx.font = `600 ${r * 0.75}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials(t.name), p.x, p.y, r * 1.8);
      }
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = pal.rail;
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
          ctx.fillStyle = pal.rail;
          ctx.fillRect(p.x - r, p.y + r + 2 * px, w, h);
          ctx.fillStyle = t.monsterId ? pal.danger : accent; // as the kit's Bar: red for monsters, teal for the rest
          ctx.fillRect(p.x - r, p.y + r + 2 * px, w * k, h);
        }
        (t.conditions ?? []).forEach((c, i) => {
          const s = 16 * px, bx = p.x - r + i * (s + 2 * px), by = p.y - r - s - 2 * px;
          ctx.fillStyle = pal.rail;
          ctx.fillRect(bx, by, s, s);
          ctx.lineWidth = px;
          ctx.strokeStyle = accent;
          ctx.strokeRect(bx, by, s, s);
          ctx.fillStyle = pal.strong;
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
      ctx.strokeStyle = reveal ? pal.strong : pal.rail;
      ctx.stroke();
    }

    // declared actions: above tokens (and fog: they only join visible things), below the template and the ruler
    for (const a of arrows) drawArrow(ctx, pal, a, px);
    if (mode.k === 'arrow') {
      const m = mode, t = tokenAt(scene(), m.b, dm);
      drawArrow(ctx, pal, { id: '', from: m.a, to: t ?? m.b, color: pal.strong, ...(t && { target: t.id }), clearable: false }, px);
    }

    // the template: affected cells tinted, and the aim
    if (template) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = accent;
      ctx.beginPath();
      for (const c of tplCells) {
        if (grid.type === 'square') { const p = cellCenter(grid, c); ctx.rect(p.x - grid.size / 2, p.y - grid.size / 2, grid.size, grid.size); continue; }
        const [first, ...rest] = hexCorners(grid, c);
        ctx.moveTo(first.x, first.y);
        for (const p of rest) ctx.lineTo(p.x, p.y);
        ctx.closePath();
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
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
      ctx.fillStyle = accent;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.globalAlpha = 1;
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
      label(ctx, pal, `${feetBetween(grid, ruler.a, ruler.b, diagonal)} ft`, b);
    }
    if (drag && primary) {
      const feet = feetBetween(grid, primary, drag.ghost, diagonal), lim = limitOf?.(drag.id), speed = lim ? undefined : speedOf?.(drag.id);
      // M5: the drop would be refused (any moved token would leave the scene)
      const off = tokens.some((t) => (t.id === drag.id || drag.ids.includes(t.id)) && !(t.x + dx >= 0 && t.x + dx <= width && t.y + dy >= 0 && t.y + dy <= height));
      const text = lim ? `${feet} ft · ${Math.max(0, lim.left - feet)} left` : speed !== undefined && feet > speed ? `${feet} ft · past speed ${speed} ft` : `${feet} ft`;
      label(ctx, pal, off ? `${text} · off the map` : text, toScreen(view, drag.ghost), !!lim && feet > lim.left);
    }
  }

  /** Where an arrow's head ends (at the ring of a target token) and where its ✕ disc sits, in scene units. */
  function arrowGeometry(a: Arrow, px: number) {
    const t = a.target === undefined ? undefined : tokens.find((x) => x.id === a.target);
    const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y, len = Math.hypot(dx, dy);
    const ux = len ? dx / len : 1, uy = len ? dy / len : 0, ring = t ? radius(grid, t.size) + 5 * px : 0;
    const tip = { x: a.to.x - ux * ring, y: a.to.y - uy * ring };
    return { ux, uy, ring, tip, len: len - ring, disc: { x: tip.x - ux * 22 * px, y: tip.y - uy * 22 * px } };
  }

  function drawArrow(ctx: CanvasRenderingContext2D, pal: ReturnType<typeof palette>, a: Arrow, px: number) {
    const g = arrowGeometry(a, px), head = 12 * px;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.lineCap = 'round';
    if (g.ring) { ctx.beginPath(); ctx.arc(a.to.x, a.to.y, g.ring, 0, Math.PI * 2); ctx.lineWidth = 2 * px; ctx.strokeStyle = a.color; ctx.stroke(); }
    if (g.len > head) {
      const base = { x: g.tip.x - g.ux * head, y: g.tip.y - g.uy * head };
      ctx.beginPath();
      ctx.moveTo(a.from.x, a.from.y);
      ctx.lineTo(base.x, base.y);
      ctx.strokeStyle = pal.rail; // a dark halo keeps it readable on busy map art
      ctx.lineWidth = 5 * px;
      ctx.stroke();
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 2.5 * px;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.tip.x, g.tip.y);
      ctx.lineTo(base.x - g.uy * 5 * px, base.y + g.ux * 5 * px);
      ctx.lineTo(base.x + g.uy * 5 * px, base.y - g.ux * 5 * px);
      ctx.closePath();
      ctx.fillStyle = a.color;
      ctx.fill();
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = pal.rail;
      ctx.stroke();
      if (a.clearable) {
        const c = g.disc, r = 8 * px, k = 3.5 * px;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fillStyle = pal.rail;
        ctx.fill();
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = a.color;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c.x - k, c.y - k); ctx.lineTo(c.x + k, c.y + k);
        ctx.moveTo(c.x + k, c.y - k); ctx.lineTo(c.x - k, c.y + k);
        ctx.strokeStyle = pal.strong;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Arrow mode from scene point `a`, with the token under it (the same visibility as a tap) as the source. */
  function startArrow(a: Pt) {
    mode = { k: 'arrow', a, b: a, fromToken: tokenAt(scene(), a, dm)?.id };
    schedule();
  }

  function label(ctx: CanvasRenderingContext2D, pal: ReturnType<typeof palette>, text: string, at: Pt, warn = false) {
    ctx.font = '600 14px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 12;
    const x = Math.min(Math.max(4, at.x + 14), vw - w - 4), y = Math.max(14, at.y - 22);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = pal.rail;
    ctx.fillRect(x, y - 12, w, 24);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = warn ? pal.danger : pal.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - 11.5, w - 1, 23);
    ctx.fillStyle = warn ? pal.danger : pal.strong;
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
    clearTimeout(hold);
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
    if (e.button === 2) { mode = { k: 'none' }; if (ondeclare) startArrow(w); return; } // the right button points, in any tool
    // ✕ discs (Select tool only: a ruler or fog stroke starting near one is not a clear): a 44 px target on touch, but a token under the finger wins unless the press is on the disc itself
    const px = 1 / view.scale, reach = (e.pointerType === 'mouse' || tokenAt(scene(), w, dm) ? 10 : 22) * px;
    const x = onclear && (tool === 'select' || tool === 'box') && arrows.find((a) => { if (!a.clearable) return false; const g = arrowGeometry(a, px); return g.len > 12 * px && Math.hypot(g.disc.x - w.x, g.disc.y - w.y) <= reach; });
    if (x) { mode = { k: 'none' }; onclear!(x.id); return; }
    if (ruler) { ruler = undefined; schedule(); } // the next tap clears the ruler
    if (tool === 'ruler') { ruler = { a: w, b: w }; mode = { k: 'ruler' }; return; }
    if (tool === 'fog') {
      if (fogTool === 'brush') { const m: Mode = { k: 'brush', points: [] }; brushTo(m, w); brushAt = w; mode = m; }
      else mode = { k: 'fogRect', a: w, b: w };
      schedule();
      return;
    }
    if (tool === 'template') { // the origin on the centre of the cell under the pointer, as a Medium token stands (square and hex)
      const o = snap(grid, w, 'M');
      tplAt = { origin: o, aim: { x: o.x + 1, y: o.y } };
      mode = { k: 'template' };
      return;
    }
    const hit = tool === 'select' ? tokenAt(scene(), w, dm) : undefined;
    if (hit) mode = { k: 'press', from: p, id: hit.id, grab: { x: w.x - hit.x, y: w.y - hit.y }, shift };
    else if (tool === 'box' || (e.shiftKey && e.pointerType === 'mouse')) mode = { k: 'box', a: w, b: w, shift };
    else mode = { k: 'pan', from: p, view0: view, moved: false, shift };
    // Touch: held still for 500 ms, the press or pan becomes an arrow from where it started (a second finger cancels it: a pinch)
    const m0 = mode;
    if (ondeclare && e.pointerType !== 'mouse') hold = setTimeout(() => {
      if (mode !== m0 || pointers.size !== 1 || (m0.k === 'pan' && m0.moved) || (m0.k !== 'press' && m0.k !== 'pan')) return;
      if (m0.k === 'pan') view = m0.view0;
      startArrow(toWorld(view, m0.from));
    }, 500);
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
        const to = { x: w.x - mode.grab.x, y: w.y - mode.grab.y }, lim = limitOf?.(t.id);
        mode.ghost = lim?.clamp ? clampMove(grid, t, to, t.size, lim.left, diagonal) : snap(grid, to, t.size);
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
      case 'arrow':
        mode.b = w;
        break;
      default:
        return;
    }
    schedule();
  }

  function up(e: PointerEvent, cancel = false) {
    if (!pointers.delete(e.pointerId)) return;
    clearTimeout(hold);
    const m = mode;
    mode = { k: 'none' }; // after a pinch the remaining finger does nothing until it lifts
    if (cancel && m.k === 'brush') strokeBits = undefined;
    if (cancel || m.k === 'pinch') { schedule(); return; }
    if (m.k === 'arrow' && Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) >= grid.size) { // a drag under one cell is ignored
      ondeclare?.({ from: m.a, fromToken: m.fromToken, to: m.b, toToken: tokenAt(scene(), m.b, dm)?.id });
    }
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

  /** Delete / Backspace, unless the focus is somewhere that types. */
  function key(e: KeyboardEvent) {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const el = e.target as HTMLElement | null;
    if (el?.isContentEditable || el?.matches?.('input, textarea, select')) return;
    if (ondelete && selected.length) { e.preventDefault(); ondelete([...selected]); }
  }

  function zoomBy(f: number) {
    view = zoomAt(view, { x: vw / 2, y: vh / 2 }, f);
    schedule();
  }
</script>

<svelte:window onkeydown={key} />

<div class="map">
  <div class="frame" bind:this={wrap}>
    <canvas
      bind:this={canvas}
      aria-label="Battle map"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={(e) => up(e)}
      onpointercancel={(e) => up(e, true)}
      oncontextmenu={(e) => e.preventDefault()}
      onpointerleave={() => { if (hover || brushAt) { hover = brushAt = undefined; schedule(); } }}
    ></canvas>
  </div>

  <!-- Floating controls: the tool switcher (and the caller's corner controls), then the active tool's options strip. -->
  <div class="float">
    <div class="top">
      <div class="seg tools" role="toolbar" aria-label="Map tools">
        <button type="button" aria-pressed={tool === 'select' || tool === 'box'} onclick={() => (tool = 'select')}>Select</button>
        <button type="button" aria-pressed={tool === 'ruler'} onclick={() => (tool = 'ruler')}>Ruler</button>
        <button type="button" aria-pressed={tool === 'template'} onclick={() => (tool = 'template')}>Template</button>
        {#if onfog}<button type="button" aria-pressed={tool === 'fog'} onclick={() => (tool = 'fog')}>Fog</button>{/if}
      </div>
      {#if corner}<div class="corner">{@render corner()}</div>{/if}
    </div>

    {#if tool === 'select' || tool === 'box'}
      <div class="strip" role="group" aria-label="Select">
        <button type="button" aria-pressed={tool === 'box'} onclick={() => (tool = tool === 'box' ? 'select' : 'box')}>Box select</button>
        <span class="hint">{tool === 'box' ? 'Drag on empty map · Shift adds' : 'Tap a token · Shift-click adds'}{#if ondeclare} · Right-drag or long-press to point{/if}</span>
      </div>
    {:else if tool === 'ruler'}
      <div class="strip"><span class="hint">Drag to measure · tap again to clear</span></div>
    {:else if tool === 'fog' && onfog}
      <div class="strip" role="group" aria-label="Fog">
        <span class="seg">
          <button type="button" aria-pressed={fogTool === 'brush'} onclick={() => (fogTool = 'brush')}>Brush</button>
          <button type="button" aria-pressed={fogTool === 'rect'} onclick={() => (fogTool = 'rect')}>Rectangle</button>
        </span>
        {#if fogTool === 'brush'}<label class="opt">Brush size <input type="range" min="16" max="256" step="8" bind:value={brush} /></label>{/if}
        <span class="seg">
          <button type="button" aria-pressed={reveal} onclick={() => (reveal = true)}>Reveal</button>
          <button type="button" aria-pressed={!reveal} onclick={() => (reveal = false)}>Hide</button>
        </span>
        <button type="button" onclick={() => confirm('Reveal the whole scene to players?') && onfog({ k: 'all', reveal: true })}>Reveal all</button>
        <button type="button" onclick={() => confirm('Hide the whole scene under fog?') && onfog({ k: 'all', reveal: false })}>Hide all</button>
      </div>
    {/if}
    {#if tool === 'template' || template}
      <div class="strip" role="group" aria-label="Template">
        {#if tool === 'template'}
          <label class="opt">Shape
            <select bind:value={shape}>{#each SHAPES as [v, name] (v)}<option value={v}>{name}</option>{/each}</select>
          </label>
          <label class="opt">Size (ft) <input class="ft num" type="number" min="1" max="1000" bind:value={tplFeet} /></label>
          {#if shape === 'line'}<label class="opt">Width (ft) <input class="ft num" type="number" min="1" max="100" bind:value={lineWidth} /></label>{/if}
        {/if}
        {#if template}
          <span class="inside" role="status">Inside: {insideNames.length ? insideNames.join(', ') : 'none'}</span>
          <button type="button" onclick={() => (tplAt = undefined)}>Clear template</button>
        {:else}<span class="hint">Drag on the map from the origin toward the aim.</span>{/if}
      </div>
    {/if}
  </div>

  <div class="seg zoom" role="group" aria-label="Zoom">
    <button type="button" aria-label="Zoom out" onclick={() => zoomBy(0.8)}>−</button>
    <button type="button" onclick={fitView}>Fit</button>
    <button type="button" aria-label="Zoom in" onclick={() => zoomBy(1.25)}>+</button>
  </div>
</div>

<style>
  /* The canvas fills its container (the Workspace's `fill` main); every control floats on it. */
  .map {
    position: relative;
    height: 100%;
    min-height: 260px;
    overflow: hidden;
  }

  .frame {
    position: absolute;
    inset: 0;
    background: var(--rail);
    overflow: hidden;
  }

  .float {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    right: 0.5rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    pointer-events: none; /* only the controls themselves catch the pointer */
  }

  .float > *,
  .top > * {
    pointer-events: auto;
  }

  .top {
    align-self: stretch;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.4rem;
    pointer-events: none;
  }

  .corner {
    margin-left: auto;
  }

  /* Segmented control on a near-opaque rail ground, as in the mockup */
  .seg {
    display: inline-flex;
    background: color-mix(in srgb, var(--rail) 92%, transparent);
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    overflow: hidden;
  }

  .seg button {
    border: 0;
    border-radius: 0;
    border-right: 1px solid var(--line);
    background: transparent;
    padding: 0.3rem 0.75rem;
    min-height: 2.1rem;
  }

  .seg button:last-child {
    border-right: 0;
  }

  .seg button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.6rem;
    max-width: 100%;
    box-sizing: border-box;
    padding: 0.3rem 0.5rem;
    background: color-mix(in srgb, var(--rail) 92%, transparent);
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    font-size: 0.9rem;
  }

  .strip > button {
    padding: 0.2rem 0.6rem;
    min-height: 1.9rem;
  }

  .strip .seg button {
    min-height: 1.9rem;
    padding: 0.2rem 0.6rem;
  }

  .hint {
    color: var(--muted);
  }

  .opt {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--muted);
  }

  .opt input[type='range'] {
    width: 6rem;
  }

  .ft {
    width: 4.5rem;
  }

  .inside {
    color: var(--text-strong);
  }

  .zoom {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
  }

  .zoom button {
    min-width: 2.4rem;
    font-family: var(--mono);
  }

  /* Phones: 44 px targets come from app.css; the zoom stands on the right edge, clear of the Dice button and the sheet */
  @media (max-width: 767px) {
    .seg button,
    .strip > button,
    .strip .seg button {
      min-height: 44px;
    }

    .seg button {
      padding: 0.3rem 0.65rem;
    }

    .zoom {
      flex-direction: column;
      bottom: auto;
      top: 50%;
      transform: translateY(-50%);
    }

    .zoom button {
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }

    .zoom button:last-child {
      border-bottom: 0;
    }
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
