import type { Choice, Effect } from '../../src/lib/types.ts';

/** Hand-authored effects and choices, keyed by converted entity id. build-srd appends them to what the data already gives. */
export const SRD_EFFECTS: Record<string, { effects?: Effect[]; choices?: Choice[] }> = {};
