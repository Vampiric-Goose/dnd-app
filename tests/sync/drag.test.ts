// Live drag previews: a player's drag (checked like a move, no budget) reaches the DM's map and the other players who see the token;
// the DM's drags reach players for visible tokens only. Never stored.
import { describe, expect, test } from 'vitest';
import { encodeFog, newFog, paintRect } from '../../src/lib/map/fog.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { Guest } from '../../src/lib/sync/guest.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { parseGuestMessage, type Preview } from '../../src/lib/sync/protocol.ts';
import type { Campaign, CampaignSettings, Character, Combat, Combatant, Scene } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';
import { camp } from '../fixtures/records.ts';
import { connect, Device, rawLink, settle } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN';
const CID = 'c1';
const settings = (o: Partial<CampaignSettings> = {}): CampaignSettings => ({ ...structuredClone(DEFAULT_SETTINGS), ...o });
const cell = (q: number, r = 0) => ({ x: 35 + 70 * q, y: 35 + 70 * r });
function thorin(): Character {
  const c = mkChar({ race: 'human', base: {}, levels: ['fighter'] });
  return { ...c, id: 'thorin', name: 'Thorin', campaignId: CID, ownerId: 'A1' };
}
const scene = (o: Partial<Scene> = {}): Scene => ({
  id: 's1', campaignId: CID, name: 'Crypt', width: 700, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
  tokens: [
    { id: 't-thorin', name: 'Thorin', x: 35, y: 35, size: 'M', color: '#c0392b', characterId: 'thorin' },
    { id: 't-gob', name: 'Goblin', ...cell(3), size: 'S', color: '#2e7d32' },
    { id: 't-ghost', name: 'Assassin', ...cell(5), size: 'M', color: '#000000', hidden: true },
  ],
  ...o,
});
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (): Combat => ({ campaignId: CID, round: 1, turn: 'pc:thorin', groupMonsters: false, updatedAt: 0,
  combatants: [cb({ id: 'pc:thorin', kind: 'pc', name: 'Thorin', characterId: 'thorin', init: 17 })] });

test('the parse: drag and dragEnd', () => {
  expect(parseGuestMessage({ t: 'drag', sceneId: 's1', tokenId: 't', x: 1, y: 2, z: 3 })).toEqual({ t: 'drag', sceneId: 's1', tokenId: 't', x: 1, y: 2 });
  expect(parseGuestMessage({ t: 'dragEnd', sceneId: 's1', tokenId: 't' })).toEqual({ t: 'dragEnd', sceneId: 's1', tokenId: 't' });
  for (const x of [-1, NaN, '5', 99999]) expect(parseGuestMessage({ t: 'drag', sceneId: 's1', tokenId: 't', x, y: 2 })).toEqual({ error: 'bad drag' });
  expect(parseGuestMessage({ t: 'dragEnd', sceneId: 's1' })).toEqual({ error: 'bad dragEnd' });
});

describe('engine', () => {
  const hosted = (): Campaign => ({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {}, A2: {} } } });
  async function setup(s: Scene = scene(), set = settings()) {
    const d = new Device();
    d.map = true;
    d.putCampaign({ ...hosted(), settings: set });
    d.edit(thorin());
    d.scene = s;
    d.combat = fight();
    const dm: Preview[] = [];
    const host = new Host({ ...d.hostDeps(CID), onDrag: (p) => { dm.push(p); } });
    const guest = (playerId: string) => {
      const got: Preview[] = [];
      const g = new Guest(new Device().guestDeps(CODE, { playerId, onDrag: (p) => { got.push(p); } }));
      connect(host, g);
      return { g, got };
    };
    const a = guest('A1'), b = guest('A2');
    await settle(host, a.g, b.g);
    return { d, host, a, b, dm };
  }

  test('a player\'s drag reaches the DM and the other players (not back to the sender); dragEnd too; nothing is stored', async () => {
    const { d, host, a, b, dm } = await setup();
    const before = JSON.stringify(d.scene);
    a.g.sendDrag('s1', 't-thorin', cell(8)); // no budget check: a preview (the sender's clamp already applies)
    await settle(host, a.g, b.g);
    a.g.sendDrag('s1', 't-thorin');
    await settle(host, a.g, b.g);
    expect(dm).toEqual([{ tokenId: 't-thorin', at: cell(8) }, { tokenId: 't-thorin' }]);
    expect(b.got).toEqual(dm);
    expect(a.got).toEqual([]);
    expect(JSON.stringify(d.scene)).toBe(before);
    expect(d.errors).toEqual([]);
  });

  test('a crafted drag of someone else\'s token is a violation and goes nowhere', async () => {
    const { d, host, b, dm } = await setup();
    const evil = rawLink();
    host.accept(evil.link);
    evil.deliver({ t: 'hello', code: CODE, playerId: 'A2' });
    await settle(host);
    evil.deliver({ t: 'drag', sceneId: 's1', tokenId: 't-thorin', x: 100, y: 100 });
    await settle(host, b.g);
    expect(d.errors.map(String)).toEqual([expect.stringMatching(/not their token/)]);
    expect(dm).toEqual([]);
    expect(b.got).toEqual([]);
  });

  test('the DM\'s drags reach players for visible tokens only (never a hidden one, never into fog)', async () => {
    const { host, a, b } = await setup();
    await host.dmDrag('s1', { tokenId: 't-gob', at: cell(4) });
    await host.dmDrag('s1', { tokenId: 't-ghost', at: cell(6) });
    await host.dmDrag('other', { tokenId: 't-gob', at: cell(6) });
    await settle(host, a.g, b.g);
    expect(a.got).toEqual([{ tokenId: 't-gob', at: cell(4) }]);
    expect(b.got).toEqual(a.got);

    // fog on, the left four columns revealed: a drag inside them shows, one into the fog does not
    const fog = encodeFog(paintRect(newFog(700, 700, false), 700, 700, { x: 0, y: 0 }, { x: 280, y: 700 }, true));
    const f = await setup(scene({ fog }), settings({ fog: true }));
    await f.host.dmDrag('s1', { tokenId: 't-gob', at: cell(2) });
    await f.host.dmDrag('s1', { tokenId: 't-gob', at: cell(7) });
    await settle(f.host, f.a.g);
    expect(f.a.got).toEqual([{ tokenId: 't-gob', at: cell(2) }]);
  });
});
