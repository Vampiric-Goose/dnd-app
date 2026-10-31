import { roll, type RollEntry } from '../../lib/rolls.svelte.ts';
import { toast } from '../../lib/toast.svelte.ts';
import { message } from '../creator/labels.ts';

/**
 * Rolls an expression into the dice tray's log. A bad expression (say, odd imported damage text) becomes a toast. R12: shared from DM view,
 * only `shareAs` (default: the label) and the total leave the device: the expression may hold a hidden item's bonus.
 */
export function rollTo(label: string, expr: string, opts: { crit?: boolean; public?: boolean; shareAs?: string } = {}): RollEntry | undefined {
  try {
    return roll(label, expr, { shareAs: label, ...opts });
  } catch (e) {
    toast(message(e), true);
  }
}

/** A d20 check: `1d20` plus the bonus. */
export const rollD20 = (label: string, bonus: number, opts: { shareAs?: string } = {}) => rollTo(label, `1d20${bonus < 0 ? '-' + -bonus : '+' + bonus}`, opts);
