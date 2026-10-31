<script lang="ts">
  import { packAllowed, sourceLabel } from '../../lib/content/sources.ts';
  import { db } from '../../lib/db.ts';
  import { app, saveCampaign } from '../../lib/store.svelte.ts';
  import type { Campaign, CampaignSettings, PackMeta } from '../../lib/types.ts';

  type Bool = { [K in keyof CampaignSettings]: CampaignSettings[K] extends boolean ? K : never }[keyof CampaignSettings];
  type Module = keyof CampaignSettings['initiativeModules'];

  const rules: [Bool, string, string][] = [
    ['allowOverrides', 'Allow rule overrides', 'The creator and level-up let you ignore prerequisites. Problems become warnings.'],
    ['customOrigin', 'Custom origin', 'Let characters set their own ability bonuses instead of the race\'s.'],
    ['optionalClassFeatures', 'Optional class features', 'Offer the optional features some classes can swap in.'],
    ['multiclassing', 'Multiclassing', 'Allow characters to take levels in a second class.'],
    ['feats', 'Feats', 'Allow feats in place of ability score increases.'],
  ];
  const later: [Bool, string][] = [
    ['crSuggestion', 'Suggest encounter CR'],
    ['fog', 'Fog of war'],
    ['freeMovement', 'Free movement on the map'],
    ['showMonsterHealth', 'Show monster health to players'],
  ];
  const modules: [Module, string][] = [
    ['hp', 'Hit points'],
    ['conditions', 'Conditions'],
    ['deathSaves', 'Death saves'],
    ['concentration', 'Concentration'],
    ['legendary', 'Legendary actions'],
    ['lair', 'Lair actions'],
    ['reactions', 'Reactions'],
  ];

  const c = $derived(app.campaign);
  let packs: PackMeta[] = $state([]);
  let error = $state('');

  $effect(() => {
    db.packs.listMeta().then((m) => (packs = m.filter((p) => p.id !== 'srd' && packAllowed(p))), (e) => (error = String(e)));
  });

  // Edits a copy, then saves it; the store re-reads the campaign so the controls show what was stored.
  async function change(edit: (c: Campaign) => void) {
    if (!app.campaign) return;
    const next = $state.snapshot(app.campaign) as Campaign;
    edit(next);
    error = '';
    try {
      await saveCampaign(next);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const setBool = (k: Bool, e: Event & { currentTarget: HTMLInputElement }) => {
    const v = e.currentTarget.checked;
    return change((n) => (n.settings[k] = v));
  };
  const setModule = (k: Module, e: Event & { currentTarget: HTMLInputElement }) => {
    const v = e.currentTarget.checked;
    return change((n) => (n.settings.initiativeModules[k] = v));
  };
  const togglePack = (id: string, e: Event & { currentTarget: HTMLInputElement }) => {
    const on = e.currentTarget.checked;
    return change((n) => (n.enabledPacks = on ? [...new Set([...n.enabledPacks, id])] : n.enabledPacks.filter((x) => x !== id)));
  };
</script>

<h1>Campaign settings</h1>

{#if !c}
  <p>{app.ready ? 'No campaign is open.' : 'Loading…'} <a href="#/">Open or create a campaign</a> first.</p>
{:else}
  <p>Settings for <strong>{c.name}</strong>. Changes save as you make them.</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}

  <h2>Character rules</h2>
  {#each rules as [key, label, help] (key)}
    <label class="check">
      <input type="checkbox" checked={c.settings[key]} onchange={(e) => setBool(key, e)} />
      <span>{label}<br /><span class="muted">{help}</span></span>
    </label>
  {/each}

  <div class="field">
    <label for="hp-method">Hit points on level-up</label>
    <select id="hp-method" value={c.settings.hpMethod} onchange={(e) => change((n) => (n.settings.hpMethod = e.currentTarget.value as 'average' | 'roll'))}>
      <option value="average">Take the average</option>
      <option value="roll">Roll</option>
    </select>
  </div>

  <div class="field">
    <label for="encumbrance">Encumbrance</label>
    <select id="encumbrance" value={c.settings.encumbrance} onchange={(e) => change((n) => (n.settings.encumbrance = e.currentTarget.value as 'off' | 'standard' | 'variant'))}>
      <option value="off">Off</option>
      <option value="standard">Standard (carrying capacity)</option>
      <option value="variant">Variant (encumbered at 5x and 10x Strength)</option>
    </select>
  </div>

  <h2>Books</h2>
  <p class="muted">Content from these books can be used by this campaign's characters and items.</p>
  <label class="check">
    <input type="checkbox" checked disabled />
    <span>System Reference Document 5.1 (always on)</span>
  </label>
  {#if packs.length > 1}
    <button type="button" disabled={packs.every((p) => c.enabledPacks.includes(p.id))} onclick={() => change((n) => (n.enabledPacks = [...new Set([...n.enabledPacks, ...packs.map((p) => p.id)])]))}>Use all</button>
  {/if}
  {#each packs as p (p.id)}
    <label class="check">
      <input type="checkbox" checked={c.enabledPacks.includes(p.id)} onchange={(e) => togglePack(p.id, e)} />
      <span>{#if p.name === p.source}{sourceLabel(p.source, p.homebrew)}{:else}{p.name} <span class="muted">({p.source})</span>{/if}</span>
    </label>
  {:else}
    <p class="muted">No books imported yet. <a href="#/packs">Import books</a>.</p>
  {/each}

  <h2>Used in later stages</h2>
  <p class="muted">These are saved now but have no effect yet.</p>

  <div class="field">
    <label for="diagonal">Diagonal movement on the map</label>
    <select id="diagonal" value={c.settings.diagonal} onchange={(e) => change((n) => (n.settings.diagonal = e.currentTarget.value as '5-5-5' | '5-10-5'))}>
      <option value="5-5-5">Every diagonal costs 5 ft</option>
      <option value="5-10-5">Alternating 5 ft and 10 ft</option>
    </select>
  </div>

  <div class="field">
    <label for="monster-hp">Monster hit points</label>
    <select id="monster-hp" value={c.settings.monsterHp} onchange={(e) => change((n) => (n.settings.monsterHp = e.currentTarget.value as 'average' | 'roll'))}>
      <option value="average">Take the average</option>
      <option value="roll">Roll</option>
    </select>
  </div>

  {#each later as [key, label] (key)}
    <label class="check">
      <input type="checkbox" checked={c.settings[key]} onchange={(e) => setBool(key, e)} />
      <span>{label}</span>
    </label>
  {/each}

  <fieldset>
    <legend>Initiative tracker modules</legend>
    {#each modules as [key, label] (key)}
      <label class="check">
        <input type="checkbox" checked={c.settings.initiativeModules[key]} onchange={(e) => setModule(key, e)} />
        <span>{label}</span>
      </label>
    {/each}
  </fieldset>
{/if}

<style>
  fieldset {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin: 0.75rem 0;
    min-width: 0;
  }
</style>
