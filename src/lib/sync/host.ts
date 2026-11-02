// Pure (no Svelte/Vite/DOM/PeerJS). The DM's side of a campaign session: it accepts links, admits players by join code, merges their
// characters with the DM's copies and sends back only player projections. Every guest message is validated (shape, ownership, size,
// 2024) before anything is stored. Storage, the content index and the clock are injected, so tests run it on fakes.
import { strip2024 } from '../character/strip2024.ts';
import type { ContentIndex } from '../content/index.ts';
import { entityAllowed, idSource, is2024Source, packAllowed, patchAllowed, restorablePack } from '../content/sources.ts';
import { isRec, problem, SHAPES } from '../recordShape.ts';
import { TRUSTED_KEYS, verify } from './signing.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import { toBase64 } from '../base64.ts';
import { budgetApplies, combatantForToken, recordMove } from '../combat/movement.ts';
import { applyUse, attacksPerAction, characterEffect, editsCharacter, payment, pcActions, problemOf, spendOn, type TurnAction } from '../combat/turnActions.ts';
import { targetOf, type TargetInfo } from '../combat/resolve.ts';
import { snapOf, touched, workOut, type Aim, type Aimed, type WorkIn } from '../combat/aiming.ts';
import { targetingOn } from '../combat/targeting.ts';
import { featureList } from '../character/play.ts';
import { computeSheet } from '../rules/sheet.ts';
import { moveTokens } from '../map/scene.ts';
import { ActionBoard, actionProblem, actionsForPlayers, expiry, type ActionRequest, type DeclaredAction, type PlayerAction } from '../map/actions.ts';
import type { Campaign, CampaignSettings, CampaignSync, Character, Combat, Combatant, MonsterDef, Pack, PackMeta, Resolution, Scene, Snap } from '../types.ts';
import { newJoinCode, nextPlayerId, sha256Text } from './code.ts';
import { hlcNow, hlcReceive, MAX_AHEAD } from './hlc.ts';
import type { Link } from './link.ts';
import { canon, latestClock, mergeCharacter, type Synced } from './merge.ts';
import { campaignForPlayers, characterForPlayer, currentActor, playerPack, rosterEntry, trackerForPlayers, unprojectCharacter, type TrackerView } from './project.ts';
import { uid } from '../uid.ts';
import { BLOB_CHUNK, cleanRoll, cuts, IMAGE_TYPES, LOW_WATER, MAX_BLOB, MAX_CHUNK, MAX_MESSAGE, MAX_PACK, parseGuestMessage, size, type GuestMsg, type HostMsg, type PackOffer, type Preview } from './protocol.ts';
import { moveCost, moveProblem, previewVisible, sceneBlobs, sceneForPlayers, type PlayerScene } from './scene.ts';

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
  /** Turn panel: a player ended their turn (the DM's Next, with expiry). */
  /** Next, only while `combatantId` still holds the turn (checked in the same write). */
  endTurn?(combatantId: string): Promise<void>;
  /** Turn panel: the DM's own edit of a character (a player's slot or resource spent by a use), stamped and synced like any DM edit. */
  editCharacter?(id: string, fn: (c: Character) => Character): Promise<unknown>;
  /** Targeting: a worked-out use applied on this device (store applyResolution: damage through changeHp, kept for the DM's Undo). */
  resolve?(r: Omit<Resolution, 'applied'>, before?: Snap): Promise<void>;
  /** Targeting: a player's own save roll for its PC's pending area save (store settleSave). */
  settleSave?(rid: string, target: string, d20: number): Promise<void>;
  /** Targeting: a player's pick of the die that sets its hit's type (store settlePick). */
  settlePick?(rid: string, target: string, type: string): Promise<void>;
  /** Publisher signatures (signing.ts): the trusted public keys (default TRUSTED_KEYS), and storing a signed book in place of this device's
   *  own copy unless it is no newer than the last signed one taken (false: refused). */
  trusted?: readonly string[];
  takeSignedPack?(p: Pack, at: number): Promise<boolean>;
  /** Targeting: a monster's stat block (its saves and defenses). */
  loadMonster?(id: string): Promise<MonsterDef | undefined>;
  /** Stage 5: the campaign's shown scene (db.scenes.shown). Without it no scene is sent. */
  loadScene?(): Promise<Scene | undefined>;
  /** Stage 5: a player's move, a read-modify-write of the fresh record (db.scenes.update, a network write: not reported). */
  updateScene?(id: string, fn: (s: Scene) => Scene): Promise<Scene | undefined>;
  /** Stage 5: a stored image (db.blobs). */
  loadBlob?(hash: string): Promise<{ type: string; data: ArrayBuffer } | undefined>;
  /** A player's live drag preview for the DM's map (checked; never stored). */
  onDrag?(p: Preview): void;
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
  actions?: string /* JSON of the last declared actions sent */;
  upload?: { id: string; at: number; sig: string; total: number; parts: string[]; length: number } /* a signed book arriving */ }

/**
 * Characters of pack JSON per chunk. Worst case a character takes 3 UTF-8 bytes (a quote or backslash escapes to 2, anything else in
 * the BMP is at most 3), so a chunk message stays under MAX_CHUNK with room for its envelope.
 */
/** M6: a link that has not said hello by then is closed. */
export const HELLO_TIMEOUT = 15_000;
/** A pack stream whose send buffer has not drained for this long is dropped. */
export const STALL_TIMEOUT = 60_000;
/** B1: live characters per player in the campaign; a new one beyond that is a violation. */
export const MAX_CHARACTERS = 30;


/** The campaign as players get it, its enabled packs cut to the ones they are offered (M2: no DM-only pack ids). */
const forPlayers = (camp: Campaign, offers: PackOffer[]) => {
  const ok = new Set(['srd', ...offers.map((o) => o.id)]);
  const c = campaignForPlayers(camp);
  return { ...c, enabledPacks: c.enabledPacks.filter((id) => ok.has(id)) };
};


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
      case 'use': return this.#use(c, c.playerId, msg);
      case 'save': return this.#save(c, c.playerId, msg);
      case 'leap': return this.#leap(c, c.playerId, msg);
      case 'pick': return this.#pick(c, c.playerId, msg);
      case 'signedChunk': return this.#signedChunk(c, msg);
      case 'endTurn': return this.#endTurn(c, c.playerId, msg.characterId);
      case 'action': return this.#action(c, c.playerId, msg.action);
      case 'clearAction': return this.#actionsChanged(this.#board.clear(c.playerId));
      case 'drag': return this.#drag(c, c.playerId, msg.sceneId, { tokenId: msg.tokenId, at: { x: msg.x, y: msg.y } });
      case 'dragEnd': return this.#drag(c, c.playerId, msg.sceneId, { tokenId: msg.tokenId });
    }
  }

  /**
   * A player's live drag preview: checked as a move (own token, visible, shown scene, their turn) without the budget; a crafted one is a
   * violation, a stale one is ignored. Goes to the DM's map and to the other players who see the token there. Never stored.
   */
  async #drag(c: Conn, pid: string, sceneId: string, p: Preview): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const s = await this.#deps.loadScene?.();
    if (!camp || !s) return;
    const t = s.tokens.find((x) => x.id === p.tokenId);
    const chars = (await this.#deps.loadCharacters()).filter((ch) => ch.campaignId === camp.id);
    const why = moveProblem(s, { sceneId, tokenId: p.tokenId, ...(p.at ?? (t ? { x: t.x, y: t.y } : { x: 0, y: 0 })) }, pid, chars, await this.#deps.loadCombat?.(), camp.settings, false);
    if (why?.violation) return this.#violation(c, why.error);
    if (why) return;
    this.#deps.onDrag?.(p);
    this.#preview(s, camp.settings, p, c);
  }

  /** A preview to every player but `except` who sees the token there (previewVisible). */
  #preview(s: Scene, settings: CampaignSettings, p: Preview, except?: Conn): void {
    if (!previewVisible(s, p.tokenId, p.at, settings)) return;
    const msg: HostMsg = p.at ? { t: 'drag', tokenId: p.tokenId, x: p.at.x, y: p.at.y } : { t: 'dragEnd', tokenId: p.tokenId };
    for (const x of this.#conns) if (x.playerId && x !== except) this.#send(x, msg);
  }

  /** The DM drags a token on `sceneId` (`at` undefined: the drag ended): players who see it there get the preview. */
  async dmDrag(sceneId: string, p: Preview): Promise<void> {
    if (![...this.#conns].some((c) => c.playerId)) return;
    const [camp, s] = await Promise.all([this.#deps.loadCampaign(), this.#deps.loadScene?.()]);
    if (camp && s?.id === sceneId) this.#preview(s, camp.settings, p);
  }

  /**
   * Turn panel: the player's own character (else a violation) uses one of its actions. Checked on the fresh combat: the action exists,
   * the turn (players' view; off-turn only a Reaction), blocking conditions, the pip, and a free slot or use. Refused: nothing is spent
   * and the player is told why. Accepted: the pip on the combat, then the slot or use on the character (the DM's edit, synced back).
   */
  async #use(c: Conn, pid: string, m: Extract<GuestMsg, { t: 'use' }>): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const ch = await this.#deps.loadCharacter(m.characterId);
    if (!camp || !ch || ch.ownerId !== pid || ch.campaignId !== camp.id) return this.#violation(c, 'not their character');
    const refuse = (reason: string) => this.#send(c, { t: 'useRefused', reason });
    if (!this.#deps.updateCombat) return refuse('no fight');
    const sheet = computeSheet(ch, { settings: camp.settings, viewer: 'player' }), features = featureList(ch, camp.settings);
    const a = pcActions(ch, sheet, features).find((x) => x.id === m.action);
    if (!a) return refuse('that action is not available');
    const { level, pact, problem } = payment(a, sheet, ch, m.slot);
    if (problem) return refuse(problem);
    if (a.options && !a.options.some((o) => o.id === m.target)) return refuse('pick one');
    let aimed: Aimed | undefined;
    if (m.aim) { // targeting: worked out before anything is paid, so a refusal spends nothing
      if (!targetingOn(camp.settings) || !this.#deps.resolve) return refuse('targeting is off');
      const r = await this.#aim(camp, ch, features, a, m.aim, level);
      if (typeof r === 'string') return refuse(r);
      aimed = r;
    }
    const edits = editsCharacter(a, level);
    if (edits && !this.#deps.editCharacter) return refuse('this device cannot spend it');
    const k0 = aimed && await this.#deps.loadCombat?.(); // before paying: Undo gives the pip and slot back too
    const before = aimed && k0 ? snapOf(k0, await this.#deps.loadCharacters(), touched(aimed.resolution)) : undefined;
    const per = attacksPerAction(features);
    let why: string | undefined = 'not in the fight';
    await this.#deps.updateCombat((k) => {
      const x = k.round >= 1 ? combatantForToken(k, { characterId: ch.id }) : undefined;
      why = x && problemOf(x, a, ch.state.conditions, k.turn === x.id, per); // the real turn: a hidden creature's turn is not theirs (final review)
      if (!x || why) { why ??= 'not in the fight'; return k; }
      const t = a.target && m.target !== undefined ? k.combatants.find((z) => !z.hidden && (z.id === m.target || this.#aliases.get(z.id) === m.target)) : undefined;
      if (a.target && !t) { why = 'pick a target'; return k; }
      return applyUse(k, x, a, per, t?.id);
    });
    if (why) return refuse(why);
    if (edits && !(await this.#deps.editCharacter!(ch.id, (x) => characterEffect(spendOn(x, level, a.resource, pact), a, m.target)).catch(() => false))) {
      return refuse('the character could not be updated, so nothing was paid');
    }
    if (aimed) {
      await this.#deps.resolve!(aimed.resolution, before);
      this.#send(c, { t: 'outcome', ...aimed.outcome });
    }
  }

  /**
   * Targeting: a player's aimed use checked and worked out on this device (resolve.ts). The target must be visible and in reach or range
   * on the shown scene (PHB range, close-combat disadvantage), the dice must fit the action, and an area catches every token in it, hidden
   * ones too. The player hears only hit or miss, a spell's DC and the names of the visible creatures caught. A string: why not.
   */
  /**
   * Targeting: a leaping spell's next target (Chaos Bolt), from the creature that result hit, never one already hit this casting. Only its
   * caster's player, once per hit that may leap; nothing is paid (it is the same casting).
   */
  async #leap(c: Conn, pid: string, m: Extract<GuestMsg, { t: 'leap' }>): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const ch = await this.#deps.loadCharacter(m.characterId);
    if (!camp || !ch || ch.ownerId !== pid || ch.campaignId !== camp.id) return this.#violation(c, 'not their character');
    const refuse = (reason: string) => this.#send(c, { t: 'useRefused', reason });
    const k = await this.#deps.loadCombat?.(), r = k?.resolutions?.find((y) => y.id === m.resolution), x = k && combatantForToken(k, { characterId: ch.id });
    const from = r?.outcomes.find((o) => o.leap)?.id;
    if (!k || !r || !x || r.actor !== x.id || r.leapt || !from || !this.#deps.updateCombat || !this.#deps.resolve) return refuse('no leap');
    const features = featureList(ch, camp.settings), a = pcActions(ch, computeSheet(ch, { settings: camp.settings, viewer: 'player' }), features).find((y) => y.spell && y.name === r.action);
    if (!a) return refuse('no leap');
    const aimed = await this.#aim(camp, ch, features, a, m.aim, r.slot, { from, exclude: r.chain ?? r.outcomes.map((o) => o.id) });
    if (typeof aimed === 'string') return refuse(aimed);
    let taken = false;
    await this.#deps.updateCombat((y) => ({ ...y, resolutions: (y.resolutions ?? []).map((z) => (z.id !== r.id || z.leapt ? z : (taken = true, { ...z, leapt: true as const }))) }));
    if (!taken) return refuse('no leap');
    await this.#deps.resolve(aimed.resolution, snapOf(k, await this.#deps.loadCharacters(), touched(aimed.resolution)));
    this.#send(c, { t: 'outcome', ...aimed.outcome });
  }

  async #aim(camp: Campaign, ch: Character, features: { name: string }[], a: TurnAction, aim: Aim, level: number | undefined, leapFrom?: WorkIn['leapFrom']): Promise<Aimed | string> {
    const k = await this.#deps.loadCombat?.(), s = await this.#deps.loadScene?.();
    if (!k || !s) return 'no map';
    const x = combatantForToken(k, { characterId: ch.id });
    if (!x) return 'not on the map';
    const chars = await this.#deps.loadCharacters();
    const onMap = new Set(sceneForPlayers(s, chars, k, camp.settings)?.tokens.map((t) => t.id)); // no hidden or fogged token
    const seen = (z: Combatant) => s.tokens.some((t) => onMap.has(t.id) && combatantForToken(k, t)?.id === z.id);
    return workOut({
      a, level, features: features.map((f) => f.name), actor: x, combat: k, scene: s, diagonal: camp.settings.diagonal, aim,
      findTarget: (id) => { // a visible token's id (the player's map) or a tracker row's; players pick visible creatures only
        const t = s.tokens.find((x) => x.id === id), z = t ? combatantForToken(k, t) : k.combatants.find((y) => y.id === id || this.#aliases.get(y.id) === id);
        return z && !z.hidden && seen(z) ? z : undefined;
      },
      info: async (z): Promise<TargetInfo> => {
        const pc = z.characterId ? chars.find((c) => c.id === z.characterId) : undefined;
        return pc ? targetOf(z, { sheet: computeSheet(pc, { settings: camp.settings, viewer: 'dm' }), hp: pc.state.hp }) : targetOf(z, { monster: z.monsterId ? await this.#deps.loadMonster?.(z.monsterId) : undefined });
      },
      nameOf: (z) => (z.characterId ? chars.find((c) => c.id === z.characterId)?.name : undefined) ?? z.name,
      conditionsOf: (z) => (z.characterId ? chars.find((c) => c.id === z.characterId)?.state.conditions : undefined) ?? z.conditions ?? [],
      exhaustionOf: (z) => (z.characterId ? chars.find((c) => c.id === z.characterId)?.state.exhaustion : undefined) ?? 0,
      seen, magical: ch.inventory.find((e) => e.id === a.attack?.entryId)?.item.magic ?? false,
      id: uid(), now: this.#deps.now?.() ?? Date.now(), rng: Math.random, ...(leapFrom && { leapFrom }),
    });
  }

  /** Targeting: a player's own save roll for their character's pending area save (else a violation); a settled one is ignored. */
  /**
   * A trusted publisher's own book, in order (the user's ruling: their copy wins). Taken only when the signature checks against a trusted
   * key, it is a book this device has imported itself (never a shared copy, never a new one), and it is newer than the last signed copy
   * taken; then every player is offered it. Anything else (a gap, another book midway, too big, a bad signature or book) is dropped.
   */
  async #signedChunk(c: Conn, m: Extract<GuestMsg, { t: 'signedChunk' }>): Promise<void> {
    const u = c.upload;
    if (u && (u.id !== m.id || u.at !== m.at || u.sig !== m.sig || u.total !== m.total || m.seq !== u.parts.length)) { c.upload = undefined; return; }
    if (!u && m.seq !== 0) return;
    const v = c.upload = u ?? { id: m.id, at: m.at, sig: m.sig, total: m.total, parts: [], length: 0 };
    v.parts.push(m.data);
    v.length += m.data.length;
    if (v.length > MAX_PACK) { c.upload = undefined; return; }
    if (v.parts.length < v.total) return;
    c.upload = undefined;
    const json = v.parts.join('');
    if (!(await verify(this.#deps.trusted ?? TRUSTED_KEYS, v.at, json, v.sig))) return;
    let p: Pack;
    try { p = JSON.parse(json); } catch { return; }
    if (problem(p, SHAPES.pack) || p.id !== v.id || !restorablePack(p) || !packAllowed(p) || !p.entities.every((e) => isRec(e) && entityAllowed(e)) || !p.patches.every((x) => isRec(x) && patchAllowed(x))) return;
    const mine = await this.#deps.loadPack(p.id);
    if (!mine || mine.sharedBy !== undefined) return;
    const { sharedBy: _s, ...book } = p;
    if (!(await this.#deps.takeSignedPack?.(book, v.at))) return;
    const camp = await this.#deps.loadCampaign();
    if (camp) this.#broadcast({ t: 'settings', campaign: forPlayers(camp, await this.#packOffers(camp)) });
  }

  /** Targeting: the player picks the die that sets its own hit's type (Chaos Bolt); only the caster's player, only a type offered. */
  async #pick(c: Conn, pid: string, m: Extract<GuestMsg, { t: 'pick' }>): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const ch = await this.#deps.loadCharacter(m.characterId);
    if (!camp || !ch || ch.ownerId !== pid || ch.campaignId !== camp.id) return this.#violation(c, 'not their character');
    const k = await this.#deps.loadCombat?.(), x = k && combatantForToken(k, { characterId: ch.id });
    const r = x && k.resolutions?.find((y) => y.id === m.resolution && y.actor === x.id);
    const o = r?.outcomes.find((y) => y.choose?.some((z) => z.type === m.type));
    if (r && o) await this.#deps.settlePick?.(r.id, o.id, m.type);
  }

  async #save(c: Conn, pid: string, m: Extract<GuestMsg, { t: 'save' }>): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const ch = await this.#deps.loadCharacter(m.characterId);
    if (!camp || !ch || ch.ownerId !== pid || ch.campaignId !== camp.id) return this.#violation(c, 'not their character');
    const k = await this.#deps.loadCombat?.();
    const x = k && combatantForToken(k, { characterId: ch.id });
    const r = x && k.resolutions?.find((y) => y.id === m.resolution && y.outcomes.some((o) => o.id === x.id && o.pending));
    if (r) await this.#deps.settleSave?.(r.id, x.id, m.d20);
  }

  /** Turn panel: the player's own character (else a violation) ends its turn, only while it really holds the turn (not a hidden creature's after it); else ignored. */
  async #endTurn(c: Conn, pid: string, id: string): Promise<void> {
    const camp = await this.#deps.loadCampaign();
    const ch = await this.#deps.loadCharacter(id);
    if (!camp || !ch || ch.ownerId !== pid || ch.campaignId !== camp.id) return this.#violation(c, 'not their character');
    const k = await this.#deps.loadCombat?.();
    const x = k && k.round >= 1 ? combatantForToken(k, { characterId: id }) : undefined;
    if (x && k!.turn === x.id) await this.#deps.endTurn?.(x.id);
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
