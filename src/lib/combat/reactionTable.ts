// Pure: every reaction not built into reactions.ts, keyed by its feature, feat, fighting style or spell name (mechanics only, no book text).
// Each says when the app asks (its window), who may answer and from how far, what it costs and what it does (its shape); the flow
// (reactionFlow.ts) works the shape out. A shape the app can't work out is a reminder: asked, paid, then settled by the DM.
import { richToPlain } from '../content/richtext.ts';
import { tokenFeet } from '../map/grid.ts';
import type { Ability, Grid } from '../types.ts';
import { acReaction, canReact, oaAction, sees, type Body, type ReactOption, type Reactor } from './reactions.ts';

type Diagonal = '5-5-5' | '5-10-5';
/**
 * declared: an attack is made, its roll not yet known · hit / miss: before its damage · after: once it has landed · damaged: damage taken ·
 * enter: a creature enters the reactor's reach (enterOptions) · cast: a spell is cast · died: a creature drops to 0 · saved: a save is rolled.
 */
export type Window = 'declared' | 'hit' | 'miss' | 'after' | 'damaged' | 'enter' | 'cast' | 'died' | 'saved';
/**
 * ac: + to AC against this attack (judged again) · dis: disadvantage on it · cut: damage minus the amount · resist: half damage · back: damage
 * to the actor (a save where it has one) · attack: an Opportunity Attack's swing at the actor (plus the die to damage) · roll: the attack roll
 * minus the amount · miss: it misses (`chance`: on a d6 of at least that) · nemesis: the caster's Wis save or the spell fails · note: a reminder.
 */
export type Shape = 'ac' | 'dis' | 'cut' | 'resist' | 'back' | 'attack' | 'roll' | 'miss' | 'nemesis' | 'note';
/** What happened. `actor`: who attacks, casts, moves or forced the save; `target`: who is attacked, hurt, saves or died. */
export interface Trigger { window: Window; actor: Body; target?: Body; melee?: boolean; ranged?: boolean; damage?: number; type?: string; crit?: boolean;
  /** the roll had advantage or disadvantage */ edge?: boolean; nat1?: boolean; /** a save succeeded */ ok?: boolean; /** non-attack damage (a save's) */ save?: boolean }

export interface Rx {
  win: Window[]; shape: Shape;
  /** self: the reactor is the target · ally: another creature of its side is · any: either · friend: the actor is of its side (not itself) ·
   *  anyone: no side rule. Otherwise the actor must be hostile. */
  who: 'self' | 'ally' | 'any' | 'friend' | 'anyone';
  near?: { of: 'actor' | 'target'; feet: number }; see?: 'actor' | 'target';
  when?: (t: Trigger, b: Body) => boolean;
  /** resource names it spends, the first the sheet tracks (none tracked: nothing spent); `count` uses of it */ res?: string[]; count?: number;
  /** a spell: its reaction action pays the lowest free slot, and it can be countered */ spell?: true;
  /** one option per free slot */ slots?: true;
  dice?: (b: Body, slot?: number) => string;
  /** back: its damage type, and the save (half on a success with `half`) */ type?: string; save?: Ability; half?: true;
  /** ac: when it still hits, half damage; when it now misses, an attack on the actor */ then?: 'resist' | 'attack';
  /** miss: a d6 of at least this */ chance?: number;
  /** back: as much as the damage dealt (Rebuke the Violent) */ dealt?: true;
}

const ELEMENTS = ['acid', 'cold', 'fire', 'lightning', 'thunder'];
const SUP = ['Superiority Dice', 'Superiority Die'], CD = ['Channel Divinity'];
const lvl = (b: Body, cls: string) => b.stats?.levels[cls] ?? 0;
const mod = (b: Body, a: Ability) => b.stats?.mods[a] ?? 0;
const plus = (n: number) => (n ? `${n > 0 ? '+' : ''}${n}` : '');
const by = (n: number, steps: [number, string][]) => steps.reduce((d, [at, v]) => (n >= at ? v : d), steps[0][1]);
const sup = (b: Body) => by(lvl(b, 'Fighter'), [[0, '1d8'], [10, '1d10'], [18, '1d12']]);
const bardic = (b: Body) => by(lvl(b, 'Bard'), [[0, '1d6'], [5, '1d8'], [10, '1d10'], [15, '1d12']]);
const psi = (b: Body) => by(lvl(b, 'Fighter'), [[0, '1d6'], [5, '1d8'], [11, '1d10'], [17, '1d12']]);
const weapon = (b: Body) => oaAction({ pc: b.pc, actions: b.actions })?.attack;
const big = (x: Body) => ['L', 'H', 'G'].includes(x.pt.size);

export const TABLE: Record<string, Rx> = {
  // spells
  'Absorb Elements': { win: ['hit'], who: 'self', shape: 'resist', spell: true, when: (t) => ELEMENTS.includes(t.type ?? '') },
  'Soul Cage': { win: ['died'], who: 'anyone', near: { of: 'target', feet: 60 }, see: 'target', shape: 'note', spell: true },
  // feats and fighting styles
  Sentinel: { win: ['after'], who: 'ally', near: { of: 'actor', feet: 5 }, shape: 'attack', when: (t) => !t.target?.features.includes('Sentinel') },
  'Mage Slayer': { win: ['cast'], who: 'anyone', near: { of: 'actor', feet: 5 }, shape: 'attack', when: (t, b) => t.actor.side !== b.side },
  'Defensive Duelist': { win: ['hit'], who: 'self', shape: 'ac', dice: (b) => String(b.stats?.prof ?? 2), when: (t, b) => !!t.melee && !!weapon(b)?.properties.includes('finesse') },
  'Shield Master': { win: ['saved'], who: 'self', shape: 'note', when: (t) => !!t.damage },
  'Orcish Fury': { win: ['damaged'], who: 'self', shape: 'note', when: (_, b) => b.x.hp === 1 },
  'Second Chance': { win: ['hit'], who: 'self', near: { of: 'actor', feet: 30 }, see: 'actor', shape: 'note' },
  'Bountiful Luck': { win: ['miss'], who: 'friend', near: { of: 'actor', feet: 30 }, see: 'actor', shape: 'note', when: (t) => !!t.nat1 },
  Protection: { win: ['declared'], who: 'ally', near: { of: 'target', feet: 5 }, see: 'actor', shape: 'dis', when: (_, b) => b.stats?.shield !== false },
  Interception: { win: ['hit'], who: 'ally', near: { of: 'target', feet: 5 }, shape: 'cut', dice: (b) => `1d10${plus(b.stats?.prof ?? 2)}` },
  // Barbarian
  Retaliation: { win: ['damaged'], who: 'self', near: { of: 'actor', feet: 5 }, shape: 'attack', when: (t) => !t.save },
  'Spirit Shield': { win: ['hit'], who: 'ally', near: { of: 'target', feet: 30 }, see: 'target', shape: 'cut', dice: (b) => by(lvl(b, 'Barbarian'), [[0, '2d6'], [10, '3d6'], [14, '4d6']]) },
  // Bard
  'Cutting Words': { win: ['hit'], who: 'any', near: { of: 'actor', feet: 60 }, see: 'actor', shape: 'roll', res: ['Bardic Inspiration'], dice: bardic },
  // Cleric
  'Warding Flare': { win: ['declared'], who: 'any', near: { of: 'actor', feet: 30 }, see: 'actor', shape: 'dis', res: ['Warding Flare'],
    when: (t, b) => t.target === b || b.features.includes('Improved Flare') },
  'Wrath of the Storm': { win: ['damaged'], who: 'self', near: { of: 'actor', feet: 5 }, see: 'actor', shape: 'back', res: ['Wrath of the Storm'], dice: () => '2d8', type: 'lightning', save: 'dex', half: true, when: (t) => !t.save },
  "War God's Blessing": { win: ['miss'], who: 'friend', near: { of: 'actor', feet: 30 }, shape: 'note', res: CD },
  "Sentinel at Death's Door": { win: ['hit'], who: 'any', near: { of: 'target', feet: 30 }, see: 'target', shape: 'note', res: ["Sentinel at Death's Door"], when: (t) => !!t.crit },
  'Dampen Elements': { win: ['hit'], who: 'any', near: { of: 'target', feet: 30 }, see: 'target', shape: 'resist', when: (t) => ELEMENTS.includes(t.type ?? '') },
  'Protective Bond': { win: ['hit'], who: 'ally', near: { of: 'target', feet: 30 }, shape: 'note' },
  // Druid
  'Halo of Spores': { win: ['enter'], who: 'self', near: { of: 'actor', feet: 10 }, shape: 'back', type: 'necrotic', save: 'con',
    dice: (b) => by(lvl(b, 'Druid'), [[0, '1d4'], [6, '1d6'], [10, '1d8'], [14, '1d10']]) },
  // Fighter
  Parry: { win: ['hit'], who: 'self', shape: 'cut', res: SUP, dice: (b) => `${sup(b)}${plus(mod(b, 'dex'))}`, when: (t) => !!t.melee },
  Riposte: { win: ['miss'], who: 'self', shape: 'attack', res: SUP, dice: sup, when: (t) => !!t.melee },
  Brace: { win: ['enter'], who: 'self', shape: 'attack', res: SUP, dice: sup },
  'Polearm Master': { win: ['enter'], who: 'self', shape: 'attack', when: (_, b) => /glaive|halberd|pike|quarterstaff|spear/i.test(weapon(b)?.name ?? '') },
  'Warding Maneuver': { win: ['hit'], who: 'any', near: { of: 'target', feet: 5 }, see: 'target', shape: 'ac', res: ['Warding Maneuver'], dice: () => '1d8', then: 'resist' },
  'Protective Field': { win: ['hit'], who: 'any', near: { of: 'target', feet: 30 }, see: 'target', shape: 'cut', res: ['Psionic Energy Dice', 'Psionic Energy'], dice: (b) => `${psi(b)}${plus(mod(b, 'int'))}` },
  'Cloud Rune': { win: ['hit'], who: 'any', near: { of: 'target', feet: 30 }, see: 'target', shape: 'note', res: ['Cloud Rune'] },
  'Strength before Death': { win: ['damaged'], who: 'self', shape: 'note', when: (_, b) => b.x.hp === 0 },
  // Monk
  'Deflect Missiles': { win: ['hit'], who: 'self', shape: 'cut', dice: (b) => `1d10${plus(mod(b, 'dex') + lvl(b, 'Monk'))}`, when: (t) => !!t.ranged },
  'Redirect Attack': { win: ['miss'], who: 'self', shape: 'note', res: ['Ki'], when: (t) => !!t.melee },
  // Paladin
  'Rebuke the Violent': { win: ['damaged'], who: 'ally', near: { of: 'actor', feet: 30 }, see: 'actor', shape: 'back', res: CD, type: 'radiant', save: 'wis', half: true, dealt: true },
  'Glorious Defense': { win: ['hit'], who: 'any', near: { of: 'target', feet: 10 }, see: 'target', shape: 'ac', res: ['Glorious Defense'], dice: (b) => String(Math.max(1, mod(b, 'cha'))), then: 'attack' },
  'Vigilant Rebuke': { win: ['saved'], who: 'any', near: { of: 'target', feet: 30 }, see: 'target', shape: 'back', type: 'force', dice: (b) => `2d8${plus(mod(b, 'cha'))}`, when: (t) => !!t.ok },
  'Soul of Vengeance': { win: ['after'], who: 'anyone', near: { of: 'actor', feet: 5 }, shape: 'attack', when: (t, b) => t.actor.side !== b.side },
  // Ranger
  'Giant Killer': { win: ['after'], who: 'self', near: { of: 'actor', feet: 5 }, see: 'actor', shape: 'attack', when: (t) => big(t.actor) },
  'Stand Against the Tide': { win: ['miss'], who: 'self', shape: 'note', when: (t) => !!t.melee },
  'Shadowy Dodge': { win: ['declared'], who: 'self', shape: 'dis', when: (t) => !t.edge },
  'Spectral Defense': { win: ['hit'], who: 'self', shape: 'resist' },
  "Magic-User's Nemesis": { win: ['cast'], who: 'anyone', near: { of: 'actor', feet: 60 }, see: 'actor', shape: 'nemesis', res: ["Magic-User's Nemesis"], when: (t, b) => t.actor.side !== b.side },
  "Slayer's Counter": { win: ['saved'], who: 'self', shape: 'note' },
  'Beguiling Twist': { win: ['saved'], who: 'any', near: { of: 'target', feet: 120 }, see: 'target', shape: 'note', when: (t) => !!t.ok },
  'Swarming Dispersal': { win: ['hit'], who: 'self', shape: 'resist', res: ['Swarming Dispersal'] },
  // Rogue
  'Spell Thief': { win: ['cast'], who: 'anyone', near: { of: 'actor', feet: 60 }, see: 'actor', shape: 'note', res: ['Spell Thief'], when: (t, b) => t.actor.side !== b.side },
  Misdirection: { win: ['declared'], who: 'self', shape: 'note' },
  'Tokens of the Departed': { win: ['died'], who: 'anyone', near: { of: 'target', feet: 30 }, see: 'target', shape: 'note' },
  // Sorcerer
  'Bend Luck': { win: ['hit'], who: 'any', see: 'actor', shape: 'roll', res: ['Sorcery Points'], count: 2, dice: () => '1d4' },
  'Restore Balance': { win: ['declared'], who: 'any', near: { of: 'actor', feet: 60 }, see: 'actor', shape: 'note', res: ['Restore Balance'], when: (t) => !!t.edge },
  "Storm's Fury": { win: ['damaged'], who: 'self', shape: 'back', type: 'lightning', dice: (b) => String(Math.max(1, lvl(b, 'Sorcerer'))), when: (t) => !!t.melee && !t.save },
  // Warlock
  'Misty Escape': { win: ['damaged'], who: 'self', shape: 'note', res: ['Misty Escape'] },
  'Entropic Ward': { win: ['declared'], who: 'self', shape: 'dis', res: ['Entropic Ward'] },
  'Armor of Hexes': { win: ['hit'], who: 'self', shape: 'miss', chance: 4 },
  'Guardian Coil': { win: ['hit'], who: 'any', near: { of: 'target', feet: 10 }, see: 'target', shape: 'cut', dice: (b) => (lvl(b, 'Warlock') >= 10 ? '2d8' : '1d8') },
  'Tomb of Levistus': { win: ['damaged'], who: 'self', shape: 'note' },
  // Wizard
  'Projected Ward': { win: ['hit'], who: 'ally', near: { of: 'target', feet: 30 }, see: 'target', shape: 'note' },
  'Song of Defense': { win: ['hit'], who: 'self', shape: 'cut', slots: true, dice: (_, slot) => String(5 * (slot ?? 1)) },
  'Arcane Deflection': { win: ['hit', 'saved'], who: 'self', shape: 'ac', dice: () => '2', when: (t) => t.window === 'hit' || !t.ok },
  'Illusory Self': { win: ['hit'], who: 'self', shape: 'miss', res: ['Illusory Self'] },
  'Instinctive Charm': { win: ['declared'], who: 'self', near: { of: 'actor', feet: 30 }, see: 'actor', shape: 'note', res: ['Instinctive Charm'] },
  // Artificer
  'Flash of Genius': { win: ['saved'], who: 'any', near: { of: 'target', feet: 30 }, see: 'target', shape: 'note', res: ['Flash of Genius'] },
};
/** The shape after a window has its say: a damage cutter against a save's damage, or Arcane Deflection on a save, is a reminder (it already landed). */
export const shapeFor = (rx: Rx, t: Trigger): Shape => ((t.save && ['cut', 'resist'].includes(rx.shape)) || (t.window === 'saved' && rx.shape === 'ac') ? 'note' : rx.shape);

export const entry = (key: string): Rx | undefined => TABLE[key];
const named = (n: string, key: string) => { const a = n.toLowerCase(), k = key.toLowerCase(); return a === k || a.endsWith(`: ${k}`); };
/** The reactor has it: a feature (a maneuver may be listed as "Maneuvers: Parry"), or a reaction of that name (a spell). */
const holds = (b: Body, key: string, rx: Rx) => b.pc && (rx.spell ? b.actions.some((a) => a.cost === 'reaction' && named(a.name, key)) : b.features.some((f) => named(f, key)));

/** The resource a use spends: the first of its names the sheet tracks (undefined: none tracked, nothing to spend). */
export function resourceOf(b: Body, key: string): string | undefined {
  return entry(key)?.res?.find((n) => b.stats?.left[n] !== undefined);
}
const affordable = (b: Body, key: string, rx: Rx) => { const r = resourceOf(b, key); return r === undefined || (b.stats?.left[r] ?? 0) >= (rx.count ?? 1); };

/** Its amount as dice (or a number), from the reactor's sheet. */
export const amount = (key: string, b: Body, slot?: number): string => entry(key)?.dice?.(b, slot) ?? '';

function label(key: string, rx: Rx, shape: Shape, b: Body, slot?: number): string {
  const d = amount(key, b, slot), name = slot === undefined ? key : `${key} ${slot}`;
  const what = shape === 'note' ? 'settle by hand' : shape === 'ac' ? `+${d} AC` : shape === 'dis' ? 'disadvantage' : shape === 'cut' ? `−${d}` : shape === 'resist' ? 'half damage'
    : shape === 'back' ? `${d} ${rx.type}` : shape === 'attack' ? (d ? `attack, +${d}` : 'attack') : shape === 'roll' ? `−${d} to the roll` : shape === 'miss' ? (rx.chance ? `misses on ${rx.chance}+` : 'it misses') : 'Wis save or it fails';
  return `${name} (${what})`;
}

function optionsFor(b: Body, key: string, rx: Rx, shape: Shape): ReactOption[] {
  if (!affordable(b, key, rx) || (rx.spell && !b.slots.length) || (shape === 'attack' && !oaAction(b))) return [];
  const one = (slot?: number): ReactOption => ({ id: 'more', key, label: label(key, rx, shape, b, slot), ...(slot !== undefined && { slot }), ...(shape === 'attack' && { strike: true as const }) });
  return rx.slots ? b.slots.map(one) : [one()];
}

function relates(rx: Rx, t: Trigger, b: Body): boolean {
  const hostile = t.actor.side !== b.side;
  switch (rx.who) {
    case 'self': return t.target === b && hostile;
    case 'ally': return !!t.target && t.target !== b && t.target.side === b.side && hostile;
    case 'any': return !!t.target && t.target.side === b.side && hostile;
    case 'friend': return t.actor !== b && t.actor.side === b.side;
    case 'anyone': return true;
  }
}

/** Who may answer `t` from the name table (and a monster target's own reaction traits, as reminders on a hit), with their options. */
export function tableReactors(g: Grid, diagonal: Diagonal, t: Trigger, all: Body[]): Reactor[] {
  const out: Reactor[] = [];
  for (const b of all) {
    if (!canReact(b) || b === t.actor) continue;
    const options: ReactOption[] = [];
    if (b.pc) for (const [key, rx] of Object.entries(TABLE)) {
      const shape = shapeFor(rx, t);
      if (!rx.win.includes(t.window) && !(t.window === 'damaged' && t.save && rx.win.includes('hit') && shape === 'note')) continue;
      if (!holds(b, key, rx) || !relates(rx, t, b) || (rx.when && !rx.when(t, b))) continue;
      const anchor = rx.near?.of === 'target' ? t.target : t.actor, seen = rx.see === 'target' ? t.target : rx.see === 'actor' ? t.actor : undefined;
      if (rx.near && (!anchor || (anchor !== b && tokenFeet(g, b.pt, anchor.pt, diagonal) > rx.near.feet))) continue;
      if (seen && seen !== b && !sees(b, seen)) continue;
      options.push(...optionsFor(b, key, rx, shape));
    }
    else if (t.window === 'hit' && t.target === b) for (const a of b.actions) { // a monster's own reactions besides "+N AC" (reactions.ts) and the spells the app knows
      if (a.cost !== 'reaction' || a.group !== 'monster' || (a.text && acReaction({ name: a.name, text: richToPlain(a.text) }))) continue;
      options.push({ id: 'more', key: `mon:${a.name}`, label: `${a.name} (settle by hand)` });
    }
    if (options.length) out.push({ id: b.x.id, name: b.name, options });
  }
  return out;
}

/** The name table's reactions to a creature entering this reactor's reach (its reach, or the entry's own distance). */
export function enterOptions(b: Body): { feet: number; option: ReactOption }[] {
  if (!b.pc || !canReact(b)) return [];
  return Object.entries(TABLE).flatMap(([key, rx]) => rx.win.includes('enter') && holds(b, key, rx) && (!rx.when || rx.when({ window: 'enter', actor: b }, b))
    ? optionsFor(b, key, rx, rx.shape).map((option) => ({ feet: rx.near?.feet ?? b.reach, option })) : []);
}
