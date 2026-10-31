import fs from 'node:fs';
import { expect, test } from 'vitest';
import { CR_LADDER, hpAverage } from '../../src/lib/rules/monsters.ts';
import type { MonsterDef, Pack } from '../../src/lib/types.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const monsters = srd.entities.filter((e): e is MonsterDef => e.kind === 'monster');
const mon = (slug: string) => monsters.find((m) => m.id === `monster:${slug}@SRD`)!;
const count = (k: string) => srd.entities.filter((e) => e.kind === k).length;

test('SRD monsters exist and stage 1 content is unchanged', () => {
  expect(monsters.length).toBeGreaterThanOrEqual(300);
  expect(monsters.every((m) => m.id.endsWith('@SRD') && m.source === 'SRD' && m.srd)).toBe(true);
  expect([count('class'), count('spell'), count('item'), count('condition')]).toEqual([12, 319, 578, 15]);
  expect(new Set(srd.entities.map((e) => e.id)).size).toBe(srd.entities.length);
});

test('goblin', () => {
  const g = mon('goblin');
  expect(g).toMatchObject({
    size: ['S'], type: 'humanoid (goblinoid)', alignment: 'neutral evil',
    ac: [{ value: 15, from: 'leather armor, shield' }], hp: { average: 7, formula: '2d6' },
    skills: { stealth: 6 }, passive: 9, languages: ['Common', 'Goblin'], cr: '1/4',
  });
  expect(g.speed.walk).toBe(30);
  expect(g.scores.dex).toBe(14);
  expect(g.senses).toContain('darkvision 60 ft.');
  expect(g.traits.map((t) => t.name)).toContain('Nimble Escape');
  expect(g.actions.map((t) => t.name)).toEqual(expect.arrayContaining(['Scimitar', 'Shortbow']));
});

test('adult red dragon', () => {
  const d = mon('adult-red-dragon');
  expect(d.legendary).toHaveLength(3);
  expect(d.legendaryCount).toBe(3);
  expect(d.immune).toContain('fire');
  expect(d.cr).toBe('17');
  expect(d.saves).toEqual({ dex: 6, con: 13, wis: 7, cha: 11 });
  expect(d.actions.map((a) => a.name)).toContain('Fire Breath (Recharge 5–6)');
  expect(d.traits.map((a) => a.name)).toContain('Legendary Resistance (3/Day)');
  expect(d.legendary.map((a) => a.name)).toContain('Wing Attack (Costs 2 Actions)');
});

test('SRD printing conventions', () => {
  expect(mon('goblin').legendary).toEqual([]);
  expect(mon('goblin').legendaryCount).toBeUndefined();
  expect(mon('archmage').ac).toEqual([{ value: 12 }, { value: 15, from: 'with mage armor' }]);
  expect(mon('ankheg').ac[1]).toEqual({ value: 11, from: 'while prone' });
  expect(mon('aboleth').ac).toEqual([{ value: 17, from: 'natural armor' }]);
  expect(mon('air-elemental').speed).toEqual({ walk: 0, fly: 90, hover: true });
  expect(mon('swarm-of-bats').type).toBe('swarm of Tiny beasts');
  expect(mon('gelatinous-cube').languages).toEqual([]);
  expect(mon('lich').hp).toEqual({ average: 135, formula: '18d8 + 54' });
  expect([mon('lich').legendary.length, mon('lich').legendaryCount]).toEqual([4, 3]); // four options, three actions per round
  // spell lists keep their bullet lists, and "* " footnotes stay paragraphs
  const sc = mon('archmage').traits.find((t) => t.name === 'Spellcasting')!.text;
  expect(sc.some((b) => 'list' in b && b.list.length >= 9)).toBe(true);
  expect(sc.some((b) => 'p' in b && b.p.startsWith('* The archmage'))).toBe(true);
  expect(mon('adult-black-dragon').senses).toEqual(['blindsight 60 ft.', 'darkvision 120 ft.']);
});

test('every monster is well formed', () => {
  for (const m of monsters) {
    expect(CR_LADDER, m.id).toContain(m.cr);
    if ('formula' in m.hp && m.hp.formula) expect(hpAverage(m.hp.formula), m.id).toBe(m.hp.average);
    expect(m.size, m.id).toHaveLength(1);
    expect(m.ac[0].value, m.id).toBeGreaterThan(0);
    expect(m.actions.length + m.traits.length, m.id).toBeGreaterThan(0);
    for (const t of [...m.traits, ...m.actions, ...m.reactions, ...m.legendary]) expect(t.text.length, `${m.id}/${t.name}`).toBeGreaterThan(0);
  }
});
