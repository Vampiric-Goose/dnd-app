<script lang="ts">
  import { packAllowed, sourceLabel } from '../../lib/content/sources.ts';
  import { db } from '../../lib/db.ts';
  import { app, saveCampaign } from '../../lib/store.svelte.ts';
  import type { Campaign, CampaignSettings, PackMeta } from '../../lib/types.ts';
  import Drawer from '../kit/Drawer.svelte';
  import SettingsGroup from '../SettingsGroup.svelte';
  import HostPanel from '../sync/HostPanel.svelte';

  type Bool = { [K in keyof CampaignSettings]-?: CampaignSettings[K] extends boolean ? K : never }[keyof CampaignSettings];
  type Module = keyof CampaignSettings['initiativeModules'];

  const rules: [Bool, string, string][] = [
    ['allowOverrides', 'Allow rule overrides', 'The creator and level-up let you ignore prerequisites. Problems become warnings.'],
    ['customOrigin', 'Custom origin', 'Let characters set their own ability bonuses instead of the race\'s.'],
    ['optionalClassFeatures', 'Optional class features', 'Offer the optional features some classes can swap in.'],
    ['multiclassing', 'Multiclassing', 'Allow characters to take levels in a second class.'],
    ['feats', 'Feats', 'Allow feats in place of ability score increases.'],
  ];
  const later: [Bool, string][] = [
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
  const readOnly = $derived(c?.sync?.role === 'player'); // a joined campaign: the DM's settings, sent by sync
  let packs: PackMeta[] = $state([]);
  let error = $state('');

  $effect(() => {
    db.packs.listMeta().then((m) => (packs = m.filter((p) => p.id !== 'srd' && packAllowed(p))), (e) => (error = String(e)));
  });

  // Edits a copy, then saves it; the store re-reads the campaign so the controls show what was stored.
  async function change(edit: (c: Campaign) => void) {
    if (!app.campaign || readOnly) return;
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

  // Closed drawers' one-line summaries.
  const onList = (xs: string[]) => (xs.length ? xs.join(', ') : 'All off');
  const hpText = { average: 'Average', roll: 'Roll' } as const;
  const encText = { off: 'Off', standard: 'Standard', variant: 'Variant' } as const;
</script>

<h1>Campaign settings</h1>

{#if !c}
  <p>{app.ready ? 'No campaign is open.' : 'Loading…'} <a href="#/">Open or create a campaign</a> first.</p>
{:else}
  {#if readOnly}
    <p role="note" class="lead">Settings are set by your DM. You joined <strong>{c.name}</strong> as {c.sync?.playerId}.</p>
  {:else}
    <p class="lead">Settings for <strong>{c.name}</strong>. Changes save as you make them.</p>
  {/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}

  {#if !readOnly}
    <SettingsGroup title="Play together"><HostPanel campaign={c} /></SettingsGroup>
  {/if}

  <fieldset class="bare" disabled={readOnly}>
  <legend class="sr-only">Campaign settings</legend>

  <SettingsGroup title="Character rules">
    <Drawer title="Options">
      {#snippet summary()}{onList(rules.filter(([k]) => c.settings[k]).map(([, l]) => l))}{/snippet}
      {#each rules as [key, label, help] (key)}
        <label class="check">
          <input type="checkbox" checked={c.settings[key]} onchange={(e) => setBool(key, e)} />
          <span>{label}<br /><span class="muted">{help}</span></span>
        </label>
      {/each}
    </Drawer>
    <Drawer title="Hit points and encumbrance">
      {#snippet summary()}{hpText[c.settings.hpMethod]} HP on level-up · Encumbrance {encText[c.settings.encumbrance].toLowerCase()}{/snippet}
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
    </Drawer>
  </SettingsGroup>

  <SettingsGroup title="Monsters">
    <label class="check">
      <input type="checkbox" checked={c.settings.crSuggestion} onchange={(e) => setBool('crSuggestion', e)} />
      <span>CR suggestion<br /><span class="muted">The monster creator suggests a CR from HP, AC, damage and attack bonus (DMG chapter 9).</span></span>
    </label>
  </SettingsGroup>

  <SettingsGroup title="Books">
    <Drawer title="Books in this campaign">
      {#snippet summary()}SRD 5.1{#if packs.length} + <span class="num">{packs.filter((p) => c.enabledPacks.includes(p.id)).length}</span> of <span class="num">{packs.length}</span> imported{/if}{/snippet}
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
    </Drawer>
  </SettingsGroup>

  <SettingsGroup title="Map and combat">
    <Drawer title="Map and monsters">
      {#snippet summary()}Diagonal <span class="num">{c.settings.diagonal}</span> · Monster HP {hpText[c.settings.monsterHp].toLowerCase()} · {onList(later.filter(([k]) => c.settings[k]).map(([, l]) => l))}{/snippet}
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
      <!-- On unless turned off, so campaigns made before it have it on too. -->
      <label class="check">
        <input type="checkbox" checked={c.settings.targeting !== false} onchange={(e) => { const v = e.currentTarget.checked; return change((n) => (n.settings.targeting = v)); }} />
        <span>Targeting: pick targets on the map; hits, saves and damage are worked out for you</span>
      </label>
      <label class="check">
        <input type="checkbox" checked={c.settings.reactions !== false} onchange={(e) => { const v = e.currentTarget.checked; return change((n) => (n.settings.reactions = v)); }} />
        <span>Ask about reactions: Opportunity Attacks, Counterspell, Shield and Hellish Rebuke wait for an answer (needs targeting)</span>
      </label>
      <label class="check">
        <input type="checkbox" checked={c.settings.critAll !== false} onchange={(e) => { const v = e.currentTarget.checked; return change((n) => (n.settings.critAll = v)); }} />
        <span>Critical hits double the whole damage total: roll once, then double it (house rule)</span>
      </label>
    </Drawer>

    <Drawer title="Initiative tracker modules">
      {#snippet summary()}<span class="num">{modules.filter(([k]) => c.settings.initiativeModules[k]).length}</span> of <span class="num">{modules.length}</span> on{/snippet}
      <fieldset class="bare">
        <legend class="sr-only">Initiative tracker modules</legend>
        {#each modules as [key, label] (key)}
          <label class="check">
            <input type="checkbox" checked={c.settings.initiativeModules[key]} onchange={(e) => setModule(key, e)} />
            <span>{label}</span>
          </label>
        {/each}
      </fieldset>
    </Drawer>
  </SettingsGroup>
  </fieldset>
{/if}

<style>
  h1 {
    margin-bottom: 0.25rem;
  }

  .lead {
    margin: 0 0 1rem;
  }

  fieldset.bare {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }

  select {
    max-width: 24rem;
  }
</style>
