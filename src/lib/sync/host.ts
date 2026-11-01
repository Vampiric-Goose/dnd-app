// Pure (no Svelte/Vite/DOM/PeerJS). The DM's side of a campaign session: it accepts links, admits players by join code, merges their
// characters with the DM's copies and sends back only player projections. Every guest message is validated (shape, ownership, size,
// 2024) before anything is stored. Storage, the content index and the clock are injected, so tests run it on fakes.
import { strip2024 } from '../character/strip2024.ts';
import type { ContentIndex } from '../content/index.ts';
import { idSource, is2024Source, restorablePack } from '../content/sources.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import { toBase64 } from '../base64.ts';
import { addDash, budgetApplies, combatantForToken, PLAYER_DASHES, recordMove } from '../combat/movement.ts';
import { moveTokens } from '../map/scene.ts';
import { ActionBoard, actionProblem, actionsForPlayers, expiry, type ActionRequest, type DeclaredAction, type PlayerAction } from '../map/actions.ts';
import type { Campaign, CampaignSync, Character, Combat, Pack, PackMeta, Scene } from '../types.ts';
import { newJoinCode, nextPlayerId, sha256Text } from './code.ts';
import { hlcNow, hlcReceive, MAX_AHEAD } from './hlc.ts';
import type { Link } from './link.ts';
import { canon, latestClock, mergeCharacter, type Synced } from './merge.ts';
import { campaignForPlayers, characterForPlayer, currentActor, packForPlayers, rosterEntry, trackerForPlayers, unprojectCharacter, type TrackerView } from './project.ts';
import { uid } from '../uid.ts';
import { BLOB_CHUNK, cleanRoll, IMAGE_TYPES, MAX_BLOB, MAX_CHUNK, MAX_MESSAGE, MAX_PACK, parseGuestMessage, size, type GuestMsg, type HostMsg, type PackOffer } from './protocol.ts';
import { moveCost, moveProblem, sceneBlobs, sceneForPlayers, type PlayerScene } from './scene.ts';

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
  /** I2: the DM's trash is full (TRASH_CAP): a player's delete is then refused, so it can never push older deleted characters out. */
  trashFull?(): Promise<boolean>;
  index(): ContentIndex | Promise<ContentIndex>;
  /** Stored pack metadata (db.packs.listMeta) and packs (db.packs.get). */
  packMeta(): Promise<PackMeta[]>;
  loadPack(id: string): Promise<Pack | undefined>;
  /** A player's public roll, for the DM's log. */
  addRoll?(e: RollEntry, from: string): void;
  /** Stage 4: the campaign's live combat (db.combat.get). Without it no tracker is sent. */
  loadCombat?(): Promise<Combat | undefined>;
  /** Stage 4: a player's initiative roll for their own character in this campaign (shape and owner checked; the store checks the fit). */
  onInitiative?(characterId: string, total: number, from: string): void;
  /** A read-modify-write of the existing live combat (db.combat.update; none: nothing happens). Its change re-sends the tracker. */
  updateCombat?(fn: (c: Combat) => Combat): Promise<Combat | undefined>;
  /** Stage 5: the campaign's shown scene (db.scenes.shown). Without it no scene is sent. */
  loadScene?(): Promise<Scene | undefined>;
  /** Stage 5: a player's move, a read-modify-write of the fresh record (db.scenes.update, a network write: not reported). */
  updateScene?(id: string, fn: (s: Scene) => Scene): Promise<Scene | undefined>;
  /** Stage 5: a stored image (db.blobs). */
  loadBlob?(hash: string): Promise<{ type: string; data: ArrayBuffer } | undefined>;
  /** Declared actions: the DM's board changed (every action, for the DM's own map). */
  onActions?(list: DeclaredAction[]): void;
  /** The connected players changed. */
  onChange?(): void;
  onError?(e: unknown): void;
  /** Wall clock in ms (default Date.now). */
  now?(): number;
}

interface Conn { link: Link; playerId?: string; name?: string; bad: number; closed: boolean; offered: Set<string>; streamed: Set<string>; packs: Promise<void>; tracker?: string /* JSON of the last tracker sent (M1) */;
  scene?: string /* JSON of the last scene sent */; seen: Set<string> /* blobs offered in any scene sent */; blobs: Set<string> /* blobs streamed */;
  actions?: string /* JSON of the last declared actions sent */ }

/**
 * Characters of pack JSON per chunk. Worst case a character takes 3 UTF-8 bytes (a quote or backslash escapes to 2, anything else in
 * the BMP is at most 3), so a chunk message stays under MAX_CHUNK with room for its envelope.
 */
const CHUNK_CHARS = 20_000;
const LOW_WATER = MAX_CHUNK * 4;
/** M6: a link that has not said hello by then is closed. */
export const HELLO_TIMEOUT = 15_000;
/** A pack stream whose send buffer has not drained for this long is dropped. */
export const STALL_TIMEOUT = 60_000;
/** B1: live characters per player in the campaign; a new one beyond that is a violation. */
export const MAX_CHARACTERS = 30;

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
    const conn: Conn = { link, bad: 0, closed: false, offered: new Set(), streamed: new Set(), packs: Promise.resolve(), seen: new Set(), blobs: new Set() };
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
  removePlayer(id: string): Promise<void> {
    return this.#task(async () => {
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
        if (!del || !Object.hasOwn(del, id)) return; // M3: not this campaign's: nothing to send, the roster is unchanged
        this.#broadcast({ t: 'deleteChar', id, at: del[id] });
      }
      await this.#sendRoster(camp);
      await this.#trackerIfFighting(camp, [id]);
      await this.#sceneIfLinked(camp, [id]);
    });
  }

  /** The DM changed the campaign's name or settings (the tracker too: the health words follow the settings). */
  campaignChanged(): void {
    void this.#task(async () => {
      const camp = await this.#deps.loadCampaign();
      if (!camp) return;
      this.#broadcast({ t: 'settings', campaign: forPlayers(camp, await this.#packOffers(camp)) });
      const combat = await this.#deps.loadCombat?.();
      if (combat) await this.#sendTracker(camp, combat);
      await this.#sendScene(camp);
    });
  }

  /** Stage 4: the combat changed (or ended): everyone gets the new player tracker. */
  trackerChanged(): void {
    void this.#task(async () => {
      const camp = await this.#deps.loadCampaign();
      if (camp && this.#deps.loadCombat) await this.#sendTracker(camp, await this.#deps.loadCombat());
      if (camp && this.#board.onCombat(await this.#deps.loadCombat?.())) this.#deps.onActions?.(this.#board.list()); // a turn ended: its arrows go
      if (camp) await this.#sendScene(camp); // health words and conditions follow the fight
    });
  }

  /** Stage 5: the shown scene changed (or another is shown, or none): everyone gets the new player scene. */
  sceneChanged(): void {
    void this.#task(async () => {
      const camp = await this.#deps.loadCampaign();
      if (camp && this.#board.onScene((await this.#deps.loadScene?.())?.id)) this.#deps.onActions?.(this.#board.list());
      if (camp) await this.#sendScene(camp);
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
      case 'initiative': return this.#initiative(c, c.playerId, msg.characterId, msg.total);
      case 'move': return this.#move(c, c.playerId, msg);
      case 'blobWant': return this.#blobWant(c, msg.hashes);
      case 'dash': return this.#dash(c, c.playerId, msg.characterId);
      case 'action': return this.#action(c, c.playerId, msg.action);
      case 'clearAction': return this.#actionsChanged(this.#board.clear(c.playerId));
    }
  }

  /** Only the owner's (else a violation), on their turn as players see it while a budget applies, at most PLAYER_DASHES a turn, checked on the fresh combat; else ignored. */
  async #dash(c: Conn, pid: string, id: string): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const ch = await this.#deps.loadCharacter(id);
    if (!camp || !ch || ch.ownerId !== pid || ch.campaignId !== camp.id) return this.#violation(c, 'not their character');
    const chars = (await this.#deps.loadCharacters()).filter((x) => x.campaignId === camp.id);
    await this.#deps.updateCombat?.((k) => {
      const x = budgetApplies(k, camp.settings) && currentActor(trackerForPlayers(k, chars, camp.settings)) === id ? combatantForToken(k, { characterId: id }) : undefined;
      return x ? addDash(k, x.id, PLAYER_DASHES) : k; // one a turn from the player's button; a second is ignored quietly
    });
  }

  /** Review Focus 4: only for the player's own character in this campaign. Whether it fits the fight is the store's check. */
  async #initiative(c: Conn, pid: string, id: string, total: number): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const ch = await this.#deps.loadCharacter(id);
    if (!camp || !ch || ch.ownerId !== pid || ch.campaignId !== camp.id) return this.#violation(c, 'not their character');
    this.#deps.onInitiative?.(id, total, pid);
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
    // I1: always (null with no fight), so a player who was offline when the fight ended drops their stale tracker
    if (this.#deps.loadCombat) this.#sendTrackerTo(c, (await this.#tracker(camp, await this.#deps.loadCombat()))(c.playerId));
    if (this.#deps.loadScene) {
      const view = await this.#scene(camp);
      this.#sendSceneTo(c, view); // always (null with none), as the tracker
      this.#sendActionsTo(c, actionsForPlayers(this.#board.list(), view)); // always ([] with none), so stale arrows go
    }
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
    let fresh = 0;
    for (const [i, ch] of list.entries()) {
      if (ch.ownerId !== pid || ch.campaignId !== camp.id) return this.#violation(c, 'not their character');
      if (has2024(ch)) return this.#violation(c, '2024 content');
      if (!stored[i] && !Object.hasOwn(sync.deleted ?? {}, ch.id)) fresh++;
    }
    // B1: a cap on live characters per player, so a leaked code cannot fill the DM's storage (or trash, through deletes).
    if (fresh && (await this.#deps.loadCharacters()).filter((x) => x.ownerId === pid && x.campaignId === camp.id).length + fresh > MAX_CHARACTERS) {
      return this.#violation(c, `more than ${MAX_CHARACTERS} characters`);
    }
    let rosterChanged = false;
    for (const [i, ch] of list.entries()) {
      const s = stored[i];
      // M1: the DM reassigned it or moved it out of the campaign. Not a violation: that device just has not heard yet.
      if (s && (s.ownerId !== pid || s.campaignId !== camp.id)) { this.#send(c, { t: 'notYours', id: ch.id }); continue; }
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
    if (rosterChanged) {
      await this.#sendRoster(camp);
      await this.#trackerIfFighting(camp, list.map((ch) => ch.id)); // a player's own HP change shows on everyone's tracker
      await this.#sceneIfLinked(camp, list.map((ch) => ch.id));
    }
  }

  async #deleteChar(c: Conn, pid: string, id: string, at: string): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const s = await this.#deps.loadCharacter(id);
    if (!camp || !s) return; // never reached the DM (or already gone): nothing to delete
    if (s.ownerId !== pid || s.campaignId !== camp.id) return this.#send(c, { t: 'notYours', id }); // M1, as in #chars
    // A wall time past MAX_AHEAD (a skewed or crafted clock) counts as a delete made now, so it can't pin this character's clocks.
    const now = this.#deps.now?.() ?? Date.now();
    if (Number(at.slice(0, 15)) > now + MAX_AHEAD) at = hlcNow(camp.sync!.node, camp.sync?.last, now);
    // A change the DM's copy holds from after the deletion (or a restore, R9) wins: the player's device gets the character back.
    if (at <= latestClock(s)) return this.#send(c, { t: 'chars', characters: [characterForPlayer(s)] });
    if (await this.#deps.trashFull?.()) {
      // I2: refused. The character gets a clock later than the player's tombstone, so their device takes it back.
      (this.#deps.onError ?? console.warn)(new Error(`Refused ${pid}'s delete: Deleted characters is full.`));
      const last = [camp.sync?.last ?? '', latestClock(s), at].sort().pop();
      const back = { ...s, sync: { clock: { ...s.sync?.clock, name: hlcNow(camp.sync!.node, last, this.#deps.now?.()) }, gone: { ...s.sync?.gone } } };
      await this.#deps.saveCharacter(back);
      return this.#send(c, { t: 'chars', characters: [characterForPlayer(back)] });
    }
    await this.#deps.updateSync((x) => ({ ...x, last: hlcReceive(x.node, x.last, at, this.#deps.now?.()) })); // a restore must stamp later than this
    await this.#deps.deleteCharacter(id, pid); // R9: kept in the DM's trash
    const tomb = (await this.#deps.loadCampaign())?.sync?.deleted?.[id] ?? at;
    this.#broadcast({ t: 'deleteChar', id, at: tomb }, c);
    await this.#sendRoster();
    await this.#trackerIfFighting(camp, [id]);
    await this.#sceneIfLinked(camp, [id]);
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
      // A stream with no drain for STALL_TIMEOUT is dropped, and the link closed: it is not moving, and it pins the pack in memory.
      const stall = setTimeout(() => { if (!done) { done = true; clearTimeout(timer); this.#close(c); resolve(); } }, STALL_TIMEOUT);
      const check = () => {
        if (done) return; // a late drain event after the wait ended
        clearTimeout(timer);
        if (full()) timer = setTimeout(check, 100);
        else { done = true; clearTimeout(stall); resolve(); }
      };
      c.link.onDrain?.(check);
      check();
    });
  }

  async #roster(camp: Campaign) {
    const index = await this.#deps.index();
    // I3: only characters a player owns; the DM's own (no owner) stay on the DM's device
    return (await this.#deps.loadCharacters()).filter((ch) => ch.campaignId === camp.id && ch.ownerId).map((ch) => rosterEntry(ch, index, camp.settings));
  }

  async #sendRoster(camp?: Campaign): Promise<void> {
    camp ??= await this.#deps.loadCampaign();
    if (camp && [...this.#conns].some((c) => c.playerId)) this.#broadcast({ t: 'roster', roster: await this.#roster(camp) });
  }

  /** Stage 4: each player's tracker (trackerForPlayers, the allowlist; only their own movement), or null with no fight. */
  async #tracker(camp: Campaign, combat: Combat | undefined): Promise<(playerId: string) => TrackerView | null> {
    if (!combat) return () => null;
    const chars = (await this.#deps.loadCharacters()).filter((ch) => ch.campaignId === camp.id);
    return (pid) => trackerForPlayers(combat, chars, camp.settings, this.#alias, pid) ?? null;
  }

  /** S4-R5: an opaque random row id per combatant, stable for this host's life, so players learn no record ids. */
  #aliases = new Map<string, string>();
  #alias = (id: string): string => {
    let a = this.#aliases.get(id);
    if (a === undefined) this.#aliases.set(id, a = uid());
    return a;
  };

  /** M1: a view identical to the last one this link got is not sent again (no timing hint of changes players can't see). */
  #sendTrackerTo(c: Conn, tracker: TrackerView | null): void {
    const json = JSON.stringify(tracker);
    if (c.tracker === json) return;
    c.tracker = json;
    this.#send(c, { t: 'tracker', tracker });
  }

  async #sendTracker(camp: Campaign, combat: Combat | undefined): Promise<void> {
    if (![...this.#conns].some((c) => c.playerId)) return;
    const tracker = await this.#tracker(camp, combat);
    for (const c of this.#conns) if (c.playerId) this.#sendTrackerTo(c, tracker(c.playerId));
  }

  /** Re-sends the tracker when the fight holds any of these characters. */
  async #trackerIfFighting(camp: Campaign, ids: string[]): Promise<void> {
    const combat = await this.#deps.loadCombat?.();
    if (combat?.combatants.some((x) => x.characterId !== undefined && ids.includes(x.characterId))) await this.#sendTracker(camp, combat);
  }

  // ---- Stage 5: the battle map ----

  /** The shown scene as players see it (sceneForPlayers, the allowlist), or undefined. */
  async #scene(camp: Campaign): Promise<PlayerScene | undefined> {
    if (!this.#deps.loadScene) return undefined;
    const s = await this.#deps.loadScene();
    if (!s) return undefined;
    const chars = (await this.#deps.loadCharacters()).filter((ch) => ch.campaignId === camp.id);
    return sceneForPlayers(s, chars, await this.#deps.loadCombat?.(), camp.settings);
  }

  /** A view identical to the last one this link got is not sent again (a hidden token's change leaves no timing hint), unless forced. */
  #sendSceneTo(c: Conn, view: PlayerScene | undefined, force = false): void {
    const json = JSON.stringify(view ?? null);
    if (c.scene === json && !force) return;
    c.scene = json;
    for (const h of sceneBlobs(view)) c.seen.add(h);
    this.#send(c, { t: 'scene', scene: view ?? null });
  }

  /** To every admitted link; `force` always gets it (a refused or no-op move snaps its token back). */
  async #sendScene(camp: Campaign, force?: Conn): Promise<void> {
    if (!this.#deps.loadScene || ![...this.#conns].some((c) => c.playerId)) return;
    const view = await this.#scene(camp);
    for (const c of this.#conns) if (c.playerId) this.#sendSceneTo(c, view, c === force);
    const actions = actionsForPlayers(this.#board.list(), view); // what players see of them follows the view
    for (const c of this.#conns) if (c.playerId) this.#sendActionsTo(c, actions);
  }

  /** Re-sends the scene when the shown one has a token of any of these characters (their HP or conditions changed). */
  async #sceneIfLinked(camp: Campaign, ids: string[]): Promise<void> {
    const s = await this.#deps.loadScene?.();
    if (s?.tokens.some((t) => t.characterId !== undefined && ids.includes(t.characterId))) await this.#sendScene(camp);
  }

  /** Review Focus 2: shape (parse), then moveProblem: a crafted move is a violation; a stale one re-sends the scene to that link only. */
  async #move(c: Conn, pid: string, m: { sceneId: string; tokenId: string; x: number; y: number }): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    if (!camp || !this.#deps.loadScene || !this.#deps.updateScene) return;
    const chars = (await this.#deps.loadCharacters()).filter((ch) => ch.campaignId === camp.id);
    const combat = await this.#deps.loadCombat?.();
    const why = moveProblem(await this.#deps.loadScene(), m, pid, chars, combat, camp.settings);
    if (why?.violation) return this.#violation(c, why.error);
    // checked again on the fresh record, in the write (the DM may have hidden the token since); its cost is measured on that record too
    let moved: { combatantId: string; from: { x: number; y: number } } | undefined;
    if (!why) await this.#deps.updateScene(m.sceneId, (s) => {
      if (moveProblem(s, m, pid, chars, combat, camp.settings)) return s;
      const t = s.tokens.find((x) => x.id === m.tokenId)!;
      const cost = moveCost(s, m, chars.find((ch) => ch.id === t.characterId)!, combat, camp.settings);
      if (cost) moved = { combatantId: cost.combatantId, from: { x: t.x, y: t.y } };
      return moveTokens(s, [m.tokenId], m.tokenId, m);
    });
    const k = moved;
    if (k) await this.#deps.updateCombat?.((x) => recordMove(x, k.combatantId, k.from)); // the turn's first move sets its origin (the db change re-sends the tracker)
    await this.#sendScene(camp, c);
  }

  /**
   * Only images of a scene this link was sent: of the current one they stream, of an earlier one (the DM switched scenes meanwhile) they
   * are ignored; anything else (a hidden token's portrait) is a violation. Each once per link, one at a time on the pack chain.
   */
  async #blobWant(c: Conn, hashes: string[]): Promise<void> {
    if (hashes.some((h) => !c.seen.has(h) || c.blobs.has(h))) return this.#violation(c, 'a blob that was not offered');
    const camp = await this.#deps.loadCampaign();
    const now = new Set(camp ? sceneBlobs(await this.#scene(camp)) : []);
    for (const h of new Set(hashes)) {
      c.blobs.add(h);
      if (now.has(h)) c.packs = c.packs.then(() => this.#streamBlob(c, h)).catch((e) => (this.#deps.onError ?? console.warn)(e));
    }
  }

  async #streamBlob(c: Conn, hash: string): Promise<void> {
    const b = await this.#deps.loadBlob?.(hash);
    if (!b || b.data.byteLength > MAX_BLOB || !IMAGE_TYPES.includes(b.type) || c.closed) return;
    const bytes = new Uint8Array(b.data), total = Math.max(1, Math.ceil(bytes.length / BLOB_CHUNK));
    for (let seq = 0; seq < total && !c.closed; seq++) {
      await this.#drained(c);
      this.#send(c, { t: 'blobChunk', hash, type: b.type, size: bytes.length, seq, total, data: toBase64(bytes.subarray(seq * BLOB_CHUNK, (seq + 1) * BLOB_CHUNK)) });
    }
  }

  // ---- Declared actions (intent arrows) ----

  #board = new ActionBoard();

  /** The DM's own arrow, from any token or a point on the shown scene (it replaces the DM's last from the same token). */
  setDmAction(r: ActionRequest): void {
    void this.#task(async () => {
      const s = await this.#deps.loadScene?.();
      if (!s || s.id !== r.sceneId) return;
      const combat = await this.#deps.loadCombat?.();
      this.#board.onCombat(combat); // the board knows the current turn before an arrow joins it
      this.#board.set({ ...r, id: uid(), by: 'dm', ...expiry(r, s, combat), at: this.#deps.now?.() ?? Date.now() });
      await this.#actionsChanged(true);
    });
  }

  /** The DM clears one arrow, or every arrow. */
  clearAction(id?: string): void {
    void this.#task(() => this.#actionsChanged(this.#board.clear('dm', id)));
  }

  /** A player's arrow: from their own visible token or a point, at what they can see. A foreign token is crafted; the rest is stale. */
  async #action(c: Conn, pid: string, r: ActionRequest): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const s = await this.#deps.loadScene?.();
    if (!camp || !s) return;
    const chars = (await this.#deps.loadCharacters()).filter((ch) => ch.campaignId === camp.id);
    const combat = await this.#deps.loadCombat?.();
    const mine = new Set(chars.filter((ch) => ch.ownerId === pid).map((ch) => ch.id));
    const own = new Set(s.tokens.filter((t) => t.characterId !== undefined && mine.has(t.characterId)).map((t) => t.id));
    const from = 'tokenId' in r.from ? r.from.tokenId : undefined;
    if (r.sceneId === s.id && from !== undefined && s.tokens.some((t) => t.id === from) && !own.has(from)) return this.#violation(c, 'not their token');
    if (actionProblem(r, sceneForPlayers(s, chars, combat, camp.settings), own)) return; // stale: hidden, fogged or another scene now
    this.#board.onCombat(combat);
    this.#board.set({ ...r, id: uid(), by: pid, ...expiry(r, s, combat), at: this.#deps.now?.() ?? Date.now() });
    await this.#actionsChanged(true);
  }

  /** The board changed: the DM's map, then every link (through the scene send, which filters them by the view). */
  async #actionsChanged(changed: boolean): Promise<void> {
    if (!changed) return;
    this.#deps.onActions?.(this.#board.list());
    const camp = await this.#deps.loadCampaign();
    if (camp) await this.#sendScene(camp);
  }

  /** As #sendSceneTo: a list identical to the last one this link got is not sent again. */
  #sendActionsTo(c: Conn, actions: PlayerAction[]): void {
    const json = JSON.stringify(actions);
    if (c.actions === json) return;
    c.actions = json;
    this.#send(c, { t: 'actions', actions });
  }
}
