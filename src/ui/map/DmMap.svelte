<script lang="ts">
  // The DM's map: scenes, image import, grid settings and tokens. Every write goes through editScene on the fresh record (A2), and the page
  // re-reads its scenes after each write and on session.rev.
  import { numberedNames } from '../../lib/combat/combat.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { resizeImage } from '../../lib/images.ts';
  import { encodeFog, newFog, paintFog, type FogEdit } from '../../lib/map/fog.ts';
  import { snap, type Pt } from '../../lib/map/grid.ts';
  import { addTokens, liveHp, MAX_SIDE, MAX_TOKENS, moveTokens, newScene, patchToken, regrid, removeTokens, tokenColor, type NewToken } from '../../lib/map/scene.ts';
  import { arrowsOn } from '../../lib/map/actions.ts';
  import { addTokensToCombat, editScene, tokenForCharacter, tokenForMonster } from '../../lib/map/store.ts';
  import { currentRun, patchCombatant } from '../../lib/combat/combat.ts';
  import { budgetApplies, combatantForToken, effectiveSpeed, recordMove, remainingFeet } from '../../lib/combat/movement.ts';
  import { feetBetween } from '../../lib/map/grid.ts';
  import { updateCombat } from '../../lib/combat/store.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import { soundMonster } from '../../lib/monsters/homebrew.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { getIndex, saveCampaign } from '../../lib/store.svelte.ts';
  import { MAX_BLOB } from '../../lib/sync/protocol.ts';
  import { clearDeclared, declareAction, session } from '../../lib/sync/session.svelte.ts';
  import type { Campaign, Character, Combat, Combatant, MonsterDef, RaceDef, Scene, Sheet, Size, Token } from '../../lib/types.ts';
  import GridForm from './GridForm.svelte';
  import { detectSquareGrid } from '../../lib/map/detectGrid.ts';
  import MapCanvas from './MapCanvas.svelte';
  import SelectedTokens from './SelectedTokens.svelte';
  import TokenList from './TokenList.svelte';
  import MonsterSearch from '../initiative/MonsterSearch.svelte';
  import Drawer from '../kit/Drawer.svelte';
  import Menu, { type MenuItem } from '../kit/Menu.svelte';
  import Tabs from '../kit/Tabs.svelte';
  import Workspace from '../kit/Workspace.svelte';
  import { untrack } from 'svelte';

  let { campaign }: { campaign: Campaign } = $props();

  let scenes: Scene[] = $state.raw([]);
  let chars: Character[] = $state.raw([]);
  let combat: Combat | undefined = $state.raw();
  let index: ContentIndex | undefined = $state.raw();
  let own: MonsterDef[] = $state.raw([]);
  let selected: string[] = $state([]);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  const cid = $derived(campaign.id);
  const settings = $derived(campaign.settings);
  const scene = $derived(scenes.find((s) => s.id === router.query.get('scene')) ?? scenes.find((s) => s.shown) ?? scenes[0]); // W5: a resumed fight's scene is shown

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  async function run(fn: () => Promise<void>) {
    error = notice = '';
    busy = true;
    try { await fn(); } catch (e) { error = msg(e); } finally { busy = false; }
  }

  async function reload() {
    const [s, c, k] = await Promise.all([db.scenes.list(cid), db.characters.list(cid), db.combat.get(cid)]);
    scenes = s.sort((a, b) => a.name.localeCompare(b.name));
    chars = c.sort((a, b) => a.name.localeCompare(b.name));
    combat = k;
  }
  $effect(() => { void session.rev; reload().catch((e) => (error = msg(e))); });
  $effect(() => {
    getIndex(cid).then((ix) => (index = ix), (e) => (error = msg(e)));
    db.monsters.list(cid).then((m) => (own = m.filter(soundMonster)), (e) => (error = msg(e)));
  });

  const pick = (id: string) => { selected = []; location.hash = `#/map?scene=${encodeURIComponent(id)}`; };

  /** One write to the current scene, then a fresh read. */
  const edit = (fn: (s: Scene) => Scene) => run(async () => {
    if (!scene) return;
    await editScene(scene.id, fn);
    await reload();
  });

  // --- scenes ---
  let newName = $state('');
  let newFile: File | undefined = $state.raw();
  let fileInput: HTMLInputElement | undefined = $state();
  const create = (e: Event) => { e.preventDefault(); return run(async () => {
    const name = newName.trim().slice(0, 100);
    if (!name) return;
    let image: { hash: string; width: number; height: number } | undefined;
    if (newFile) {
      let blob = await resizeImage(newFile, MAX_SIDE);
      // I1: Safari can't encode WebP (it falls back to a huge PNG): JPEG then
      if (blob.size > MAX_BLOB || blob.type !== 'image/webp') blob = await resizeImage(newFile, MAX_SIDE, 'image/jpeg', 0.85);
      if (blob.size > MAX_BLOB) throw new Error('That image is too big, even shrunk (over 8 MB). Try a smaller image.');
      const bmp = await createImageBitmap(blob);
      image = { hash: await db.blobs.put(blob), width: bmp.width, height: bmp.height };
      bmp.close();
    }
    const s = newScene(cid, name, image);
    await db.scenes.put(s);
    newName = '';
    newFile = undefined;
    if (fileInput) fileInput.value = '';
    await reload();
    pick(s.id);
    newDialog?.close();
  }); };

  // --- layout: the panel's tab, the phone sheet, the New scene dialog ---
  let tab = $state('tokens');
  let sheet = $state(false); // phones: the panel opened without a selection
  let newDialog: HTMLDialogElement | undefined = $state();
  // A new pick on the map or in the list shows it.
  $effect(() => { if (selected.length) untrack(() => (tab = 'selected')); });
  const sceneItems = $derived<MenuItem[]>([
    ...scenes.map((s) => ({ label: `${s.name}${s.shown ? ' (shown)' : ''}`, checked: s.id === scene?.id, onselect: () => pick(s.id) })),
    { separator: true },
    { label: 'New scene…', onselect: () => setTimeout(() => newDialog?.showModal()) }, // after the menu has closed
  ]);


  const rename = (name: string) => { const n = name.trim().slice(0, 100); if (n && n !== scene?.name) void edit((s) => ({ ...s, name: n })); };
  const remove = () => run(async () => {
    if (!scene || !confirm(`Delete the scene "${scene.name}"? Its tokens go with it.`)) return;
    await db.scenes.delete(scene.id);
    await reload();
    if (scenes[0]) pick(scenes[0].id);
  });
  /** The same field the Settings page edits; from the stored campaign, so a quick second toggle does not undo another edit. */
  const setFreeMovement = (on: boolean) => run(async () => {
    const fresh = await db.campaigns.get(cid);
    if (fresh) await saveCampaign({ ...fresh, settings: { ...fresh.settings, freeMovement: on } });
  });
  const show = (on: boolean) => run(async () => {
    if (!scene) return;
    await db.scenes.show(cid, on ? scene.id : undefined);
    await reload();
  });

  /** Lines the scene's grid up with a square grid printed on its image (official maps often have one). */
  const detectGrid = () => run(async () => {
    const blob = scene?.image ? await db.blobs.get(scene.image) : undefined;
    if (!scene || !blob) return;
    const bmp = await createImageBitmap(blob);
    // ponytail: detection runs on at most 2048 px per side (a few hundred ms on a phone); results scale back to scene pixels.
    const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const rgba = ctx.getImageData(0, 0, w, h).data, gray = new Float32Array(w * h);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    const g = detectSquareGrid(gray, w, h);
    if (!g) { notice = 'No printed grid found on this image. Set the cell size and offsets by hand.'; return; }
    const f = scene.width / w, size = Math.round(g.size * f * 100) / 100;
    if (size < 10 || size > 500) { notice = 'The printed grid is too fine or too coarse to use. Set it by hand.'; return; }
    await editScene(scene.id, (s) => regrid(s, { type: 'square', size, offsetX: Math.round(g.offsetX * f * 10) / 10, offsetY: Math.round(g.offsetY * f * 10) / 10 }));
    await reload();
    notice = g.confidence < 10 ? `Grid set to ${size} px cells. The match is weak: check that it lines up with the printed grid.` : `Grid set to ${size} px cells to match the printed grid.`;
  });

  // --- tokens ---
  const sheets = $derived(new Map(chars.flatMap((c): [string, Sheet][] => {
    try { return [[c.id, computeSheet(c, { settings, viewer: 'dm' })]]; } catch { return []; } // a damaged character just gets no speed
  })));
  const pool = $derived<MonsterDef[]>(index ? [...own, ...index.all('monster')] : own);
  const monsterById = $derived(new Map(pool.map((m) => [m.id, m])));
  const charSize = (c: Character): Size => ((c.embedded[c.build.raceId] ?? index?.get(c.build.raceId)) as RaceDef | undefined)?.size ?? 'M';

  const add = (list: NewToken[]) => {
    if (scene && scene.tokens.length + list.length > MAX_TOKENS) notice = `A scene holds at most ${MAX_TOKENS} tokens; only the first ones fit.`;
    return edit((s) => addTokens(s, list));
  };

  // Characters already on this scene are not offered again (one token per character).
  const onScene = $derived(new Set(scene?.tokens.flatMap((t) => (t.characterId ? [t.characterId] : [])) ?? []));
  const offChars = $derived(chars.filter((c) => !onScene.has(c.id)));
  let charId = $state('');
  $effect(() => { if (charId && !offChars.some((c) => c.id === charId)) charId = ''; });
  const addCharacter = () => { const c = offChars.find((x) => x.id === charId); if (c) { charId = ''; void add([tokenForCharacter(c, charSize(c))]); } };
  /** Every campaign character not yet on the scene, players' characters first. */
  const addParty = () => void add([...offChars].sort((a, b) => Number(!a.ownerId) - Number(!b.ownerId)).map((c) => tokenForCharacter(c, charSize(c))));
  const owner = (c: Character) => (c.ownerId ? ` (${c.ownerId})` : ' (DM)');

  const addMonster = (m: MonsterDef, count: number) => {
    if (!scene) return;
    const names = numberedNames(m.name, Math.min(count, MAX_TOKENS), scene.tokens.map((t) => t.name));
    void add(names.map((name) => tokenForMonster(m, name, settings.monsterHp)));
  };

  /** A linked token's HP lives on its combatant while the fight holds it (one authority); the rest of the patch goes to the token. */
  const patch = async (id: string, p: Partial<Token>) => {
    const t = scene?.tokens.find((x) => x.id === id), cId = t?.combatantId;
    if (cId && combat?.combatants.some((x) => x.id === cId) && ('hp' in p || 'maxHp' in p)) {
      const { hp, maxHp, ...rest } = p;
      await run(async () => {
        await updateCombat(cid, (c) => patchCombatant(c, cId, { ...('hp' in p && { hp }), ...('maxHp' in p && { maxHp }) }));
        await reload();
      });
      if (!Object.keys(rest).length) return;
      p = rest;
    }
    return patchScene(id, p);
  };
  const addToCombat = () => run(async () => {
    if (!scene) return;
    const { missing } = await addTokensToCombat(cid, scene.id, selected, {
      chars, sheetOf: (c) => sheets.get(c.id) ?? computeSheet(c, { settings, viewer: 'dm' }), lookup: (id) => monsterById.get(id), settings,
    });
    await reload();
    if (missing.length) toast(`Not in this campaign any more, so left out: ${missing.join(', ')}.`, true);
    else toast('Added to combat.');
  });
  const patchScene = (id: string, p: Partial<Token>) => edit((s) => {
    const t = s.tokens.find((x) => x.id === id);
    if (!t) return s;
    return patchToken(s, id, p.size ? { ...p, ...snap(s.grid, t, p.size) } : p); // a new size re-snaps (Large sits on a vertex)
  });
  const removeIds = (ids: string[]) => { const gone = new Set(ids); selected = selected.filter((x) => !gone.has(x)); void edit((s) => removeTokens(s, ids)); };
  const portrait = (id: string, file: File) => run(async () => {
    const hash = await db.blobs.put(await resizeImage(file, 256));
    if (scene) await editScene(scene.id, (s) => patchToken(s, id, { portrait: hash }));
    await reload(); // a new hash: MapCanvas loads it without re-decoding the background (M2)
  });

  /** One scene write, then the feet each moved token walked go on the budget of its combatant if that one is taking its turn (P2). */
  const onmove = (ids: string[], primary: string, to: Pt) => run(async () => {
    if (!scene) return;
    let walked: { t: Token; feet: number }[] = [];
    await editScene(scene.id, (s) => {
      const out = moveTokens(s, ids, primary, to);
      walked = out.tokens.flatMap((t) => {
        const o = s.tokens.find((x) => x.id === t.id);
        return o && (o.x !== t.x || o.y !== t.y) ? [{ t, feet: feetBetween(s.grid, o, t, settings.diagonal) }] : [];
      });
      return out;
    });
    if (walked.length && budgetApplies(combat, settings)) await updateCombat(cid, (c) => {
      if (!budgetApplies(c, settings)) return c;
      const now = currentRun(c);
      for (const { t, feet } of walked) { const x = combatantForToken(c, t); if (x && now.has(x.id)) c = recordMove(c, x.id, feet); }
      return c;
    });
    await reload();
  });
  /** Speed after conditions, as the host's check counts it: a PC's player-view walk, a monster's stat block. */
  const speedFor = (x: Combatant): number | undefined => {
    const ch = x.characterId ? chars.find((c) => c.id === x.characterId) : undefined;
    if (ch) { try { return effectiveSpeed(computeSheet(ch, { settings, viewer: 'player' }).speed.walk, ch.state.conditions, ch.state.exhaustion); } catch { return undefined; } }
    const walk = x.monsterId ? monsterById.get(x.monsterId)?.speed.walk : undefined;
    return walk === undefined ? undefined : effectiveSpeed(walk, x.conditions ?? []);
  };
  const turnIds = $derived(combat ? currentRun(combat) : new Set<string>());
  const limitOf = (id: string) => {
    const t = scene?.tokens.find((x) => x.id === id), x = t && combat && budgetApplies(combat, settings) ? combatantForToken(combat, t) : undefined;
    const speed = x && turnIds.has(x.id) ? speedFor(x) : undefined;
    return speed === undefined ? undefined : { left: remainingFeet(speed, combat!.movement?.[x!.id]), clamp: false };
  };
  /** One stroke, rectangle or Reveal all / Hide all: one write, painted onto the fresh record's fog. */
  const onfog = (e: FogEdit) => edit((s) => ({ ...s, fog: paintFog(s.fog, s.width, s.height, e) }));
  const speedOf = (id: string) => {
    const t = scene?.tokens.find((x) => x.id === id);
    if (t?.characterId) return sheets.get(t.characterId)?.speed.walk;
    if (t?.monsterId) return monsterById.get(t.monsterId)?.speed.walk;
  };
  const canvasTokens = $derived((scene?.tokens ?? []).map((t) => {
    const c = t.characterId ? chars.find((x) => x.id === t.characterId) : undefined;
    const pc = c && { hp: c.state.hp, maxHp: sheets.get(c.id)?.maxHp, conditions: c.state.conditions };
    // M6: a character token follows the character's current portrait unless the DM gave the token its own
    return { ...t, ...(pc ?? liveHp(t, combat)), ...(c && !t.portrait && c.details.portrait && { portrait: c.details.portrait }) };
  }));
  // Declared actions: the DM sees and may clear every arrow, and may point from any token, on the shown scene (arrows are table state:
  // another scene ends them). The DM's no-token arrow is --text-strong.
  const strong = getComputedStyle(document.documentElement).getPropertyValue('--text-strong').trim() || '#eafffb';
  const arrows = $derived(scene ? arrowsOn(session.actions, scene.id, scene.tokens, () => true, (by) => (by === 'dm' ? strong : tokenColor(by))) : []);
  /** The arrow picked on the map: a Delete arrow button under the scene bar (phones have no Delete key). */
  let picked: string | undefined = $state();
  const ondeclare = (d: { from: Pt; fromToken?: string; to: Pt; toToken?: string }) => {
    if (scene) void declareAction({ sceneId: scene.id, from: d.fromToken ? { tokenId: d.fromToken } : d.from, to: d.toToken ? { tokenId: d.toToken } : d.to, kind: 'intent' });
  };
  const GRID_NAMES = { square: 'Square', 'hex-flat': 'Hex (flat)', 'hex-pointy': 'Hex (pointy)' } as const;
</script>

<!-- The canvas fills the workspace; the scene picker floats top-right on it; tokens and scene settings live in the panel's tabs. -->
<Workspace fill panelLabel="Scene and tokens" panel={scene ? side : undefined} open={selected.length > 0 || sheet}
  onclose={() => { selected = []; sheet = false; }}>
  {#if scene}
    {#key scene.id}
      <MapCanvas
        width={scene.width}
        height={scene.height}
        image={scene.image}
        grid={scene.grid}
        tokens={canvasTokens}
        dm={true}
        diagonal={settings.diagonal}
        {selected}
        canDrag={() => true}
        {speedOf}
        {limitOf}
        onselect={(ids) => (selected = ids)}
        {onmove}
        fog={settings.fog ? scene.fog ?? encodeFog(newFog(scene.width, scene.height, false)) : undefined}
        onfog={settings.fog ? onfog : undefined}
        {corner}
        {arrows}
        ondeclare={scene.shown ? ondeclare : undefined}
        onclear={(id) => clearDeclared(id)}
        ondelete={removeIds}
        bind:arrow={picked}
      />
    {/key}
    <button type="button" class="sheet-btn" onclick={() => (sheet = true)}>Tokens and scene</button>
  {:else}
    <div class="empty">
      <h2>No scenes yet</h2>
      <p class="muted">Make one below.</p>
      {@render sceneForm()}
    </div>
  {/if}
  <div class="msgs">
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    {#if notice}<p role="status">{notice}</p>{/if}
  </div>
</Workspace>

{#if scenes.length}
  <dialog bind:this={newDialog} aria-labelledby="new-scene-title">
    <h2 id="new-scene-title">New scene</h2>
    {@render sceneForm()}
  </dialog>
{/if}

{#snippet sceneForm()}
  <form class="newscene" onsubmit={create}>
    {#if error && scenes.length}<p class="error">{error}</p>{/if}
    <label class="field">Name <input maxlength="100" bind:value={newName} required /></label>
    <label class="field">Image (optional) <input type="file" accept="image/*" bind:this={fileInput} onchange={(e) => (newFile = (e.currentTarget as HTMLInputElement).files?.[0])} /></label>
    <p class="muted note">A scene's image is fixed once made: make a new scene for a new image.</p>
    <div class="row">
      <button class="primary" disabled={busy || !newName.trim()}>New scene</button>
      {#if scenes.length}<button type="button" onclick={() => newDialog?.close()}>Cancel</button>{/if}
    </div>
  </form>
{/snippet}

{#snippet corner()}
  {#if scene}
    <div class="scenebar">
      <Menu label={scene.name} ariaLabel="Scene: {scene.name}" items={sceneItems} align="end" />
      {#if scene.shown}
        <span class="shown"><span class="dot" aria-hidden="true">●</span> Shown<span class="sr-only"> to players</span></span>
        <button type="button" disabled={busy} onclick={() => show(false)}>Stop showing</button>
      {:else}
        <button type="button" class="primary" disabled={busy} onclick={() => show(true)}>Show to players</button>
      {/if}
    </div>
    {#if picked !== undefined}<button type="button" class="del-arrow" onclick={() => { clearDeclared(picked); picked = undefined; }}>Delete arrow</button>{/if}
  {/if}
{/snippet}

{#snippet side()}
  {#if scene}
    <Tabs label="Map panel" bind:value={tab} tabs={[
      { id: 'selected', label: 'Selected', ...(selected.length > 0 && { count: selected.length }) },
      { id: 'tokens', label: 'Tokens', count: scene.tokens.length },
      { id: 'scene', label: 'Scene' },
    ]}>
      {#snippet panel(id)}
        {#if id === 'selected'}
          <SelectedTokens tokens={canvasTokens.filter((t) => selected.includes(t.id))} {busy} onselect={(ids) => (selected = ids)}
            onpatch={patch} onremove={removeIds} onportrait={portrait} oncombat={addToCombat} />
        {:else if id === 'tokens'}
          <div class="addbar">
            <Menu label="+ Add" primary items={[{ label: `Add party (${offChars.length})`, disabled: busy || !offChars.length, onselect: addParty }]}>
              {#snippet children()}
                <div class="row addchar">
                  <label class="field">Character
                    <select bind:value={charId} disabled={!offChars.length}>
                      <option value="">{offChars.length ? 'Choose a character' : 'Everyone is on the map'}</option>
                      {#each offChars as c (c.id)}<option value={c.id}>{c.name}{owner(c)}</option>{/each}
                    </select>
                  </label>
                  <button type="button" disabled={busy || !charId} onclick={addCharacter}>Add</button>
                </div>
                <MonsterSearch {pool} label="Add monster tokens" onadd={addMonster} />
              {/snippet}
            </Menu>
            {#if arrows.length}<button type="button" onclick={() => clearDeclared()}>Clear all arrows</button>{/if}
          </div>
          <TokenList tokens={canvasTokens} {selected} onselect={(ids) => (selected = ids)} />
        {:else}
          <label class="field">Scene name <input maxlength="100" value={scene.name} onchange={(e) => rename((e.currentTarget as HTMLInputElement).value)} /></label>
          <Drawer title="Grid" open>
            {#snippet summary()}{GRID_NAMES[scene!.grid.type]} · <span class="num">{scene!.grid.size}</span> px · <span class="num">{scene!.grid.feet}</span> ft{/snippet}
            {#if scene.image}<button type="button" class="detect" disabled={busy} onclick={detectGrid}>Detect grid from the image</button>{/if}
            <GridForm grid={scene.grid} onchange={(p) => edit((s) => regrid(s, p))} />
          </Drawer>
          <div class="rule">
            <label class="check"><input type="checkbox" checked={settings.freeMovement} onchange={(e) => setFreeMovement((e.currentTarget as HTMLInputElement).checked)} /> Free movement</label>
          </div>
          <div class="rule">
            <button type="button" class="danger" disabled={busy} onclick={remove}>Delete scene</button>
          </div>
        {/if}
      {/snippet}
    </Tabs>
  {/if}
{/snippet}

<style>
  .empty {
    padding: 1.5rem var(--page-pad, 1rem);
    max-width: 32rem;
  }

  .empty h2 {
    margin: 0 0 0.25rem;
  }

  .newscene .note {
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }

  .newscene input[type='file'] {
    max-width: 100%;
  }

  dialog {
    width: min(26rem, calc(100vw - 2rem));
    box-sizing: border-box;
  }

  dialog h2 {
    margin: 0 0 0.25rem;
    font-size: 1.1rem;
  }

  /* the scene picker and the Show toggle, one floating group like the tool switcher */
  .scenebar {
    display: inline-flex;
    align-items: stretch;
    max-width: 100%;
    background: color-mix(in srgb, var(--rail) 92%, transparent);
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    overflow: hidden;
  }

  .scenebar > :global(button) {
    border: 0;
    border-radius: 0;
    border-left: 1px solid var(--line);
    padding: 0.3rem 0.75rem;
    min-height: 2.1rem;
  }

  .scenebar > :global(.trigger) {
    border-left: 0;
    background: transparent;
    min-width: 0;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .del-arrow {
    display: block;
    margin: 0.4rem 0 0 auto;
    min-height: 44px;
    background: color-mix(in srgb, var(--rail) 92%, transparent);
  }

  .shown {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.6rem;
    border-left: 1px solid var(--line);
    color: var(--accent);
    white-space: nowrap;
  }

  .shown .dot {
    font-size: 0.7em;
  }

  .msgs {
    position: absolute;
    left: 0.5rem;
    bottom: 0.5rem;
    max-width: min(28rem, calc(100% - 7rem));
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    pointer-events: none;
  }

  .msgs p {
    margin: 0;
    padding: 0.35rem 0.6rem;
    background: color-mix(in srgb, var(--rail) 92%, transparent);
    border: 1px solid var(--line-strong);
    border-left: 2px solid var(--accent);
    border-radius: 5px;
    pointer-events: auto;
  }

  .msgs p.error {
    border-left-color: var(--danger);
  }

  .sheet-btn {
    display: none;
  }

  .addbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .addchar {
    align-items: flex-end;
    margin-bottom: 0.25rem;
  }

  .addchar .field {
    flex: 1 1 10rem;
    margin: 0;
  }

  .addchar select {
    max-width: 100%;
  }

  .detect {
    margin-bottom: 0.6rem;
  }

  .rule {
    border-top: 1px solid var(--line);
    padding: 0.6rem 0;
  }

  .rule .check {
    margin: 0;
  }

  /* Phones: a floating button opens the sheet when nothing is selected; messages sit above it */
  @media (max-width: 767px) {
    .sheet-btn {
      display: block;
      position: absolute;
      left: 0.5rem;
      bottom: 0.5rem;
      background: color-mix(in srgb, var(--rail) 92%, transparent);
    }

    .msgs {
      bottom: calc(0.5rem + 52px);
    }

    .scenebar > :global(button) {
      min-height: 44px;
    }

    .scenebar > :global(.trigger) {
      max-width: 9rem;
    }
  }
</style>
