// The reaction flow's context on this device (the DM's map and the host's deps share it): the shown scene unless told another, stat blocks
// (the DM's own first) and spells from the books, this device's d20. `rollAim` is the UI's roller (ui/map/aimRoll.ts), passed in.
import { db } from '../db.ts';
import { roll } from '../rolls.svelte.ts';
import { getIndex } from '../store.svelte.ts';
import type { CampaignSettings, MonsterDef, Scene } from '../types.ts';
import type { FlowCtx } from './reactionFlow.ts';

export async function flowCtx(cid: string, settings: CampaignSettings, o: Pick<FlowCtx, 'rollAim' | 'onRefused'> & { scene?: () => Promise<Scene | undefined> } = {}): Promise<FlowCtx> {
  const [index, own] = await Promise.all([getIndex(cid), db.monsters.list(cid)]);
  const spells = new Map(index.all('spell').map((s) => [s.name.toLowerCase(), s]));
  return { cid, settings, scene: o.scene ?? (() => db.scenes.shown(cid)), rollAim: o.rollAim, onRefused: o.onRefused,
    monster: (id) => own.find((m) => m.id === id) ?? (index.resolve(id) as MonsterDef | undefined), spell: (n) => spells.get(n.toLowerCase()),
    // never shared: it would tell players a Counterspell was cast (R6), or what a reaction rolled before its result shows
    d20: (label = 'Counterspell check') => roll(label, '1d20', { mode: 'normal', public: false }).faces[0],
    dice: (label, expr, crit) => roll(label, expr, { mode: 'normal', public: false, crit }).total };
}
