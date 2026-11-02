<script lang="ts">
  // The DM's map: scenes, image import, grid settings and tokens. Every write goes through editScene on the fresh record (A2), and the page
  // re-reads its scenes after each write and on session.rev.
  import { numberedNames } from '../../lib/combat/combat.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { deviceSide, resizeImage } from '../../lib/images.ts';
  import { encodeFog, newFog, paintFog, type FogEdit } from '../../lib/map/fog.ts';
  import { snap, type Pt } from '../../lib/map/grid.ts';
  import { addTokens, liveHp, MAX_IMAGE, MAX_SIDE, MAX_TOKENS, moveTokens, newScene, patchToken, regrid, resizeScene, tokenColor, type NewToken } from '../../lib/map/scene.ts';
  import { arrowsOn } from '../../lib/map/actions.ts';
  import { addTokensToCombat, dropTokens, editScene, joinFight, placeUnplaced, startFight, summon, tokenForCharacter, tokenForMonster } from '../../lib/map/store.ts';
  import { scaleSummon } from '../../lib/combat/summons.ts';
  import { currentRun, patchCombatant } from '../../lib/combat/combat.ts';
  import { budgetApplies, budgetFeet, combatantForToken, effectiveSpeed, originOf, recordMove } from '../../lib/combat/movement.ts';
  import { applyResolution, editCharacter, settlePick, settleSave, turn, undoResolution, updateCombat } from '../../lib/combat/store.ts';
  import { aimPlan, areasOn, entersIn, foeWithin5, judge, snapOf, startsIn, touched, workOut, type AimPlan } from '../../lib/combat/aiming.ts';
  import { monsterAc, resolveSpell, targetOf } from '../../lib/combat/resolve.ts';
  import { targetingOn, type Pickable, type Toggle } from '../../lib/combat/targeting.ts';
  import { roll } from '../../lib/rolls.svelte.ts';
  import { uid } from '../../lib/uid.ts';
  import { rollAim, reveal } from './aimRoll.ts';
  import { setPip } from '../../lib/combat/economy.ts';
  import { applyUse, attacksPerAction, characterEffect, editsCharacter, monsterActions, payment, pcActions, problemOf, slotsLeft, spendOn, type TurnAction } from '../../lib/combat/turnActions.ts';
  import { featureList } from '../../lib/character/play.ts';
  import TurnPanel from '../turn/TurnPanel.svelte';
  import type { SpellArea } from '../../lib/combat/spellText.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import { soundMonster } from '../../lib/monsters/homebrew.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { getIndex, saveCampaign } from '../../lib/store.svelte.ts';
  import { MAX_BLOB } from '../../lib/sync/protocol.ts';
  import { clearDeclared, declareAction, sendDrag, session } from '../../lib/sync/session.svelte.ts';
  import type { Ability, Campaign, Character, Combat, Combatant, MonsterDef, Outcome, RaceDef, Resolution, Scene, Sheet, Size, Token } from '../../lib/types.ts';
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
      // as large as this device can encode (each device decodes it to its own size, MapCanvas), smaller until it fits a sync (8 MB)
      let blob: Blob | undefined;
      for (const side of [MAX_IMAGE, 6144, 4096, 3072].filter((n) => n <= Math.min(MAX_IMAGE, deviceSide()))) {
        blob = await resizeImage(newFile, side);
        // I1: Safari can't encode WebP (it falls back to a huge PNG): JPEG then
        if (blob.size > MAX_BLOB || blob.type !== 'image/webp') blob = await resizeImage(newFile, side, 'image/jpeg', 0.85);
        if (blob.size <= MAX_BLOB) break;
      }
      if (!blob) throw new Error('That image could not be read.');
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
  // A new pick on the map or in the list shows it: in a fight, one creature in it shows in the Turn tab (without changing the turn).
  $effect(() => {
    if (!selected.length) return;
    untrack(() => {
      const t = selected.length === 1 ? scene?.tokens.find((x) => x.id === selected[0]) : undefined;
      const x = t && fighting ? combatantForToken(combat!, t) : undefined;
      if (x) { viewId = x.id; tab = 'turn'; } else tab = 'selected';
    });
  });
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
  // the campaign's own copy of a book monster (same id) stands in for it: listed once
  const pool = $derived<MonsterDef[]>(index ? [...own, ...index.all('monster').filter((m) => !own.some((o) => o.id === m.id))] : own);
  const monsterById = $derived(new Map(pool.map((m) => [m.id, m])));
  const charSize = (c: Character): Size => ((c.embedded[c.build.raceId] ?? index?.get(c.build.raceId)) as RaceDef | undefined)?.size ?? 'M';

  /** What fighters made from tokens need (addTokensToCombat). */
  const fightOpts = () => ({ chars, sheetOf: (c: Character) => sheets.get(c.id) ?? computeSheet(c, { settings, viewer: 'dm' }), lookup: (id: string) => monsterById.get(id), settings });
  /** New tokens; during a fight they join it too (one roster). */
  const add = (list: NewToken[]) => run(async () => {
    if (!scene) return;
    if (scene.tokens.length + list.length > MAX_TOKENS) notice = `A scene holds at most ${MAX_TOKENS} tokens; only the first ones fit.`;
    const had = new Set(scene.tokens.map((t) => t.id)), s = await editScene(scene.id, (x) => addTokens(x, list));
    const ids = (s?.tokens ?? []).filter((t) => !had.has(t.id)).map((t) => t.id);
    const { missing } = ids.length ? await joinFight(cid, scene.id, ids, fightOpts()) : { missing: [] };
    await reload();
    if (missing.length) toast(`Not in this campaign any more, so left out: ${missing.join(', ')}.`, true);
  });
  // One roster: fighters with no token anywhere (added on the Combat page before there was a scene, or an older fight) are placed on
  // the fight's scene. Tried once per set of them, so a full scene isn't retried on every reload.
  let placing = '';
  $effect(() => {
    const k = combat, ss = scenes;
    if (!k || !ss.length) return;
    const linked = new Set(ss.flatMap((s) => s.tokens.map((t) => t.combatantId))), onMap = new Set(ss.flatMap((s) => s.tokens.map((t) => t.characterId)));
    const key = k.combatants.filter((x) => (x.kind === 'monster' && !linked.has(x.id)) || (x.kind === 'pc' && !onMap.has(x.characterId))).map((x) => x.id).join(',');
    if (!key || key === placing) return;
    placing = key;
    void untrack(() => run(async () => { await placeUnplaced(cid, (id) => monsterById.get(id)); await reload(); }));
  });

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
    const { missing } = await addTokensToCombat(cid, scene.id, selected, fightOpts());
    await reload();
    if (missing.length) toast(`Not in this campaign any more, so left out: ${missing.join(', ')}.`, true);
    else toast('Added to combat.');
  });
  const patchScene = (id: string, p: Partial<Token>) => edit((s) => {
    const t = s.tokens.find((x) => x.id === id);
    if (!t) return s;
    return patchToken(s, id, p.size ? { ...p, ...snap(s.grid, t, p.size) } : p); // a new size re-snaps (Large sits on a vertex)
  });
  /** Tokens off the map, and the fighters they stand for out of the fight (one roster). */
  const removeIds = (ids: string[]) => { const gone = new Set(ids); selected = selected.filter((x) => !gone.has(x)); void run(async () => { if (scene) await dropTokens(cid, scene.id, ids); await reload(); }); };
  const portrait = (id: string, file: File) => run(async () => {
    const hash = await db.blobs.put(await resizeImage(file, 256));
    if (scene) await editScene(scene.id, (s) => patchToken(s, id, { portrait: hash }));
    await reload(); // a new hash: MapCanvas loads it without re-decoding the background (M2)
  });

  /** One scene write; then a moved token whose combatant is taking its turn gets the turn's origin, where it stood (its first move only; P2). */
  const onmove = (ids: string[], primary: string, to: Pt) => run(async () => {
    if (!scene) return;
    let walked: { t: Token; from: Pt }[] = [];
    await editScene(scene.id, (s) => {
      const out = moveTokens(s, ids, primary, to);
      walked = out.tokens.flatMap((t) => {
        const o = s.tokens.find((x) => x.id === t.id);
        return o && (o.x !== t.x || o.y !== t.y) ? [{ t, from: { x: o.x, y: o.y } }] : [];
      });
      return out;
    });
    if (walked.length && budgetApplies(combat, settings)) await updateCombat(cid, (c) => {
      if (!budgetApplies(c, settings)) return c;
      const now = currentRun(c);
      for (const { t, from } of walked) { const x = combatantForToken(c, t); if (x && now.has(x.id)) c = recordMove(c, x.id, from); }
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
    const m = speed === undefined ? undefined : combat!.movement?.[x!.id];
    return speed === undefined ? undefined : { from: originOf(m), budget: budgetFeet(speed, m), clamp: false };
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
    return { ...t, ...(pc ?? liveHp(t, combat)), ...(c && !t.portrait && c.details.portrait && { portrait: c.details.portrait }), ...session.drags[t.id] }; // a player's live drag: where it is now
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
  // --- the Turn tab (turn panel spec): follows the acting creature (a grouped run: its first, with a switcher among the group) ---
  const fighting = $derived(!!combat && combat.round >= 1);
  const spellByName = $derived(new Map((index?.all('spell') ?? []).map((s) => [s.name.toLowerCase(), s])));
  /** An area spell's template on the map, from the caster's cell when it starts there (range Self). */
  let preset: { shape: SpellArea['shape']; feet: number; width?: number; origin?: Pt; n: number } | undefined = $state.raw();
  const placeTemplate = (area: SpellArea) => {
    const t = combat && view ? scene?.tokens.find((k) => combatantForToken(combat!, k)?.id === view!.x.id) : undefined;
    preset = { shape: area.shape, feet: area.feet, ...(area.width && { width: area.width }), ...(area.self && t && { origin: { x: t.x, y: t.y } }), n: (preset?.n ?? 0) + 1 };
    sheet = false; selected = [];
  };
  /** A map Start combat waiting for the players' initiative rolls. */
  const waiting = $derived(combat && combat.round === 0 && combat.autoStart ? combat.combatants.filter((x) => x.init === undefined) : undefined);
  /** One step: show the scene, everyone on it joins, monsters and the DM's characters roll; round 1 once the players have rolled. */
  const beginFight = () => run(async () => {
    if (!scene) return;
    const r = await startFight(cid, scene.id, fightOpts());
    await reload();
    if (r.missing.length) toast(`Not in this campaign any more, so left out: ${r.missing.join(', ')}.`, true);
    toast(r.waiting.length ? `Waiting for initiative from ${r.waiting.join(', ')}.` : 'Round 1.');
  });
  let viewId: string | undefined = $state();
  $effect(() => { const on = fighting || !!waiting; untrack(() => { if (on) tab = 'turn'; else if (tab === 'turn') tab = 'tokens'; }); });
  // A string, so only a new turn resets the view (every reload makes a new combat object).
  const turnKey = $derived(combat ? `${combat.round}:${combat.turn}` : '');
  $effect(() => { void turnKey; untrack(() => (viewId = undefined)); });
  const runList = $derived(combat ? combat.combatants.filter((x) => turnIds.has(x.id)) : []);
  const view = $derived.by(() => {
    const x = combat?.combatants.find((z) => z.id === viewId) ?? runList[0];
    if (!x) return undefined;
    const ch = x.characterId ? chars.find((c) => c.id === x.characterId) : undefined, sheet = ch && sheets.get(ch.id);
    if (ch && sheet) {
      const features = featureList(ch, settings);
      return { x, ch, sheet, name: ch.name, ac: sheet.ac, hp: ch.state.hp, maxHp: sheet.maxHp, tempHp: ch.state.tempHp, conditions: ch.state.conditions,
        actions: pcActions(ch, sheet, features), perAction: attacksPerAction(features), slots: slotsLeft(sheet, ch) };
    }
    const m = x.monsterId ? monsterById.get(x.monsterId) : undefined;
    return { x, name: x.name, ac: monsterAc(x, m, x.conditions ?? []), hp: x.hp, maxHp: x.maxHp, tempHp: x.tempHp, conditions: x.conditions ?? [], actions: m ? monsterActions(m, { spell: (n) => spellByName.get(n), used: x.spellsUsed }) : [], perAction: 1 };
  });
  /** The DM's use: pips and what it pays, no turn checks (the panel greys out what the rules don't allow). */
  const useAction = (a: TurnAction, slot?: number, target?: string) => run(async () => {
    const v = view;
    if (!v || !combat) return;
    await pay(v, a, slot, target);
    await reload();
  });
  /** A summon cast: paid for like any use, then its creatures (a spirit scaled to the slot) join the fight beside the caster. */
  const summonAction = (a: TurnAction, slot: number | undefined, p: { option?: number; monsters: MonsterDef[]; variant?: string }) => run(async () => {
    const v = view, spec = a.cast?.read.summon;
    if (!v || !combat || !spec || !p.monsters.length) return;
    await pay(v, a, slot);
    const level = slot ?? a.spell!.level, caster = (await db.combat.get(cid))?.combatants.find((x) => x.id === v.x.id);
    const list = 'creature' in spec ? [scaleSummon(p.monsters[0], { level, attack: a.cast!.attack ?? 0, variant: p.variant, campaignId: cid })] : p.monsters;
    await summon(cid, v.x.id, list, { spell: a.name, ...(a.spell?.concentration && caster && { cast: caster.concentrationCount }), share: 'creature' in spec, hpMode: settings.monsterHp });
    await reload();
  });
  /** Pays for a use (the pip on the fresh fight, then a slot or resource on the character); throws why when it can't. */
  async function pay(v: NonNullable<typeof view>, a: TurnAction, slot?: number, target?: string, aimed = false) {
    const pay = v.ch && v.sheet ? payment(a, v.sheet, v.ch, slot) : {};
    if (pay.problem) throw new Error(`Not done: ${pay.problem}.`);
    let why: string | undefined;
    await updateCombat(cid, (k) => { // checked again on the fresh fight: a quick second tap spends nothing
      const y = k.combatants.find((z) => z.id === v.x.id);
      why = y ? problemOf(y, a, v.ch ? v.conditions : y.conditions ?? [], currentRun(k).has(y.id), v.perAction) : 'not in the fight';
      return y && !why ? applyUse(k, y, a, v.perAction, target) : k;
    });
    if (why) throw new Error(`Not done: ${why}.`);
    if (v.ch && editsCharacter(a, pay.level)) await editCharacter(v.ch.id, (c) => characterEffect(spendOn(c, pay.level, a.resource, pay.pact), a, target, aimed));
  }

  // Targeting (the DM's setting): the action being aimed on the map, then rolled here and worked out by the same rules as a player's use.
  // `picks`: rays or darts picked so far; `leap`: a leaping spell's next target (Chaos Bolt), from the creature `from`, not one in `exclude`
  type Pick = { tokenId?: string; point: Pt };
  let aiming: { a: TurnAction; slot?: number; toggles: Toggle[]; dtype?: string; plan: AimPlan; v: NonNullable<typeof view>; picks?: Pick[]; leap?: { rid: string; from: string; exclude: string[] } } | undefined = $state.raw();
  const onaim = (a: TurnAction, slot: number | undefined, toggles: Toggle[], dtype?: string) => {
    const plan = aimPlan(a, { level: slot, toggles, dtype, rider: view?.x.rider });
    if (!plan || !view) return;
    const k = combat, here = k && scene?.tokens.some((t) => combatantForToken(k, t)?.id === view!.x.id);
    if (!here) { error = `${view.name} has no token on this scene: put it on the map to aim.`; return; } // never a silent no-op
    aiming = { a, slot, toggles, dtype, plan, v: view }; sheet = false; selected = [];
    if (plan.helps && plan.reach === 'self') void fire([], () => ({ ok: true })); // a buff on the caster (Shield): nothing to pick
  };
  const conditionsOf = (z: Combatant) => (z.characterId ? chars.find((c) => c.id === z.characterId)?.state.conditions : undefined) ?? z.conditions ?? [];
  const nameOfCombatant = (id: string) => { const z = combat?.combatants.find((y) => y.id === id); return (z?.characterId ? chars.find((c) => c.id === z.characterId)?.name : undefined) ?? z?.name ?? '?'; };
  const aim = $derived.by(() => {
    const m = aiming, k = combat, s = scene;
    if (!m || !k || !s) return undefined;
    const me = s.tokens.find((t) => combatantForToken(k, t)?.id === (m.leap?.from ?? m.v.x.id));
    if (!me) return undefined;
    const foe = foeWithin5(k, s, m.v.x, settings.diagonal, conditionsOf);
    const pickable = (id: string): Pickable => {
      const t = s.tokens.find((x) => x.id === id), z = t && combatantForToken(k, t);
      return t && z && (m.plan.helps || z.id !== m.v.x.id) && !m.leap?.exclude.includes(z.id) ? judge(m.plan, s.grid, settings.diagonal, me, foe, t,
        { attacker: conditionsOf(m.v.x), target: conditionsOf(z), exhaustion: m.v.ch?.state.exhaustion, dodging: !!z.economy?.dodging }) : { ok: false };
    };
    const picks = m.picks ?? [], count = m.plan.count ?? m.plan.helps?.max, nameAt = (p: Pick) => s.tokens.find((t) => t.id === p.tokenId)?.name ?? '?';
    return { from: { x: me.x, y: me.y }, line: m.plan.line, ...(m.plan.area && { area: m.plan.area }), pickable,
      onpick: (p: Pick) => {
        if (count && picks.length + 1 < count) { aiming = { ...m, picks: [...picks, p] }; return; }
        void fire([...picks, p], pickable);
      },
      ...(count ? { status: `Target ${picks.length + 1} of ${count}${picks.length ? `: ${picks.map(nameAt).join(', ')}` : ''}` } : m.leap ? { status: 'Leap: a creature within 30 ft of the last one' } : {}),
      ...(picks.length && { onundo: () => (aiming = { ...m, picks: picks.slice(0, -1) }) }),
      ...((m.plan.helps || m.plan.upTo) && picks.length && { ondone: () => void fire(picks, pickable) }), // a helpful spell may take fewer than it could
      oncancel: () => (aiming = undefined) };
  });
  const fire = (ps: Pick[], pickable: (id: string) => Pickable) => run(async () => {
    const m = aiming, k = combat, s = scene;
    aiming = undefined;
    if (!m || !k || !s) return;
    const judged = (p: Pick) => (p.tokenId ? pickable(p.tokenId) : undefined);
    const many = m.plan.count || m.plan.helps; // one roll per creature (a helpful spell on the caster alone: one)
    const r = many ? rollAim(m.a.name, m.plan, ps.length ? ps.map(judged) : [undefined]) : rollAim(m.a.name, m.plan, judged(ps[0]));
    const idOf = (p: Pick) => { const t = p.tokenId ? s.tokens.find((x) => x.id === p.tokenId) : undefined; return t && combatantForToken(k, t)?.id; };
    const target = idOf(ps[0]), ch = m.v.ch;
    const where = many ? { targets: ps.map((p) => idOf(p) ?? '') } : target ? { target } : { point: ps[0].point };
    const res = await workOut({ a: m.a, level: m.slot, features: ch ? featureList(ch, settings).map((f) => f.name) : [], actor: m.v.x, combat: k, scene: s,
      ...(m.leap && { leapFrom: { from: m.leap.from, exclude: m.leap.exclude } }),
      diagonal: settings.diagonal, aim: { ...where, rolled: r.rolled, toggles: m.toggles.map((x) => x.id), ...(m.dtype && { dtype: m.dtype }) },
      findTarget: (id) => k.combatants.find((z) => z.id === id), conditionsOf,
      exhaustionOf: (z) => (z.characterId ? chars.find((c) => c.id === z.characterId)?.state.exhaustion : undefined) ?? 0,
      info: infoOf,
      nameOf: (z) => nameOfCombatant(z.id), magical: !!ch?.inventory.find((e) => e.id === m.a.attack?.entryId)?.item.magic, id: uid(), now: Date.now(), rng: Math.random });
    if (typeof res === 'string') throw new Error(`Not done: ${res}.`);
    const before = snapOf(k, chars, touched(res.resolution)); // before paying: Undo gives the pip and slot back too
    const rid = m.leap?.rid;
    if (rid) await updateCombat(cid, (c) => ({ ...c, resolutions: (c.resolutions ?? []).map((y) => (y.id === rid ? { ...y, leapt: true as const } : y)) })); // the same casting: nothing to pay
    else await pay(m.v, m.a, m.slot, undefined, true);
    reveal(r.held, res.outcome.hit, undefined, res.outcome.hits);
    await applyResolution(cid, res.resolution, settings, before);
    await reload();
  });
  const infoOf = (z: Combatant) => {
    const c = z.characterId ? chars.find((y) => y.id === z.characterId) : undefined;
    return c ? targetOf(z, { sheet: sheets.get(c.id) ?? computeSheet(c, { settings, viewer: 'dm' }), hp: c.state.hp, conditions: c.state.conditions }) : targetOf(z, { monster: z.monsterId ? monsterById.get(z.monsterId) : undefined });
  };
  // Damage over time: the areas the creature whose turn it is starts in (Moonbeam), or walked into (Cloudkill), each once a turn: a start of
  // turn there or entering it, not both
  const startOf = (r: Resolution) => `${r.action} (start of turn)`, enterOf = (r: Resolution) => `${r.action} (entering)`;
  const hurtsNow = $derived.by((): { r: Resolution; enters: boolean }[] => {
    const k = combat, s = scene, id = k?.turn;
    if (!k || !s || !id) return [];
    const done = (r: Resolution) => (k.resolutions ?? []).some((y) => (y.action === startOf(r) || y.action === enterOf(r)) && y.round === k.round && y.outcomes[0]?.id === id);
    return [...startsIn(k, s, id).map((r) => ({ r, enters: false })), ...entersIn(k, s, id).map((r) => ({ r, enters: true }))].filter((x) => !done(x.r));
  });
  const lingerRoll = (r: Resolution, enters = false) => run(async () => {
    const k = combat, z = k?.combatants.find((x) => x.id === k.turn), l = r.linger;
    if (!k || !z || !l) return;
    const rolled = { dmg: l.dice.map((d) => roll(`${r.action}: ${d.type} damage`, d.expr).faces) };
    const outcomes = resolveSpell(l.read, l.dice, l.dc, undefined, infoOf(z), [], rolled, Math.random);
    await applyResolution(cid, { id: uid(), actor: r.actor, action: enters ? enterOf(r) : startOf(r), outcomes, at: Date.now(), round: k.round,
      ...(l.dc !== undefined && l.read.save && { dc: l.dc, ability: l.read.save.toLowerCase() as Ability, onSave: l.read.onSave }) }, settings);
    await reload();
  });
  /** A leaping spell's next target (Chaos Bolt): aimed from the creature it hit, while its caster's turn panel is open. */
  const startLeap = (r: Resolution) => {
    const v = view, a = v?.x.id === r.actor ? v.actions.find((x) => x.spell && x.name === r.action) : undefined, plan = a && aimPlan(a, { level: r.slot });
    const from = r.outcomes.find((o) => o.leap)?.id;
    if (!v || !a || !plan || !from) return;
    aiming = { a, slot: r.slot, toggles: [], plan: { ...plan, reach: { spell: plan.read?.leap ?? 0 } }, v, leap: { rid: r.id, from, exclude: r.chain ?? r.outcomes.map((o) => o.id) } };
    sheet = false; selected = [];
  };
  const undo = (rid: string) => run(async () => { await undoResolution(cid, rid, settings); await reload(); });
  const rollFor = (rid: string, target: string) => run(async () => {
    const d = roll(`${nameOfCombatant(target)}: save (rolled by the DM)`, '1d20', { mode: 'normal' });
    await settleSave(cid, rid, target, d.faces[0], settings);
    await reload();
  });
  const pickFor = (rid: string, target: string, type: string) => run(async () => { await settlePick(cid, rid, target, type, settings); await reload(); });
  const describe = (o: Outcome) => [
    o.part !== 'save' && o.roll !== undefined ? `${o.hit ? 'hit' : 'miss'} (${o.roll}${o.nat ? `, natural ${o.nat}` : ''} vs AC ${o.ac ?? '?'}${o.edge ? `; ${o.edge}` : ''})` : '',
    o.save ? `${o.save.ok ? 'saved' : 'failed'} (${o.save.total})` : o.pending ? 'waiting for their save' : o.choose ? 'waiting for their d8 pick' : '',
    o.damage ? `${o.damage} damage` : '', o.heal ? `regains ${o.heal} HP` : '', o.temp ? `${o.temp} temporary HP` : '', o.note ?? '',
    o.inflict?.length ? o.inflict.join(', ').toLowerCase() : '',
  ].filter(Boolean).join(', ');
  const onpip = (pip: 'action' | 'bonus' | 'reaction', used: boolean) => run(async () => {
    const id = view?.x.id;
    await updateCombat(cid, (k) => ({ ...k, combatants: k.combatants.map((z) => (z.id !== id ? z : setPip(z, pip, used))) }));
    await reload();
  });
  const nextTurn = () => run(async () => { await turn(cid, 'next'); await reload(); });

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
        ondrag={(id, at) => { if (scene?.shown) sendDrag(scene.id, id, at); }}
        {preset}
        {aim}
        areas={areasOn(combat, scene.id)}
      />
    {/key}
    <button type="button" class="sheet-btn" onclick={() => (sheet = true)}>{fighting ? 'Turn and tokens' : 'Tokens and scene'}</button>
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
      {#if !fighting && !waiting && scene.tokens.length}
        <button type="button" class="primary" disabled={busy} onclick={beginFight}>Start combat</button>
      {/if}
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
      ...(fighting || waiting ? [{ id: 'turn', label: 'Turn' }] : []),
      { id: 'selected', label: 'Selected', ...(selected.length > 0 && { count: selected.length }) },
      { id: 'tokens', label: 'Tokens', count: scene.tokens.length },
      { id: 'scene', label: 'Scene' },
    ]}>
      {#snippet panel(id)}
        {#if id === 'turn' && view && combat}
          <TurnPanel dm name={view.name} order={combat.combatants} self={view.x.id} current={combat.turn} round={combat.round}
            ac={view.ac} hp={view.hp} maxHp={view.maxHp} tempHp={view.tempHp} tone={view.ch ? 'accent' : 'danger'} conditions={[...view.conditions, ...(view.x.hasted && !view.x.hasted.ended ? ['Haste'] : [])]}
            x={view.x} perAction={view.perAction} onTurn={turnIds.has(view.x.id)} actions={view.actions} slots={view.slots}
            concentrating={!!view.x.concentrating} {busy} canEnd={!busy} endLabel="Next turn ▶" onuse={(a, slot, target) => void useAction(a, slot, target)} onsummon={summonAction} summonPool={pool} onend={nextTurn} {onpip}
            onstrip={(id) => (viewId = id)} ontemplate={placeTemplate}
            targeting={targetingOn(settings)} features={view.ch ? featureList(view.ch, settings).map((f) => f.name) : []} {onaim}>
            {#snippet top()}
              {#if runList.length > 1}
                <div class="row switch" role="group" aria-label="This group">
                  {#each runList as x (x.id)}<button type="button" aria-pressed={x.id === view!.x.id} onclick={() => (viewId = x.id)}>{x.name}</button>{/each}
                </div>
              {/if}
            {/snippet}
          </TurnPanel>
          {#if combat?.resolutions?.length}
            <section class="results" aria-labelledby="res-h">
              <h3 id="res-h">Results</h3>
              {#each hurtsNow as h (h.r.id + h.enters)}<p class="row small"><span><strong>{nameOfCombatant(combat.turn ?? '')}</strong> {h.enters ? 'entered' : 'starts its turn in'} {h.r.action}</span>
                <button type="button" disabled={busy} onclick={() => lingerRoll(h.r, h.enters)}>Roll</button></p>{/each}
              <ol class="plain">
                {#each [...combat.resolutions].reverse().slice(0, 6) as r (r.id)}
                  <li>
                    <div class="row"><strong>{nameOfCombatant(r.actor)}: {r.action}</strong>{#if r.dc !== undefined}<span class="muted small">DC {r.dc} {r.ability?.toUpperCase()}</span>{/if}
                      {#if r.outcomes.some((o) => o.leap) && !r.leapt && view?.x.id === r.actor}<button type="button" disabled={busy} onclick={() => startLeap(r)}>Leap</button>{/if}
                      <button type="button" disabled={busy} onclick={() => undo(r.id)}>Undo</button></div>
                    {#if r.caught?.length}<p class="muted small">In the area: {r.caught.map(nameOfCombatant).join(', ')}</p>{/if}
                    <ul class="plain small">
                      {#each r.outcomes as o, i (i)}
                        <li>{nameOfCombatant(o.id)}: {describe(o)}{#if o.pending} <button type="button" disabled={busy} onclick={() => rollFor(r.id, o.id)}>Roll for them</button>{/if}
                          {#each o.choose ?? [] as c (c.face)} <button type="button" disabled={busy} onclick={() => pickFor(r.id, o.id, c.type)}>{c.type} ({c.damage})</button>{/each}</li>
                      {/each}
                      {#each r.applied.filter((x) => x.conc) as x (x.id)}<li><strong>{nameOfCombatant(x.id)}</strong>: Con save DC {x.conc} to keep concentrating</li>{/each}
                    </ul>
                  </li>
                {/each}
              </ol>
            </section>
          {/if}
        {:else if id === 'turn' && waiting}
          <div class="waiting">
            <h2>Rolling initiative</h2>
            <p>Waiting for {waiting.map((x) => x.name).join(', ')}. Round 1 starts once they've rolled.</p>
          </div>
        {:else if id === 'turn'}
          <p class="muted">No one is acting.</p>
        {:else if id === 'selected'}
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
          {#if !scene.image}
            {@const cells = (px: number) => Math.round(px / scene!.grid.size)}
            <div class="size">
              <label class="field">Width (cells) <input type="number" min="1" max={Math.floor(MAX_SIDE / scene.grid.size)} value={cells(scene.width)} onchange={(e) => { const n = Number(e.currentTarget.value); edit((s) => resizeScene(s, n, cells(s.height))); }} /></label>
              <label class="field">Height (cells) <input type="number" min="1" max={Math.floor(MAX_SIDE / scene.grid.size)} value={cells(scene.height)} onchange={(e) => { const n = Number(e.currentTarget.value); edit((s) => resizeScene(s, cells(s.width), n)); }} /></label>
              <span class="muted small"><span class="num">{cells(scene.width) * scene.grid.feet}</span> × <span class="num">{cells(scene.height) * scene.grid.feet}</span> ft</span>
            </div>
          {/if}
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

  .switch button {
    min-height: 44px;
  }

  .waiting h2 {
    margin: 0 0 0.3rem;
    font-size: 1.1rem;
  }


  .switch button[aria-pressed='true'] {
    border-color: var(--accent);
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
