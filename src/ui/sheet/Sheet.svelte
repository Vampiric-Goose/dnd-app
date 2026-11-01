<script lang="ts">
  import { setContext, untrack } from 'svelte';
  import { exportRecord } from '../../lib/backup.ts';
  import { characterSummary, featureList } from '../../lib/character/play.ts';
  import { ABILITIES } from '../../lib/rules/constants.ts';
  import { db, DeletedError, StorageError } from '../../lib/db.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { natD20, rollLog, shownRolls } from '../../lib/rolls.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { DEFAULT_SETTINGS } from '../../lib/settings.ts';
  import { transfer } from '../../lib/items/inventory.ts';
  import { replay } from '../../lib/sync/merge.ts';
  import { session } from '../../lib/sync/session.svelte.ts';
  import { app, getFullIndex, getIndex, refreshCampaigns } from '../../lib/store.svelte.ts';
  import { listChoices } from '../../lib/character/build.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, CampaignSettings, Character, OverrideKey } from '../../lib/types.ts';
  import { ABILITY_NAMES, message, signed, titleCase } from '../creator/labels.ts';
  import { download, downloadPdf, fileName } from '../download.ts';
  import Bar from '../kit/Bar.svelte';
  import Drawer from '../kit/Drawer.svelte';
  import Menu from '../kit/Menu.svelte';
  import Workspace from '../kit/Workspace.svelte';
  import Abilities from './Abilities.svelte';
  import Attacks from './Attacks.svelte';
  import Combat from './Combat.svelte';
  import CustomEffects from './CustomEffects.svelte';
  import Features from './Features.svelte';
  import Inventory from './Inventory.svelte';
  import OverrideNumber from './OverrideNumber.svelte';
  import RestDialogs from './RestDialogs.svelte';
  import { rollD20 } from './roll.ts';
  import Spells from './Spells.svelte';

  let { params }: { params: { id: string } } = $props();

  // The character is replaced, never mutated, so `c !== saved` is the whole dirty check.
  let c: Character | undefined = $state.raw();
  let status: 'loading' | 'ready' | 'missing' | 'error' = $state('loading');
  let error = $state('');
  let restMode: 'short' | 'long' | undefined = $state();
  let saved: Character | undefined; // what is in storage (or was loaded from it)
  let timer: ReturnType<typeof setTimeout> | undefined;

  let moving = false; // a transfer is committing: autosave stays out of its way (R44)

  // B5: one save at a time. A flush (timer, route leave, page hide) runs after the one in flight, from what that one stored.
  let saving: Promise<void> = Promise.resolve();
  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    return (saving = saving.then(save));
  }

  async function save() {
    const cur = c;
    if (!cur || cur === saved || moving) return;
    try {
      const stored = await db.characters.put($state.snapshot(cur) as Character);
      if (c?.id !== cur.id) return; // the route moved on meanwhile
      // N1: continue from what was stored, so the next save's base (sync) includes this one. B4: edits made meanwhile are replayed onto
      // the stored record, so a remote value this save kept is not reverted by the edit's stale copy of it.
      saved = stored;
      c = c === cur ? stored : replay(stored, cur, $state.snapshot(c) as Character);
    } catch (e) {
      if (e instanceof DeletedError) return gone(); // B2: deleted meanwhile (here or on another device): nothing more is saved
      // The in-memory state is kept; the next edit tries again.
      toast(e instanceof StorageError ? e.message : `Could not save: ${message(e)}`, true);
    }
  }

  function gone() {
    clearTimeout(timer);
    c = saved = undefined;
    status = 'missing';
    toast('This character was deleted, so the last change was not saved.', true);
  }

  $effect(() => {
    const id = params.id;
    let live = true;
    c = saved = undefined;
    status = 'loading';
    db.characters.get(id).then((found) => {
      if (!live) return;
      saved = c = found; // loading is not an edit: nothing is saved until c changes
      status = found ? 'ready' : 'missing';
    }).catch((e) => {
      if (!live) return;
      error = message(e);
      status = 'error';
    });
    return () => {
      live = false;
      void flush(); // leaving the page (route change) must not lose the last edit
    };
  });

  // Stage 3: sync stored something. With no unsaved edits the sheet shows the stored record; with some, the next save rebases onto it (C1).
  $effect(() => {
    void session.rev;
    untrack(() => {
      const id = c?.id;
      if (!id || c !== saved || moving) return;
      db.characters.get(id).then((found) => {
        if (c !== saved || c?.id !== id) return;
        if (found) saved = c = found;
        else gone(); // B2: deleted by sync
      }, () => {});
    });
  });

  // Debounced autosave.
  $effect(() => {
    if (c && c !== saved) {
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    }
  });

  // R36: the character's own campaign settings, not the picker's.
  const settings = $derived(app.campaigns.find((x) => x.id === c?.campaignId)?.settings ?? DEFAULT_SETTINGS);
  // Choices the character never made (a book upgrade can add one, such as Variant Human's feat): a button opens just those.
  let index: ContentIndex | undefined = $state.raw();
  $effect(() => { const cid = c?.campaignId; (cid ? getIndex(cid) : getFullIndex()).then((i) => (index = i), () => undefined); });
  const pending = $derived.by(() => {
    if (!c || !index) return 0;
    const ch = c, racial = (id: string) => [ch.build.raceId, ch.build.subraceId].includes(id.split('/')[0]);
    try { return listChoices(ch, index, settings).filter((p) => !p.answer && !(ch.build.customOrigin && p.choice.type === 'ability' && racial(p.sourceId))).length; } catch { return 0; }
  });
  const sheet = $derived(c ? computeSheet(c, { settings, viewer: app.viewer }) : undefined);

  const update = (fn: (c: Character) => Character) => { if (c) c = fn(c); };
  const patch = (s: Partial<Character['state']>) => update((x) => ({ ...x, state: { ...x.state, ...s } }));
  function onset(key: OverrideKey, value: number | undefined) {
    update((x) => {
      const overrides = { ...x.overrides };
      if (value === undefined) delete overrides[key];
      else overrides[key] = value;
      return { ...x, overrides };
    });
  }

  // R37: moves the character into or out of a campaign; embedded content stays as it is.
  function setCampaign(id: string) {
    update(({ campaignId: _, ...rest }) => (id ? { ...rest, campaignId: id } : rest));
  }

  // R44: moves `qty` of an entry to Unassigned ('loot', the stored field) or another character, and commits both sides in one transaction.
  // The receiver is read fresh from storage. On failure nothing in memory changes. On success the sheet adopts what was
  // written as its saved baseline, so autosave doesn't write a stale copy over it.
  async function transferTo(entryId: string, qty: number, to: string) {
    if (!c) return;
    if (moving) { toast("Another move is still saving. Try again in a moment.", true); return; }
    if (to === c.id) { toast("That item is already with this character.", true); return; }
    moving = true;
    clearTimeout(timer);
    try {
      await saving; // B5: a save in flight finishes first; the move then starts from what it stored (it saves any newer edits too)
      const cur = c;
      if (!cur) return;
      const camp = to === 'loot' ? await db.campaigns.get(cur.campaignId ?? '') : undefined;
      const other = to === 'loot' ? undefined : await db.characters.get(to);
      if (!camp && !other) throw new Error('Could not find where to send it.');
      const moved = transfer(cur.inventory, camp?.loot ?? other!.inventory, entryId, qty);
      if (moved.from === cur.inventory) throw new Error('Nothing was moved.');
      const next: Character = { ...cur, inventory: moved.from };
      const [stored] = await db.saveTogether(camp
        ? { characters: [$state.snapshot(next) as Character], campaign: $state.snapshot({ ...camp, loot: moved.to }) as Campaign }
        : { characters: [$state.snapshot(next) as Character, $state.snapshot({ ...other!, inventory: moved.to }) as Character] });
      if (c?.id === cur.id) { // still on this sheet (the route may have changed while it committed)
        saved = stored; // N1: as stored, with its sync
        // Edits made while it committed stay and autosave.
        c = c === cur ? stored : replay(stored, cur, $state.snapshot(c) as Character); // B4: only the edits made meanwhile
      }
      if (camp) await refreshCampaigns().catch(() => {});
      toast(`Moved to ${camp ? 'Unassigned' : other!.name || 'Unnamed'}.`);
    } catch (e) {
      if (e instanceof DeletedError) gone();
      else toast(e instanceof StorageError ? e.message : `Could not move it: ${message(e)}`, true);
    } finally {
      moving = false;
      if (c && c !== saved) timer = setTimeout(flush, 500);
    }
  }

  // Exports: the character as it is on screen (autosave may not have caught up). The PDF shows the sheet as the current viewer sees it (R48).
  let exporting = $state(false);
  function exportJson() {
    if (c) download(exportRecord('character', $state.snapshot(c) as Character, app.viewer), fileName(c.name, 'json'));
  }
  async function exportPdf() {
    if (!c || !sheet || exporting) return;
    exporting = true;
    try {
      const { exportCharacterPdf } = await import('../../lib/pdf/exportPdf.ts');
      downloadPdf(await exportCharacterPdf($state.snapshot(c) as Character, sheet, { viewer: app.viewer, settings: $state.snapshot(settings) as CampaignSettings }), fileName(c.name, 'pdf'));
    } catch (e) {
      toast(`Could not export the PDF: ${message(e)}`, true);
    } finally {
      exporting = false;
    }
  }

  const last = $derived(shownRolls(rollLog, app.viewer).find((r) => !r.from)); // R6: never a private (monster) roll in Player view; this device's own
  const nat = $derived(last && natD20(last.detail));

  // R46: sheet edits (overrides, custom effects) are the DM's, through one Edit mode. Not saved; it never outlives the DM view or the page.
  let editOn = $state(false);
  const edit = $derived(editOn && app.viewer === 'dm');
  setContext('sheet-edit', () => edit);
  $effect(() => { if (app.viewer !== 'dm') editOn = false; });
  $effect(() => { void params.id; editOn = false; });

  // Layout only: the closed drawers' one-line summaries, and the phone status sheet.
  let statusOpen = $state(false);
  let notesOpen = $state(false);
  $effect(() => { if (edit) notesOpen = true; }); // custom effects live in that drawer
  const has = (k: OverrideKey) => !!sheet?.overridden.includes(k);
  const speeds = $derived(sheet ? Object.entries(sheet.speed).filter(([m, v]) => m !== 'walk' && v) : []);
  const attackSummary = $derived(sheet?.attacks.map((a) => `${a.name} ${signed(a.toHit)}`).join(' · ') || 'None');
  const skillSummary = $derived(
    sheet ? Object.entries(sheet.skills).filter(([, s]) => s.proficient).map(([k, s]) => `${titleCase(k)} ${signed(s.bonus)}`).join(' · ') || 'No proficiencies' : '',
  );
  const features = $derived(c ? featureList(c, settings) : []);
  const featureSummary = $derived(features.length ? features.slice(0, 3).map((f) => f.name).join(' · ') + (features.length > 3 ? ` +${features.length - 3}` : '') : 'None yet');
  const slotsLeft = $derived(sheet && c ? sheet.slots.reduce((n, t, i) => n + Math.max(0, t - (c!.state.slotsUsed[i] ?? 0)), 0) + (sheet.pact ? Math.max(0, sheet.pact.slots - c.state.pactSlotsUsed) : 0) : 0);
  const slotsTotal = $derived(sheet ? sheet.slots.reduce((n, t) => n + t, 0) + (sheet.pact?.slots ?? 0) : 0);
</script>

<svelte:window onpagehide={flush} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'hidden' && flush()} />

{#if status === 'loading'}
  <p class="muted">Loading…</p>
{:else if status === 'error'}
  <h1>Could not open the character</h1>
  <p role="alert" class="error">{error}</p>
  <p><a href="#/characters">Back to Characters</a></p>
{:else if status === 'missing' || !c || !sheet}
  <h1>Character not found</h1>
  <p>There is no saved character with this link. It may have been deleted, or it lives on another device.</p>
  <p><a href="#/characters">Back to Characters</a></p>
{:else}
  {#snippet lastRoll(where: string)}
    {#if last}
      <p class="lastroll {where}" class:nat20={nat === 'nat20'} class:nat1={nat === 'nat1'} role="status">
        <strong class="total num">{last.total}</strong>
        <span class="what">
          {#if nat === 'nat20'}<b class="tag">★ Natural 20!</b>{:else if nat === 'nat1'}<b class="tag">Natural 1</b>{/if}
          {last.label} <small>{last.expr === last.label ? '' : `${last.expr}: `}{last.detail}</small>
        </span>
      </p>
    {/if}
  {/snippet}

  <Workspace panelLabel="Status" open={statusOpen} onclose={() => (statusOpen = false)}>
    <header class="top">
      <div class="id">
        <h1>{c.name || 'Unnamed'}</h1>
        <p class="muted">{characterSummary(c)}{sheet.totalLevel ? ` · level ${sheet.totalLevel}` : ''}</p>
      </div>
      <div class="actions">
        {#if pending}<button type="button" class="primary" onclick={() => navigate(`characters/${c!.id}/choices`)}>Choices to make ({pending})</button>{/if}
        {#if app.viewer === 'dm'}
          <button type="button" aria-pressed={edit} onclick={() => (editOn = !editOn)}>Edit mode</button>
          <button type="button" class="primary" onclick={() => navigate(`characters/${c!.id}/level-up`)}>Level up</button>
        {/if}
        <Menu label="⋯" ariaLabel="More character actions" caret={false} align="end"
          items={[{ label: 'Export JSON', onselect: exportJson }, { label: exporting ? 'Exporting PDF…' : 'Export PDF', disabled: exporting, onselect: exportPdf }]}>
          {#snippet children()}
            <label class="field camp">
              <span>Campaign</span>
              <select value={c!.campaignId ?? ''} onchange={(e) => setCampaign(e.currentTarget.value)}>
                <option value="">No campaign</option>
                {#each app.campaigns as camp (camp.id)}<option value={camp.id}>{camp.name}</option>{/each}
              </select>
            </label>
          {/snippet}
        </Menu>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><span class="caption">AC</span><OverrideNumber label="Armor Class" okey="ac" value={sheet.ac} overridden={has('ac')} {onset} /></div>
      <div class="stat">
        <span class="caption">Speed</span>
        <OverrideNumber label="Speed" okey="speed" value={sheet.speed.walk} overridden={has('speed')} {onset} format={(n) => `${n} ft`} />
        {#if speeds.length}<small class="muted">{speeds.map(([m, v]) => `${m} ${v} ft`).join(', ')}</small>{/if}
      </div>
      <div class="stat">
        <span class="caption">Initiative</span>
        <OverrideNumber label="Initiative" okey="initiative" value={sheet.initiative} overridden={has('initiative')} {onset} format={signed} onroll={() => rollD20('Initiative', sheet!.initiative)} />
      </div>
      <div class="stat minor"><span class="caption">Proficiency</span><OverrideNumber label="Proficiency bonus" okey="prof" value={sheet.prof} overridden={has('prof')} {onset} format={signed} /></div>
      <div class="stat minor">
        <span class="caption">Passive Perception</span>
        <OverrideNumber label="Passive Perception" okey="passivePerception" value={sheet.passivePerception} overridden={has('passivePerception')} {onset} />
      </div>
      <!-- Phones: the status panel is a bottom sheet; this opens it and shows HP at a glance. -->
      <button type="button" class="status-btn" aria-expanded={statusOpen} onclick={() => (statusOpen = true)}>
        <span class="caption">Status</span>
        <span class="num">{c.state.hp} / {sheet.maxHp}</span>
        <Bar value={c.state.hp} max={sheet.maxHp} temp={c.state.tempHp} label="{c.name || 'Character'} hit points" />
      </button>
    </div>

    <div class="abilities" role="group" aria-label="Ability scores">
      {#each ABILITIES as a (a)}
        <div class="ab">
          <span class="caption">{a}</span>
          <button type="button" class="mod num" aria-label="Roll {ABILITY_NAMES[a]} check, {signed(sheet.mods[a])}" onclick={() => rollD20(`${ABILITY_NAMES[a]} check`, sheet!.mods[a])}>{signed(sheet.mods[a])}</button>
          <OverrideNumber label="{ABILITY_NAMES[a]} score" okey={`score.${a}` as const} value={sheet.scores[a]} overridden={has(`score.${a}`)} {onset} />
        </div>
      {/each}
    </div>

    {#if c.imported}
      <p class="note" role="note"><strong>Imported, unverified.</strong> These numbers were read from a file, not built here. Check them against your original sheet.</p>
    {/if}
    {#if sheet.warnings.length}
      <div class="note warnings" role="note">
        <strong>Warnings</strong>
        <ul>{#each sheet.warnings as w (w)}<li>{w}</li>{/each}</ul>
      </div>
    {/if}

    {@render lastRoll('in-main')}

    <div class="drawers">
      <Drawer title="Attacks" open>
        {#snippet summary()}{attackSummary}{/snippet}
        <Attacks {sheet} />
      </Drawer>
      <Drawer title="Skills & saves">
        {#snippet summary()}{skillSummary}{/snippet}
        <Abilities {sheet} {onset} />
      </Drawer>
      <Drawer title="Features">
        {#snippet summary()}{featureSummary}{/snippet}
        <Features {sheet} {features} />
      </Drawer>
      {#if sheet.spellcasting.length || sheet.pact}
        <Drawer title="Spells">
          {#snippet summary()}
            {#each sheet!.spellcasting.slice(0, 1) as sc (sc.classId)}DC <span class="num">{sc.dc}</span> · <span class="num">{signed(sc.attack)}</span>{/each}
            {#if slotsTotal}{sheet!.spellcasting.length ? ' · ' : ''}slots <span class="num">{slotsLeft}/{slotsTotal}</span>{/if}
          {/snippet}
          <Spells {c} {sheet} {patch} {onset} />
        </Drawer>
      {/if}
      <Drawer title="Inventory">
        {#snippet summary()}<span class="num">{c!.inventory.length}</span> {c!.inventory.length === 1 ? 'item' : 'items'} · <span class="num">{Math.round(sheet!.carrying.weight * 10) / 10}</span> lb · <span class="num">{c!.currency.gp}</span> gp{/snippet}
        <Inventory {c} {sheet} {settings} {update} ontransfer={transferTo} />
      </Drawer>
      {#if sheet.notes.length || edit}
        <Drawer title="Notes & custom effects" bind:open={notesOpen}>
          {#snippet summary()}<span class="num">{sheet!.notes.length}</span> {sheet!.notes.length === 1 ? 'note' : 'notes'}{/snippet}
          {#if sheet.notes.length}
            <ul class="plain notes">{#each sheet.notes as n, i (i)}<li><strong>{n.source}:</strong> {n.text}</li>{/each}</ul>
          {/if}
          {#if edit}<CustomEffects {c} {update} />{/if}
        </Drawer>
      {/if}
    </div>

    {#snippet panel()}
      <Combat c={c!} sheet={sheet!} {update} {patch} {onset} onrest={(m) => (restMode = m)} />
      {@render lastRoll('in-panel')}
    {/snippet}
  </Workspace>

  <RestDialogs bind:mode={restMode} {c} {sheet} {update} />
{/if}

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding-top: 0.9rem;
  }

  .id {
    min-width: 0;
  }

  .top h1 {
    margin: 0;
    font-size: 1.55rem;
  }

  .top p {
    margin: 0.1rem 0 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }

  .camp {
    margin: 0.2rem;
    min-width: 13rem;
  }

  .camp > span {
    color: var(--label);
    font-size: 0.72rem;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  /* Header stats: caption over a mono value (the kit Stat's look, with an editable or rollable value inside). */
  .stats {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.6rem 1.75rem;
    margin: 0.9rem 0 0.75rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    --ov-size: 1.35rem;
  }

  .stat.minor {
    --ov-size: 1.05rem;
  }

  .stat small {
    font-size: 0.8rem;
  }

  .status-btn {
    display: none;
  }

  /* Ability row: six hairline boxes; the modifier rolls the check, the score sits under it. */
  .abilities {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .ab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.45rem 0.3rem 0.4rem;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    min-width: 0;
    --ov-size: 0.85rem;
  }

  .mod {
    min-height: 0;
    padding: 0 0.4rem;
    border-color: transparent;
    color: var(--text-strong);
    font-size: 1.45rem;
    font-weight: 600;
    line-height: 1.2;
  }

  .ab :global(.ov .val) {
    color: var(--muted);
    font-weight: 400;
  }

  .note {
    margin: 0 0 0.75rem;
    padding: 0.4rem 0.75rem;
    border-left: 2px solid var(--accent);
    background: var(--panel);
  }

  .warnings {
    border-left-color: var(--danger);
  }

  .warnings ul {
    margin: 0.2rem 0 0;
    padding-left: 1.2rem;
  }

  .drawers {
    border-bottom: 1px solid var(--line);
  }

  .notes li {
    padding: 0.2rem 0;
  }

  /* The newest roll: an amber strip with its own colours (--roll-*), the one place amber is used. In the panel it sticks to
     the bottom edge, so it stays in view however far the panel scrolls; on phones it sticks to the top of the page. */
  .lastroll {
    position: sticky;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.75rem 0;
    padding: 0.3rem 0.7rem;
    overflow-wrap: anywhere;
    background: var(--roll-bg);
    color: var(--roll-fg);
    border: 1px solid var(--roll-edge);
    border-left-width: 3px;
    border-radius: var(--radius);
  }

  .in-main {
    top: 0;
  }

  .in-panel {
    bottom: 0.5rem;
    margin-top: 1.25rem;
  }

  .lastroll.nat20 {
    border-width: 2px;
    border-left-width: 3px;
  }

  .lastroll.nat1 {
    border-style: dashed;
    border-width: 2px;
    border-left-width: 3px;
  }

  .total {
    font-size: 1.7rem;
    font-weight: 600;
    line-height: 1.1;
    min-width: 2ch;
    text-align: center;
  }

  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.4rem;
    line-height: 1.3;
  }

  .tag {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.8rem;
  }

  .lastroll small {
    font-size: 0.8rem;
  }

  @media (min-width: 768px) {
    .in-main {
      display: none;
    }
  }

  @media (max-width: 767px) {
    .in-panel {
      display: none;
    }

    /* The sticky strip must not cover a control that gets focus (keyboard, or tapping into a field). */
    :global(html:has(.lastroll.in-main)) {
      scroll-padding-top: 5rem;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.6rem 0.75rem;
    }

    .status-btn {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.2rem;
      text-align: left;
    }

    .status-btn .num {
      color: var(--text-strong);
      font-size: 1.15rem;
    }

    /* Still one row of six on a 375 px phone: tighter boxes, the modifier keeps a 44 px tap height. */
    .abilities {
      gap: 0.3rem;
    }

    .ab {
      padding: 0.35rem 0 0.3rem;
    }

    .mod {
      min-height: 44px;
      padding: 0;
      font-size: 1.3rem;
    }
  }
</style>
