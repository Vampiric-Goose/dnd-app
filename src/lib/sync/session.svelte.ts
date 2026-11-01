// Stage 3: the app-wide sync session (one at a time). It follows the open campaign: a campaign this device hosts resumes hosting unless
// the DM stopped it, and a joined campaign reconnects. The engine and the PeerJS transport load only when a session starts (dynamic
// imports), so the first load stays small. The engine writes through the db adapters below; local edits reach it through onLocalChange.
import { db, hostOffKey, onLocalChange, TRASH_CAP } from '../db.ts';
import { addRemoteRoll, rollHooks } from '../rolls.svelte.ts';
import { app, getIndex, refreshCampaigns, setCampaign } from '../store.svelte.ts';
import type { Campaign } from '../types.ts';
import { newCampaignSync, newJoinCode, peerIdFor } from './code.ts';
import type { Guest, GuestDeps, GuestStatus, PackProgress } from './guest.ts';
import type { Host, HostDeps } from './host.ts';
import type { Listener, Transport } from './link.ts';
import type { RosterEntry, TrackerView } from './project.ts';

export type SessionStatus = 'off' | 'starting' | 'hosting' | 'retrying' | GuestStatus;

export const session = $state({
  role: undefined as 'dm' | 'player' | undefined,
  campaignId: undefined as string | undefined,
  status: 'off' as SessionStatus,
  /** Why it is retrying, or why it was refused. */
  reason: '',
  /** DM: open links per connected player ID. */
  online: {} as Record<string, number>,
  /** Player: the party as the DM last sent it. */
  roster: [] as RosterEntry[],
  /** Player: the initiative tracker as the DM last sent it (stage 4). */
  tracker: undefined as TrackerView | undefined,
  /** Player: pack download progress since the last welcome. */
  packs: undefined as PackProgress | undefined,
  /** Player: the last welcome has been handled (its pack requests are out). */
  welcomed: false,
  /** Bumped whenever sync stored something, so pages re-read. */
  rev: 0,
  /** M9: a question waiting for the user. */
  confirm: undefined as { text: string; answer(ok: boolean): void } | undefined,
});

/** Reconnect delays: 2 s, 5 s, 15 s, then every 30 s, for as long as the page is open. */
export const backoff = (attempt: number): number => [2000, 5000, 15000][attempt] ?? 30000;

let transport = async (): Promise<Transport> => (await import('./peer.ts')).transport;
/** Tests: a fake transport instead of PeerJS. */
export const useTransport = (t: Transport): void => { transport = async () => t; };

interface Run {
  role: 'dm' | 'player';
  code: string;
  campaignId?: string;
  /** role|campaign|code, once the campaign is known (a join learns it from the welcome). */
  key?: string;
  attempt: number;
  /** peerIdFor(code), worked out once per code. */
  peerId?: string;
  timer?: ReturnType<typeof setTimeout>;
  t?: Transport;
  host?: Host;
  guest?: Guest;
  listener?: Listener;
}
let run: Run | undefined;
const live = (r: Run) => r === run;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const keyOf = (role: string, id: string, code: string) => `${role}|${id}|${code}`;

/** Ends the current session, if any. */
export function stopSession(): void {
  const r = run;
  run = undefined;
  if (r) {
    clearTimeout(r.timer);
    r.host?.stop();
    r.guest?.stop();
    r.listener?.close();
  }
  session.confirm?.answer(false);
  Object.assign(session, { role: undefined, campaignId: undefined, status: 'off', reason: '', online: {}, roster: [], tracker: undefined, packs: undefined, welcomed: false, confirm: undefined });
}

function begin(role: Run['role'], code: string, campaignId?: string): Run {
  stopSession();
  const r: Run = { role, code, campaignId, attempt: 0, ...(campaignId && { key: keyOf(role, campaignId, code) }) };
  run = r;
  Object.assign(session, { role, campaignId, status: role === 'dm' ? 'starting' : 'connecting' });
  return r;
}

let follows = 0;
/** Follows the open campaign: App calls it whenever that changes. */
export async function follow(c: Campaign | undefined): Promise<void> {
  const n = ++follows;
  const key = c?.sync && keyOf(c.sync.role, c.id, c.sync.code);
  if (run && (run.key === key || (run.key === undefined && session.status !== 'rejected'))) return; // the same session, or a join underway
  if (!c?.sync) return stopSession();
  if (c.sync.role === 'player') return startGuest({ code: c.sync.code, playerId: c.sync.playerId, campaignId: c.id });
  const off = await db.meta.get<boolean>(hostOffKey(c.id));
  if (n !== follows) return; // the campaign changed meanwhile
  if (off) return stopSession();
  return startHost(c);
}

// ---- DM ----

async function startHost(c: Campaign): Promise<void> {
  const r = begin('dm', c.sync!.code, c.id);
  try {
    const [{ Host }, t] = await Promise.all([import('./host.ts'), transport()]);
    if (!live(r)) return;
    r.t = t;
    r.host = new Host(hostDeps(r, c.id));
    await listen(r);
  } catch (e) {
    // ponytail: no retry when the code itself fails to load (offline before the chunk was ever fetched); Host again or a reload tries again
    if (!live(r)) return;
    stopSession(); // M2: not hosting, so the panel offers Host again
    session.reason = `Could not start hosting: ${msg(e)}`;
  }
}

async function listen(r: Run): Promise<void> {
  const id = await peerIdFor(r.code);
  if (!live(r)) return;
  r.listener = r.t!.listen(id, {
    link: (l) => (live(r) ? r.host!.accept(l) : l.close()),
    status: (up, why) => {
      if (!live(r)) return;
      clearTimeout(r.timer);
      if (up) {
        r.attempt = 0;
        Object.assign(session, { status: 'hosting', reason: '' });
        return;
      }
      Object.assign(session, { status: 'retrying', reason: why ?? '' });
      r.timer = setTimeout(() => r.listener?.retry(), backoff(r.attempt++));
    },
  });
}

const changed = (r: Run) => { if (live(r)) session.rev++; };

/** Who rolled, as the roll log shows it: "DM", or the player ID and their characters' names. */
const who = (from: string | undefined, names: string[]) => (from === undefined ? 'DM' : names.length ? `${from} · ${names.join(', ')}` : from);

function hostDeps(r: Run, cid: string): HostDeps {
  return {
    loadCampaign: () => db.campaigns.get(cid),
    updateSync: (fn) => db.campaigns.updateSync(cid, (s) => fn(s!)),
    loadCharacters: () => db.characters.list(cid),
    loadCharacter: (id) => db.characters.get(id),
    saveCharacter: async (c) => { await db.characters.putSynced(c); changed(r); },
    deleteCharacter: async (id, by) => { await db.characters.delete(id, { by, network: true }); changed(r); },
    trashFull: async () => (await db.trash.list(cid)).length >= TRASH_CAP, // I2
    index: () => getIndex(cid),
    packMeta: () => db.packs.listMeta(),
    loadPack: (id) => db.packs.get(id),
    loadCombat: () => db.combat.get(cid),
    // Dynamic, so the combat store (and the engine) stay out of the first load. applyInitiative checks the fit and reports 'combat'.
    onInitiative: (id, n) => void import('../combat/store.ts').then((m) => m.applyInitiative(cid, id, n)).then(() => changed(r), (e) => console.warn(e)),
    addRoll: (e, from) => void db.characters.list(cid).then((cs) => {
      if (live(r)) addRemoteRoll(e, who(from, cs.filter((c) => c.ownerId === from).map((c) => c.name || 'Unnamed')));
    }),
    onChange: () => {
      if (!live(r)) return;
      session.online = Object.fromEntries([...r.host!.players].map(([id, p]) => [id, p.links]));
      void refreshCampaigns(); // the player list in campaign.sync may have grown
    },
    onError: (e) => console.warn(e),
  };
}

/** "Host this campaign", or host again after Stop hosting. The join code is made the first time. */
export async function hostCampaign(id: string): Promise<void> {
  await db.campaigns.updateSync(id, (s) => s ?? newCampaignSync('dm', newJoinCode()));
  await db.meta.set(hostOffKey(id), false);
  await refreshCampaigns();
  const c = app.campaigns.find((x) => x.id === id);
  if (c?.sync?.role === 'dm') await startHost(c);
}

/** "Stop hosting": players are disconnected, and hosting stays off on this device until the DM hosts again. */
export async function stopHosting(id: string): Promise<void> {
  if (run?.role === 'dm' && run.campaignId === id) stopSession();
  await db.meta.set(hostOffKey(id), true);
}

/** "Issue a new join code": everyone is disconnected, and the old code and link stop reaching this device at once (Review Focus 4). */
export async function rotateCode(): Promise<void> {
  const r = run;
  if (!r?.host) return;
  const code = await r.host.rotateCode();
  if (!live(r)) return;
  r.listener?.close(); // the old peer id is given up now
  r.listener = undefined;
  clearTimeout(r.timer);
  r.code = code;
  r.key = keyOf('dm', r.campaignId!, code);
  session.status = 'starting';
  await refreshCampaigns();
  await listen(r);
}

/** Removes a player for good: their links close and their ID is never admitted or reused again. */
export async function removePlayer(id: string): Promise<void> {
  if (!run?.host) return;
  await run.host.removePlayer(id);
  await refreshCampaigns();
}

// ---- Player ----

/** The Join page: joins with a code, as a new player (optional display name) or with an existing player ID. */
export const join = (o: { code: string; playerId?: string; name?: string }): Promise<void> => startGuest(o);

/** Leaving the Join page before a join succeeded: back to following the open campaign. */
export function leaveJoin(): void {
  if (run?.role === 'player' && run.key === undefined) {
    stopSession();
    void follow(app.campaign);
  }
}

async function startGuest(o: { code: string; playerId?: string; name?: string; campaignId?: string }): Promise<void> {
  const r = begin('player', o.code, o.campaignId);
  try {
    const [{ Guest }, t] = await Promise.all([import('./guest.ts'), transport()]);
    if (!live(r)) return;
    r.t = t;
    r.guest = new Guest({ ...o, ...guestDeps(r) }); // M9: a rejoin passes its campaign id
    void dial(r);
  } catch (e) {
    if (live(r)) Object.assign(session, { status: 'offline', reason: msg(e) });
  }
}

async function dial(r: Run): Promise<void> {
  if (!live(r)) return;
  session.status = 'connecting';
  try {
    const link = await r.t!.dial((r.peerId ??= await peerIdFor(r.code)));
    if (!live(r)) return link.close();
    r.guest!.connect(link);
  } catch (e) {
    if (!live(r)) return;
    Object.assign(session, { status: 'offline', reason: msg(e) });
    redial(r);
  }
}

/** Schedules the next dial, once: a close and a bye for the same disconnect both report offline. */
function redial(r: Run): void {
  if (r.timer !== undefined) return;
  r.timer = setTimeout(() => { r.timer = undefined; void dial(r); }, backoff(r.attempt++));
}

function guestStatus(r: Run, s: GuestStatus, reason?: string): void {
  if (!live(r)) return;
  session.status = s;
  if (reason !== undefined) session.reason = reason;
  if (s === 'offline') {
    session.welcomed = false;
    redial(r);
  } else if (s === 'rejected') {
    clearTimeout(r.timer); // final (a new code, removed, refused): no more retries
    r.timer = undefined;
  } else if (s === 'online') {
    r.attempt = 0;
    session.reason = '';
    const id = r.guest!.campaignId!;
    r.campaignId = session.campaignId = id;
    r.key = keyOf('player', id, r.code);
    void (async () => {
      await r.guest!.idle(); // the welcome finishes (characters sent, packs asked for)
      if (!live(r)) return;
      session.welcomed = true;
      await refreshCampaigns();
      if (app.campaign?.id !== id) await setCampaign(id);
    })();
  }
}

function ask(r: Run, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!live(r)) return resolve(false);
    session.confirm = { text, answer: (ok) => { session.confirm = undefined; resolve(ok); } };
  });
}

function guestDeps(r: Run): Omit<GuestDeps, 'code' | 'playerId' | 'name' | 'campaignId'> {
  const save = async (p: Promise<unknown>) => { await p; changed(r); };
  return {
    confirmCampaign: (had, _offered, playerId) =>
      ask(r, `This device already plays “${had.name}” as ${had.sync?.playerId ?? 'another player'}. Join it as ${playerId} instead? Characters of ${had.sync?.playerId ?? 'the old ID'} stay on this device but stop syncing.`),
    loadCampaign: (id) => db.campaigns.get(id),
    saveCampaign: async (c) => { await save(db.campaigns.put(c)); await refreshCampaigns(); },
    updateSync: (id, fn) => db.campaigns.updateSync(id, fn),
    loadCharacters: (cid) => db.characters.list(cid),
    loadCharacter: (id) => db.characters.get(id),
    saveCharacter: (c) => save(db.characters.putSynced(c)),
    deleteCharacter: (id, at) => save(db.characters.delete(id, { at, network: true })),
    dropCharacter: ({ campaignId: _c, ...c }) => save(db.characters.putSynced(c)), // M1: kept on this device, out of the campaign
    packMeta: () => db.packs.listMeta(),
    savePack: (p) => save(db.packs.put(p)),
    onStatus: (s, reason) => guestStatus(r, s, reason),
    onPacks: (p) => { if (live(r)) session.packs = p; },
    onRoster: (x) => { if (live(r)) session.roster = x; },
    onTracker: (t) => { if (live(r)) session.tracker = t; },
    onRoll: (e, from) => { if (live(r)) addRemoteRoll(e, who(from, session.roster.filter((x) => x.ownerId === from).map((x) => x.name))); },
    onError: (e) => console.warn(e),
  };
}

// ---- Local changes and rolls go to the running engine ----

onLocalChange((kind, id) => {
  const r = run;
  if (!r) return;
  if (kind === 'character') {
    r.host?.characterChanged(id); // a restore from Deleted characters too: the owner's devices get it back
    r.guest?.characterChanged(id);
  } else if (kind === 'campaign' && id === r.campaignId) r.host?.campaignChanged();
  else if (kind === 'combat' && id === r.campaignId) r.host?.trackerChanged();
});

/** Stage 4: the player's own initiative roll, sent to the DM (the guest checks owner, range and that it is online). */
export function sendInitiative(characterId: string, total: number): void {
  run?.guest?.sendInitiative(characterId, total);
}

rollHooks.public = (e) => {
  run?.host?.broadcastRoll(e);
  run?.guest?.sendRoll(e);
};
