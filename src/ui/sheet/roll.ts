import { roll, type RollEntry } from '../../lib/rolls.svelte.ts';
import { toast } from '../../lib/toast.svelte.ts';
import { message } from '../creator/labels.ts';

/** Rolls an expression into the dice tray's log. A bad expression (say, odd imported damage text) becomes a toast. */
export function rollTo(label: string, expr: string, opts: { crit?: boolean } = {}): RollEntry | undefined {
  try {
    return roll(label, expr, opts);
  } catch (e) {
    toast(message(e), true);
  }
}

/** A d20 check: `1d20` plus the bonus. */
export const rollD20 = (label: string, bonus: number) => rollTo(label, `1d20${bonus < 0 ? '-' + -bonus : '+' + bonus}`);
