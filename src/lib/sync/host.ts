// Pure (no Svelte/Vite/DOM/PeerJS). The DM's side of a campaign session: it accepts links, admits players by join code, merges their
// characters with the DM's copies and sends back only player projections. Every guest message is validated (shape, ownership, size,
// 2024) before anything is stored. Storage, the content index and the clock are injected, so tests run it on fakes.
import { strip2024 } from '../character/strip2024.ts';
import type { ContentIndex } from '../content/index.ts';
import { idSource, is2024Source, restorablePack } from '../content/sources.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import type { Campaign, CampaignSync, Character, Pack, PackMeta } from '../types.ts';
import { newJoinCode, nextPlayerId, sha256Text } from './code.ts';
import { hlcNow, hlcReceive } from './hlc.ts';
import type { Link } from './link.ts';
import { canon, latestClock, mergeCharacter, type Synced } from './merge.ts';
import { campaignForPlayers, characterForPlayer, packForPlayers, rosterEntry, unprojectCharacter } from './project.ts';
import { cleanRoll, MAX_CHUNK, MAX_MESSAGE, MAX_PACK, parseGuestMessage, size, type GuestMsg, type HostMsg, type PackOffer } from './protocol.ts';

export interface HostDeps {
  /** The hosted campaign (its `sync.role` is 'dm'). */
  loadCampaign(): Promise<Campaign | undefined>;
  /** R4: read-modify-write of the campaign's sync (db.campaigns.updateSync). */
  updateSync(fn: (s: CampaignSync) => CampaignSync): Promise<void>;
  /** The campaign's characters. */
  loadCharacters(): Promise<Character[]>;
  loadCharacter(id: string): Promise<Character | undefined>;
  /** R2: stores a merged record without stamping it (db.characters.putSynced). */
  saveCharacter(c: Character): Promise<void>;
  /** Deletes a character, records its tombstone in campaign.sync.deleted and keeps it in the DM's trash (R9; db.characters.delete with `by`). */
  deleteCharacter(id: string, by: string): Promise<void>;
  index(): ContentIndex | Promise<ContentIndex>;
  /** Stored pack metadata (db.packs.listMeta) and packs (db.packs.get). */
  packMeta(): Promise<PackMeta[]>;
  loadPack(id: string): Promise<Pack | undefined>;
  /** A player's public roll, for the DM's log. */
  addRoll?(e: RollEntry, from: string): void;
  /** The connected players changed. */
  onChange?(): void;
  onError?(e: unknown): void;
  /** Wall clock in ms (default Date.now). */
  now?(): number;
}

interface Conn { link: Link; playerId?: string; name?: string; bad: number; closed: boolean; offered: Set<string>; streamed: Set<string>; packs: Promise<void> }

/**
 * Characters of pack JSON per chunk. Worst case a character takes 3 UTF-8 bytes (a quote or backslash escapes to 2, anything else in
 * the BMP is at most 3), so a chunk message stays under MAX_CHUNK with room for its envelope.
 */
const CHUNK_CHARS = 20_000;
const LOW_WATER = MAX_CHUNK * 4;
/** M6: a link that has not said hello by then is closed. */
export const HELLO_TIMEOUT = 15_000;

/** M4: chunk boundaries every CHUNK_CHARS, moved back one unit so a surrogate pair is never split (a binary transport would mangle each half). */
function cuts(json: string): number[] {
  const out = [0];
  while (out.at(-1)! < json.length) {
    let end = Math.min(out.at(-1)! + CHUNK_CHARS, json.length);
    const u = json.charCodeAt(end - 1);
    if (end < json.length && u >= 0xd800 && u <= 0xdbff) end--;
    out.push(end);
  }
  return out;
}

/** The campaign as players get it, its enabled packs cut to the ones they are offered (M2: no DM-only pack ids). */
const forPlayers = (camp: Campaign, offers: PackOffer[]) => {
  const ok = new Set(['srd', ...offers.map((o) => o.id)]);
  const c = campaignForPlayers(camp);
  return { ...c, enabledPacks: c.enabledPacks.filter((id) => ok.has(id)) };
};

/** A pack as players get it, serialized, with the hash and byte size of exactly that JSON (R6). Undefined when nothing may be sent. */
async function playerPack(p: Pack | undefined): Promise<{ json: string; offer: PackOffer } | undefined> {
  const fp = p && restorablePack(p) ? packForPlayers(p) : undefined; // never the built-in SRD; never monsters (packForPlayers)
  if (!fp) return undefined;
  const json = JSON.stringify(fp);
  return { json, offer: { id: fp.id, hash: await sha256Text(json), size: new TextEncoder().encode(json).length } };
}

/** Same record, ignoring updatedAt (the db sets it on every write). */
const same = (a: Character, b: Character) => canon({ ...a, updatedAt: 0 }) === canon({ ...b, updatedAt: 0 });

/** R52–R54/R60: a character carrying 2024 content: an embedded entity or item strip2024 would drop, or a 2024 id anywhere in its build. */
function has2024(c: Character): boolean {
  if (strip2024(c) !== c) return true;
  let bad = false;
  const hit = (s: unknown) => typeof s === 'string' && s.includes('@') && is2024Source(idSource(s));
  JSON.stringify(c.build, (k, v) => { if (hit(k) || hit(v)) bad = true; return v; });
  return bad;
}

const MAX_BAD = 3;

export class Host {
  #deps: HostDeps;
  #conns = new Set<Conn>();
  #queue: Promise<void> = Promise.resolve();

  constructor(deps: HostDeps) { this.#deps = deps; }

  /** Connected players: how many links each has, and the name they gave. */
  get players(): ReadonlyMap<string, { links: number; name?: string }> {
    const m = new Map<string, { links: number; name?: string }>();
    for (const c of this.#conns) if (c.playerId) m.set(c.playerId, { links: (m.get(c.playerId)?.links ?? 0) + 1, name: c.name ?? m.get(c.playerId)?.name });
    return m;
  }

  #offers = new Map<string, { key: string; offer?: PackOffer }>(); // by pack id; key = stored hash + import time

  /** Resolves once every queued message, task and pack stream has been handled (tests). */
  async idle(): Promise<void> {
    let q;
    do { q = this.#queue; await q; await Promise.all([...this.#conns].map((c) => c.packs)); } while (q !== this.#queue);
  }

  accept(link: Link): void {
    const conn: Conn = { link, bad: 0, closed: false, offered: new Set(), streamed: new Set(), packs: Promise.resolve() };
    setTimeout(() => { if (!conn.playerId && !conn.closed) this.#close(conn); }, HELLO_TIMEOUT);
    this.#conns.add(conn);
    link.onMessage((raw) => {
      if (conn.closed) return;
      if (size(raw) > MAX_MESSAGE) return this.#close(conn); // dropped, and the link closed at once
      void this.#task(() => this.#receive(conn, raw));
    });
    link.onClose(() => { conn.closed = true; if (this.#conns.delete(conn) && conn.playerId) this.#deps.onChange?.(); });
  }

  /** A new join code. Everyone connected is told and disconnected; the transport re-registers under the new peer id (Task 5). */
  rotateCode(): Promise<string> {
    return this.#task(async () => {
      const code = newJoinCode();
      await this.#deps.updateSync((s) => ({ ...s, code }));
      for (const c of [...this.#conns]) this.#close(c, 'code changed');
      return code;
    });
  }

  /** Marks the player ID removed (never reused) and disconnects its links. */
  removePlayer(id: string): void {
    void this.#task(async () => {
      await this.#deps.updateSync((s) => ({ ...s, players: { ...s.players, [id]: { ...s.players?.[id], removed: true } } }));
      for (const c of [...this.#conns]) if (c.playerId === id) this.#close(c, 'removed');
    });
  }

  /** The DM's own roll: sent to every player when public (R6: private rolls never leave). */
  broadcastRoll(e: RollEntry): void {
    const entry = cleanRoll(e);
    if (entry) this.#broadcast({ t: 'roll', entry });
  }

  /** The DM saved or deleted a character: its owner's links get the new projection (or the deletion), and everyone a new roster. */
  characterChanged(id: string): void {
    void this.#task(async () => {
      const camp = await this.#deps.loadCampaign();
      if (!camp) return;
      const c = await this.#deps.loadCharacter(id);
      if (c?.campaignId === camp.id) {
        const p = characterForPlayer(c);
        for (const k of this.#conns) if (k.playerId && k.playerId === c.ownerId) this.#send(k, { t: 'chars', characters: [p] });
      } else {
        const del = camp.sync?.deleted;
        if (del && Object.hasOwn(del, id)) this.#broadcast({ t: 'deleteChar', id, at: del[id] });
      }
      await this.#sendRoster();
    });
  }

  /** The DM changed the campaign's name or settings. */
  campaignChanged(): void {
    void this.#task(async () => {
      const camp = await this.#deps.loadCampaign();
      if (camp) this.#broadcast({ t: 'settings', campaign: forPlayers(camp, await this.#packOffers(camp)) });
    });
  }

  stop(): void {
    for (const c of [...this.#conns]) this.#close(c, 'host stopped');
  }

  /** Runs `f` after everything queued before it: messages are handled one at a time, in order. */
  #task<T>(f: () => Promise<T>): Promise<T> {
    const p = this.#queue.then(f);
    this.#queue = p.then(() => undefined, (e) => (this.#deps.onError ?? console.warn)(e));
    return p;
  }

  #send(c: Conn, msg: HostMsg): void {
    if (c.closed) return;
    if (size(msg) > MAX_MESSAGE) return (this.#deps.onError ?? console.warn)(new Error(`A ${msg.t} message is over the size limit and was not sent.`));
    c.link.send(msg);
  }

  /** To every admitted link, except `but`. */
  #broadcast(msg: HostMsg, but?: Conn): void {
    for (const c of this.#conns) if (c.playerId && c !== but) this.#send(c, msg);
  }

  #close(c: Conn, bye?: string): void {
    if (bye) this.#send(c, { t: 'bye', reason: bye });
    c.closed = true;
    if (this.#conns.delete(c) && c.playerId) this.#deps.onChange?.();
    c.link.close();
  }

  /** A refused message: dropped, counted, and the link closed after the third. */
  #violation(c: Conn, why: string): void {
    (this.#deps.onError ?? console.warn)(new Error(`Refused a message from ${c.playerId ?? 'a new link'}: ${why}`));
    if (++c.bad >= MAX_BAD) this.#close(c, 'too many bad messages');
  }

  async #receive(c: Conn, raw: unknown): Promise<void> {
    const msg = parseGuestMessage(raw);
    if ('error' in msg) return this.#violation(c, msg.error);
    if (!c.playerId) return msg.t === 'hello' ? this.#hello(c, msg) : this.#violation(c, 'no hello yet');
    switch (msg.t) {
      case 'hello': return this.#violation(c, 'a second hello');
      case 'chars': return this.#chars(c, c.playerId, msg.characters);
      case 'deleteChar': return this.#deleteChar(c, c.playerId, msg.id, msg.at);
      case 'roll':
        this.#deps.addRoll?.(msg.entry, c.playerId);
        return this.#broadcast({ t: 'roll', entry: msg.entry, from: c.playerId }, c);
      case 'packWant': return this.#packWant(c, msg.ids);
    }
  }

  async #hello(c: Conn, msg: Extract<GuestMsg, { t: 'hello' }>): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const sync = camp?.sync;
    if (!camp || sync?.role !== 'dm' || msg.code !== sync.code) return this.#reject(c, 'wrong code');
    const players = sync.players ?? {};
    if (msg.playerId !== undefined && (!Object.hasOwn(players, msg.playerId) || players[msg.playerId].removed)) {
      return this.#reject(c, Object.hasOwn(players, msg.playerId) ? 'removed' : 'unknown player');
    }
    let id = msg.playerId;
    if (id === undefined || (msg.name && msg.name !== players[id].name)) {
      await this.#deps.updateSync((s) => {
        id ??= nextPlayerId(Object.keys(s.players ?? {}));
        return { ...s, players: { ...s.players, [id]: { ...s.players?.[id], ...(msg.name && { name: msg.name }) } } };
      });
    }
    if (c.closed) return;
    c.playerId = id!;
    c.name = msg.name ?? players[id!]?.name;
    this.#deps.onChange?.();
    const packs = await this.#packOffers(camp);
    c.offered = new Set(packs.map((p) => p.id));
    this.#send(c, { t: 'welcome', playerId: c.playerId, campaign: forPlayers(camp, packs), roster: await this.#roster(camp), packs });
    for (const ch of await this.#deps.loadCharacters()) if (ch.ownerId === c.playerId) this.#send(c, { t: 'chars', characters: [characterForPlayer(ch)] });
  }

  #reject(c: Conn, reason: string): void {
    this.#send(c, { t: 'rejected', reason });
    this.#close(c);
  }

  async #chars(c: Conn, pid: string, list: Synced<Character>[]): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const sync = camp?.sync;
    if (!camp || !sync) return;
    const stored = await Promise.all(list.map((ch) => this.#deps.loadCharacter(ch.id)));
    // All checks first: one bad character refuses the whole message, so nothing of it is stored.
    for (const [i, ch] of list.entries()) {
      const s = stored[i];
      if (ch.ownerId !== pid || ch.campaignId !== camp.id || (s && (s.ownerId !== pid || s.campaignId !== camp.id))) return this.#violation(c, 'not their character');
      if (has2024(ch)) return this.#violation(c, '2024 content');
    }
    let rosterChanged = false;
    for (const [i, ch] of list.entries()) {
      const s = stored[i];
      if (sync.deleted && Object.hasOwn(sync.deleted, ch.id)) { this.#send(c, { t: 'deleteChar', id: ch.id, at: sync.deleted[ch.id] }); continue; }
      // R8: the player's copy holds player views; the DM's real items, views and hidden charge counts go back in before the merge.
      const incoming = s ? unprojectCharacter(ch, s) : ch;
      let merged = mergeCharacter(s ?? incoming, incoming);
      // Where the player's clock won but the DM's real entry projects differently from what the player sent (a revealed field, an
      // item the player tried to rewrite), the DM's entry gets a new clock, so the player's copy takes it instead of tying forever.
      const sent = new Map(ch.inventory.map((e) => [e.id, e]));
      const stale = characterForPlayer(merged).inventory.filter((e) => {
        const x = sent.get(e.id), path = `inventory/${e.id}`;
        return x && canon(x) !== canon(e) && (merged.sync!.clock[path] ?? '') === (ch.sync?.clock[path] ?? '');
      });
      if (stale.length) {
        const last = [sync.last ?? '', latestClock(merged)].sort().pop();
        const at = hlcNow(sync.node, last, this.#deps.now?.());
        merged = { ...merged, sync: { ...merged.sync!, clock: { ...merged.sync!.clock, ...Object.fromEntries(stale.map((e) => [`inventory/${e.id}`, at])) } } };
      }
      const changed = !s || !same(merged, s);
      if (changed) await this.#deps.saveCharacter(merged);
      const p = characterForPlayer(merged);
      const echo = !same(p, ch);
      for (const k of this.#conns) if (k.playerId === pid && (k === c ? echo : changed)) this.#send(k, { t: 'chars', characters: [p] });
      rosterChanged ||= changed;
    }
    if (rosterChanged) await this.#sendRoster(camp);
  }

  async #deleteChar(c: Conn, pid: string, id: string, at: string): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const s = await this.#deps.loadCharacter(id);
    if (!camp || !s) return; // never reached the DM (or already gone): nothing to delete
    if (s.ownerId !== pid || s.campaignId !== camp.id) return this.#violation(c, 'not their character');
    // A change the DM's copy holds from after the deletion (or a restore, R9) wins: the player's device gets the character back.
    if (at <= latestClock(s)) return this.#send(c, { t: 'chars', characters: [characterForPlayer(s)] });
    await this.#deps.updateSync((x) => ({ ...x, last: hlcReceive(x.node, x.last, at, this.#deps.now?.()) })); // a restore must stamp later than this
    await this.#deps.deleteCharacter(id, pid); // R9: kept in the DM's trash
    const tomb = (await this.#deps.loadCampaign())?.sync?.deleted?.[id] ?? at;
    this.#broadcast({ t: 'deleteChar', id, at: tomb }, c);
    await this.#sendRoster();
  }

  /** The campaign's enabled packs that players may have, with the hash and size of what would be sent. Cached per stored pack version. */
  async #packOffers(camp: Campaign): Promise<PackOffer[]> {
    const metas = new Map((await this.#deps.packMeta()).map((m) => [m.id, m]));
    const out: PackOffer[] = [];
    for (const id of camp.enabledPacks) {
      const m = metas.get(id);
      if (!m) continue;
      const key = `${m.hash}|${m.importedAt}`;
      let hit = this.#offers.get(id);
      if (hit?.key !== key) this.#offers.set(id, hit = { key, offer: (await playerPack(await this.#deps.loadPack(id)))?.offer });
      if (hit.offer && hit.offer.size <= MAX_PACK) out.push(hit.offer);
    }
    return out;
  }

  /** Only packs offered to this link in its welcome. Streams run one at a time per link, beside the message queue. */
  #packWant(c: Conn, ids: string[]): void {
    if (ids.some((id) => !c.offered.has(id))) return this.#violation(c, 'a pack that was not offered');
    if (ids.some((id) => c.streamed.has(id))) return this.#violation(c, 'a pack it already asked for'); // M5: each pack once per link
    for (const id of new Set(ids)) {
      c.streamed.add(id);
      c.packs = c.packs.then(() => this.#stream(c, id)).catch((e) => (this.#deps.onError ?? console.warn)(e));
    }
  }

  async #stream(c: Conn, id: string): Promise<void> {
    const pp = await playerPack(await this.#deps.loadPack(id));
    if (!pp || pp.offer.size > MAX_PACK || c.closed) return;
    const { json, offer: { hash } } = pp;
    const at = cuts(json), total = Math.max(1, at.length - 1);
    for (let seq = 0; seq < total && !c.closed; seq++) {
      await this.#drained(c);
      this.#send(c, { t: 'packChunk', id, hash, seq, total, data: json.slice(at[seq], at[seq + 1] ?? json.length) });
    }
  }

  /**
   * Flow control (R1): resolves once the transport's send buffer is low or the link closed. One onDrain listener per wait (M5), and a
   * re-check every 100 ms in case a drain event is missed.
   */
  #drained(c: Conn): Promise<void> {
    const full = () => !c.closed && (c.link.bufferedAmount?.() ?? 0) > LOW_WATER;
    if (!full()) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>, done = false;
      const check = () => {
        if (done) return; // a late drain event after the wait ended
        clearTimeout(timer);
        if (full()) timer = setTimeout(check, 100);
        else { done = true; resolve(); }
      };
      c.link.onDrain?.(check);
      check();
    });
  }

  async #roster(camp: Campaign) {
    const index = await this.#deps.index();
    return (await this.#deps.loadCharacters()).filter((ch) => ch.campaignId === camp.id).map((ch) => rosterEntry(ch, index, camp.settings));
  }

  async #sendRoster(camp?: Campaign): Promise<void> {
    camp ??= await this.#deps.loadCampaign();
    if (camp && [...this.#conns].some((c) => c.playerId)) this.#broadcast({ t: 'roster', roster: await this.#roster(camp) });
  }
}
