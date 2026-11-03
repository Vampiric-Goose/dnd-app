import type { CampaignSettings } from './types.ts';

// Copy before editing (structuredClone); nested initiativeModules is shared.
export const DEFAULT_SETTINGS: CampaignSettings = {
  allowOverrides: false,
  customOrigin: false,
  optionalClassFeatures: false,
  multiclassing: true,
  feats: true,
  hpMethod: 'average',
  encumbrance: 'off',
  crSuggestion: false,
  fog: false,
  diagonal: '5-5-5',
  freeMovement: false,
  monsterHp: 'average',
  initiativeModules: { hp: true, conditions: true, deathSaves: true, concentration: false, legendary: false, lair: false, reactions: false },
  showMonsterHealth: true,
  targeting: true,
  critAll: true,
};
