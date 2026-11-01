<script lang="ts">
  import type { ItemDef, MonsterDef, SpellDef } from '../lib/types.ts';
  import { leaveGuard } from '../lib/router.svelte.ts';
  import { message } from './creator/labels.ts';

  type Kind = 'monster' | 'spell' | 'item';
  type Draft = { monster: MonsterDef; spell: SpellDef; item: ItemDef };
  let { kind, onread, oncancel }: { kind: Kind; onread: (draft: Draft[Kind], notes: string[]) => void; oncancel: () => void } = $props();

  // The parsers load only when the DM presses Read (their own lazy chunks).
  const parse = {
    monster: async (s: string) => (await import('../lib/import/paste/monster.ts')).parseMonsterText(s),
    spell: async (s: string) => (await import('../lib/import/paste/spell.ts')).parseSpellText(s),
    item: async (s: string) => (await import('../lib/import/paste/item.ts')).parseItemText(s),
  };
  const what = $derived(kind === 'monster' ? 'stat block' : kind);
  const uid = $props.id();
  let text = $state('');
  let busy = $state(false);
  let error = $state('');

  // M5: typed or pasted text isn't thrown away by navigating off without a word.
  const guard = () => !text.trim() || confirm('Discard the pasted text?');
  const release = () => { if (leaveGuard.fn === guard) leaveGuard.fn = undefined; };
  $effect(() => {
    leaveGuard.fn = guard;
    return release;
  });

  async function read() {
    busy = true;
    error = '';
    try {
      const r = await parse[kind](text);
      if (r.refused) { error = r.refused; return; } // I3 / R8: too long, or 2024
      release(); // the editor this opens holds the draft now
      onread(r.draft, r.notes);
    } catch (e) {
      error = `Could not read the text: ${message(e)}`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="paste" role="dialog" aria-labelledby="{uid}-h" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && oncancel()}>
  <h2 id="{uid}-h">Paste a {what}</h2>
  <div class="field">
    <label for="{uid}-t">The {what}'s text, as copied from a PDF or web page</label>
    <!-- svelte-ignore a11y_autofocus (the dialog opens on a click; the text box is what it is for) -->
    <textarea id="{uid}-t" rows="12" autofocus bind:value={text}></textarea>
  </div>
  <p class="muted">The text is read on this device. You review the result in the editor; nothing is saved until you press Save.</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <div class="row">
    <button type="button" class="primary" disabled={busy || !text.trim()} onclick={read}>Read</button>
    <button type="button" onclick={oncancel}>Cancel</button>
  </div>
</div>

<style>
  /* An inline panel under the control that opened it: accent bar, no card. */
  .paste { border-left: 2px solid var(--accent); background: var(--panel); padding: 0.5rem 0.9rem 0.75rem; margin: 0.5rem 0; }
  .paste:focus-visible { outline-offset: -2px; }
  h2 { margin: 0.25rem 0 0; font-size: 1rem; }
  .field { margin: 0.5rem 0; }
  textarea { width: 100%; font-family: var(--mono); font-size: 0.9em; }
  p { margin: 0.5rem 0; }
</style>
