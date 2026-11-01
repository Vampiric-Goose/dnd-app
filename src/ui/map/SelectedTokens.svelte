<script lang="ts">
  // The panel's Selected tab: one token's controls (HP with damage/heal for monsters, hidden, name/size/portrait, Add to combat, Remove),
  // or a count and the bulk actions for several. Every edit goes out through onpatch, as the token list's did.
  import { SIZE_NAMES } from '../../lib/monsters/library.ts';
  import type { Size, Token } from '../../lib/types.ts';
  import Bar from '../kit/Bar.svelte';
  import Drawer from '../kit/Drawer.svelte';
  import Pill from '../kit/Pill.svelte';

  let { tokens, busy, onselect, onpatch, onremove, onportrait, oncombat }: {
    tokens: (Token & { conditions?: string[] })[]; busy: boolean;
    onselect: (ids: string[]) => void; onpatch: (id: string, patch: Partial<Token>) => void;
    onremove: (ids: string[]) => void; onportrait: (id: string, file: File) => void; oncombat: () => void;
  } = $props();

  const SIZES = Object.keys(SIZE_NAMES) as Size[];
  const value = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const hp = (e: Event) => { const v = value(e).trim(); const n = Math.round(Number(v)); return v === '' || !Number.isFinite(n) ? undefined : Math.max(0, Math.min(9999, n)); };

  let amount: number | null = $state(null);
  const ok = $derived(typeof amount === 'number' && Number.isInteger(amount) && amount > 0);
  /** Damage or heal: the same write as typing the new HP into the HP field (0 to Max HP). */
  function apply(t: Token, sign: 1 | -1) {
    if (!ok || t.hp === undefined) return;
    onpatch(t.id, { hp: Math.max(0, Math.min(t.maxHp ?? 9999, t.hp + sign * amount!)) });
    amount = null;
  }
</script>

{#if !tokens.length}
  <p class="muted">Pick a token on the map, or in the Tokens tab.</p>
{:else if tokens.length === 1}
  {@const t = tokens[0]}
  {#key t.id}
    <div class="head">
      <h2>{t.name}</h2>
      <Pill label={SIZE_NAMES[t.size]} />
    </div>

    {#if t.hp !== undefined || t.monsterId}
      <div class="caption">Hit points</div>
      <p class="hpline"><span class="num now">{t.hp ?? '—'}</span>{#if t.maxHp}<span class="num muted"> / {t.maxHp}</span>{/if}</p>
      {#if t.hp !== undefined && t.maxHp}<Bar value={t.hp} max={t.maxHp} label="{t.name} hit points" tone={t.monsterId ? 'danger' : 'accent'} />{/if}
    {/if}
    {#if t.monsterId}
      <div class="row hpops">
        <input class="num amt" type="number" min="0" step="1" inputmode="numeric" placeholder="Amount" aria-label="{t.name} amount" bind:value={amount} />
        <button type="button" class="danger" aria-label="Damage {t.name}" disabled={!ok || t.hp === undefined} onclick={() => apply(t, -1)}>− Damage</button>
        <button type="button" aria-label="Heal {t.name}" disabled={!ok || t.hp === undefined} onclick={() => apply(t, 1)}>+ Heal</button>
      </div>
      <div class="row">
        <label class="small">HP <input class="num" type="number" min="0" value={t.hp ?? ''} onchange={(e) => onpatch(t.id, { hp: hp(e) })} /></label>
        <label class="small">Max HP <input class="num" type="number" min="0" value={t.maxHp ?? ''} onchange={(e) => onpatch(t.id, { maxHp: hp(e) })} /></label>
      </div>
    {:else if t.characterId}
      <p class="muted note">HP follows the character sheet.</p>
    {/if}
    {#if t.conditions?.length}<div class="row conds">{#each t.conditions as c (c)}<Pill label={c} />{/each}</div>{/if}

    <label class="check"><input type="checkbox" checked={!!t.hidden} onchange={(e) => onpatch(t.id, { hidden: (e.currentTarget as HTMLInputElement).checked || undefined })} /> Hidden from players</label>

    <Drawer title="Name, size and portrait">
      {#snippet summary()}{SIZE_NAMES[t.size]}{#if t.portrait} · portrait{/if}{/snippet}
      <label class="field">Name
        <input maxlength="100" value={t.name} onchange={(e) => { const n = value(e).trim().slice(0, 100); if (n) onpatch(t.id, { name: n }); }} />
      </label>
      <label class="field">Size
        <select value={t.size} onchange={(e) => onpatch(t.id, { size: value(e) as Size })}>
          {#each SIZES as s}<option value={s}>{SIZE_NAMES[s]}</option>{/each}
        </select>
      </label>
      <label class="field">Portrait
        <input type="file" accept="image/*" onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) onportrait(t.id, f); }} />
      </label>
    </Drawer>

    <div class="row actions">
      <button type="button" class="primary" disabled={busy} onclick={oncombat}>Add to combat</button>
      <button type="button" class="danger" onclick={() => onremove([t.id])} aria-label="Remove {t.name}">Remove</button>
      <button type="button" onclick={() => onselect([])}>Clear selection</button>
    </div>
  {/key}
{:else}
  <p class="head"><span class="num count">{tokens.length}</span> selected</p>
  <p class="muted names">{tokens.map((t) => t.name).join(', ')}</p>
  <div class="row actions">
    <button type="button" class="primary" disabled={busy} onclick={oncombat}>Add to combat</button>
    <button type="button" class="danger" onclick={() => onremove(tokens.map((t) => t.id))}>Remove selected</button>
    <button type="button" onclick={() => onselect([])}>Clear selection</button>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 0 0 0.75rem;
  }

  h2 {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }

  .count {
    font-size: 1.5rem;
    color: var(--text-strong);
    margin-right: 0.3rem;
  }

  .head:has(.count) {
    justify-content: flex-start;
  }

  .hpline {
    margin: 0.15rem 0 0.4rem;
  }

  .now {
    font-size: 1.6rem;
    color: var(--text-strong);
  }

  .hpops {
    margin: 0.6rem 0 0.4rem;
  }

  .amt {
    width: 6rem;
  }

  .small {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .small input {
    width: 4.5rem;
  }

  .note {
    margin: 0.3rem 0;
    font-size: 0.9rem;
  }

  .conds {
    margin: 0.5rem 0;
    gap: 0.3rem;
  }

  .field input[type='file'] {
    max-width: 100%;
  }

  .names {
    margin: 0 0 0.75rem;
  }

  .actions {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--line);
  }
</style>
