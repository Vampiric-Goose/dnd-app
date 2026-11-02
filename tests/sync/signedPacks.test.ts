import { describe, expect, test } from 'vitest';
import { Guest } from '../../src/lib/sync/guest.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { newKey, publicText, sign } from '../../src/lib/sync/signing.ts';
import type { Campaign, Entity, Pack } from '../../src/lib/types.ts';
import { camp } from '../fixtures/records.ts';
import { connect, Device, rawLink, settle } from './fakes.ts';

// "Your copy wins" (the user's ruling, 11-02): a player whose device holds a trusted signing key sends its own imported books when the DM's
// copy differs; the DM's device takes one only when the signature checks against a trusted key, the book is one the DM's device has, and it
// is newer than the last signed copy it took. Its sharing then carries the fix to every other player.
const CODE = 'ABCDEFGHJKMN', CID = 'c1';
const spell = (classes: string[]): Entity => ({ kind: 'spell', id: 'spell:catapult@XGE', name: 'Catapult', source: 'XGE', text: [{ p: 'Fling.' }], level: 1, school: 'transmutation',
  castingTime: '1 action', range: '60 feet', components: { s: true }, duration: 'Instantaneous', concentration: false, ritual: false, classes }) as Entity;
const xge = (classes: string[], hash: string): Pack => ({ id: 'pack:XGE', name: 'XGE', source: 'XGE', importedAt: 1, hash, entities: [spell(classes)], patches: [] });

async function setup(o: { trust?: boolean } = {}) {
  const dm = new Device();
  dm.packs.set('pack:XGE', xge([], 'damaged'));
  dm.putCampaign({ ...camp(CID), enabledPacks: ['pack:XGE'], sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {} } } } as Campaign);
  const key = await newKey(), trusted = o.trust === false ? [] : [await publicText(key.publicKey)];
  const host = new Host({ ...dm.hostDeps(CID), trusted });
  const me = new Device();
  me.packs.set('pack:XGE', xge(['wizard', 'sorcerer'], 'good')); // my own import (no sharedBy)
  const guest = new Guest(me.guestDeps(CODE, { playerId: 'A1', signingKey: async () => key, trusted }));
  return { dm, host, me, guest, key, trusted };
}
const classesOn = (d: Device) => (d.packs.get('pack:XGE')!.entities[0] as { classes: string[] }).classes;

describe('signed books win over the DM\'s copy', () => {
  test('a trusted player joins: their copy replaces the DM\'s damaged one; the same copy is not sent twice', async () => {
    const { dm, host, me, guest, key, trusted } = await setup();
    const up: string[] = [];
    const [, g] = connect(host, guest, [], up);
    await settle(host, guest);
    expect(classesOn(dm)).toEqual(['wizard', 'sorcerer']);
    expect(dm.packs.get('pack:XGE')!.sharedBy).toBeUndefined();
    expect(up.some((s) => JSON.parse(s).t === 'signedChunk')).toBe(true);
    g.close();
    const up2: string[] = [], again = new Guest(me.guestDeps(CODE, { playerId: 'A1', signingKey: async () => key, trusted }));
    connect(host, again, [], up2);
    await settle(host, again);
    expect(up2.some((s) => JSON.parse(s).t === 'signedChunk')).toBe(false); // the DM's copy is mine now
  });
  test('an untrusted key sends nothing, and a forged or replayed book is refused', async () => {
    const { dm, host, guest } = await setup({ trust: false });
    const up: string[] = [];
    connect(host, guest, [], up);
    await settle(host, guest);
    expect(up.some((s) => JSON.parse(s).t === 'signedChunk')).toBe(false);
    expect(classesOn(dm)).toEqual([]);
  });
  test('the DM\'s device checks: the signature, a book it has, and newer than the last it took', async () => {
    const { dm, host, key } = await setup();
    const r = rawLink();
    host.accept(r.link);
    r.deliver({ t: 'hello', code: CODE, playerId: 'A1' });
    await settle(host);
    const push = async (p: Pack, at: number, sig?: string) => {
      const json = JSON.stringify(p);
      r.deliver({ t: 'signedChunk', id: p.id, at, sig: sig ?? await sign(key.privateKey, at, json), seq: 0, total: 1, data: json });
      await settle(host);
    };
    const other = await newKey();
    await push(xge(['bard'], 'x'), 500, await sign(other.privateKey, 500, JSON.stringify(xge(['bard'], 'x')))); // forged
    expect(classesOn(dm)).toEqual([]);
    await push({ ...xge(['bard'], 'y'), id: 'pack:TCE', name: 'TCE', source: 'TCE' }, 600); // a book the DM doesn't have
    expect(dm.packs.has('pack:TCE')).toBe(false);
    await push(xge(['wizard'], 'z'), 700);
    expect(classesOn(dm)).toEqual(['wizard']);
    await push(xge(['bard'], 'old'), 650); // replayed older copy
    expect(classesOn(dm)).toEqual(['wizard']);
  });
});
