<script lang="ts">
  import { redactionTexts } from '../../lib/content/richtext.ts';
  import { playerItem, revealedView, revealField, revealRedaction } from '../../lib/items/playerView.ts';
  import { editableToRich, nextRedactionId, richToEditable, wrapRedaction } from '../../lib/items/textEdit.ts';
  import type { HideableField, ItemDef, PlayerView } from '../../lib/types.ts';
  import RichText from '../RichText.svelte';

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

  // Follow outside changes (the view loaded, Identify, the item text edited) but not our own emissions.
  $effect(() => {
    if (external !== richToEditable(editableToRich(draft))) draft = external;
  });

  const set = (patch: Partial<PlayerView>) => onchange({ ...base, ...patch });

  function setText(s: string) {
    draft = s;
    set({ text: s === richToEditable(item.text) ? undefined : editableToRich(s) });
  }

  function redactSelection() {
    if (!area) return;
    // Ids in use anywhere (item text, curse, override text, and the draft) so a new one never collides.
    const id = nextRedactionId([...item.text, ...(item.curse ?? []), ...(view?.text ?? []), ...editableToRich(draft)]);
    const next = wrapRedaction(draft, area.selectionStart, area.selectionEnd, id);
    if (next !== draft) setText(next);
  }

  const toggle = (f: HideableField, on: boolean) => set({ hidden: on ? [...new Set([...base.hidden, f])] : base.hidden.filter((h) => h !== f) });

  // Every redaction the players' text or the shown curse carries, with what it hides.
  const redactions = $derived([...redactionTexts([...(view?.text ?? item.text), ...(item.curse ?? [])])]);

  const seen = $derived(playerItem(item, view));
  const meta = $derived([seen.type, seen.magic ? seen.rarity : undefined, seen.attunement ? (typeof seen.attunement === 'string' ? `requires attunement ${seen.attunement}` : 'requires attunement') : undefined].filter(Boolean).join(', '));
</script>

<div class="field">
  <label for="pv-name">Name players see (optional cover name)</label>
  <input id="pv-name" type="text" autocomplete="off" value={view?.name ?? ''} oninput={(e) => set({ name: e.currentTarget.value || undefined })} />
</div>

<div class="field">
  <label for="pv-text">Text players see</label>
  <textarea id="pv-text" rows="6" bind:this={area} value={draft} oninput={(e) => setText(e.currentTarget.value)}></textarea>
  <div class="row">
    <button type="button" onclick={redactSelection}>Redact selection</button>
    {#if view?.text}<button type="button" onclick={() => set({ text: undefined })}>Use the item text</button>{/if}
  </div>
  <p class="muted">
    Select words, then Redact selection: players see a bar until you reveal them.
    {#if view?.text}This text is a separate copy: changes to the item's description no longer reach players.{/if}
  </p>
</div>

<fieldset>
  <legend>Hidden from players</legend>
  {#each FIELDS as [f, label] (f)}
    <div class="row">
      <label class="check"><input type="checkbox" checked={base.hidden.includes(f)} onchange={(e) => toggle(f, e.currentTarget.checked)} /> {label}</label>
      {#if base.hidden.includes(f)}<button type="button" aria-label="Reveal {f}" onclick={() => onchange(revealField(base, f))}>Reveal</button>{/if}
    </div>
  {/each}
</fieldset>

<h4>Redactions</h4>
{#each redactions as [id, hidden] (id)}
  <div class="row">
    <span><code>{id}</code>: {hidden}</span>
    {#if base.revealed.includes(id)}
      <span class="muted">Revealed</span>
    {:else}
      <button type="button" aria-label="Reveal redaction {id}" onclick={() => onchange(revealRedaction(base, id))}>Reveal</button>
    {/if}
  </div>
{:else}
  <p class="muted">No redactions.</p>
{/each}

<div class="row">
  <button type="button" onclick={() => onchange(revealedView(item))}>Identify</button>
  <span class="muted">Players now know everything: no cover name, nothing hidden, every redaction revealed.</span>
</div>

<section class="card" aria-label="Players see">
  <strong>Players see</strong>
  <h3>{seen.name}</h3>
  {#if meta}<p class="muted">{meta}</p>{/if}
  <RichText text={seen.text} />
  {#if seen.curse}<h4>Curse</h4><RichText text={seen.curse} />{/if}
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
