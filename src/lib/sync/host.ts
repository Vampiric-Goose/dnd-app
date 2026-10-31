// Pure (no Svelte/Vite/DOM/PeerJS). The DM's side of a campaign session: it accepts links, admits players by join code, merges their
// characters with the DM's copies and sends back only player projections. Every guest message is validated (shape, ownership, size,
// 2024) before anything is stored. Storage, the content index and the clock are injected, so tests run it on fakes.
import { strip2024 } from '../character/strip2024.ts';
import type { ContentIndex } from '../content/index.ts';
import { idSource, is2024Source } from '../content/sources.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import type { Campaign, CampaignSync, Character } from '../types.ts';
import { newJoinCode, nextPlayerId } from './code.ts';
import { hlcNow } from './hlc.ts';
import type { Link } from './link.ts';
import { canon, latestClock, mergeCharacter, type Synced } from './merge.ts';
import { campaignForPlayers, characterForPlayer, rosterEntry, unprojectCharacter } from './project.ts';
import { cleanRoll, MAX_MESSAGE, parseGuestMessage, size, type GuestMsg, type HostMsg } from './protocol.ts';

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
  /** Deletes a character and records its tombstone in campaign.sync.deleted (db.characters.delete does both). */
  deleteCharacter(id: string): Promise<void>;
  index(): ContentIndex | Promise<ContentIndex>;
  /** A player's public roll, for the DM's log. */
  addRoll?(e: RollEntry, from: string): void;
  /** The connected players changed. */
  onChange?(): void;
  onError?(e: unknown): void;
  /** Wall clock in ms (default Date.now). */
  now?(): number;
}

interface Conn { link: Link; playerId?: string; name?: string; bad: number; closed: boolean }

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

  /** Resolves once every queued message and task has been handled (tests). */
  async idle(): Promise<void> {
    let q;
    do { q = this.#queue; await q; } while (q !== this.#queue);
  }

  accept(link: Link): void {
    const conn: Conn = { link, bad: 0, closed: false };
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
      if (camp) this.#broadcast({ t: 'settings', campaign: campaignForPlayers(camp) });
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
      case 'deleteChar': return this.#deleteChar(c, c.playerId, msg.id);
      case 'roll':
        this.#deps.addRoll?.(msg.entry, c.playerId);
        return this.#broadcast({ t: 'roll', entry: msg.entry, from: c.playerId }, c);
      case 'packWant': return; // Task 4
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
    this.#send(c, { t: 'welcome', playerId: c.playerId, campaign: campaignForPlayers(camp), roster: await this.#roster(camp), packs: [] });
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

  async #deleteChar(c: Conn, pid: string, id: string): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const s = await this.#deps.loadCharacter(id);
    if (!camp || !s) return; // never reached the DM (or already gone): nothing to delete
    if (s.ownerId !== pid || s.campaignId !== camp.id) return this.#violation(c, 'not their character');
    await this.#deps.deleteCharacter(id);
    const at = (await this.#deps.loadCampaign())?.sync?.deleted?.[id] ?? '';
    this.#broadcast({ t: 'deleteChar', id, at }, c);
    await this.#sendRoster();
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
