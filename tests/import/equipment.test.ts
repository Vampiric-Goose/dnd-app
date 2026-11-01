import { describe, expect, test } from 'vitest';
import { equipmentChoices } from '../../src/lib/import/fivetools/backgrounds.ts';
import type { Ctx } from '../../src/lib/import/fivetools/common.ts';

const ctx = { ref: (kind: string, name: string, source: string) => `${kind}:${name.toLowerCase()}@${source.toUpperCase()}` } as unknown as Ctx;

describe('equipmentChoices (5etools defaultData)', () => {
  test("a fighter's picks: lettered options become one choice group; categories and named items are both picks", () => {
    const fighter = [
      { a: ['chain mail|phb'], b: ['leather armor|phb', 'longbow|phb', { item: 'arrow|phb', quantity: 20 }] },
      { a: [{ equipmentType: 'weaponMartial' }, 'shield|phb'], b: [{ equipmentType: 'weaponMartial', quantity: 2 }] },
      { _: ['explorer\'s pack|phb'] },
    ];
    const g = equipmentChoices(fighter, ctx);
    expect(g).toHaveLength(3);
    expect(g[0].map((o) => o.items)).toEqual([
      [{ itemId: 'item:chain mail@PHB', quantity: 1 }],
      [{ itemId: 'item:leather armor@PHB', quantity: 1 }, { itemId: 'item:longbow@PHB', quantity: 1 }, { itemId: 'item:arrow@PHB', quantity: 20 }],
    ]);
    expect(g[1][0].items).toEqual([{ category: 'martial-weapons', quantity: 1 }, { itemId: 'item:shield@PHB', quantity: 1 }]);
    expect(g[1][1].items).toEqual([{ category: 'martial-weapons', quantity: 2 }]);
    expect(g[2]).toHaveLength(1); // always given: "You get"
  });

  test('specials and coins stay in the label only; junk groups are skipped', () => {
    const g = equipmentChoices([{ _: [{ special: 'a trophy' }, { value: 1000 }, 'common clothes|phb'] }, null, 'x'], ctx);
    expect(g).toHaveLength(1);
    expect(g[0][0].items).toEqual([{ itemId: 'item:common clothes@PHB', quantity: 1 }]);
    expect(g[0][0].label).toContain('a trophy');
  });
});
