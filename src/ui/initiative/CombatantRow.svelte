<script lang="ts">
  // One slim tracker row: initiative, name, HP bar, condition chips (and Move up / down on wider screens; phones get them in the
  // panel). Every other control is in CombatantPanel, shown for the picked row.
  import { deathState } from '../../lib/character/play.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import type { CampaignSettings, Character, Combat, Combatant } from '../../lib/types.ts';
  import Bar from '../kit/Bar.svelte';
  import Pill from '../kit/Pill.svelte';
  import { reorder } from './order.ts';

  let { x, i, count, current, selected, ch, settings, prompt, edit, onselect }: {
    x: Combatant; i: number; count: number; current: boolean; selected: boolean; ch: Character | undefined; settings: CampaignSettings;
    prompt: { dc?: number; lost?: boolean } | undefined; edit: (fn: (c: Combat) => Combat) => Promise<void>; onselect: () => void;
  } = $props();

  // The same HP, conditions and life state as the panel shows.
  const mods = $derived(settings.initiativeModules);
  const pc = $derived(x.kind === 'pc');
  const sheet = $derived(ch ? computeSheet(ch, { settings, viewer: 'dm' }) : undefined);
  const hp = $derived(ch ? { now: ch.state.hp, max: sheet?.maxHp, temp: ch.state.tempHp } : { now: x.hp, max: x.maxHp, temp: x.tempHp ?? 0 });
  const conditions = $derived(pc ? ch?.state.conditions ?? [] : x.conditions ?? []);
  const life = $derived(ch ? deathState(ch.state) : 'ok');
</script>

<div class="crow">
  <span class="init num" title="Initiative">{x.init ?? '—'}</span>
  <button type="button" class="name" aria-pressed={selected} onclick={onselect}>{x.name}</button>
  <span class="hp">
    {#if mods.hp && x.kind !== 'lair'}
      {#if hp.now !== undefined && hp.max !== undefined}
        <Bar value={hp.now} max={hp.max} temp={hp.temp} label="{x.name} hit points" tone={pc ? 'accent' : 'danger'} />
      {/if}
      <span class="hpn num">{hp.now ?? '—'}{#if hp.max !== undefined}<span class="muted">/{hp.max}</span>{/if}</span>
    {/if}
  </span>
  <span class="chips">
    {#if mods.hp && life !== 'ok'}<span class="life">{life === 'dying' ? 'Dying' : life === 'stable' ? 'Stable' : 'Dead'}</span>{/if}
    {#if prompt?.dc !== undefined}<Pill label="Con save DC {prompt.dc}" accent />{/if}
    {#if mods.conditions && x.kind !== 'lair'}
      {#each conditions as name (name)}
        {@const d = x.durations?.[name]}
        <Pill label="{name}{d ? ` ${d.rounds}` : ''}" />
      {/each}
    {/if}
    {#if mods.concentration && x.concentrating}<Pill label="Concentrating" accent />{/if}
    {#if mods.reactions && x.reactionUsed}<Pill label="Reaction used" />{/if}
    {#if x.hidden}<span class="muted small">Hidden</span>{/if}
  </span>
  <span class="move">
    <button type="button" aria-label="Move {x.name} up" disabled={i === 0 || current} onclick={() => edit((c) => reorder(c, x.id, i - 1))}>↑</button>
    <button type="button" aria-label="Move {x.name} down" disabled={i === count - 1 || current} onclick={() => edit((c) => reorder(c, x.id, i + 1))}>↓</button>
  </span>
</div>

<style>
  .crow {
    display: grid;
    grid-template-columns: 2.2rem minmax(6rem, 14rem) minmax(5rem, 11rem) minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.25rem 0.9rem;
    padding: 0.2rem 0.5rem;
    min-height: 2.6rem;
  }

  .init {
    color: var(--text-strong);
    text-align: right;
  }

  .name {
    min-height: 2rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-strong);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name:hover:not(:disabled),
  .name[aria-pressed='true'] {
    background: transparent;
    border: 0;
    color: var(--accent);
  }

  .hp {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .hp :global(.bar) {
    flex: 1;
  }

  .hpn {
    flex: none;
    font-size: 0.85rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .life {
    color: var(--danger);
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .small {
    font-size: 0.8rem;
  }

  .move {
    display: flex;
    gap: 0.25rem;
  }

  .move button {
    min-height: 1.9rem;
    min-width: 1.9rem;
    padding: 0 0.4rem;
    border-color: transparent;
    color: var(--muted);
  }

  .move button:hover:not(:disabled) {
    color: var(--text-strong);
  }

  /* Narrower: the chips go on a second line under the name. */
  @media (max-width: 1199px) {
    .crow {
      grid-template-columns: 2.2rem minmax(0, 1fr) minmax(5rem, 9rem) auto;
    }

    .chips {
      grid-column: 2 / -1;
      grid-row: 2;
    }

    .chips:empty {
      display: none;
    }
  }

  /* Phones: init · name · HP; Move up / down live in the panel. */
  @media (max-width: 767px) {
    .crow {
      grid-template-columns: 2rem minmax(0, 1fr) 6.5rem;
      padding: 0.15rem 0.4rem;
    }

    .name {
      min-height: 44px;
    }

    .move {
      display: none;
    }
  }
</style>
