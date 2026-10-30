// Pure (no Svelte): unit-tested under Node, where navigator/matchMedia may not exist.
const DAY = 86_400_000;
const REMIND_AFTER = 14 * DAY;

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ reports itself as a Mac, but only the iPad has a touch screen.
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** True when launched from the Home Screen (iOS sets navigator.standalone; others use the display-mode query). */
export function isStandalone(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator as { standalone?: boolean }).standalone === true
    || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
}

/** Remind when there is data and no backup in the last 14 days, unless snoozed. */
export function needsBackupReminder(o: { lastBackupAt?: number; snoozedUntil?: number; hasData: boolean; now: number }): boolean {
  if (!o.hasData) return false;
  if (o.snoozedUntil !== undefined && o.snoozedUntil > o.now) return false;
  return o.lastBackupAt === undefined || o.now - o.lastBackupAt > REMIND_AFTER;
}
