// Stage 3 final review fixes: M1, M3, M4, B2, B3, B6, B7, B8 and R11 (I1–I3 and M2 are in session.test.ts).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { classesFor, isSidekick } from '../../src/lib/character/build.ts';
import { db, DeletedError, resetDb } from '../../src/lib/db.ts';
import { sha256Text } from '../../src/lib/sync/code.ts';
import { Guest } from '../../src/lib/sync/guest.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { mergeCharacter } from '../../src/lib/sync/merge.ts';
import type { Campaign, ClassDef, Entity, Pack } from '../../src/lib/types.ts';
import { camp, char } from '../fixtures/records.ts';
import { connect, Device, rawLink, settle } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN', CID = 'c1';
const hosted = (players: NonNullable<Campaign['sync']>['players'] = {}): Campaign =>
  ({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players } });
const welcome = (o: Record<string, unknown> = {}) =>
  ({ t: 'welcome', playerId: 'A1', campaign: { id: CID, name: 'Ravenloft', settings: camp(CID).settings, enabledPacks: [] }, roster: [], packs: [], ...o });

/** A guest on a fresh device, driven by hand from the host's side. */
async function guestOn(o: { onRoster?: (r: unknown[]) => void } = {}) {
  const p = new Device(), raw = rawLink();
  const guest = new Guest(p.guestDeps(CODE, { playerId: 'A1', ...(o.onRoster && { onRoster: o.onRoster }) }));
  guest.connect(raw.link);
  return { p, raw, guest };
}

describe('M1: what an impostor host sends is shape-checked', () => {
  test('bad roster entries are dropped, and settings with a wrong value are not saved', async () => {
    const rosters: unknown[][] = [];
    const { p, raw, guest } = await guestOn({ onRoster: (r) => rosters.push(r) });
    const good = { id: 'x', ownerId: 'A1', name: 'Thorin', race: 'Dwarf', classes: 'Fighter 1', level: 1, hp: 12, maxHp: 12, conditions: [] };
    raw.deliver(welcome({ roster: [{}, good, { ...good, id: 'y', conditions: [1] }, { ...good, id: 'z', hp: 'lots' }] }));
    await settle(guest);
    expect(guest.status).toBe('online');
    expect(rosters).toEqual([[good]]);
    const before = JSON.stringify(p.campaigns.get(CID)!.settings);
    raw.deliver({ t: 'settings', campaign: { id: CID, name: 'Ravenloft', settings: { ...camp(CID).settings, hpMethod: 'max' }, enabledPacks: [] } });
    raw.deliver({ t: 'settings', campaign: { id: CID, name: 'Ravenloft', settings: { ...camp(CID).settings, initiativeModules: 'all' }, enabledPacks: [] } });
    await settle(guest);
    expect(JSON.stringify(p.campaigns.get(CID)!.settings)).toBe(before);
    raw.deliver({ t: 'settings', campaign: { id: CID, name: 'Ravenloft 2', settings: { ...camp(CID).settings, feats: false, extra: 'ignored' }, enabledPacks: [] } });
    await settle(guest);
    expect([p.campaigns.get(CID)!.name, p.campaigns.get(CID)!.settings.feats, 'extra' in p.campaigns.get(CID)!.settings]).toEqual(['Ravenloft 2', false, false]);
  });

  test('a welcome with damaged settings is ignored', async () => {
    const { p, raw, guest } = await guestOn();
    raw.deliver(welcome({ campaign: { id: CID, name: 'R', settings: { ...camp(CID).settings, encumbrance: 7 }, enabledPacks: [] } }));
    await settle(guest);
    expect([guest.status, p.campaigns.size]).toEqual(['connecting', 0]);
  });
});

describe('M3: a DM save outside the hosted campaign', () => {
  test('sends nothing at all (no roster rebuild)', async () => {
    const d = new Device();
    d.putCampaign(hosted({ A1: {} }));
    d.putCampaign(camp('other'));
    d.edit({ ...char('x', CID), ownerId: 'A1' });
    d.edit(char('o', 'other'));
    const host = new Host(d.hostDeps(CID));
    const g = new Guest(new Device().guestDeps(CODE, { playerId: 'A1' }));
    const down: string[] = [];
    connect(host, g, down);
    await settle(host, g);
    const n = down.length;
    host.characterChanged('o');
    await settle(host, g);
    expect(down.length).toBe(n);
    host.characterChanged('x'); // one of the campaign's: its owner gets it, everyone a roster
    await settle(host, g);
    expect(down.slice(n).map((m) => JSON.parse(m).t)).toEqual(['chars', 'roster']);
  });
});

describe('db', () => {
  beforeEach(resetDb);
  const joined = (): Campaign => ({ ...camp(CID), sync: { role: 'player', code: CODE, node: 'pnode001', playerId: 'A1' } });

  test('M4: a character moved into a joined campaign becomes that player’s, whatever owner it had', async () => {
    await db.campaigns.put(joined());
    await db.campaigns.put({ ...camp('c2'), sync: { role: 'player', code: 'OTHERCODE234', node: 'pnode002', playerId: 'B2' } });
    const c = await db.characters.put(char('m', 'c2'));
    expect(c.ownerId).toBe('B2');
    const moved = await db.characters.put({ ...c, campaignId: CID });
    expect(moved.ownerId).toBe('A1');
  });

  test('B2: a deleted id is not brought back: a late network save is dropped, a user save refused', async () => {
    await db.campaigns.put(hosted());
    const c = await db.characters.put(char('k', CID));
    await db.characters.delete('k');
    await db.characters.putSynced({ ...c, name: 'late merge' });
    expect(await db.characters.get('k')).toBeUndefined();
    await expect(db.characters.put({ ...c, name: 'open sheet autosave' })).rejects.toBeInstanceOf(DeletedError);
    expect(await db.characters.get('k')).toBeUndefined();
    expect((await db.trash.list(CID)).map((e) => e.character.name)).toEqual(['k']);
  });

  test('B7: a restore drops tombstones and trash entries for characters it makes live; Restore of a live one only clears its entry', async () => {
    await db.campaigns.put(hosted());
    const k = await db.characters.put(char('k', CID));
    await db.characters.put(char('gone', CID));
    await db.characters.delete('k'); // tombstoned, in the trash
    await db.characters.delete('gone');
    const file = {
      campaigns: [{ ...hosted(), sync: { ...hosted().sync!, deleted: { k: '001700000000000:000000:old00001', gone: '001700000000000:000000:old00001' } } }],
      characters: [{ ...k, name: 'k from the backup' }],
      items: [], packs: [], blobs: [],
      trash: { [CID]: [{ character: { ...k, name: 'k in the file trash' }, by: 'A1', at: 1 }] },
    };
    await db.restore(file);
    const sync = (await db.campaigns.get(CID))!.sync!;
    expect(Object.keys(sync.deleted ?? {}).sort()).toEqual(['gone']); // k is live: its tombstone went
    expect((await db.trash.list(CID)).map((e) => e.character.name).sort()).toEqual(['gone', 'k']); // the stored entries; the file's k entry was dropped
    expect(await db.trash.restore(CID, 'k')).toBe(false);
    expect((await db.characters.get('k'))!.name).toBe('k from the backup'); // not overwritten by the trashed copy
    expect((await db.trash.list(CID)).map((e) => e.character.id)).toEqual(['gone']);
  });

  test('B8: a restored character in a synced campaign gets fresh clocks, so its values win the next merge', async () => {
    await db.campaigns.put(hosted());
    const old = await db.characters.put(char('k', CID));
    const newer = await db.characters.put({ ...old, state: { ...old.state, hp: 9 } }); // a player device holds this one too
    await db.restore({ campaigns: [], characters: [old], items: [], packs: [], blobs: [] }); // back to hp 1, from an old file
    const restored = (await db.characters.get('k'))!;
    expect(restored.state.hp).toBe(1);
    expect(restored.sync!.clock['state.hp'] > newer.sync!.clock['state.hp']).toBe(true);
    expect(mergeCharacter(newer, restored).state.hp).toBe(1);
  });
});

describe('guest: B3 and B6', () => {
  test('B3: a far-future tombstone clock from the host is replaced by the local clock', async () => {
    const { p, raw, guest } = await guestOn();
    raw.deliver(welcome());
    await settle(guest);
    raw.deliver({ t: 'chars', characters: [{ ...char('x', CID), ownerId: 'A1' }] });
    await settle(guest);
    expect(p.char('x')).toBeTruthy();
    const evil = '999999999999999:000000:evil0001';
    raw.deliver({ t: 'deleteChar', id: 'x', at: evil });
    await settle(guest);
    const at = p.campaigns.get(CID)!.sync!.deleted!.x;
    expect(p.char('x')).toBeUndefined();
    expect(at).not.toBe(evil);
    expect(Number(at.slice(0, 15))).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('B6: a pack is stored under the offered hash, not the hash its chunks claim', async () => {
    const spell: Entity = { kind: 'spell', id: 'spell:brewed-bolt@MYBREW', name: 'Brewed Bolt', source: 'MYBREW', text: [{ p: 'Zap.' }], level: 1, school: 'evocation',
      castingTime: '1 action', range: '60 feet', components: { v: true }, duration: 'Instantaneous', concentration: false, ritual: false, classes: ['wizard'] } as Entity;
    const pack: Pack = { id: 'pack:MYBREW', name: 'Brew', source: 'MYBREW', homebrew: true, importedAt: 1, hash: 'stored', entities: [spell], patches: [] };
    const json = JSON.stringify(pack), hash = await sha256Text(json);
    const { p, raw, guest } = await guestOn();
    raw.deliver(welcome({ packs: [{ id: pack.id, hash, size: new TextEncoder().encode(json).length }] }));
    await settle(guest);
    raw.deliver({ t: 'packChunk', id: pack.id, hash: 'f'.repeat(64), seq: 0, total: 1, data: json });
    await settle(guest);
    expect(p.packs.get(pack.id)?.hash).toBe(hash);
  });
});

describe('R11: sidekick classes are for the DM', () => {
  const cls = (o: Partial<ClassDef>) => ({ kind: 'class', id: `class:${o.name}@X`, name: o.name, source: 'X', text: [], hitDie: 8, ...o }) as ClassDef;
  test('hidden from a player, offered to the DM; detected by the flag or by no hit die', () => {
    const all = [cls({ name: 'fighter', hitDie: 10 }), cls({ name: 'warrior', hitDie: 0 }), cls({ name: 'expert', sidekick: true })];
    expect(all.map(isSidekick)).toEqual([false, true, true]);
    expect(classesFor(all, false).map((k) => k.name)).toEqual(['fighter']);
    expect(classesFor(all, true).map((k) => k.name)).toEqual(['fighter', 'warrior', 'expert']);
  });
});
