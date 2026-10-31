// Pure (no Svelte/Vite/DOM/PeerJS). A player's side of a campaign session: joins with the code, keeps the local copy of the campaign,
// and merges the player's characters with the DM's. The DM's device is the authority on what is allowed, but anyone holding the code
// can stand in for it while the DM is away, so what arrives is still checked (shape, campaign, owner) before it is stored.
import { entityAllowed, packAllowed, patchAllowed, restorablePack } from '../content/sources.ts';
import { characterProblem, isRec, problem, SHAPES } from '../recordShape.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import type { Campaign, CampaignSettings, CampaignSync, Character, Pack, PackMeta } from '../types.ts';
import { newCampaignSync, sha256Text } from './code.ts';
import type { Link } from './link.ts';
import { canon, latestClock, mergeCharacter, type Synced } from './merge.ts';
import type { CampaignForPlayers, RosterEntry } from './project.ts';
import { cleanRoll, HLC, MAX_MESSAGE, MAX_PACK, PLAYER_ID, size, type GuestMsg, type PackOffer } from './protocol.ts';

export type GuestStatus = 'connecting' | 'online' | 'offline' | 'rejected';
/** Pack download progress: packs finished (stored or refused) of those wanted, and bytes received of their total. */
export interface PackProgress { done: number; total: number; bytes: number; totalBytes: number; error?: string }

export interface GuestDeps {
  code: string;
  /** Join as this existing player ID; absent = as a new player. */
  playerId?: string;
  name?: string;
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
  /** Stored pack metadata (db.packs.listMeta) and the pack store (db.packs.put). */
  packMeta(): Promise<PackMeta[]>;
  savePack(p: Pack): Promise<void>;
  onPacks?(p: PackProgress): void;
  onStatus?(s: GuestStatus, reason?: string): void;
  onRoster?(roster: RosterEntry[]): void;
  /** A public roll from the DM (`from` absent) or another player. */
  onRoll?(e: RollEntry, from?: string): void;
  onError?(e: unknown): void;
  now?(): number;
}

const same = (a: Character, b: Character) => canon({ ...a, updatedAt: 0 }) === canon({ ...b, updatedAt: 0 });

const isSettings = (v: unknown): v is CampaignSettings => isRec(v) && isRec(v.initiativeModules);
const playerCampaign = (v: unknown): v is CampaignForPlayers =>
  isRec(v) && typeof v.id === 'string' && typeof v.name === 'string' && isSettings(v.settings) && Array.isArray(v.enabledPacks) && v.enabledPacks.every((x) => typeof x === 'string');

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
    this.#setStatus('connecting');
    link.onMessage((raw) => { if (this.#link === link) void this.#task(() => this.#receive(raw)); });
    link.onClose(() => {
      if (this.#link !== link) return;
      this.#link = undefined;
      if (this.#status !== 'rejected') this.#setStatus('offline');
    });
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
        if (c && c.campaignId === this.#campaignId) await this.#deps.deleteCharacter(c.id, typeof m.at === 'string' && HLC.test(m.at) ? m.at : undefined);
        return;
      }
      case 'roster': if (Array.isArray(m.roster)) this.#deps.onRoster?.(m.roster as RosterEntry[]); return;
      case 'roll': {
        const entry = cleanRoll(m.entry);
        if (entry) this.#deps.onRoll?.(entry, typeof m.from === 'string' && PLAYER_ID.test(m.from) ? m.from : undefined);
        return;
      }
      case 'settings': if (playerCampaign(m.campaign) && m.campaign.id === this.#campaignId) await this.#saveCampaign(m.campaign); return;
      case 'packChunk': return this.#packChunk(m);
    }
  }

  async #welcome(m: Record<string, unknown>): Promise<void> {
    if (this.#status !== 'connecting' || typeof m.playerId !== 'string' || !PLAYER_ID.test(m.playerId) || !playerCampaign(m.campaign)) return;
    const campaign = m.campaign as CampaignForPlayers, playerId = m.playerId;
    const had = await this.#deps.loadCampaign(campaign.id);
    // Never overwrite a campaign this device hosts or made itself (the same browser joining its own game, or a crafted welcome).
    if (had && had.sync?.role !== 'player') return this.#end('This device already has this campaign as its own.');
    const code = this.#deps.code;
    if (had) {
      await this.#saveCampaign(campaign);
      await this.#deps.updateSync(campaign.id, (s) => ({ ...s!, role: 'player', code, playerId }));
    } else await this.#saveCampaign(campaign, { ...newCampaignSync('player', code), playerId }); // M7: a first join is one write
    this.#playerId = playerId;
    this.#campaignId = campaign.id;
    this.#setStatus('online');
    if (Array.isArray(m.roster)) this.#deps.onRoster?.(m.roster as RosterEntry[]);
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
    await this.#deps.savePack({ ...p, hash, sharedBy: this.#campaignId! });
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
