import { describe, expect, it } from 'vitest';
import { versions } from '../../src/ui/creator/labels.ts';

describe('versions', () => {
  it('groups same-named races, preferred version first', () => {
    const r = (name: string, source: string) => ({ id: `race:${name.toLowerCase()}@${source}`, name, source });
    const groups = versions([r('Orc', 'VGM'), r('Dwarf', 'SRD'), r('Orc', 'BREW'), r('orc', 'DMG'), r('Orc', 'MPMM'), r('Dwarf', 'PHB')]);
    expect(groups.map((g) => g.map((e) => e.source))).toEqual([['SRD', 'PHB'], ['MPMM', 'VGM', 'DMG', 'BREW']]);
    expect(groups.map((g) => g[0].name)).toEqual(['Dwarf', 'Orc']);
  });
});
