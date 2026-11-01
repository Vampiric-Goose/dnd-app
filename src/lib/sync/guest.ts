// Pure (no Svelte/Vite/DOM/PeerJS). A player's side of a campaign session: joins with the code, keeps the local copy of the campaign,
// and merges the player's characters with the DM's. The DM's device is the authority on what is allowed, but anyone holding the code
// can stand in for it while the DM is away, so what arrives is still checked (shape, campaign, owner) before it is stored.
import { fromBase64 } from '../base64.ts';
import { entityAllowed, packAllowed, patchAllowed, restorablePack } from '../content/sources.ts';
import type { Pt } from '../map/grid.ts';
import { characterProblem, isRec, problem, SHAPES } from '../recordShape.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import type { Campaign, CampaignSettings, CampaignSync, Character, Pack, PackMeta } from '../types.ts';
import { newCampaignSync, sha256Bytes, sha256Text } from './code.ts';
import { MAX_AHEAD } from './hlc.ts';
import type { Link } from './link.ts';
import { canon, latestClock, mergeCharacter, type Synced } from './merge.ts';
import type { CampaignForPlayers, HealthStatus, RosterEntry, TrackerRow, TrackerView } from './project.ts';
import { BLOB_CHUNK, cleanRoll, HLC, IMAGE_TYPES, INIT_MAX, INIT_MIN, MAX_BLOB, MAX_MESSAGE, MAX_PACK, PLAYER_ID, size, type GuestMsg, type PackOffer } from './protocol.ts';
import { cleanScene, sceneBlobs, type PlayerScene } from './scene.ts';

export type GuestStatus = 'connecting' | 'online' | 'offline' | 'rejected';
/** Pack download progress: packs finished (stored or refused) of those wanted, and bytes received of their total. */
export interface PackProgress { done: number; total: number; bytes: number; totalBytes: number; error?: string }

export interface GuestDeps {
  code: string;
  /** Join as this existing player ID; absent = as a new player. */
  playerId?: string;
  name?: string;
  /** M9: a rejoin from an existing campaign: a welcome for any other campaign is refused. */
  campaignId?: string;
  /**
   * M9: a join from a link whose welcome targets a player campaign already on this device under another player ID. Without a yes
   * (or without this callback) the welcome is refused, so a crafted host cannot retarget another campaign.
   */
  confirmCampaign?(had: Campaign, offered: CampaignForPlayers, playerId: string): Promise<boolean>;
  loadCampaign(id: string): Promise<Campaign | undefined>;
  /** db.campaigns.put: an existing campaign keeps its stored sync (R4). */
  saveCampaign(c: Campaign): Promise<void>;
  /** R4: read-modify-write of the campaign's sync (db.campaigns.updateSync). */
  updateSync(id: string, fn: (s: CampaignSync | undefined) => CampaignSync): Promise<void>;
  loadCharacters(campaignId: string): Promise<Character[]>;
  loadCharacter(id: string): Promise<Character | undefined>;
  /** R2: stores a merged record without stamping it (db.characters.putSynced). */
  saveCharacter(c: Character): Promise<void>;
  /** Deletes a character and records its tombstone in campaign.sync.deleted (db.characters.delete does both), at `at` when the DM's. */
  deleteCharacter(id: string, at?: string): Promise<void>;
  /** M1: the DM says this character is no longer the player's here: it leaves the campaign on this device (kept, no tombstone). */
  dropCharacter(c: Character): Promise<void>;
  /** Stored pack metadata (db.packs.listMeta) and the pack store (db.packs.put). */
  packMeta(): Promise<PackMeta[]>;
  savePack(p: Pack): Promise<void>;
  onPacks?(p: PackProgress): void;
  onStatus?(s: GuestStatus, reason?: string): void;
  onRoster?(roster: RosterEntry[]): void;
  /** A public roll from the DM (`from` absent) or another player. */
  onRoll?(e: RollEntry, from?: string): void;
  /** Stage 4: the DM's tracker as players see it (cleanTracker); undefined = no fight. */
  onTracker?(t: TrackerView | undefined): void;
  /** Stage 5: the shown scene as the DM sent it (cleanScene); undefined = none shown. */
  onScene?(s: PlayerScene | undefined): void;
  /** Stage 5: images (db.blobs.has, and db.blobs.put of bytes whose hash was checked). */
  hasBlob?(hash: string): Promise<boolean>;
  saveBlob?(type: string, data: Uint8Array): Promise<void>;
  onError?(e: unknown): void;
  now?(): number;
}

const same = (a: Character, b: Character) => canon({ ...a, updatedAt: 0 }) === canon({ ...b, updatedAt: 0 });

const CHOICES: Partial<Record<keyof CampaignSettings, readonly string[]>> = {
  hpMethod: ['average', 'roll'], encumbrance: ['off', 'standard', 'variant'], diagonal: ['5-5-5', '5-10-5'], monsterHp: ['average', 'roll'],
};
/** M1: the DM's settings rebuilt key by key from DEFAULT_SETTINGS (same types, known choices); a missing key keeps the default. Undefined when any is wrong. */
export function cleanSettings(v: unknown): CampaignSettings | undefined {
  if (!isRec(v) || (v.initiativeModules !== undefined && !isRec(v.initiativeModules))) return undefined;
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const [k, d] of Object.entries(DEFAULT_SETTINGS)) {
    const x = Object.hasOwn(v, k) ? v[k] : undefined;
    if (x === undefined || k === 'initiativeModules') continue;
    if (typeof x !== typeof d || (CHOICES[k as keyof CampaignSettings] && !CHOICES[k as keyof CampaignSettings]!.includes(x as string))) return undefined;
    out[k] = x;
  }
  const im = out.initiativeModules as Record<string, boolean>, got = (v.initiativeModules ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(im)) {
    if (!Object.hasOwn(got, k)) continue;
    if (typeof got[k] !== 'boolean') return undefined;
    im[k] = got[k] as boolean;
  }
  return out as unknown as CampaignSettings;
}
/** The campaign as the host sent it, with clean settings, or undefined. */
function playerCampaign(v: unknown): CampaignForPlayers | undefined {
  const settings = isRec(v) ? cleanSettings(v.settings) : undefined;
  if (!isRec(v) || !settings || typeof v.id !== 'string' || typeof v.name !== 'string' || !Array.isArray(v.enabledPacks) || !v.enabledPacks.every((x) => typeof x === 'string')) return undefined;
  return { id: v.id, name: v.name.slice(0, 200), settings, enabledPacks: v.enabledPacks as string[] };
}
const str = (x: unknown) => typeof x === 'string' && x.length <= 500;
const fin = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
/** I2: the first entry of each id only (a repeated key crashes a keyed {#each}). */
function uniqueIds<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => !seen.has(x.id) && !!seen.add(x.id));
}
/** M1: only well-formed party entries reach the page, rebuilt from their known fields; a repeated id is dropped (I2). */
export const cleanRoster = (v: unknown): RosterEntry[] => uniqueIds((Array.isArray(v) ? v : []).flatMap((e): RosterEntry[] =>
  isRec(e) && str(e.id) && str(e.ownerId) && str(e.name) && str(e.race) && str(e.classes) && fin(e.level) && fin(e.hp) && fin(e.maxHp)
    && Array.isArray(e.conditions) && e.conditions.every(str) && (e.portrait === undefined || str(e.portrait))
    ? [{ id: e.id as string, ownerId: e.ownerId as string, name: e.name as string, ...(e.portrait !== undefined && { portrait: e.portrait as string }), race: e.race as string, classes: e.classes as string,
      level: e.level as number, hp: e.hp as number, maxHp: e.maxHp as number, conditions: [...e.conditions as string[]] }]
    : []));
const HEALTH: readonly string[] = ['Unhurt', 'Hurt', 'Bloodied', 'Down'] satisfies HealthStatus[];
const MAX_ROWS = 200; // MAX_COMBATANTS (combat.ts is lazy: not imported here)
const s = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
/** Stage 4: the DM's tracker rebuilt from its known fields: a row without a fitting id and name, or with an id already seen, is dropped; a bad optional field omitted. */
export function cleanTracker(v: unknown): TrackerView | undefined {
  if (!isRec(v) || !fin(v.round) || !Array.isArray(v.rows)) return undefined;
  const rows = uniqueIds(v.rows.flatMap((r): TrackerRow[] => {
    if (!isRec(r) || !s(r.id, 100) || !s(r.name, 200)) return [];
    return [{ id: r.id, name: r.name, ...(s(r.characterId, 100) && { characterId: r.characterId }), ...(fin(r.init) && { init: r.init as number }),
      ...(fin(r.hp) && { hp: r.hp as number }), ...(fin(r.maxHp) && { maxHp: r.maxHp as number }),
      ...(typeof r.health === 'string' && HEALTH.includes(r.health) && { health: r.health as HealthStatus })}];
  })).slice(0, MAX_ROWS);
  const current = rows.some((r) => r.id === v.current) ? v.current as string : undefined;
  return { round: v.round as number, ...(current !== undefined && { current }), rows };
}
/** B3: a tombstone clock from the DM, unless it claims a wall time past MAX_AHEAD (then the local clock is used). */
const fairAt = (at: unknown, now: number): string | undefined =>
  typeof at === 'string' && HLC.test(at) && Number(at.slice(0, 15)) <= now + MAX_AHEAD ? at : undefined;

const isOffer = (o: unknown): o is PackOffer => isRec(o) && typeof o.id === 'string' && typeof o.hash === 'string' && /^[0-9a-f]{64}$/.test(o.hash) && Number.isSafeInteger(o.size);

/** Reasons after which reconnecting with the same code and ID is pointless. */
const FINAL = new Set(['code changed', 'removed']);

export class Guest {
  #deps: GuestDeps;
  #link?: Link;
  #status: GuestStatus = 'offline';
  #queue: Promise<void> = Promise.resolve();
  #playerId?: string;
  #campaignId?: string;
  #want = new Map<string, PackOffer>();
  #progress: PackProgress = { done: 0, total: 0, bytes: 0, totalBytes: 0 };
  #chunks?: { id: string; hash: string; total: number; parts: string[]; length: number };
  #scene?: PlayerScene;
  /** Stage 5, per link: blobs asked for, those still due, and the one arriving. */
  #blobAsked = new Set<string>();
  #blobDue = new Set<string>();
  #blob?: { hash: string; type: string; size: number; total: number; parts: Uint8Array[]; length: number };

  constructor(deps: GuestDeps) {
    this.#deps = deps;
    this.#playerId = deps.playerId;
  }

  get status(): GuestStatus { return this.#status; }
  /** The player ID, once welcomed (or the one asked for). */
  get playerId(): string | undefined { return this.#playerId; }
  /** The campaign's id, once welcomed. */
  get campaignId(): string | undefined { return this.#campaignId; }

  async idle(): Promise<void> {
    let q;
    do { q = this.#queue; await q; } while (q !== this.#queue);
  }

  connect(link: Link): void {
    this.#link?.close();
    this.#link = link;
    this.#blobAsked = new Set();
    this.#blobDue = new Set();
    this.#blob = undefined;
    this.#setStatus('connecting');
    link.onMessage((raw) => { if (this.#link === link) void this.#task(() => this.#receive(raw)); });
    // In the queue, after the messages that came before the close: a bye or rejected just read decides the status, not the close.
    link.onClose(() => void this.#task(async () => {
      if (this.#link !== link) return;
      this.#link = undefined;
      if (this.#status !== 'rejected') this.#setStatus('offline');
    }));
    const { code, name } = this.#deps, playerId = this.#playerId;
    this.#send({ t: 'hello', code, ...(playerId && { playerId }), ...(name && { name }) });
  }

  /** The player saved or deleted a character: sent to the DM when online (otherwise it goes on the next connect). */
  characterChanged(id: string): void {
    void this.#task(async () => {
      if (this.#status !== 'online') return;
      const c = await this.#deps.loadCharacter(id);
      if (c) {
        if (c.campaignId === this.#campaignId && c.ownerId === this.#playerId) this.#send({ t: 'chars', characters: [c] });
        return;
      }
      const del = (await this.#deps.loadCampaign(this.#campaignId!))?.sync?.deleted;
      if (del && Object.hasOwn(del, id)) this.#send({ t: 'deleteChar', id, at: del[id] });
    });
  }

  /** A public roll goes to the DM, who shares it with the party. R6: a private roll is never sent. */
  sendRoll(e: RollEntry): void {
    const entry = cleanRoll(e);
    if (entry && this.#status === 'online') this.#send({ t: 'roll', entry });
  }

  /** Stage 4: the player's own initiative roll, for a character of theirs in this campaign, sent only while online. */
  sendInitiative(characterId: string, total: number): void {
    if (!Number.isInteger(total) || total < INIT_MIN || total > INIT_MAX) return;
    void this.#task(async () => {
      if (this.#status !== 'online') return;
      const c = await this.#deps.loadCharacter(characterId);
      if (c && c.campaignId === this.#campaignId && c.ownerId === this.#playerId) this.#send({ t: 'initiative', characterId, total });
    });
  }

  /** Stage 5: the player's own token, dropped at `to` (kept inside the scene), sent only while online. The DM checks the turn. */
  sendMove(sceneId: string, tokenId: string, to: Pt): void {
    if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return;
    void this.#task(async () => {
      const s = this.#scene, t = s?.id === sceneId ? s.tokens.find((x) => x.id === tokenId) : undefined;
      if (this.#status !== 'online' || !s || !t?.characterId) return;
      const c = await this.#deps.loadCharacter(t.characterId);
      if (!c || c.campaignId !== this.#campaignId || c.ownerId !== this.#playerId) return;
      const x = Math.min(Math.max(to.x, 0), s.width), y = Math.min(Math.max(to.y, 0), s.height);
      this.#send({ t: 'move', sceneId, tokenId, x, y });
    });
  }

  stop(): void {
    const l = this.#link;
    this.#link = undefined;
    l?.close();
    if (this.#status !== 'rejected') this.#setStatus('offline');
  }

  #task(f: () => Promise<void>): Promise<void> {
    return (this.#queue = this.#queue.then(f).catch((e) => (this.#deps.onError ?? console.warn)(e)));
  }

  #setStatus(s: GuestStatus, reason?: string): void {
    this.#status = s;
    this.#deps.onStatus?.(s, reason);
  }

  #send(msg: GuestMsg): void {
    if (size(msg) > MAX_MESSAGE) return (this.#deps.onError ?? console.warn)(new Error(`A ${msg.t} message is over the size limit and was not sent.`));
    this.#link?.send(msg);
  }

  #end(reason: string, status: GuestStatus = 'rejected'): void {
    const l = this.#link;
    this.#link = undefined;
    l?.close();
    this.#setStatus(status, reason);
  }

  async #receive(m: unknown): Promise<void> {
    if (!isRec(m)) return;
    if (m.t === 'rejected') return this.#end(String(m.reason ?? ''));
    if (m.t === 'bye') { const r = String(m.reason ?? ''); return this.#end(r, FINAL.has(r) ? 'rejected' : 'offline'); }
    if (m.t === 'welcome') return this.#welcome(m);
    if (this.#status !== 'online') return;
    switch (m.t) {
      case 'chars': if (Array.isArray(m.characters)) for (const c of m.characters) await this.#char(c); return;
      case 'deleteChar': {
        const c = typeof m.id === 'string' ? await this.#deps.loadCharacter(m.id) : undefined;
        // the DM's tombstone clock, so a later restore (R9) outdates it here too
        if (c && c.campaignId === this.#campaignId) await this.#deps.deleteCharacter(c.id, fairAt(m.at, this.#deps.now?.() ?? Date.now()));
        return;
      }
      case 'notYours': {
        if (typeof m.id !== 'string') return;
        const c = await this.#deps.loadCharacter(m.id);
        if (c && c.campaignId === this.#campaignId) await this.#deps.dropCharacter(c);
        const id = m.id; // a deletion the DM did not take (the character is someone else's now) is forgotten too
        await this.#deps.updateSync(this.#campaignId!, (s) => ({ ...s!, deleted: Object.fromEntries(Object.entries(s!.deleted ?? {}).filter(([k]) => k !== id)) }));
        return;
      }
      case 'roster': if (Array.isArray(m.roster)) this.#deps.onRoster?.(cleanRoster(m.roster)); return;
      case 'roll': {
        const entry = cleanRoll(m.entry);
        if (entry) this.#deps.onRoll?.(entry, typeof m.from === 'string' && PLAYER_ID.test(m.from) ? m.from : undefined);
        return;
      }
      case 'settings': {
        const c = playerCampaign(m.campaign);
        if (c && c.id === this.#campaignId) await this.#saveCampaign(c);
        return;
      }
      case 'packChunk': return this.#packChunk(m);
      case 'tracker': return this.#deps.onTracker?.(m.tracker === null ? undefined : cleanTracker(m.tracker));
      case 'scene': return this.#onScene(m.scene === null ? undefined : cleanScene(m.scene));
      case 'blobChunk': return this.#blobChunk(m);
    }
  }

  /** Stage 5: passes the scene on, then asks once per link for the images it lacks. */
  async #onScene(s: PlayerScene | undefined): Promise<void> {
    this.#scene = s;
    this.#deps.onScene?.(s);
    if (!this.#deps.hasBlob || !this.#deps.saveBlob) return;
    const want: string[] = [];
    for (const h of sceneBlobs(s)) if (!this.#blobAsked.has(h) && !(await this.#deps.hasBlob(h))) want.push(h);
    if (!want.length) return;
    for (const h of want) { this.#blobAsked.add(h); this.#blobDue.add(h); }
    this.#send({ t: 'blobWant', hashes: want });
  }

  #blobDone(hash: string): void {
    this.#blobDue.delete(hash);
    this.#blob = undefined;
  }

  /** As #packChunk: chunks in order, one image at a time, within the size it claims and MAX_BLOB; stored only when its hash matches. */
  async #blobChunk(m: Record<string, unknown>): Promise<void> {
    const { hash, type, size: n, seq, total, data } = m;
    if (typeof hash !== 'string' || !this.#blobDue.has(hash) || typeof type !== 'string' || !IMAGE_TYPES.includes(type) || typeof data !== 'string'
      || !Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > MAX_BLOB || !Number.isSafeInteger(seq) || !Number.isSafeInteger(total)
      || (total as number) < 1 || (total as number) > Math.ceil(MAX_BLOB / BLOB_CHUNK) + 1) return;
    const cur = this.#blob;
    if (cur && (cur.hash !== hash || cur.type !== type || cur.size !== n || cur.total !== total || seq !== cur.parts.length)) return this.#blobDone(cur.hash);
    if (!cur && seq !== 0) return this.#blobDone(hash);
    let bytes: Uint8Array;
    try { bytes = fromBase64(data); } catch { return this.#blobDone(hash); }
    const b = this.#blob = cur ?? { hash, type, size: n as number, total: total as number, parts: [], length: 0 };
    b.parts.push(bytes);
    b.length += bytes.length;
    if (b.length > b.size) return this.#blobDone(hash);
    if (b.parts.length < b.total) return;
    this.#blobDone(hash);
    const all = new Uint8Array(b.length);
    let at = 0;
    for (const p of b.parts) { all.set(p, at); at += p.length; }
    if (b.length !== b.size || (await sha256Bytes(all)) !== hash) return;
    await this.#deps.saveBlob?.(type, all);
  }

  async #welcome(m: Record<string, unknown>): Promise<void> {
    const campaign = playerCampaign(m.campaign);
    if (this.#status !== 'connecting' || typeof m.playerId !== 'string' || !PLAYER_ID.test(m.playerId) || !campaign) return;
    const playerId = m.playerId;
    const had = await this.#deps.loadCampaign(campaign.id);
    // Never overwrite a campaign this device hosts or made itself (the same browser joining its own game, or a crafted welcome).
    if (had && had.sync?.role !== 'player') return this.#end('This device already has this campaign as its own.');
    // M9: a rejoin expects its own campaign; a join from a link asks before taking over a campaign joined under another player ID.
    if (this.#deps.campaignId !== undefined && campaign.id !== this.#deps.campaignId) return this.#end('This code now belongs to a different campaign.');
    if (had && this.#deps.campaignId === undefined && had.sync?.playerId !== playerId && !(await this.#deps.confirmCampaign?.(had, campaign, playerId))) {
      return this.#end(`Not joined: this device already plays “${had.name}” as ${had.sync?.playerId ?? 'another player'}.`);
    }
    const code = this.#deps.code;
    if (had) {
      await this.#saveCampaign(campaign);
      await this.#deps.updateSync(campaign.id, (s) => ({ ...s!, role: 'player', code, playerId }));
    } else await this.#saveCampaign(campaign, { ...newCampaignSync('player', code), playerId }); // M7: a first join is one write
    this.#playerId = playerId;
    this.#campaignId = campaign.id;
    this.#setStatus('online');
    if (Array.isArray(m.roster)) this.#deps.onRoster?.(cleanRoster(m.roster));
    for (const c of await this.#deps.loadCharacters(campaign.id)) if (c.ownerId === playerId) this.#send({ t: 'chars', characters: [c] });
    const del = (await this.#deps.loadCampaign(campaign.id))?.sync?.deleted ?? {};
    for (const [id, at] of Object.entries(del)) this.#send({ t: 'deleteChar', id, at });
    await this.#wantPacks(Array.isArray(m.packs) ? m.packs.filter(isOffer) : []);
  }

  /**
   * Asks for the offered packs it lacks or holds an older shared copy of (Review Focus 5: content hash, so a reconnect asks for none).
   * A pack of the same id the player imported themself is kept as it is (it is never overwritten, nor deleted with the campaign).
   */
  async #wantPacks(offers: PackOffer[]): Promise<void> {
    const have = new Map((await this.#deps.packMeta()).map((p) => [p.id, p]));
    const big = offers.filter((o) => o.size > MAX_PACK);
    const want = offers.filter((o) => o.size <= MAX_PACK && (!have.has(o.id) || (have.get(o.id)!.sharedBy !== undefined && have.get(o.id)!.hash !== o.hash)));
    this.#want = new Map(want.map((o) => [o.id, o]));
    this.#chunks = undefined;
    this.#progress = { done: 0, total: want.length, bytes: 0, totalBytes: want.reduce((n, o) => n + o.size, 0), ...(big.length && { error: `Too large to share: ${big.map((o) => o.id).join(', ')}` }) };
    if (want.length || big.length) this.#deps.onPacks?.({ ...this.#progress });
    if (want.length) this.#send({ t: 'packWant', ids: want.map((o) => o.id) });
  }

  /** One pack finished, stored or refused. */
  #packDone(id: string, error?: string): void {
    this.#want.delete(id);
    this.#chunks = undefined;
    this.#progress = { ...this.#progress, done: this.#progress.done + 1, ...(error && { error: `${id}: ${error}` }) };
    this.#deps.onPacks?.({ ...this.#progress });
  }

  /** Chunks arrive in order, one pack at a time. Anything else (a gap, another pack midway, too many bytes, a bad hash) discards the pack. */
  async #packChunk(m: Record<string, unknown>): Promise<void> {
    const { id, hash, seq, total, data } = m;
    if (typeof id !== 'string' || !this.#want.has(id) || typeof hash !== 'string' || typeof data !== 'string' || !Number.isSafeInteger(seq) || !Number.isSafeInteger(total) || (total as number) < 1) return;
    const cur = this.#chunks;
    if (cur && (cur.id !== id || cur.hash !== hash || cur.total !== total || seq !== cur.parts.length)) return this.#packDone(cur.id, 'chunks out of order');
    if (!cur && seq !== 0) return this.#packDone(id, 'chunks out of order');
    const c = this.#chunks = cur ?? { id, hash, total: total as number, parts: [], length: 0 };
    c.parts.push(data);
    c.length += data.length;
    this.#progress = { ...this.#progress, bytes: this.#progress.bytes + data.length };
    const offer = this.#want.get(id)!;
    if (c.length > offer.size) return this.#packDone(id, 'larger than offered'); // M3: characters never outnumber UTF-8 bytes
    if (c.parts.length < c.total) return this.#deps.onPacks?.({ ...this.#progress });
    const json = c.parts.join('');
    this.#chunks = undefined;
    if ((await sha256Text(json)) !== offer.hash) return this.#packDone(id, 'damaged in transfer (hash mismatch)'); // M3: the offered hash
    let p: Pack;
    try { p = JSON.parse(json); } catch { return this.#packDone(id, 'not valid JSON'); }
    // R52–R54/R60: what stored packs must pass, plus: it is the pack that was offered, and never the built-in SRD.
    if (problem(p, SHAPES.pack) || p.id !== id || typeof p.source !== 'string' || !restorablePack(p) || !packAllowed(p) || !p.entities.every((e) => isRec(e) && entityAllowed(e)) || !p.patches.every((x) => isRec(x) && patchAllowed(x))) {
      return this.#packDone(id, 'refused (not an allowed 2014 pack)');
    }
    await this.#deps.savePack({ ...p, hash: offer.hash, sharedBy: this.#campaignId! }); // B6: the offered hash, so the next welcome matches it
    this.#packDone(id);
  }

  /** Creates or updates the local copy: the DM's id, name, settings and enabled packs. Loot stays empty (R50: never sent). */
  async #saveCampaign(c: CampaignForPlayers, sync?: CampaignSync): Promise<void> {
    const had = await this.#deps.loadCampaign(c.id), now = this.#deps.now?.() ?? Date.now();
    await this.#deps.saveCampaign({ createdAt: now, loot: [], ...had, id: c.id, name: c.name, settings: c.settings, enabledPacks: c.enabledPacks, updatedAt: now, ...(sync && { sync }) });
  }

  async #char(raw: unknown): Promise<void> {
    if (characterProblem(raw)) return;
    const c = raw as Synced<Character>;
    if (c.campaignId !== this.#campaignId || c.ownerId !== this.#playerId) return;
    const del = (await this.#deps.loadCampaign(c.campaignId!))?.sync?.deleted;
    if (del && Object.hasOwn(del, c.id)) {
      if (latestClock(c) <= del[c.id]) return; // deleted here since its last change; the DM learns it from our deleteChar
      // changed since the deletion (the DM restored it, R9): it comes back, and the tombstone goes
      await this.#deps.updateSync(c.campaignId!, (s) => ({ ...s!, deleted: Object.fromEntries(Object.entries(s!.deleted ?? {}).filter(([k]) => k !== c.id)) }));
    }
    const local = await this.#deps.loadCharacter(c.id);
    if (local && local.campaignId !== this.#campaignId) return; // never overwrite a character of another campaign
    const merged = mergeCharacter(local ?? c, c);
    if (!local || !same(merged, local)) await this.#deps.saveCharacter(merged);
    if (!same(merged, c)) this.#send({ t: 'chars', characters: [merged] });
  }
}
