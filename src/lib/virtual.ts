/** Rows `[start, end)` to render for a fixed-row-height list: the visible rows plus `overscan` on each side. */
export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan: number): [number, number] {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + viewport) / rowHeight);
  return [Math.min(count, Math.max(0, first - overscan)), Math.min(count, last + overscan)];
}
