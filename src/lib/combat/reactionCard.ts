// Pure: what the DM's reaction card shows. The DM answers for monsters and for PCs whose player is not connected; a connected player's
// reactor is theirs to answer (their device has the card), so the DM only waits on it (and may pass for them).
import type { Combatant } from '../types.ts';
import type { Reactor } from './reactions.ts';
import type { Open } from './reactionStack.svelte.ts';

export interface DmCard { ask: string; trigger: string; deadline: number; mine: Reactor[]; others: Reactor[] }

/** `ownerOf`: a character's player id; `online`: the connected player ids (session.online). */
export const dmAnswers = (fighters: Combatant[], ownerOf: (characterId: string) => string | undefined, online: Record<string, unknown>) => (combatantId: string): boolean => {
  const cid = fighters.find((x) => x.id === combatantId)?.characterId, owner = cid === undefined ? undefined : ownerOf(cid);
  return owner === undefined || !(owner in online);
};

/** One card per open ask that still has an unanswered reactor. */
export const dmCards = (open: Open[], answers: (combatantId: string) => boolean): DmCard[] => open.flatMap((o): DmCard[] => {
  const left = o.reactors.filter((r) => !o.answered.includes(r.id));
  return left.length ? [{ ask: o.id, trigger: o.trigger, deadline: o.deadline, mine: left.filter((r) => answers(r.id)), others: left.filter((r) => !answers(r.id)) }] : [];
});
