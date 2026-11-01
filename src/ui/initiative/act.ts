import { toast } from '../../lib/toast.svelte.ts';
import { message } from '../creator/labels.ts';

/** Runs a tracker operation: an error becomes a toast, as do the names of characters a PC write could not reach (`failed`). */
export async function act<T>(op: () => Promise<T>): Promise<T | undefined> {
  try {
    const r = await op();
    const failed = (r as { failed?: unknown } | undefined)?.failed;
    if (Array.isArray(failed) && failed.length) toast(`Could not update ${failed.join(', ')}.`, true);
    return r;
  } catch (e) {
    toast(message(e), true);
  }
}
