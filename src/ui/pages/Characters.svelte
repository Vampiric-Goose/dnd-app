<script lang="ts">
  import { deletedInCampaign, exportRecord, importRecord, keepBoth, replacement } from '../../lib/backup.ts';
  import { characterSummary } from '../../lib/character/play.ts';
  import { db, type TrashEntry } from '../../lib/db.ts';
  import { characterListProblem } from '../../lib/recordShape.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { app, getFullIndex } from '../../lib/store.svelte.ts';
  import { session } from '../../lib/sync/session.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { DEFAULT_SETTINGS } from '../../lib/settings.ts';
  import type { Character, Sheet } from '../../lib/types.ts';
  import { message, signed } from '../creator/labels.ts';
  import { download, fileName } from '../download.ts';
  import Bar from '../kit/Bar.svelte';
  import Drawer from '../kit/Drawer.svelte';
  import Menu from '../kit/Menu.svelte';
  import Pill from '../kit/Pill.svelte';
  import Stat from '../kit/Stat.svelte';
  import Workspace from '../kit/Workspace.svelte';
  import Roster from '../sync/Roster.svelte';

  let chars: Character[] = $state.raw([]);
  let damaged: Character[] = $state.raw([]); // stored records the list itself can't read (R60/4: only that; the full check is for imports)
  let confirmingRemove = $state(false);
  let loaded = $state(false);
  let filter = $state('all'); // 'all', 'none' or a campaign id
  let error = $state('');
  let notice = $state('');
  let deleting: Character | undefined = $state.raw();
  let trash: (TrashEntry & { campaignId: string })[] = $state.raw([]); // R9: deleted characters of the campaigns this device hosts
  let purging: string | undefined = $state();
  let emptying = $state(false);

  const hosted = (id?: string) => app.campaigns.find((x) => x.id === id)?.sync?.role === 'dm';

  async function load() {
    try {
      trash = (await Promise.all(app.campaigns.filter((x) => x.sync?.role === 'dm').map(async (x) => (await db.trash.list(x.id)).map((e) => ({ ...e, campaignId: x.id }))))).flat();
      const all = await db.characters.list();
      damaged = all.filter((c) => characterListProblem(c));
      chars = all.filter((c) => !characterListProblem(c)).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      error = message(e);
    }
    loaded = true;
  }
  $effect(() => { void session.rev; load(); }); // and again whenever sync stored something

  const shown = $derived(chars.filter((c) => filter === 'all' || (filter === 'none' ? !c.campaignId : c.campaignId === filter)));
  const campaignName = (id?: string) => app.campaigns.find((x) => x.id === id)?.name;

  // R49: an imported character whose id is already stored waits here until the user picks Replace or Keep both.
  let clash: { c: Character; edits: string[]; existing: string; playerView: boolean } | undefined = $state.raw();
  let keepBtn: HTMLButtonElement | undefined = $state();
  $effect(() => { if (clash) keepBtn?.focus(); }); // the dialog takes focus; Escape (below) cancels

  const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

  async function onImport(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    error = notice = '';
    clash = undefined;
    try {
      let c: Character, edits: string[] = [], taken: boolean, playerView = false;
      if (isPdf(file)) {
        const { importPdf } = await import('../../lib/pdf/importPdf.ts'); // pdf-lib's own chunk, loaded only now
        const rec = await importPdf(new Uint8Array(await file.arrayBuffer()), () => getFullIndex().catch(() => undefined)); // the index loads only if a field map needs it
        if (rec.kind !== 'character') throw new Error(rec.kind === 'monster' ? 'That file is a monster. Import it on the Monsters page.' : 'That file is an item. Import it on the Items page (All items tab).');
        c = rec.data;
        edits = rec.edits;
        playerView = !!rec.playerView;
        taken = !!(await db.characters.get(c.id));
      } else {
        const rec = await importRecord(file);
        if (rec.kind !== 'character') throw new Error(rec.kind === 'monster' ? 'That file is a monster. Import it on the Monsters page.' : 'That file is an item. Import it on the Items page (All items tab).');
        ({ data: c, taken, playerView } = rec);
      }
      if (c.campaignId && !app.campaigns.some((x) => x.id === c.campaignId)) { c = { ...c }; delete c.campaignId; } // its campaign isn't on this device
      if (await deletedInCampaign(c)) { // I1: under its old id, sync would delete it again
        await save(keepBoth(c), edits, ' It had been deleted from its campaign, so it was added as a new copy.');
        return;
      }
      if (taken) clash = { c, edits, existing: (await db.characters.get(c.id))?.name || 'Unnamed', playerView };
      else await save(c, edits);
    } catch (err) {
      error = message(err);
    }
  }

  // importRecord and importPdf don't save (N2): this is where the character is put.
  async function save(c: Character, edits: string[], note = '') {
    await db.characters.put(c);
    notice = `Imported ${c.name}.${note}${edits.length ? ` Changes made in the PDF were applied: ${edits.join(', ')}.` : ''}`;
    await load();
  }

  async function resolveClash(how: 'replace' | 'keep') {
    const k = clash!;
    clash = undefined;
    try {
      // R10: Replace overwrites every field (JSON and PDF alike); R56: a Player-view file keeps the real items of the stored character.
      await save(how === 'keep' ? keepBoth(k.c) : replacement(k.c, k.playerView ? await db.characters.get(k.c.id) : undefined, k.playerView), k.edits);
    } catch (err) {
      error = message(err);
    }
  }

  // Mirrors the Items page: damaged records are hidden, and this is how they are cleared out.
  async function removeDamaged() {
    try {
      for (const d of damaged) await db.characters.delete(d.id, { permanent: true });
      confirmingRemove = false;
      await load();
    } catch (e) {
      error = message(e);
    }
  }

  async function confirmDelete() {
    const d = deleting!;
    try {
      await db.characters.delete(d.id);
      deleting = undefined;
      await load();
    } catch (e) {
      error = message(e);
    }
  }

  // R9: db.trash.restore tells the sync session (onLocalChange), which re-sends the character to its owner's devices.
  async function restore(e: TrashEntry & { campaignId: string }) {
    try {
      const name = e.character.name || 'Unnamed';
      notice = (await db.trash.restore(e.campaignId, e.character.id)) ? `Restored ${name}.` : `${name} is already back in the campaign, so it was only removed from Deleted characters.`;
      await load();
    } catch (err) {
      error = message(err);
    }
  }

  // I3 (R13): who plays a character of a hosted campaign. Saved like any edit, so sync delivers it to that player (M1 drops it from the old one).
  const playersOf = (id?: string) => Object.entries(app.campaigns.find((x) => x.id === id)?.sync?.players ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  async function assign(c: Character, ownerId: string) {
    try {
      const fresh = await db.characters.get(c.id);
      if (!fresh) return;
      const { ownerId: _o, ...rest } = fresh;
      await db.characters.put(ownerId ? { ...rest, ownerId } : rest);
      notice = ownerId ? `${c.name || 'Unnamed'} now belongs to ${ownerId}.` : `${c.name || 'Unnamed'} is now yours only (not synced to a player).`;
      await load();
    } catch (err) {
      error = message(err);
    }
  }

  // B1: every deleted character of the shown campaigns, permanently.
  async function emptyTrash() {
    try {
      for (const id of new Set(trash.filter((e) => filter === 'all' || filter === e.campaignId).map((e) => e.campaignId))) await db.trash.empty(id);
      emptying = false;
      await load();
    } catch (err) {
      error = message(err);
    }
  }

  async function purge(e: TrashEntry & { campaignId: string }) {
    try {
      await db.trash.purge(e.campaignId, e.character.id);
      purging = undefined;
      await load();
    } catch (err) {
      error = message(err);
    }
  }

  // Layout: the selected row's summary shows in the panel (a bottom sheet on phones). Each row's numbers come from its own
  // campaign's settings, as on the sheet (R36). Display only: a record the rules engine can't read just shows no HP bar.
  let selectedId: string | undefined = $state();
  const selected = $derived(shown.find((c) => c.id === selectedId));
  const sheets = $derived(new Map(shown.map((c) => {
    let s: Sheet | undefined;
    try { s = computeSheet(c, { settings: app.campaigns.find((x) => x.id === c.campaignId)?.settings ?? DEFAULT_SETTINGS, viewer: app.viewer }); } catch { s = undefined; }
    return [c.id, s];
  })));
  const shownTrash = $derived(trash.filter((e) => filter === 'all' || filter === e.campaignId));
  const ownerLabel = (c: Character) => {
    const p = c.ownerId ? app.campaigns.find((x) => x.id === c.campaignId)?.sync?.players?.[c.ownerId] : undefined;
    return c.ownerId ? `${c.ownerId}${p?.name ? ` · ${p.name}` : ''}` : '';
  };
</script>

<Workspace panelLabel="Character" open={!!selected} onclose={() => (selectedId = undefined)}>
  <header class="head">
    <h1>Characters {#if loaded}<span class="count num">{shown.length}</span>{/if}</h1>
    <div class="tools">
      <label class="show">
        <span class="caption">Show</span>
        <select bind:value={filter}>
          <option value="all">All characters</option>
          <option value="none">Not in a campaign</option>
          {#each app.campaigns as camp (camp.id)}<option value={camp.id}>{camp.name}</option>{/each}
        </select>
      </label>
      <Menu label="Import" align="end">
        {#snippet children(close)}
          <div class="field import">
            <label for="import-character">Character file (.json or .pdf)</label>
            <input id="import-character" type="file" accept=".json,application/json,.pdf,application/pdf" onchange={(e) => { close(); void onImport(e); }} />
          </div>
        {/snippet}
      </Menu>
      <button class="primary" onclick={() => navigate('characters/new')}>New character</button>
    </div>
  </header>

  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if notice}<p role="status" class="notice">{notice}</p>{/if}
  {#if clash}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape bubbles up from the dialog's own buttons) -->
    <div role="alertdialog" aria-label="Character already exists" class="note" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (clash = undefined)}>
      <p>You already have a character with this id: “{clash.existing}”. Replace “{clash.existing}” with the imported “{clash.c.name || 'Unnamed'}”, or keep both?</p>
      {#if clash.playerView}<p class="error" role="note">This file was exported in Player view; secret item details are not in it. Replace keeps the real items of “{clash.existing}” and takes quantities, equipped, attuned, charges and notes from the file.</p>{/if}
      {#if clash.edits.length}<p class="muted">Changes made in the PDF: {clash.edits.join(', ')}.</p>{/if}
      <div class="row">
        <button class="danger" onclick={() => resolveClash('replace')}>Replace “{clash.existing}”</button>
        <button class="primary" bind:this={keepBtn} onclick={() => resolveClash('keep')}>Keep both</button>
        <button onclick={() => (clash = undefined)}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if damaged.length}
    <div class="note warn">
      <div class="row">
        <p role="status">{damaged.length} damaged {damaged.length === 1 ? 'character' : 'characters'} hidden</p>
        {#if !confirmingRemove}<button onclick={() => (confirmingRemove = true)}>Remove damaged characters</button>{/if}
      </div>
      <!-- the raw record, so its data can be rescued before it is removed -->
      <ul class="plain row">
        {#each damaged as d (d.id)}
          <li><button onclick={() => download(exportRecord('character', d), fileName(typeof d.name === 'string' ? d.name : '', 'json'))}>Export {typeof d.name === 'string' && d.name ? d.name : d.id}</button></li>
        {/each}
      </ul>
      {#if confirmingRemove}
        <div role="alertdialog" aria-label="Confirm removing damaged characters" class="row">
          <p>Permanently remove {damaged.length} damaged {damaged.length === 1 ? 'character' : 'characters'}? This cannot be undone.</p>
          <button class="danger" onclick={removeDamaged}>Remove</button>
          <button onclick={() => (confirmingRemove = false)}>Keep them</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else if !shown.length}
    <p class="muted">{chars.length ? 'No characters match.' : 'No characters yet. Create one, or import a character file (JSON or PDF) from the Import menu.'}</p>
  {:else}
    <ul class="plain list" aria-label="Characters">
      {#each shown as c (c.id)}
        {@const s = sheets.get(c.id)}
        {@const camp = filter === 'all' ? campaignName(c.campaignId) : undefined}
        <li class="crow" class:selected={selectedId === c.id}>
          <a class="name" href="#/characters/{c.id}">{c.name || 'Unnamed'}</a>
          <!-- the whole row selects (this button's ::after covers it); the name link and the Player menu sit above it -->
          <button type="button" class="pick" aria-pressed={selectedId === c.id} onclick={() => (selectedId = selectedId === c.id ? undefined : c.id)}>
            <span class="sr-only">Summary of {c.name || 'Unnamed'}: </span>{characterSummary(c)}{#if camp}<span class="camp">{' · '}{camp}</span>{/if}
          </button>
          <span class="hp">
            {#if s}
              <Bar value={c.state.hp} max={s.maxHp} temp={c.state.tempHp} label="{c.name || 'Unnamed'} hit points" />
              <span class="num">{c.state.hp}/{s.maxHp}</span>
            {/if}
          </span>
          <span class="owner">
            {#if hosted(c.campaignId)}
              <label>
                <span class="sr-only">Player</span>
                <select aria-label="Player for {c.name || 'Unnamed'}" value={c.ownerId ?? ''} onchange={(e) => assign(c, e.currentTarget.value)}>
                  <option value="">No player (DM only)</option>
                  {#each playersOf(c.campaignId) as [id, p] (id)}
                    {#if !p.removed || id === c.ownerId}<option value={id}>{id}{p.name ? ` · ${p.name}` : ''}{p.removed ? ' (removed)' : ''}</option>{/if}
                  {/each}
                </select>
              </label>
            {:else if c.ownerId}
              <span class="muted">{ownerLabel(c)}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if app.campaign?.sync}<div class="roster"><Roster campaign={app.campaign} /></div>{/if}

  {#if shownTrash.length}
    <div class="trash">
      <Drawer title="Deleted characters">
        {#snippet summary()}<span class="num">{shownTrash.length}</span> {shownTrash.length === 1 ? 'character' : 'characters'}{/snippet}
        <div class="row">
          {#if !emptying}<button class="danger" onclick={() => (emptying = true)}>Empty deleted characters</button>{/if}
        </div>
        {#if emptying}
          <div role="alertdialog" aria-label="Confirm emptying deleted characters" class="row confirm">
            <p>Delete all {shownTrash.length} deleted characters permanently? This cannot be undone.</p>
            <button class="danger" onclick={emptyTrash}>Delete them permanently</button>
            <button onclick={() => (emptying = false)}>Keep them</button>
          </div>
        {/if}
        <ul class="plain">
          {#each shownTrash as e (e.character.id)}
            {@const name = typeof e.character.name === 'string' && e.character.name ? e.character.name : 'Unnamed'}
            <li class="trow">
              <div>
                <strong>{name}</strong>
                <span class="muted">deleted by {e.by === 'DM' ? 'you' : `player ${e.by}`} on {new Date(e.at).toLocaleDateString()}{#if campaignName(e.campaignId)} · {campaignName(e.campaignId)}{/if}</span>
              </div>
              <div class="row">
                <button onclick={() => restore(e)}>Restore {name}</button>
                <button class="danger" onclick={() => (purging = e.character.id)}>Delete {name} permanently</button>
              </div>
              {#if purging === e.character.id}
                <div role="alertdialog" aria-label="Confirm permanent delete" class="row confirm">
                  <p>Delete “{name}” permanently? This cannot be undone.</p>
                  <button class="danger" onclick={() => purge(e)}>Delete permanently</button>
                  <button onclick={() => (purging = undefined)}>Keep it</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </Drawer>
    </div>
  {/if}

  {#snippet panel()}
    {#if selected}
      {@const c = selected}
      {@const s = sheets.get(c.id)}
      <h2 class="pname">{c.name || 'Unnamed'}</h2>
      <p class="muted sub">{characterSummary(c)}{s?.totalLevel ? ` · level ${s.totalLevel}` : ''}</p>
      {#if campaignName(c.campaignId)}<p class="muted sub">{campaignName(c.campaignId)}</p>{/if}
      {#if s}
        <div class="pstats">
          <Stat label="AC" value={s.ac} />
          <Stat label="Speed" value="{s.speed.walk} ft" />
          <Stat label="Initiative" value={signed(s.initiative)} />
        </div>
        <div class="php">
          <Stat label="Hit points" value="{c.state.hp} / {s.maxHp}" size="lg" />
          <Bar value={c.state.hp} max={s.maxHp} temp={c.state.tempHp} label="{c.name || 'Unnamed'} hit points" />
          {#if c.state.tempHp}<p class="muted sub">Temp HP <span class="num">{c.state.tempHp}</span></p>{/if}
        </div>
      {/if}
      {#if c.state.conditions.length || c.state.dead}
        <p class="pills">
          {#if c.state.dead}<Pill label="Dead" />{/if}
          {#each c.state.conditions as n (n)}<Pill label={n} accent />{/each}
        </p>
      {/if}
      {#if c.ownerId}<p class="sub"><span class="caption">Player</span> {ownerLabel(c)}</p>{/if}
      <div class="row pact">
        <a class="btn primary" href="#/characters/{c.id}">Open sheet</a>
        {#if app.viewer === 'dm'}<a class="btn" href="#/characters/{c.id}/level-up">Level up</a>{/if}
      </div>
      <div class="pdanger">
        <button class="danger" aria-label="Delete {c.name}" onclick={() => (deleting = c)}>Delete</button>
        {#if deleting?.id === c.id}
          <div role="alertdialog" aria-label="Confirm delete" class="confirm">
            <p>Delete “{c.name}”? {hosted(c.campaignId) ? 'It moves to Deleted characters, where you can restore it.' : 'This cannot be undone.'}</p>
            <div class="row">
              <button class="danger" onclick={confirmDelete}>Delete character</button>
              <button onclick={() => (deleting = undefined)}>Keep it</button>
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <p class="muted">Pick a character to see a summary here. The name opens the sheet.</p>
    {/if}
  {/snippet}
</Workspace>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.9rem 0 0.6rem;
  }

  h1 {
    margin: 0;
  }

  .count {
    margin-left: 0.3rem;
    color: var(--muted);
    font-size: 0.9rem;
    font-weight: 400;
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }

  .show {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .import {
    margin: 0.2rem;
    min-width: 15rem;
  }

  .notice {
    color: var(--accent);
  }

  .note {
    margin: 0 0 0.75rem;
    padding: 0.4rem 0.75rem;
    border-left: 2px solid var(--accent);
    background: var(--panel);
  }

  .note.warn {
    border-left-color: var(--danger);
  }

  .note p {
    margin: 0.3rem 0;
  }

  /* The dense list: name · race/class/level · HP · owner, one hairline row each. */
  .list {
    border-top: 1px solid var(--line);
  }

  .crow {
    position: relative;
    display: grid;
    grid-template-columns: minmax(7rem, 1fr) minmax(0, 1.6fr) minmax(7rem, 10rem) minmax(0, 12rem);
    align-items: center;
    gap: 0.75rem;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid var(--line);
  }

  .crow:hover {
    background: color-mix(in srgb, var(--raised) 45%, transparent);
  }

  .crow.selected {
    background: var(--raised);
    box-shadow: inset 2px 0 var(--accent);
  }

  .name {
    position: relative;
    z-index: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-strong);
    font-weight: 600;
    text-decoration: none;
  }

  .name:hover {
    color: var(--accent);
    text-decoration: underline;
  }

  .pick {
    min-width: 0;
    min-height: 2.25rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pick:hover:not(:disabled),
  .pick[aria-pressed='true'] {
    background: transparent;
    border: 0;
    color: var(--text);
  }

  .pick::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .pick:focus-visible {
    outline: none;
  }

  .crow:has(.pick:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .camp {
    color: var(--label);
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

  .hp .num {
    flex: none;
    color: var(--text-strong);
    font-size: 0.9rem;
  }

  .owner {
    position: relative;
    z-index: 1;
    min-width: 0;
    justify-self: end;
    font-size: 0.9rem;
  }

  .owner select {
    min-height: 2rem;
    padding: 0.15rem 0.4rem;
    max-width: 12rem;
  }

  .roster {
    margin-top: 1rem;
  }

  .trash {
    margin-top: 1.5rem;
    border-bottom: 1px solid var(--line);
  }

  .trow {
    padding: 0.4rem 0;
    border-top: 1px solid var(--line);
  }

  .trow > div:first-child {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.6rem;
    margin-bottom: 0.3rem;
  }

  .confirm p {
    margin: 0.4rem 0;
  }

  /* Panel */
  .pname {
    margin: 0;
    font-size: 1.3rem;
  }

  .sub {
    margin: 0.15rem 0 0;
  }

  .pstats {
    display: flex;
    gap: 1.5rem;
    margin: 0.9rem 0 0.6rem;
  }

  .php {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0.6rem 0 0;
  }

  .pact {
    margin: 1rem 0;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    min-height: 2.5rem;
    padding: 0 0.8rem;
    box-sizing: border-box;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    color: var(--text);
    text-decoration: none;
  }

  .btn:hover {
    background: var(--raised);
  }

  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  .pdanger {
    padding-top: 0.75rem;
    border-top: 1px solid var(--line);
  }

  @media (max-width: 767px) {
    .crow {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'name hp' 'pick owner';
      gap: 0 0.75rem;
      padding: 0.35rem 0.25rem;
    }

    .name {
      grid-area: name;
      min-height: 44px;
      display: flex;
      align-items: center;
    }

    .pick {
      grid-area: pick;
      min-height: 0;
      padding-bottom: 0.3rem;
    }

    .hp {
      grid-area: hp;
      width: 8.5rem;
    }

    .owner {
      grid-area: owner;
    }

    .owner select {
      min-height: 44px;
      max-width: 8.5rem;
    }

    .btn {
      min-height: 44px;
    }
  }
</style>
