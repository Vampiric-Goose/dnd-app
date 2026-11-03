// The DM device's in-memory stack of open reaction asks (newest last). A move or a cast awaits `ask()`; the host relays the open asks
// to the players through `onChange`. Nested asks (Shield in answer to an Opportunity Attack) are just a deeper stack: each has its own timer.
import type { Aim } from './aiming.ts';
import type { ReactKind, ReactOption, Reactor } from './reactions.ts';

export const AUTO_PASS_MS = 10_000;
export interface Ask { id: string; kind: ReactKind; trigger: string /* the DM's line */; playerTrigger: string /* players' line: no hidden info */; reactors: Reactor[]; waiting: string /* the combatant whose thing waits */ }
export interface Answer { reactor: string; option: ReactOption['id']; slot?: number; aim?: Aim; d20?: number }
/** `answered` holds every reactor that has answered or passed; `answers` only the chosen ones. */
export interface Open extends Ask { answered: string[]; answers: Answer[]; deadline: number }

/** Read by the DM's UI and relayed to players; the newest ask is last. */
export const reactions: { open: Open[] } = $state({ open: [] });

const live = new Map<string, { timer: ReturnType<typeof setTimeout>; done: (a: Answer[]) => void }>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function ask(a: Ask, now: () => number = Date.now): Promise<Answer[]> {
  if (!a.reactors.length) return Promise.resolve([]);
  return new Promise((done) => {
    live.set(a.id, { timer: setTimeout(() => close(a.id) && changed(), AUTO_PASS_MS), done });
    reactions.open.push({ ...a, answered: [], answers: [], deadline: now() + AUTO_PASS_MS });
    changed();
  });
}

/** Removes the ask and resolves it with the answers it has; false when it was already gone. */
function close(id: string): boolean {
  const i = reactions.open.findIndex((o) => o.id === id), l = live.get(id);
  if (i < 0 || !l) return false;
  clearTimeout(l.timer);
  live.delete(id);
  const [o] = reactions.open.splice(i, 1);
  l.done($state.snapshot(o.answers) as Answer[]);
  return true;
}

export function answer(askId: string, a: Answer): boolean {
  const o = reactions.open.find((z) => z.id === askId), r = o?.reactors.find((z) => z.id === a.reactor);
  if (!o || !r || o.answered.includes(r.id)) return false;
  const offered = r.options.filter((z) => z.id === a.option);
  if (!offered.length || !offered.some((z) => z.slot === undefined || z.slot === a.slot)) return false;
  settle(o, r.id, a);
  return true;
}

export function pass(askId: string, reactor?: string): void {
  const o = reactions.open.find((z) => z.id === askId);
  if (!o) return;
  const left = o.reactors.map((r) => r.id).filter((id) => !o.answered.includes(id) && (reactor === undefined || id === reactor));
  if (!left.length) return;
  o.answered.push(...left);
  settle(o);
}

function settle(o: Open, reactor?: string, a?: Answer): void {
  if (reactor) o.answered.push(reactor);
  if (a) o.answers.push(a);
  if (o.reactors.every((r) => o.answered.includes(r.id))) close(o.id);
  changed();
}

/** DM reload: every timer cleared, every open ask resolved with the answers it already has. */
export function reset(): void {
  const ids = reactions.open.map((o) => o.id);
  ids.forEach(close);
  if (ids.length) changed();
}
