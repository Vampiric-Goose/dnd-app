// Pure (no Svelte/Vite/DOM/PeerJS). A player's side of a campaign session: joins with the code, keeps the local copy of the campaign,
// and merges the player's characters with the DM's. The DM's device is the authority on what is allowed, but anyone holding the code
// can stand in for it while the DM is away, so what arrives is still checked (shape, campaign, owner) before it is stored.
import { characterProblem, isRec } from '../recordShape.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import type { Campaign, CampaignSettings, CampaignSync, Character } from '../types.ts';
import { newCampaignSync } from './code.ts';
import type { Link } from './link.ts';
import { canon, mergeCharacter, type Synced } from './merge.ts';
import type { CampaignForPlayers, RosterEntry } from './project.ts';
import { cleanRoll, MAX_MESSAGE, PLAYER_ID, size, type GuestMsg } from './protocol.ts';

export type GuestStatus = 'connecting' | 'online' | 'offline' | 'rejected';

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
  /** Deletes a character and records its tombstone in campaign.sync.deleted (db.characters.delete does both). */
  deleteCharacter(id: string): Promise<void>;
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

/** Reasons after which reconnecting with the same code and ID is pointless. */
const FINAL = new Set(['code changed', 'removed']);

export class Guest {
  #deps: GuestDeps;
  #link?: Link;
  #status: GuestStatus = 'offline';
  #queue: Promise<void> = Promise.resolve();
  #playerId?: string;
  #campaignId?: string;

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
        if (c && c.campaignId === this.#campaignId) await this.#deps.deleteCharacter(c.id);
        return;
      }
      case 'roster': if (Array.isArray(m.roster)) this.#deps.onRoster?.(m.roster as RosterEntry[]); return;
      case 'roll': {
        const entry = cleanRoll(m.entry);
        if (entry) this.#deps.onRoll?.(entry, typeof m.from === 'string' && PLAYER_ID.test(m.from) ? m.from : undefined);
        return;
      }
      case 'settings': if (playerCampaign(m.campaign) && m.campaign.id === this.#campaignId) await this.#saveCampaign(m.campaign); return;
    }
  }

  async #welcome(m: Record<string, unknown>): Promise<void> {
    if (this.#status !== 'connecting' || typeof m.playerId !== 'string' || !PLAYER_ID.test(m.playerId) || !playerCampaign(m.campaign)) return;
    const campaign = m.campaign as CampaignForPlayers, playerId = m.playerId;
    const had = await this.#deps.loadCampaign(campaign.id);
    // Never overwrite a campaign this device hosts or made itself (the same browser joining its own game, or a crafted welcome).
    if (had && had.sync?.role !== 'player') return this.#end('This device already has this campaign as its own.');
    await this.#saveCampaign(campaign);
    const code = this.#deps.code;
    await this.#deps.updateSync(campaign.id, (s) => ({ ...(s ?? newCampaignSync('player', code)), role: 'player', code, playerId }));
    this.#playerId = playerId;
    this.#campaignId = campaign.id;
    this.#setStatus('online');
    if (Array.isArray(m.roster)) this.#deps.onRoster?.(m.roster as RosterEntry[]);
    for (const c of await this.#deps.loadCharacters(campaign.id)) if (c.ownerId === playerId) this.#send({ t: 'chars', characters: [c] });
    const del = (await this.#deps.loadCampaign(campaign.id))?.sync?.deleted ?? {};
    for (const [id, at] of Object.entries(del)) this.#send({ t: 'deleteChar', id, at });
  }

  /** Creates or updates the local copy: the DM's id, name, settings and enabled packs. Loot stays empty (R50: never sent). */
  async #saveCampaign(c: CampaignForPlayers): Promise<void> {
    const had = await this.#deps.loadCampaign(c.id), now = this.#deps.now?.() ?? Date.now();
    await this.#deps.saveCampaign({ createdAt: now, loot: [], ...had, id: c.id, name: c.name, settings: c.settings, enabledPacks: c.enabledPacks, updatedAt: now });
  }

  async #char(raw: unknown): Promise<void> {
    if (characterProblem(raw)) return;
    const c = raw as Synced<Character>;
    if (c.campaignId !== this.#campaignId || c.ownerId !== this.#playerId) return;
    const del = (await this.#deps.loadCampaign(c.campaignId!))?.sync?.deleted;
    if (del && Object.hasOwn(del, c.id)) return; // deleted here; the DM learns it from our deleteChar
    const local = await this.#deps.loadCharacter(c.id);
    if (local && local.campaignId !== this.#campaignId) return; // never overwrite a character of another campaign
    const merged = mergeCharacter(local ?? c, c);
    if (!local || !same(merged, local)) await this.#deps.saveCharacter(merged);
    if (!same(merged, c)) this.#send({ t: 'chars', characters: [merged] });
  }
}
