export interface ToastMsg { id: number; text: string; error: boolean }

/** Shown by src/ui/Toast.svelte, which App mounts once. */
export const toasts: ToastMsg[] = $state([]);

let next = 0;

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Shows a message for a few seconds (errors stay longer). */
export function toast(text: string, error = false): void {
  const id = ++next;
  toasts.push({ id, text, error });
  setTimeout(() => dismissToast(id), error ? 10_000 : 4_000);
}
