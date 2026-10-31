// Minimal valid records for storage tests.
import { applyBackup, readBackup } from '../../src/lib/backup.ts';
import type { Campaign, Character, StoredItem } from '../../src/lib/types.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';

/** Both backup import steps at once, as if the user confirmed (R57). */
export const importBackup = async (file: Blob) => applyBackup(await readBackup(file));

export const camp = (id: string): Campaign => ({
  id, name: id, createdAt: 0, updatedAt: 0, settings: structuredClone(DEFAULT_SETTINGS), enabledPacks: [], loot: [],
});

export const char = (id: string, campaignId?: string): Character => ({
  id, name: id, campaignId, updatedAt: 0,
  build: {
    raceId: 'race:human', backgroundId: 'background:acolyte', abilityMethod: 'standard',
    baseScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    levels: [], subclasses: {}, choices: {}, spells: {},
  },
  embedded: {},
  state: {
    hp: 1, tempHp: 0, hitDiceUsed: {}, slotsUsed: [], pactSlotsUsed: 0, resourcesUsed: {}, conditions: [],
    exhaustion: 0, deathSaves: { success: 0, fail: 0 }, inspiration: false,
  },
  inventory: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, overrides: {}, customEffects: [],
  details: { alignment: '', personality: '', ideals: '', bonds: '', flaws: '', appearance: '', backstory: '', notes: '' },
});

export const item = (id: string, campaignId: string): StoredItem => ({
  id, name: id, source: 'test', text: [], kind: 'item', type: 'gear', magic: false, campaignId, updatedAt: 0,
});

