import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { db, resetDb } from '../../src/lib/db.ts';
import { makeEntry } from '../../src/lib/items/inventory.ts';
import { characterProblem } from '../../src/lib/recordShape.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { hlcCompare, hlcNow } from '../../src/lib/sync/hlc.ts';
import { latestClock, mergeCharacter, stamp } from '../../src/lib/sync/merge.ts';
import { campaignForPlayers, characterForPlayer, packForPlayers, rosterEntry, unprojectCharacter } from '../../src/lib/sync/project.ts';
import type { Campaign, Entity, ItemDef, Pack } from '../../src/lib/types.ts';
import { fixtureIndex, mkChar } from '../fixtures/content.ts';
import { camp, char } from '../fixtures/records.ts';

const synced = (id: string): Campaign => ({ ...camp(id), sync: { role: 'dm', code: 'ABCDEFGHJKMN', node: 'dmnode01' } });

describe('db stamping (stage 3)', () => {
  beforeEach(resetDb);

  test('a put in a synced campaign stamps exactly the changed paths and saves the advanced clock', async () => {
    await db.campaigns.put(synced('c1'));
    await db.characters.put(char('a', 'c1'));
    const first = (await db.characters.get('a'))!;
    const at1 = (await db.campaigns.get('c1'))!.sync!.last!;
    expect(at1).toMatch(/:dmnode01$/);
    expect(new Set(Object.values(first.sync!.clock))).toEqual(new Set([at1]));
    expect(first.sync!.clock['state.hp']).toBe(at1);

    await db.characters.put({ ...first, state: { ...first.state, hp: 7 }, details: { ...first.details, notes: 'x' }, sync: undefined });
    const second = (await db.characters.get('a'))!;
    const at2 = (await db.campaigns.get('c1'))!.sync!.last!;
    expect(hlcCompare(at2, at1)).toBe(1);
    expect(Object.entries(second.sync!.clock).filter(([, v]) => v === at2).map(([k]) => k).sort()).toEqual(['details.notes', 'state.hp']);
    expect(Object.values(second.sync!.clock).every((v) => v === at1 || v === at2)).toBe(true);
  });

  test('a put outside a synced campaign adds no sync', async () => {
    await db.campaigns.put(camp('c2'));
    await db.characters.put(char('a', 'c2'));
    await db.characters.put(char('b'));
    expect((await db.characters.get('a'))!.sync).toBeUndefined();
    expect((await db.characters.get('b'))!.sync).toBeUndefined();
    expect((await db.campaigns.get('c2'))!.sync).toBeUndefined();
  });

  test('R2: merge → putSynced stores the merge as it is (no new clocks) and moves the clock past the remote one', async () => {
    await db.campaigns.put(synced('c1'));
    await db.characters.put(char('a', 'c1'));
    const local = (await db.characters.get('a'))!;
    const remoteAt = hlcNow('player01', undefined, Date.now() + 3_600_000); // a device an hour ahead
    const remote = stamp(local, { ...local, name: 'Theirs' }, remoteAt);
    const merged = mergeCharacter(local, remote);
    await db.characters.putSynced(merged);
    const stored = (await db.characters.get('a'))!;
    expect(stored.sync).toEqual(merged.sync);
    expect(stored.name).toBe('Theirs');
    expect(hlcCompare((await db.campaigns.get('c1'))!.sync!.last!, latestClock(remote))).toBe(1);
    // the next local edit is later than the remote one, so it wins
    await db.characters.put({ ...stored, name: 'Mine' });
    expect(mergeCharacter((await db.characters.get('a'))!, remote).name).toBe('Mine');
  });

  test('C1: a save from a copy loaded before a merge keeps the remote notes and entry, and its own hp', async () => {
    await db.campaigns.put(synced('c1'));
    await db.characters.put(char('a', 'c1'));
    const stale = (await db.characters.get('a'))!; // an open sheet holds this copy
    const remoteAt = hlcNow('player01', latestClock(stale), Date.now() + 1000);
    const added = makeEntry({ kind: 'item', id: 'item:rope@PHB', name: 'Rope', source: 'PHB', text: [], type: 'gear', magic: false });
    const remote = stamp(stale, { ...stale, details: { ...stale.details, notes: 'from the phone' }, inventory: [added] }, remoteAt);
    await db.characters.putSynced(mergeCharacter(stale, remote));
    await db.characters.put({ ...stale, state: { ...stale.state, hp: 9 } }); // damage applied from the stale copy
    const got = (await db.characters.get('a'))!;
    expect(got.details.notes).toBe('from the phone');
    expect(got.inventory.map((e) => e.id)).toEqual([added.id]);
    expect(got.state.hp).toBe(9);
    expect(got.sync!.gone).toEqual({});
    // and a deletion made on a copy that had the entry is still a deletion
    await db.characters.put({ ...got, inventory: [] });
    expect((await db.characters.get('a'))!.inventory).toEqual([]);
  });

  test('saveTogether (an item transfer) stamps the characters too', async () => {
    await db.campaigns.put(synced('c1'));
    await db.characters.put(char('a', 'c1'));
    const a = (await db.characters.get('a'))!;
    await db.saveTogether({ characters: [{ ...a, currency: { ...a.currency, gp: 5 } }], campaign: (await db.campaigns.get('c1'))! });
    const at = (await db.campaigns.get('c1'))!.sync!.last!;
    expect((await db.characters.get('a'))!.sync!.clock['currency.gp']).toBe(at);
  });
});

test('I2: recordShape accepts real clocks and rejects a future wall time, a value that sorts after every clock, and too many keys', () => {
  const ok = hlcNow('dmnode01', undefined, Date.now());
  const bad = (clock: Record<string, unknown>, gone: Record<string, unknown> = {}) => characterProblem({ ...char('a'), sync: { clock, gone } });
  expect(bad({ name: ok, 'order/e1': `${ok}/000003`, 'order/e2': '/000001' }, { e3: ok })).toBeUndefined();
  expect(bad({ name: hlcNow('n', undefined, Date.now() + 2 * 86_400_000) })).toBe('has damaged sync clocks');
  expect(bad({}, { e1: '999999999999999:000000:x' })).toBe('has damaged sync clocks');
  expect(bad({ 'state.hp': '~' })).toBe('has damaged sync clocks');
  expect(bad({ name: '' })).toBe('has damaged sync clocks');
  expect(bad({ name: 1 })).toBe('has damaged sync clocks');
  expect(bad(Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`inventory/${i}`, ok])))).toBe('has damaged sync clocks');
  expect(characterProblem({ ...char('a'), sync: { clock: {} } })).toBe('has damaged sync clocks');
});

describe('player projections', () => {
  test('campaignForPlayers has no loot and no sync', () => {
    const c = { ...synced('c1'), loot: [makeEntry({ kind: 'item', id: 'item:x@PHB', name: 'Secret Blade', source: 'PHB', text: [], type: 'weapon', magic: true })] };
    c.sync!.players = { A1: { name: 'Sam' } };
    const p = campaignForPlayers(c);
    expect(Object.keys(p).sort()).toEqual(['enabledPacks', 'id', 'name', 'settings']);
    const json = JSON.stringify(p);
    for (const secret of ['Secret Blade', 'ABCDEFGHJKMN', 'dmnode01', 'Sam', 'loot', 'sync']) expect(json).not.toContain(secret);
  });

  const spell = { kind: 'spell', id: 'spell:zap@PHB', name: 'Zap', source: 'PHB', text: [] } as unknown as Entity;
  const goblin = { kind: 'monster', id: 'monster:goblin@MM', name: 'Goblin', source: 'MM', text: [] } as unknown as Entity;
  const book = (o: Partial<Pack>): Pack => ({ id: 'p', name: 'Book', source: 'PHB', importedAt: 0, hash: 'h', entities: [], patches: [], ...o });

  test('packForPlayers drops monsters and monster patches; nothing left or a 2024 pack → undefined', () => {
    const p = packForPlayers(book({ entities: [spell, goblin], patches: [{ targetId: 'monster:goblin@MM', alias: 'MM', lair: [{ p: 'Lair' }] }, { targetId: 'spell:zap@PHB', alias: 'PHB', text: [] }] }))!;
    expect(p.entities.map((e) => e.id)).toEqual(['spell:zap@PHB']);
    expect(p.patches.map((x) => x.targetId)).toEqual(['spell:zap@PHB']);
    expect(JSON.stringify(p)).not.toContain('Goblin');
    expect(packForPlayers(book({ source: 'MM', entities: [goblin] }))).toBeUndefined();
    expect(packForPlayers(book({ source: 'XMM', entities: [{ ...goblin, id: 'item:thing@XMM', kind: 'item', source: 'XMM' } as unknown as Entity] }))).toBeUndefined();
  });

  test('characterForPlayer: a hidden-rarity, cover-named item leaves neither its real name nor its redacted text', () => {
    const potion: ItemDef = { kind: 'item', id: 'item:potion-of-venom@DMG', name: 'Potion of Venom', source: 'DMG', text: [{ p: 'Looks like healing. {{redact:r1}}It is deadly venom.{{/redact}}' }],
      type: 'potion', magic: true, rarity: 'uncommon', consumable: true };
    const c = stamp(undefined, { ...char('a', 'c1'), inventory: [makeEntry(potion, { sourceId: potion.id, view: { name: 'Cloudy red potion', hidden: ['rarity'], revealed: [] } })] }, hlcNow('n', undefined, 1));
    const out = characterForPlayer(c);
    const json = JSON.stringify(out);
    for (const secret of ['Venom', 'venom', 'deadly', 'uncommon']) expect(json).not.toContain(secret);
    expect(out.inventory[0].item.name).toBe('Cloudy red potion');
    expect(out.sync).toEqual(c.sync);
  });

  test('R8 unprojectCharacter: a player copy merged back keeps the real hidden item, its view, sourceId and hidden charges, and the play state', () => {
    const potion: ItemDef = { kind: 'item', id: 'item:potion-of-venom@DMG', name: 'Potion of Venom', source: 'DMG', text: [{ p: 'Looks like healing. {{redact:r1}}It is deadly venom.{{/redact}}' }],
      type: 'potion', magic: true, rarity: 'uncommon', consumable: true };
    const wand: ItemDef = { kind: 'item', id: 'item:wand-of-secrets@DMG', name: 'Wand of Secrets', source: 'DMG', text: [], type: 'wand', magic: true, charges: { max: 3, recharge: 'dawn' } };
    const view = { name: 'Zinc vial', hidden: ['rarity' as const], revealed: [] };
    const dm = stamp(undefined, { ...char('a', 'c1'), ownerId: 'A1', inventory: [
      makeEntry(potion, { sourceId: potion.id, view }),
      { ...makeEntry(wand, { view: { hidden: ['charges'], revealed: [] } }), chargesUsed: 2 },
    ] }, hlcNow('dmnode01', undefined, 1000));
    const sent = characterForPlayer(dm);
    expect(sent.inventory[1].chargesUsed).toBe(0);

    // unchanged copy: equal clocks would fall to the canonical tie-break, which the cover name can win
    expect(mergeCharacter(dm, unprojectCharacter(sent, dm)).inventory).toEqual(dm.inventory);
    expect(mergeCharacter(dm, sent).inventory[0].item.name).not.toBe('Potion of Venom'); // what R8 prevents

    // a player edit of both entries (quantity, notes) has the later clock
    const edited = stamp(sent, { ...sent, inventory: sent.inventory.map((e) => ({ ...e, quantity: 3, notes: 'mine' })) }, hlcNow('a1node01', undefined, 2000));
    const merged = mergeCharacter(dm, unprojectCharacter(edited, dm));
    expect(merged.inventory.map((e) => [e.item.name, e.quantity, e.notes, e.chargesUsed])).toEqual([['Potion of Venom', 3, 'mine', 0], ['Wand of Secrets', 3, 'mine', 2]]);
    expect(merged.inventory[0].view).toEqual(view);
    expect(merged.inventory[0].sourceId).toBe(potion.id);
    // an entry the DM never had stays as the player sent it
    const extra = makeEntry({ ...wand, id: 'item:stick@HOMEBREW', name: 'Stick', source: 'Homebrew' });
    expect(unprojectCharacter({ ...edited, inventory: [...edited.inventory, extra] }, dm).inventory[2]).toEqual(extra);
  });

  test('rosterEntry: name, race, "Fighter 3", level, HP and conditions, nothing else', () => {
    const c = { ...mkChar({ race: 'human', base: { con: 14 }, levels: ['fighter', 'fighter', 'fighter'] }), ownerId: 'A1', name: 'Bree' };
    c.state = { ...c.state, hp: 20, conditions: ['poisoned'] };
    const r = rosterEntry(c, fixtureIndex(), DEFAULT_SETTINGS);
    expect(r).toEqual({ id: 'char-fix', ownerId: 'A1', name: 'Bree', race: 'Human', classes: 'Fighter 3', level: 3, hp: 20, maxHp: 28, conditions: ['poisoned'] });
    expect(Object.keys(rosterEntry({ ...c, details: { ...c.details, portrait: 'abc' } }, fixtureIndex(), DEFAULT_SETTINGS))).toContain('portrait');
  });
});
