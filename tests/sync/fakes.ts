// In-memory devices for the sync engine tests: each one stores like the db does (R2 putSynced, R4 kept sync, stamped user edits,
// delete tombstones), so a test can run a DM and several players in one process.
import type { RollEntry } from '../../src/lib/rolls.svelte.ts';
import { Guest, type GuestDeps } from '../../src/lib/sync/guest.ts';
import { Host, type HostDeps } from '../../src/lib/sync/host.ts';
import { hlcNow, hlcReceive } from '../../src/lib/sync/hlc.ts';
import { memoryPair, type Link } from '../../src/lib/sync/link.ts';
import { latestClock, rebase, stamp } from '../../src/lib/sync/merge.ts';
import type { Campaign, CampaignSync, Character, Pack, PackMeta } from '../../src/lib/types.ts';
import { fixtureIndex } from '../fixtures/content.ts';

const clone = <T>(x: T): T => (x === undefined ? x : structuredClone(x));

export class Device {
  campaigns = new Map<string, Campaign>();
  characters = new Map<string, Character>();
  packs = new Map<string, Pack>();
  other: unknown[] = []; // records the engine must never read (DM monsters, homebrew items)
  rolls: { e: RollEntry; from?: string }[] = [];
  errors: unknown[] = [];
  wall: () => number;
  constructor(wall: () => number = Date.now) { this.wall = wall; }

  putCampaign(c: Campaign): void {
    const had = this.campaigns.get(c.id);
    const { sync: _s, ...rest } = clone(c);
    const sync = had ? had.sync : c.sync;
    this.campaigns.set(c.id, { ...rest, ...(sync && { sync: clone(sync) }) });
  }
  updateSync(id: string, fn: (s: CampaignSync | undefined) => CampaignSync | undefined): void {
    const c = this.campaigns.get(id);
    if (!c) throw new Error('Campaign not found');
    const { sync: old, ...rest } = c;
    const sync = fn(clone(old));
    this.campaigns.set(id, { ...rest, ...(sync && { sync: clone(sync) }) });
  }
  #advance(campaignId: string | undefined, f: (s: CampaignSync) => string): string | undefined {
    const s = campaignId === undefined ? undefined : this.campaigns.get(campaignId)?.sync;
    if (!s) return undefined;
    return (s.last = f(s));
  }
  /** A user edit, stamped like db.characters.put. */
  edit(c: Character): void {
    const at = this.#advance(c.campaignId, (s) => hlcNow(s.node, s.last, this.wall()));
    const prev = this.characters.get(c.id);
    const rec = at ? stamp(prev, rebase(prev, c), at) : c;
    this.characters.set(c.id, clone({ ...rec, updatedAt: this.wall() }));
  }
  /** R2, like db.characters.putSynced. */
  putSynced(c: Character): void {
    this.#advance(c.campaignId, (s) => hlcReceive(s.node, s.last, latestClock(c), this.wall()));
    this.characters.set(c.id, clone({ ...c, updatedAt: this.wall() }));
  }
  /** Like db.characters.delete: a tombstone in a synced campaign. */
  deleteChar(id: string): void {
    const c = this.characters.get(id);
    const at = this.#advance(c?.campaignId, (s) => hlcNow(s.node, s.last, this.wall()));
    if (at) { const s = this.campaigns.get(c!.campaignId!)!.sync!; s.deleted = { ...s.deleted, [id]: at }; }
    this.characters.delete(id);
  }
  char(id: string): Character | undefined { return clone(this.characters.get(id)); }
  packMeta(): PackMeta[] {
    return [...this.packs.values()].map((p) => ({ id: p.id, name: p.name, source: p.source, importedAt: p.importedAt, hash: p.hash, counts: {}, ...(p.sharedBy !== undefined && { sharedBy: p.sharedBy }) }));
  }
  /** Everything stored, for "nothing changed" checks. */
  snapshot(): string { return JSON.stringify([[...this.campaigns], [...this.characters], [...this.packs]]); }

  hostDeps(campaignId: string): HostDeps {
    return {
      loadCampaign: async () => clone(this.campaigns.get(campaignId)),
      updateSync: async (fn) => this.updateSync(campaignId, (s) => fn(s!)),
      loadCharacters: async () => [...this.characters.values()].filter((c) => c.campaignId === campaignId).map(clone),
      loadCharacter: async (id) => this.char(id),
      saveCharacter: async (c) => this.putSynced(c),
      deleteCharacter: async (id) => this.deleteChar(id),
      index: fixtureIndex,
      packMeta: async () => this.packMeta(),
      loadPack: async (id) => clone(this.packs.get(id)),
      addRoll: (e, from) => { this.rolls.push({ e, from }); },
      onError: (e) => { this.errors.push(e); },
      now: this.wall,
    };
  }
  guestDeps(code: string, o: Partial<GuestDeps> = {}): GuestDeps {
    return {
      code,
      loadCampaign: async (id) => clone(this.campaigns.get(id)),
      saveCampaign: async (c) => this.putCampaign(c),
      updateSync: async (id, fn) => this.updateSync(id, fn),
      loadCharacters: async (cid) => [...this.characters.values()].filter((c) => c.campaignId === cid).map(clone),
      loadCharacter: async (id) => this.char(id),
      saveCharacter: async (c) => this.putSynced(c),
      deleteCharacter: async (id) => this.deleteChar(id),
      packMeta: async () => this.packMeta(),
      savePack: async (p) => { this.packs.set(p.id, clone(p)); },
      onRoll: (e, from) => { this.rolls.push({ e, from }); },
      onError: (e) => { this.errors.push(e); },
      now: this.wall,
      ...o,
    };
  }
}

/** Waits until every engine and memory link has gone quiet. */
export async function settle(...xs: { idle(): Promise<void> }[]): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await Promise.all(xs.map((x) => x.idle()));
    await new Promise((r) => setImmediate(r)); // not setTimeout: Windows timers tick every ~15 ms
  }
}

/** Wraps a link's send to record every message it sends (as JSON). */
export function tap(l: Link, log: string[]): Link {
  const send = l.send.bind(l);
  l.send = (m) => {
    if (log.length > 500) throw new Error('message storm: the two sides never settle'); // fails a sync loop instead of hanging
    log.push(JSON.stringify(m));
    send(m);
  };
  return l;
}

/** Connects a guest to the host over a memory pair. `down`: host→guest JSON; `up`: guest→host JSON. */
export function connect(host: Host, guest: Guest, down: string[] = [], up: string[] = []): [Link, Link] {
  const [h, g] = memoryPair();
  host.accept(tap(h, down));
  guest.connect(tap(g, up));
  return [h, g];
}

/** A link the test drives by hand: `deliver` hands the host any object as it is (no JSON), `got` is what the host sent. */
export function rawLink(): { link: Link; deliver(m: unknown): void; got: unknown[]; closed: () => boolean } {
  let onMsg: (m: unknown) => void = () => {};
  const onClose: (() => void)[] = [];
  let closed = false;
  const got: unknown[] = [];
  return {
    link: {
      id: 'raw', send: (m) => { if (!closed) got.push(JSON.parse(JSON.stringify(m))); },
      onMessage: (f) => { onMsg = f; }, onClose: (f) => { onClose.push(f); },
      close: () => { if (!closed) { closed = true; for (const f of onClose) f(); } },
    },
    deliver: (m) => { if (!closed) onMsg(m); },
    got,
    closed: () => closed,
  };
}
