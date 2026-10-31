<script lang="ts">
  import { tick } from 'svelte';
  import { redactionIds, redactionTexts } from '../../lib/content/richtext.ts';
  import { playerItem, pruneRevealed, revealedView, revealField, revealRedaction } from '../../lib/items/playerView.ts';
  import { editableToRich, expandShorthand, nextRedactionId, richToEditable, wrapRedaction } from '../../lib/items/textEdit.ts';
  import type { HideableField, ItemDef, PlayerView } from '../../lib/types.ts';
  import EntityDetail from '../EntityDetail.svelte';

  let { item, view, onchange }: { item: ItemDef; view: PlayerView | undefined; onchange: (view: PlayerView | undefined) => void } = $props();

  const FIELDS: [HideableField, string][] = [
    ['rarity', 'Rarity (item reads as mundane)'], ['attunement', 'Attunement'], ['bonuses', 'Bonuses'], ['effects', 'Effects'], ['charges', 'Charges'], ['curse', 'Curse'],
  ];

  // Player text model: `view.text` is an optional override copy of the description. While it is unset the
  // players' text is the item's own `text` (which may carry redaction markers), so it follows later edits to
  // the description. The first edit here stores a copy in `view.text`; "Use the item text" drops it again.
  const base = $derived(view ?? { hidden: [], revealed: [] });
  const external = $derived(richToEditable(view?.text ?? item.text));
  let draft = $state('');
  let area: HTMLTextAreaElement | undefined = $state();
  let hint = $state('');

  // Follow outside changes (the view loaded, Identify, the item text edited) but not our own emissions.
  $effect(() => {
    if (external !== richToEditable(editableToRich(draft))) draft = external;
  });

  // Every redaction id in use (item text, curse, override text) plus the revealed ones, which a new redaction must not reuse.
  const taken = $derived([...redactionIds([...item.text, ...(item.curse ?? []), ...(view?.text ?? [])]), ...base.revealed]);

  // Revealed ids whose redaction is gone are dropped on the way out, so a later redaction can't pick one up already revealed.
  const emit = (v: PlayerView) => onchange(pruneRevealed(item, v));
  const set = (patch: Partial<PlayerView>) => emit({ ...base, ...patch });

  async function setText(s: string, caret?: number) {
    hint = '';
    const expanded = expandShorthand(s, taken); // ||secret|| becomes a numbered redaction
    draft = expanded;
    set({ text: richToEditable(editableToRich(expanded)) === richToEditable(item.text) ? undefined : editableToRich(expanded) });
    if (area && expanded !== s) {
      // Keep the caret where it was, measured from the end, since the text before it grew.
      const at = expanded.length - (s.length - (caret ?? s.length));
      await tick();
      area.setSelectionRange(at, at);
    }
  }

  function redactSelection() {
    if (!area) return;
    const v = area.value;
    const id = nextRedactionId(editableToRich(v), taken);
    const next = wrapRedaction(v, area.selectionStart, area.selectionEnd, id);
    if (next === v) hint = "Select text that isn't already redacted.";
    else void setText(next);
  }

  const toggle = (f: HideableField, on: boolean) => set({ hidden: on ? [...new Set([...base.hidden, f])] : base.hidden.filter((h) => h !== f) });

  // Every redaction the players' text or the shown curse carries, with what it hides (scanned apart: a span left open in the text doesn't reach the curse).
  const redactions = $derived([...new Map([...redactionTexts(view?.text ?? item.text), ...redactionTexts(item.curse ?? [])])]);

  const seen = $derived(playerItem(item, view));
</script>

<div class="field">
  <label for="pv-name">Name players see (optional cover name)</label>
  <input id="pv-name" type="text" autocomplete="off" value={view?.name ?? ''} oninput={(e) => set({ name: e.currentTarget.value || undefined })} />
</div>

<div class="field">
  <label for="pv-text">Text players see</label>
  <textarea id="pv-text" rows="6" bind:this={area} value={draft} oninput={(e) => setText(e.currentTarget.value, e.currentTarget.selectionStart)}></textarea>
  <div class="row">
    <button type="button" onclick={redactSelection}>Redact selection</button>
    {#if view?.text}<button type="button" onclick={() => set({ text: undefined })}>Use the item text</button>{/if}
  </div>
  {#if hint}<p role="status" class="error">{hint}</p>{/if}
  <p class="muted">
    Select words, then Redact selection, or type ||secret|| around them: players see a bar until you reveal them.
    {#if view?.text}This text is a separate copy: changes to the item's description no longer reach players.{/if}
  </p>
</div>

<fieldset>
  <legend>Hidden from players</legend>
  {#each FIELDS as [f, label] (f)}
    <div class="row">
      <label class="check"><input type="checkbox" checked={base.hidden.includes(f)} onchange={(e) => toggle(f, e.currentTarget.checked)} /> {label}</label>
      {#if base.hidden.includes(f)}<button type="button" aria-label="Reveal {f}" onclick={() => emit(revealField(base, f))}>Reveal</button>{/if}
    </div>
  {/each}
</fieldset>

<h3>Redactions</h3>
{#each redactions as [id, hidden] (id)}
  <div class="row">
    <span><code>{id}</code>: {hidden}</span>
    {#if base.revealed.includes(id)}
      <span class="muted">Revealed</span>
    {:else}
      <button type="button" aria-label="Reveal redaction {id}" onclick={() => emit(revealRedaction(base, id))}>Reveal</button>
    {/if}
  </div>
{:else}
  <p class="muted">No redactions.</p>
{/each}

<div class="row">
  <button type="button" onclick={() => emit(revealedView(item))}>Identify</button>
  <span class="muted">Players now know everything: no cover name, nothing hidden, every redaction revealed.</span>
</div>

<section class="card" aria-label="Players see">
  <strong>Players see</strong>
  <EntityDetail entity={seen} />
</section>

<style>
  fieldset {
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    margin: 0.75rem 0;
  }

  textarea {
    font: inherit;
    color: inherit;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    padding: 0.4rem 0.7rem;
    max-width: 100%;
    box-sizing: border-box;
  }
</style>
