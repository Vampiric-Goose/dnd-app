<script lang="ts">
  // The DM's map: scenes, image import, grid settings and tokens. Every write goes through editScene on the fresh record (A2), and the page
  // re-reads its scenes after each write and on session.rev.
  import { numberedNames } from '../../lib/combat/combat.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { resizeImage } from '../../lib/images.ts';
  import { encodeFog, newFog, paintFog, type FogEdit } from '../../lib/map/fog.ts';
  import { snap, type Pt } from '../../lib/map/grid.ts';
  import { addTokens, liveHp, MAX_SIDE, MAX_TOKENS, moveTokens, newScene, patchToken, regrid, removeTokens, type NewToken } from '../../lib/map/scene.ts';
  import { addTokensToCombat, editScene, tokenForCharacter, tokenForMonster } from '../../lib/map/store.ts';
  import { patchCombatant } from '../../lib/combat/combat.ts';
  import { updateCombat } from '../../lib/combat/store.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import { soundMonster } from '../../lib/monsters/homebrew.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { getIndex, saveCampaign } from '../../lib/store.svelte.ts';
  import { MAX_BLOB } from '../../lib/sync/protocol.ts';
  import { session } from '../../lib/sync/session.svelte.ts';
  import type { Campaign, Character, Combat, MonsterDef, RaceDef, Scene, Sheet, Size, Token } from '../../lib/types.ts';
  import GridForm from './GridForm.svelte';
  import { detectSquareGrid } from '../../lib/map/detectGrid.ts';
  import MapCanvas from './MapCanvas.svelte';
  import TokenList from './TokenList.svelte';
  import MonsterSearch from '../initiative/MonsterSearch.svelte';

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
  const scene = $derived(scenes.find((s) => s.id === router.query.get('scene')) ?? scenes[0]);

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
  }); };


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

  const onmove = (ids: string[], primary: string, to: Pt) => edit((s) => moveTokens(s, ids, primary, to));
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
</script>

{#if error}<p role="alert" class="error">{error}</p>{/if}
{#if notice}<p class="muted" role="status">{notice}</p>{/if}

<section aria-label="Scenes">
  {#if scenes.length}
    <div class="row">
      <label>Scene
        <select value={scene?.id} onchange={(e) => pick((e.currentTarget as HTMLSelectElement).value)}>
          {#each scenes as s (s.id)}<option value={s.id}>{s.name}{s.shown ? ' (shown)' : ''}</option>{/each}
        </select>
      </label>
      {#if scene?.shown}
        <span class="badge">Shown to players</span>
        <button type="button" disabled={busy} onclick={() => show(false)}>Stop showing</button>
      {:else if scene}
        <button type="button" class="primary" disabled={busy} onclick={() => show(true)}>Show to players</button>
      {/if}
      <label class="check"><input type="checkbox" checked={settings.freeMovement} onchange={(e) => setFreeMovement((e.currentTarget as HTMLInputElement).checked)} /> Free movement</label>
    </div>
  {:else}
    <p class="muted">No scenes yet. Make one below.</p>
  {/if}
  <details open={!scenes.length}>
    <summary>New scene</summary>
    <form class="row" onsubmit={create}>
      <label>Name <input maxlength="100" bind:value={newName} required /></label>
      <label>Image (optional) <input type="file" accept="image/*" bind:this={fileInput} onchange={(e) => (newFile = (e.currentTarget as HTMLInputElement).files?.[0])} /></label>
      <button class="primary" disabled={busy || !newName.trim()}>New scene</button>
    </form>
    <p class="muted">A scene's image is fixed once made: make a new scene for a new image.</p>
  </details>
</section>

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
      onselect={(ids) => (selected = ids)}
      {onmove}
      fog={settings.fog ? scene.fog ?? encodeFog(newFog(scene.width, scene.height, false)) : undefined}
      onfog={settings.fog ? onfog : undefined}
    />
  {/key}
  {#if selected.length}
    <div class="row">
      <span>{selected.length} selected</span>
      <button type="button" disabled={busy} onclick={addToCombat}>Add to combat</button>
    </div>
  {/if}

  <details>
    <summary>Scene and grid</summary>
    <div class="row">
      <label>Scene name <input maxlength="100" value={scene.name} onchange={(e) => rename((e.currentTarget as HTMLInputElement).value)} /></label>
      <button type="button" class="danger" disabled={busy} onclick={remove}>Delete scene</button>
    </div>
    {#if scene.image}<button type="button" disabled={busy} onclick={detectGrid}>Detect grid from the image</button>{/if}
    <GridForm grid={scene.grid} onchange={(p) => edit((s) => regrid(s, p))} />
  </details>

  <details open>
    <summary>Tokens ({scene.tokens.length})</summary>
    <div class="adder">
      <div class="row">
        <button type="button" disabled={busy || !offChars.length} onclick={addParty}>Add party ({offChars.length})</button>
      </div>
      <div class="row">
        <label class="row"><span>Character</span>
          <select bind:value={charId} disabled={!offChars.length}>
            <option value="">{offChars.length ? 'Choose a character' : 'Everyone is on the map'}</option>
            {#each offChars as c (c.id)}<option value={c.id}>{c.name}{owner(c)}</option>{/each}
          </select>
        </label>
        <button type="button" disabled={busy || !charId} onclick={addCharacter}>Add</button>
      </div>
      <MonsterSearch {pool} label="Add monster tokens" onadd={addMonster} />
    </div>
    <TokenList tokens={scene.tokens.map((t) => (t.combatantId ? { ...t, ...liveHp(t, combat) } : t))} {selected} onselect={(ids) => (selected = ids)} onpatch={patch} onremove={removeIds} onportrait={portrait} />
  </details>
{/if}

<style>
  section {
    margin-bottom: 0.5rem;
  }

  .badge {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--surface);
    font-size: 0.8rem;
  }

  details {
    margin: 0.5rem 0;
  }

  summary {
    cursor: pointer;
    font-weight: 600;
    padding: 0.25rem 0;
  }

  label {
    font-size: 0.9rem;
  }

  input[type='file'] {
    max-width: 14rem;
  }

  .adder select {
    max-width: 100%;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
</style>
