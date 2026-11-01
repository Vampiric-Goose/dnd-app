<script lang="ts">
  // The DM's map: scenes, image import, grid settings and tokens. Every write goes through editScene on the fresh record (A2), and the page
  // re-reads its scenes after each write and on session.rev.
  import { numberedNames } from '../../lib/combat/combat.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { resizeImage } from '../../lib/images.ts';
  import { encodeFog, newFog, paintFog, type FogEdit } from '../../lib/map/fog.ts';
  import { snap, type Pt } from '../../lib/map/grid.ts';
  import { addTokens, liveHp, MAX_SIDE, MAX_TOKENS, moveTokens, newScene, patchToken, removeTokens, type NewToken } from '../../lib/map/scene.ts';
  import { addTokensToCombat, editScene, tokenForCharacter, tokenForMonster } from '../../lib/map/store.ts';
  import { patchCombatant } from '../../lib/combat/combat.ts';
  import { updateCombat } from '../../lib/combat/store.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import { filterMonsters } from '../../lib/monsters/library.ts';
  import { soundMonster } from '../../lib/monsters/homebrew.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { getIndex, saveCampaign } from '../../lib/store.svelte.ts';
  import { MAX_BLOB } from '../../lib/sync/protocol.ts';
  import { session } from '../../lib/sync/session.svelte.ts';
  import type { Campaign, Character, Combat, Grid, MonsterDef, RaceDef, Scene, Sheet, Size, Token } from '../../lib/types.ts';
  import GridForm from './GridForm.svelte';
  import MapCanvas from './MapCanvas.svelte';
  import TokenList from './TokenList.svelte';

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
  let rev = $state(0);

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
      const blob = await resizeImage(newFile, MAX_SIDE);
      if (blob.size > MAX_BLOB) throw new Error('That image is too big, even shrunk (over 8 MB). Try a smaller file or a JPEG/WebP.');
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

  /** A grid change; tokens re-snap to the new grid (each stays put if its snapped spot would leave the scene). */
  function regrid(s: Scene, p: Partial<Grid>): Scene {
    const grid = { ...s.grid, ...p };
    return { ...s, grid, tokens: s.tokens.map((t) => {
      const at = snap(grid, t, t.size);
      return at.x >= 0 && at.x <= s.width && at.y >= 0 && at.y <= s.height ? { ...t, ...at } : t;
    }) };
  }

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

  let charId = $state('');
  const addCharacter = () => { const c = chars.find((x) => x.id === charId); if (c) void add([tokenForCharacter(c, charSize(c))]); };

  let q = $state('');
  let monsterId = $state('');
  let count = $state(1);
  const matches = $derived(q.trim() ? filterMonsters(pool, { q }).slice(0, 20) : []);
  const addMonster = () => {
    const m = matches.find((x) => x.id === monsterId) ?? matches[0]; // the select shows the first match until one is chosen
    if (!m || !scene) return;
    const n = Math.max(1, Math.min(20, Math.round(count) || 1));
    const names = numberedNames(m.name, n, scene.tokens.map((t) => t.name));
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
    await reload();
    rev++;
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
    return { ...t, ...(pc ?? liveHp(t, combat)) };
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
      {rev}
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
    <GridForm grid={scene.grid} onchange={(p) => edit((s) => regrid(s, p))} />
  </details>

  <details open>
    <summary>Tokens ({scene.tokens.length})</summary>
    <div class="row">
      <label>Character
        <select bind:value={charId}>
          <option value="">Choose a character</option>
          {#each chars as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <button type="button" disabled={busy || !charId} onclick={addCharacter}>Add character token</button>
    </div>
    <div class="row">
      <label>Search monsters <input type="search" bind:value={q} /></label>
      {#if matches.length}
        <label>Monster
          <select bind:value={monsterId}>
            {#each matches as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label>Count <input class="count" type="number" min="1" max="20" bind:value={count} /></label>
      <button type="button" disabled={busy || !matches.length} onclick={addMonster}>Add monster token</button>
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

  .count {
    width: 4rem;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
</style>
