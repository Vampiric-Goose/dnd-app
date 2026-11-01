// An optional TURN relay, stored only on this device (db.meta 'relay'). WebRTC sends traffic through it when no direct path opens:
// a Windows "Public" network, a building Wi-Fi that isolates devices, or mobile data. Never synced or put in backups' sync data.

export interface Relay { urls: string[]; username: string; credential: string }

export const RELAY_KEY = 'relay';

/** The relay from what the user typed (URLs separated by commas, spaces or lines), or a message saying what is wrong. */
export function parseRelay(urls: string, username: string, credential: string): Relay | string {
  const list = urls.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
  if (!list.length) return 'Enter at least one relay server address.';
  if (list.length > 8) return 'Use at most 8 server addresses.';
  if (list.some((u) => !/^turns?:[^\s]{3,200}$/i.test(u))) return 'Relay addresses start with turn: or turns: (for example turn:relay.example.com:443?transport=tcp).';
  if (!username.trim() || !credential.trim()) return 'Enter the username and password your relay provider gave you.';
  if (username.length > 200 || credential.length > 200) return 'The username or password is too long.';
  return { urls: list, username: username.trim(), credential: credential.trim() };
}

/** A stored value back to a Relay, or undefined when it is missing or damaged. */
export function storedRelay(v: unknown): Relay | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Partial<Relay>;
  if (!Array.isArray(r.urls) || typeof r.username !== 'string' || typeof r.credential !== 'string') return undefined;
  const p = parseRelay(r.urls.join(' '), r.username, r.credential);
  return typeof p === 'string' ? undefined : p;
}
