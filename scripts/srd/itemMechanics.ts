import type { Ability, Effect, ItemDef, ItemType } from '../../src/lib/types.ts';

// Structured mechanics (bonuses, charges, effects) for SRD magic items. The 5e-database has only text, so
// `parseMechanics` reads the standard SRD sentences and ITEM_MECHANICS hand-corrects or adds what the parser can't.

type Bonuses = NonNullable<ItemDef['bonuses']>;
type Charges = NonNullable<ItemDef['charges']>;
export interface Mechanics { bonuses?: Bonuses; charges?: Charges; effects?: Effect[] }

// Consumables grant their bonus for a duration, not while carried or equipped.
const SKIP_BONUSES: ItemType[] = ['potion', 'scroll'];
const COMPACT = (dice: string) => dice.replace(/\s+/g, '');

/**
 * Reads the numbers out of an SRD magic item description (plain text, blocks joined by spaces):
 * "+N bonus to attack and damage rolls" (weapons and ammunition only: other types have no attack to add it to),
 * "+N bonus to AC [and saving throws]" (not "against ..." or "if ..."), "+N bonus to saving throws",
 * "+N bonus to spell attack rolls" / "spell save DC", "has N charges" and "regains XdY [+ Z] expended charges daily at dawn".
 * Only the first match of each pattern counts; anything conditional or per-form belongs in ITEM_MECHANICS.
 */
export function parseMechanics(text: string, type?: ItemType): Pick<Mechanics, 'bonuses' | 'charges'> {
  const bonuses: Bonuses = {};
  const num = (re: RegExp) => { const m = re.exec(text); return m ? +m[1] : undefined; };
  if (!type || !SKIP_BONUSES.includes(type)) {
    const hit = (type === undefined || type === 'weapon' || type === 'ammunition') ? num(/\+(\d) bonus to attack and damage rolls/i) : undefined;
    if (hit) { bonuses.attack = hit; bonuses.damage = hit; }
    const ac = /\+(\d) bonus to (?:AC|Armor Class)( and saving throws)?(\s+(?:against|if|when)\b)?/i.exec(text);
    if (ac && !ac[3]) { bonuses.ac = +ac[1]; if (ac[2]) bonuses.save = +ac[1]; }
    const save = num(/\+(\d) bonus to (?:ability checks and )?saving throws/i);
    if (save && !bonuses.save) bonuses.save = save;
    const spellAttack = num(/\+(\d) bonus to spell attack rolls/i);
    if (spellAttack) bonuses.spellAttack = spellAttack;
    const spellDc = num(/\+(\d) bonus to (?:spell attack rolls and (?:to )?)?(?:your |the )?(?:spell save DC|saving throw DCs)/i);
    if (spellDc) bonuses.spellDc = spellDc;
  }
  const out: Pick<Mechanics, 'bonuses' | 'charges'> = {};
  if (Object.keys(bonuses).length) out.bonuses = bonuses;

  const max = num(/(?:has|have|starts with) (\d+) charges/i) ?? num(/of (?:its|the \w+'s) (\d+) charges/i);
  if (max) {
    const regain = /regains? (all|\d+d\d+(?:\s*[+-]\s*\d+)?) expended charges[^.]*?\bat (dawn|dusk)/i.exec(text);
    out.charges = regain
      ? { max, recharge: regain[2].toLowerCase() as 'dawn' | 'dusk', ...(regain[1].toLowerCase() !== 'all' && { rechargeAmount: COMPACT(regain[1]) }) }
      : { max, recharge: 'none' };
  }
  return out;
}

const resist = (damageType: string): Effect => ({ type: 'damage', kind: 'resistance', damageType });
const setStr = (value: number): Effect => ({ type: 'setScore', ability: 'str', value });
const I = (slug: string) => `item:${slug}@SRD`;
const ABILITY: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * Per-item corrections, keyed by item id. Each key present replaces what the parser read for that field;
 * `null` drops it (the text says the bonus is conditional or belongs to something else). Only unconditional numbers
 * the Effect union can express are represented; everything else stays in the item text.
 */
export const ITEM_MECHANICS: Record<string, { bonuses?: Bonuses | null; charges?: Charges | null; effects?: Effect[] }> = {
  // The parser reads these wrongly: conditional bonuses or numbers from a different property.
  [I('rod-of-alertness')]: { bonuses: null }, // only in bright light
  [I('defender')]: { bonuses: { attack: 3, damage: 3 } }, // the text's "+2 bonus to AC" is an example of reallocating the +3
  [I('talisman-of-pure-good')]: { bonuses: null }, // only for good clerics and paladins
  [I('talisman-of-ultimate-evil')]: { bonuses: null }, // only for evil clerics and paladins
  [I('staff-of-power')]: { bonuses: { ac: 2, save: 2, spellAttack: 2 } }, // "Armor Class, saving throws, and spell attack rolls" (the quarterstaff +2 has no weapon to sit on)
  [I('luck-blade')]: { charges: { max: 3, recharge: 'none' } }, // "1d4 - 1 charges": the largest roll
  [I('nine-lives-stealer')]: { charges: { max: 9, recharge: 'none' } }, // "1d8 + 1 charges": the largest roll
  // Items with more than a number to read.
  [I('bracers-of-defense')]: { effects: [{ type: 'bonus', target: 'ac', value: 2, when: 'unarmored' }] }, // no armor and no shield
  [I('bracers-of-archery')]: { effects: [{ type: 'proficiency', category: 'weapon', value: 'longbow' }, { type: 'proficiency', category: 'weapon', value: 'shortbow' }] }, // the +2 damage is longbow/shortbow only
  [I('stone-of-good-luck-luckstone')]: { effects: ABILITY.map((a): Effect => ({ type: 'bonus', target: `check.${a}`, value: 1 })) }, // bonuses.save comes from the text
  [I('ring-of-swimming')]: { effects: [{ type: 'speed', mode: 'swim', value: 40 }] },
  [I('amulet-of-health')]: { effects: [{ type: 'setScore', ability: 'con', value: 19 }] },
  [I('gauntlets-of-ogre-power')]: { effects: [setStr(19)] },
  [I('headband-of-intellect')]: { effects: [{ type: 'setScore', ability: 'int', value: 19 }] },
  [I('brooch-of-shielding')]: { effects: [resist('force')] }, // also immune to the magic missile spell (text)
  [I('boots-of-the-winterlands')]: { effects: [resist('cold')] },
  [I('cloak-of-arachnida')]: { effects: [resist('poison')] },
  [I('ring-of-warmth')]: { effects: [resist('cold')] },
  [I('ring-of-fire-elemental-command')]: { effects: [resist('fire')] },
  [I('staff-of-fire')]: { effects: [resist('fire')] },
  [I('staff-of-frost')]: { effects: [resist('cold')] },
  [I('frost-brand')]: { effects: [resist('fire')] },
  [I('periapt-of-proof-against-poison')]: { effects: [{ type: 'damage', kind: 'immunity', damageType: 'poison' }] }, // also immune to the poisoned condition (text)
  // Belt of Giant Strength variants: Strength becomes the belt's score, never lowered (setScore takes the higher).
  ...Object.fromEntries(Object.entries({ hill: 21, stone: 23, frost: 23, fire: 25, cloud: 27, storm: 29 }).map(([giant, score]) => [I(`belt-of-${giant}-giant-strength`), { effects: [setStr(score)] }])),
  // Ring of <type> Resistance.
  ...Object.fromEntries(['acid', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'poison', 'psychic', 'radiant', 'thunder'].map(t => [I(`ring-of-${t}-resistance`), { effects: [resist(t)] }])),
  // Dragon scale mail: the +1 AC is parsed; each colour adds its dragon's damage type.
  ...Object.fromEntries(Object.entries({ black: 'acid', blue: 'lightning', brass: 'fire', bronze: 'lightning', copper: 'acid', gold: 'fire', green: 'poison', red: 'fire', silver: 'cold', white: 'cold' })
    .map(([colour, t]) => [I(`${colour}-dragon-scale-mail`), { effects: [resist(t)] }])),
};

/** The parser's reading of `text`, then ITEM_MECHANICS for `id` on top. */
export function itemMechanics(id: string, text: string, type?: ItemType): Mechanics {
  const parsed: Mechanics = parseMechanics(text, type);
  const fix = ITEM_MECHANICS[id];
  if (!fix) return parsed;
  const out: Mechanics = { ...parsed };
  for (const k of ['bonuses', 'charges', 'effects'] as const) {
    if (!(k in fix)) continue;
    if (fix[k] == null) delete out[k]; else (out as Record<string, unknown>)[k] = fix[k];
  }
  return out;
}
