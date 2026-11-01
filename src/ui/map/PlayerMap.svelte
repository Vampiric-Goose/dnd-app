<script lang="ts">
  // The players' live map. A joined campaign shows session.scene (as the DM last sent it) and lets the player drag their own token on
  // their turn: the drop moves it here at once, then goes to the DM, whose next scene replaces it (a refusal snaps it back). On the
  // DM's device in Player view (R12) the same player scene is built locally, read-only.
  import { db } from '../../lib/db.ts';
  import { snap, type Pt } from '../../lib/map/grid.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { currentActor } from '../../lib/sync/project.ts';
  import { sceneForPlayers, type PlayerScene } from '../../lib/sync/scene.ts';
  import { sendMove, session } from '../../lib/sync/session.svelte.ts';
  import type { Campaign, Character } from '../../lib/types.ts';
  import MapCanvas from './MapCanvas.svelte';
  import Drawer from '../kit/Drawer.svelte';
  import Workspace from '../kit/Workspace.svelte';

  let { campaign }: { campaign: Campaign } = $props();

  const joined = $derived(campaign.sync?.role === 'player');
  const settings = $derived(campaign.settings);
  let chars: Character[] = $state.raw([]);
  let local: PlayerScene | undefined = $state.raw();
  let error = $state('');
  let selected: string[] = $state([]);
  /** The optimistic drop, until the next scene from the DM. */
  let pending: { of: PlayerScene; id: string; at: Pt } | undefined = $state.raw();
  /** Final M3: a drop while offline snaps back (nothing is sent), and the status line says so until the next drop. */
  let unsent = $state(false);

  async function reload() {
    const cid = campaign.id;
    const c = await db.characters.list(cid);
    chars = c;
    if (!joined) {
      const [s, k] = await Promise.all([db.scenes.shown(cid), db.combat.get(cid)]);
      local = sceneForPlayers(s, c, k, settings);
    }
  }
  $effect(() => { void session.rev; void settings; reload().catch((e) => (error = e instanceof Error ? e.message : String(e))); });

  const base = $derived(joined ? session.scene : local);
  const view = $derived(base && pending?.of === base
    ? { ...base, tokens: base.tokens.map((t) => (t.id === pending!.id ? { ...t, ...pending!.at } : t)) } : base);

  const mine = (characterId: string | undefined) => {
    const c = characterId === undefined ? undefined : chars.find((x) => x.id === characterId);
    return joined && !!c && c.ownerId !== undefined && c.ownerId === campaign.sync?.playerId ? c : undefined;
  };
  const actor = $derived(currentActor(session.tracker));
  const owned = $derived(view?.tokens.filter((t) => mine(t.characterId)) ?? []);
  const myTurn = $derived(owned.some((t) => t.characterId === actor));
  const status = $derived(!owned.length ? '' : unsent && session.status !== 'online' ? "You're offline: that move wasn't sent." : settings.freeMovement ? 'Free movement is on.' : myTurn ? 'Your turn: drag your token.' : 'Wait for your turn to move.');

  const tokenOf = (id: string) => view?.tokens.find((t) => t.id === id);
  const canDrag = (id: string) => {
    const t = tokenOf(id);
    return !!t && !!mine(t.characterId) && (settings.freeMovement || actor === t.characterId);
  };
  const speedOf = (id: string) => {
    const c = mine(tokenOf(id)?.characterId);
    if (!c) return undefined;
    try { return computeSheet(c, { settings, viewer: 'player' }).speed.walk; } catch { return undefined; }
  };
  const onmove = (_ids: string[], primary: string, to: Pt) => {
    const t = tokenOf(primary);
    if (!base || !t || !canDrag(primary)) return;
    unsent = session.status !== 'online';
    if (unsent) return;
    pending = { of: base, id: primary, at: snap(base.grid, to, t.size) };
    sendMove(base.id, primary, to);
  };
</script>

{#if !view}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <p class="muted">The DM isn't showing a map right now.</p>
{:else}
  <!-- The same canvas as the DM's; the panel (a sheet on phones, always up) holds the player's own tokens and the turn status. -->
  <Workspace fill panelLabel="Your tokens" open={true}>
    {#key view.id}
      <MapCanvas
        width={view.width}
        height={view.height}
        image={view.image}
        grid={view.grid}
        tokens={view.tokens}
        fog={view.fog}
        dm={false}
        diagonal={settings.diagonal}
        {selected}
        {canDrag}
        {speedOf}
        onselect={(ids) => (selected = ids)}
        {onmove}
        rev={session.rev}
      />
    {/key}
    {#snippet panel()}
      {#if error}<p role="alert" class="error">{error}</p>{/if}
      <h2 class="scene-name">{view.name}</h2>
      {#if !joined}<p class="muted note">Player view: read-only</p>{/if}
      <p class="status" role="status" aria-live="polite">{status}</p>
      {#if owned.length}
        <div class="caption">Your tokens</div>
        <ul class="plain tokens">{#each owned as t (t.id)}{@render row(t)}{/each}</ul>
      {/if}
      {#if view.tokens.length}
        <Drawer title="Tokens ({view.tokens.length})">
          <ul class="plain tokens">{#each view.tokens as t (t.id)}{@render row(t)}{/each}</ul>
        </Drawer>
      {/if}
    {/snippet}
  </Workspace>
{/if}

{#snippet row(t: { id: string; name: string; color: string; health?: string; conditions: string[] })}
  <li><span class="dot" style:background={t.color} aria-hidden="true"></span><span class="nm">{t.name}</span>{#if t.health}<span class="muted"> · {t.health}</span>{/if}{#if t.conditions.length}<span class="muted"> · {t.conditions.join(', ')}</span>{/if}</li>
{/snippet}

<style>
  .scene-name {
    margin: 0 0 0.2rem;
    font-size: 1.2rem;
    color: var(--text-strong);
  }

  .note {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }

  .status {
    margin: 0.4rem 0 0.9rem;
    color: var(--text-strong);
  }

  .tokens {
    margin: 0.25rem 0 0.75rem;
  }

  .tokens li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.3rem 0;
  }

  .tokens li + li {
    border-top: 1px solid var(--line);
  }

  .nm {
    color: var(--text-strong);
  }

  .dot {
    flex: none;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    margin-right: 0.5rem;
    box-shadow: 0 0 0 1px var(--line-strong);
  }
</style>
