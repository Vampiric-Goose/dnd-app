// A tiny hand-written stand-in for the SRD pack, for importer tests (Tasks 11 and 12).
import type { Pack, Proficiencies } from '../../src/lib/types.ts';

const P = (o: Partial<Proficiencies> = {}): Proficiencies => ({ armor: [], weapons: [], tools: [], skills: [], languages: [], ...o });

export const srdPackFixture: Pack = {
  id: 'srd', name: 'System Reference Document 5.1', source: 'SRD', importedAt: 0, hash: '', patches: [],
  entities: [
    { kind: 'race', id: 'race:dwarf@SRD', name: 'Dwarf', source: 'SRD', srd: true, text: [{ p: 'Short SRD text.' }], size: 'M', speed: { walk: 25 },
      abilityBonuses: { con: 2 }, proficiencies: P({ languages: ['Common', 'Dwarvish'] }), darkvision: 60, traits: [] },
    { kind: 'item', id: 'item:longsword@SRD', name: 'Longsword', source: 'SRD', srd: true, text: [], type: 'weapon', magic: false, weight: 3, costCp: 1500,
      weapon: { category: 'martial', ranged: false, damage: '1d8', damageType: 'slashing', versatile: '1d10', properties: ['versatile'] } },
    { kind: 'class', id: 'class:fighter@SRD', name: 'Fighter', source: 'SRD', srd: true, text: [], hitDie: 10, saves: ['str', 'con'],
      proficiencies: P({ armor: ['light', 'medium', 'heavy', 'shield'], weapons: ['simple', 'martial'] }), skillChoice: { count: 2, from: ['athletics', 'perception'] },
      multiclassProficiencies: P(), startingEquipment: { text: [], choices: [] }, subclassLevel: 3, subclassTitle: 'Martial Archetype', asiLevels: [4],
      features: [{ level: 1, id: 'feature:fighter:second-wind:1@SRD' }], table: [], optionalFeatureProgression: [] },
    { kind: 'feature', id: 'feature:fighter:second-wind:1@SRD', name: 'Second Wind', source: 'SRD', srd: true, text: [{ p: 'Regain hit points.' }],
      level: 1, classId: 'class:fighter@SRD' },
  ],
};
