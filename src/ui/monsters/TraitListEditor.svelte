<script lang="ts">
  import { editableToRich, richToEditable } from '../../lib/items/textEdit.ts';
  import type { Trait } from '../../lib/types.ts';

  // Uncontrolled after mount: each row keeps its own typed text (so a half-typed paragraph is never rewritten under the
  // cursor) and every edit reports the whole list. Effects and choices on a trait ride along untouched.
  let { id, label, traits, onchange }: { id: string; label: string; traits: Trait[]; onchange: (ts: Trait[]) => void } = $props();

  type Row = { key: number; name: string; text: string; rest: Omit<Trait, 'name' | 'text'> };
  let next = 0;
  const toRow = ({ name, text, ...rest }: Trait): Row => ({ key: next++, name, text: richToEditable(text), rest });
  // svelte-ignore state_referenced_locally
  let rows: Row[] = $state(traits.map(toRow));

  const emit = () => onchange(rows.filter((r) => r.name.trim() || r.text.trim()).map((r) => ({ ...r.rest, name: r.name.trim(), text: editableToRich(r.text) })));
  const add = () => { rows.push(toRow({ name: '', text: [] })); };
  const remove = (i: number) => { rows.splice(i, 1); emit(); };
  const up = (i: number) => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; emit(); };
</script>

<fieldset>
  <legend>{label}</legend>
  {#each rows as r, i (r.key)}
    <div class="trait">
      <div class="field">
        <label for="{id}-{r.key}-n">Name</label>
        <input id="{id}-{r.key}-n" type="text" autocomplete="off" value={r.name} oninput={(e) => { r.name = e.currentTarget.value; emit(); }} />
      </div>
      <div class="field">
        <label for="{id}-{r.key}-t">Text</label>
        <textarea id="{id}-{r.key}-t" rows="3" value={r.text} oninput={(e) => { r.text = e.currentTarget.value; emit(); }}></textarea>
      </div>
      <div class="row">
        {#if i > 0}<button type="button" aria-label="Move {r.name || 'this entry'} up" onclick={() => up(i)}>Move up</button>{/if}
        <button type="button" class="danger" aria-label="Remove {r.name || 'this entry'}" onclick={() => remove(i)}>Remove</button>
      </div>
    </div>
  {/each}
  <button type="button" onclick={add}>Add to {label.toLowerCase()}</button>
</fieldset>

<style>
  /* a caption and a hairline, not a box; each entry is indented under a thin rule */
  fieldset { border: 0; border-top: 1px solid var(--line); border-radius: 0; margin: 0.75rem 0; padding: 0.25rem 0 0; min-width: 0; }
  legend { padding: 0 0.4rem 0 0; }
  .trait { border-left: 1px solid var(--line-strong); padding: 0 0 0.25rem 0.75rem; margin-bottom: 0.75rem; }
  .field { margin: 0.4rem 0; }
  textarea { width: 100%; }
</style>
