import type { SpellDef } from '../../src/lib/types.ts';
import { base, rich, type Raw, type Read } from './misc.ts';

export const spells = (read: Read): SpellDef[] => read('Spells').map((s): SpellDef => ({
  ...base('spell', s.name, rich(s.desc)),
  level: s.level,
  school: s.school.index,
  castingTime: s.casting_time,
  range: s.range,
  components: {
    ...(s.components.includes('V') && { v: true }),
    ...(s.components.includes('S') && { s: true }),
    ...(s.components.includes('M') && { m: s.material ?? '' }),
  },
  duration: s.duration,
  concentration: s.concentration,
  ritual: s.ritual,
  ...(s.higher_level?.length && { higherLevels: rich(s.higher_level) }),
  classes: s.classes.map((c: Raw) => c.index),
}));
