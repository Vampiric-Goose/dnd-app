import { rollDice } from './dice.ts';
import { uid } from './uid.ts';

/** `from`: set on a roll received through sync, naming who rolled it ("DM", "A1 · Thorin"). Never sent (cleanRoll drops it). */
export interface RollEntry { id: string; label: string; expr: string; total: number; detail: string; at: number; public: boolean; from?: string }

const CAP = 200;

/** Most recent first, capped at 200. */
export const rollLog: RollEntry[] = $state([]);
/** The next roll's advantage state; roll() resets it to 'normal'. */
export const rollMode: { value: 'normal' | 'adv' | 'dis' } = $state({ value: 'normal' });
/**
 * Who is rolling: 'dm' in DM view of a campaign this device runs, 'player' in Player view or in any joined campaign (App keeps it
 * current; a joined campaign holds nothing hidden).
 */
export const rollViewer: { value: 'dm' | 'player' } = $state({ value: 'dm' });
/** The tray's Public toggle, per viewer. R12: a DM's rolls start private; the DM shares one by ticking it. */
export const rollVisibility: { dm: boolean; player: boolean } = $state({ dm: false, player: true });

/**
 * Rolls with the tray's current mode, logs it, and resets the mode. `public` overrides the tray's toggle (R6: stat-block rolls are always
 * private). `shareAs`: what players see of a DM-view roll that is shared (R12: a sheet roll in DM view can carry a hidden item's real name
 * or bonus, so only this label and the total leave the device). Throws the parser's message on bad input.
 */
export function roll(label: string, expr: string, opts: { crit?: boolean; public?: boolean; shareAs?: string } = {}): RollEntry {
  const advantage = rollMode.value === 'normal' ? undefined : rollMode.value;
  const { total, detail } = rollDice(expr, { advantage, crit: opts.crit });
  const entry: RollEntry = { id: uid(), label, expr, total, detail, at: Date.now(), public: opts.public ?? rollVisibility[rollViewer.value] };
  log(entry);
  rollMode.value = 'normal';
  // R6: a private roll never reaches the session
  if (entry.public) rollHooks.public?.(rollViewer.value === 'dm' && opts.shareAs !== undefined ? { ...entry, label: opts.shareAs, expr: '', detail: '' } : entry);
  return entry;
}

function log(entry: RollEntry): void {
  rollLog.unshift(entry);
  if (rollLog.length > CAP) rollLog.length = CAP;
}

/** Stage 3: the sync session listens for this device's public rolls. */
export const rollHooks: { public?: (e: RollEntry) => void } = {};

/** A public roll from another device, labelled with who rolled it. Its id is kept, so the same roll is logged once. */
export function addRemoteRoll(e: RollEntry, from: string): void {
  if (e.public && !rollLog.some((r) => r.id === e.id)) log({ ...e, from });
}

/** R6: the entries this viewer may see. Player view hides private rolls (the DM's monster rolls), so switching views never shows them. */
export const shownRolls = (log: readonly RollEntry[], viewer: 'dm' | 'player'): readonly RollEntry[] => (viewer === 'dm' ? log : log.filter((r) => r.public));

/** 'nat20' / 'nat1' when the roll's kept d20 shows that face. Reads the first d20 term of `detail` (as rollDice formats it). */
export function natD20(detail: string): 'nat20' | 'nat1' | undefined {
  const m = /(\d+)d20(?:(kh|kl)(\d+))? \(([\d, ]+)\)/.exec(detail);
  if (!m) return undefined;
  const rolls = m[4].split(',').map(Number);
  const kept = m[2] ? [...rolls].sort((a, b) => (m[2] === 'kh' ? b - a : a - b)).slice(0, Number(m[3])) : rolls;
  if (kept.length !== 1) return undefined; // ponytail: a bare 2d20 sum is not an attack roll; no highlight
  return kept[0] === 20 ? 'nat20' : kept[0] === 1 ? 'nat1' : undefined;
}
