<script lang="ts">
  import { blankValues, buildEffect, EFFECT_FIELDS, EFFECT_LABEL, EFFECT_TYPES, PROFICIENCY_KEYS, type FieldValue } from '../lib/character/customEffect.ts';
  import { ABILITIES } from '../lib/rules/constants.ts';
  import type { Effect } from '../lib/types.ts';
  import { ABILITY_NAMES, titleCase } from './creator/labels.ts';

  // The effect form shared by the sheet's custom effects and the item editor: pick a type, fill its fields, validate with buildEffect.
  let { onadd }: { onadd: (e: Effect) => void } = $props();

  let type: Effect['type'] = $state(EFFECT_TYPES[0]);
  let values: Record<string, FieldValue> = $state(blankValues(EFFECT_TYPES[0]));
  let error = $state('');

  // A proficiency in a skill or a saving throw must name the exact key the sheet matches, so those values are picked, not typed.
  const keysFor = (name: string) => (type === 'proficiency' && name === 'value' ? PROFICIENCY_KEYS[values.category as string] : undefined);
  const keyLabel = (o: string) => (values.category === 'save' ? ABILITY_NAMES[o as keyof typeof ABILITY_NAMES] : titleCase(o));
  function setField(name: string, v: string) {
    values[name] = v;
    if (type === 'proficiency' && name === 'category') values.value = PROFICIENCY_KEYS[v]?.[0] ?? '';
  }

  function pick(t: Effect['type']) {
    type = t;
    values = blankValues(t);
    error = '';
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    const r = buildEffect(type, values);
    if ('error' in r) return void (error = r.error);
    onadd(r.effect);
    pick(type);
  }

  const toggleAbility = (name: string, a: string, on: boolean) => {
    const list = (values[name] as string[]).filter((x) => x !== a);
    values[name] = on ? [...list, a] : list;
  };
</script>

<form onsubmit={add}>
  <div class="field">
    <label for="ce-type">Type</label>
    <select id="ce-type" value={type} onchange={(e) => pick(e.currentTarget.value as Effect['type'])}>
      {#each EFFECT_TYPES as t (t)}<option value={t}>{EFFECT_LABEL[t]}</option>{/each}
    </select>
  </div>

  {#each EFFECT_FIELDS[type] as f (f.name)}
    {#if f.kind === 'check'}
      <label class="check"><input type="checkbox" checked={values[f.name] === true} onchange={(e) => (values[f.name] = e.currentTarget.checked)} /> {f.label}</label>
    {:else if f.kind === 'abilities'}
      <fieldset>
        <legend>{f.label}</legend>
        <div class="row">
          {#each ABILITIES as a (a)}
            <label class="check"><input type="checkbox" checked={(values[f.name] as string[]).includes(a)} onchange={(e) => toggleAbility(f.name, a, e.currentTarget.checked)} /> {ABILITY_NAMES[a]}</label>
          {/each}
        </div>
      </fieldset>
    {:else}
      <div class="field">
        <label for="ce-{f.name}">{f.label}{f.optional ? ' (optional)' : ''}</label>
        {#if keysFor(f.name)}
          <select id="ce-{f.name}" value={values[f.name]} onchange={(e) => setField(f.name, e.currentTarget.value)}>
            {#each keysFor(f.name) ?? [] as o (o)}<option value={o}>{keyLabel(o)}</option>{/each}
          </select>
        {:else if f.kind === 'select'}
          <select id="ce-{f.name}" value={values[f.name]} onchange={(e) => setField(f.name, e.currentTarget.value)}>
            {#if f.optional}<option value="">Always</option>{/if}
            {#each f.options ?? [] as o (o)}<option value={o}>{o}</option>{/each}
          </select>
        {:else if f.kind === 'longtext'}
          <textarea id="ce-{f.name}" rows="3" value={values[f.name] as string} oninput={(e) => (values[f.name] = e.currentTarget.value)}></textarea>
        {:else}
          <input id="ce-{f.name}" type="text" inputmode={f.kind === 'integer' ? 'numeric' : undefined} autocomplete="off" value={values[f.name] as string} oninput={(e) => (values[f.name] = e.currentTarget.value)} />
        {/if}
      </div>
    {/if}
  {/each}

  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <button type="submit" class="primary">Add effect</button>
</form>

<style>
  /* Fieldset, inputs and textarea use the global control style; the form stays a readable width in a wide drawer. */
  form {
    max-width: 36rem;
  }
</style>
