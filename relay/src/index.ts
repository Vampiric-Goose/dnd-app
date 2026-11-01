// The dnd-app sync relay. Devices that cannot reach each other directly (hotel Wi-Fi isolates guests, strict mobile networks) each
// open a WebSocket here, and the room forwards messages between the DM (host) and the players. Payloads are end-to-end encrypted by
// the app with a key from the join code, which never reaches this server; the room only sees opaque strings and who sent them.
//
// Protocol (all text frames):
//   host  → room: {"to": id, "d": payload} | {"kick": id}       room → host:  {"open": id} | {"from": id, "d": payload} | {"close": id}
//   guest → room: payload                                       room → guest: {"ready": 1} once the host knows it, then payloads
//   either side may get {"err": "taken" | "nohost" | "full"} just before the room closes it.
import { DurableObject } from 'cloudflare:workers';

interface Env { ROOMS: DurableObjectNamespace<Room> }

/** Cloudflare's WebSocket message limit is 1 MiB; the app's largest message (256 KB of JSON, encrypted and base64'd) fits well below. */
const MAX_FRAME = 1_000_000;
/** Players' connections per room (a table is a handful; a player may have a phone and a laptop). */
const MAX_GUESTS = 40;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = /^\/room\/([A-Za-z0-9-]{8,64})$/.exec(url.pathname);
    if (!m) return new Response('dnd-app relay', { status: url.pathname === '/' ? 200 : 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const role = new URL(req.url).searchParams.get('role');
    const [client, server] = Object.values(new WebSocketPair());
    const host = this.ctx.getWebSockets('host')[0];
    const refuse = (err: string) => {
      server.accept();
      server.send(JSON.stringify({ err }));
      server.close(4000, err);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (role === 'host') {
      if (host) return refuse('taken');
      this.ctx.acceptWebSocket(server, ['host']);
    } else {
      if (!host) return refuse('nohost');
      if (this.ctx.getWebSockets('g').length >= MAX_GUESTS) return refuse('full');
      const id = crypto.randomUUID().slice(0, 12);
      this.ctx.acceptWebSocket(server, ['g', `g:${id}`]);
      host.send(JSON.stringify({ open: id }));
      server.send(JSON.stringify({ ready: 1 }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    if (typeof msg !== 'string' || msg.length > MAX_FRAME) return ws.close(1009, 'too big');
    const tags = this.ctx.getTags(ws);
    if (tags.includes('host')) {
      let m: { to?: unknown; d?: unknown; kick?: unknown };
      try { m = JSON.parse(msg); } catch { return; }
      if (typeof m.to === 'string' && typeof m.d === 'string') this.guest(m.to)?.send(m.d);
      else if (typeof m.kick === 'string') this.guest(m.kick)?.close(4001, 'closed by host');
      return;
    }
    const id = tags.find((t) => t.startsWith('g:'))?.slice(2);
    if (id) this.ctx.getWebSockets('host')[0]?.send(JSON.stringify({ from: id, d: msg }));
  }

  webSocketClose(ws: WebSocket): void { this.gone(ws); }
  webSocketError(ws: WebSocket): void { this.gone(ws); }

  private guest(id: string): WebSocket | undefined { return this.ctx.getWebSockets(`g:${id}`)[0]; }

  /** The host leaving ends every player's link (they redial and wait for it); a player leaving is told to the host. */
  private gone(ws: WebSocket): void {
    const tags = this.ctx.getTags(ws);
    try { ws.close(1000); } catch { /* already closed */ }
    if (tags.includes('host')) {
      for (const g of this.ctx.getWebSockets('g')) try { g.close(4002, 'host left'); } catch { /* already closed */ }
      return;
    }
    const id = tags.find((t) => t.startsWith('g:'))?.slice(2);
    if (id) this.ctx.getWebSockets('host')[0]?.send(JSON.stringify({ close: id }));
  }
}
