<script lang="ts">
  import { addPreparedToFight, deleteEncounter, resumeFight, saveFight, saveFightAs } from '../../lib/combat/store.ts';
  import { db } from '../../lib/db.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, Combat, Encounter, MonsterDef } from '../../lib/types.ts';
  import { uid } from '../../lib/uid.ts';
  import Pill from '../kit/Pill.svelte';
  import { act } from './act.ts';
  import type { FightAnswer, FightAsk } from './FightDialog.svelte';
  import MonsterSearch from './MonsterSearch.svelte';

  let { campaign, combat, encounters, pool, reload, ask }: {
    campaign: Campaign; combat: Combat | undefined; encounters: Encounter[]; pool: MonsterDef[]; reload: () => Promise<void>;
    ask: (k: FightAsk) => Promise<FightAnswer>;
  } = $props();

  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  function kind(e: Encounter): string {
    if (!e.fight) return plural(e.monsters.reduce((t, l) => t + l.count, 0), 'monster');
    const { round, combatants } = e.fight.combat;
    return `${round ? `Round ${round}` : 'Setup'} · ${plural(combatants.length, 'combatant')}`;
  }

  // A line keeps the monster's name, so a missing monster can still be named.
  type Line = Encounter['monsters'][number];
  const MAX_LINES = 50;

  const monById = $derived(new Map(pool.map((m) => [m.id, m])));
  const lineName = (l: Line) => monById.get(l.monsterId)?.name ?? l.name ?? l.monsterId;

  let editing: { id: string; name: string; lines: Line[] } | undefined = $state();

  const startNew = () => (editing = { id: uid(), name: '', lines: [] });
  const startEdit = (e: Encounter) => (editing = { id: e.id, name: e.name, lines: e.monsters.map((l) => ({ ...l })) });

  function addLine(m: MonsterDef, count: number) {
    if (!editing) return;
    const had = editing.lines.find((l) => l.monsterId === m.id);
    if (had) had.count = Math.min(99, had.count + count);
    else if (editing.lines.length < MAX_LINES) editing.lines.push({ monsterId: m.id, count, name: m.name });
  }

  async function save() {
    const e = editing;
    if (!e || !e.name.trim()) return;
    const lines = e.lines.filter((l) => Number.isInteger(l.count) && l.count >= 1 && l.count <= 99)
      .map((l) => { const name = monById.get(l.monsterId)?.name ?? l.name; return { monsterId: l.monsterId, count: l.count, ...(name && { name }) }; });
    // Final M5: a failed save keeps the editor open, so the list is not lost.
    let ok = false;
    await act(async () => { await db.encounters.put({ id: e.id, campaignId: campaign.id, name: e.name.trim(), monsters: $state.snapshot(lines), updatedAt: Date.now() }); ok = true; });
    if (!ok) return;
    editing = undefined;
    await reload();
  }

  async function del(e: Encounter) {
    if (!confirm(`Delete the encounter "${e.name}"?`)) return;
    await act(() => deleteEncounter(campaign.id, e.id));
    await reload();
  }

  // Review Focus 5 / P1: monsters deleted or in a disabled pack are left out and named; the rest join the fight (a running one too).
  async function start(e: Encounter) {
    const cid = campaign.id, lookup = (id: string) => monById.get(id);
    const r = await act(() => addPreparedToFight(cid, e, lookup, campaign.settings.monsterHp));
    if (r?.added.length) {
      const added = r.added;
      // Stage 5: the new monsters get tokens on the current scene (the map chunk loads only here).
      void import('../../lib/map/store.ts').then((m) => m.placeCombatants(cid, added, lookup))
        .then((p) => {
          if (p.why === 'no scene') toast('No scene to place tokens on.');
          else if (p.why === 'full') toast(`The scene is full (200 tokens): ${p.placed ? `only ${p.placed} placed` : 'no tokens placed'}.`, true);
        }, (err) => toast(`Tokens not placed: ${err instanceof Error ? err.message : err}`, true));
    }
    if (r?.missing.length) toast(`Not in this campaign any more, so left out: ${r.missing.join(', ')}.`, true);
    await reload();
  }

  // A saved fight replaces the live one: a linked fight is saved back first; an unlinked one asks (save as / discard / cancel).
  async function resume(e: Encounter) {
    const cid = campaign.id;
    await act(async () => {
      const live = await db.combat.get(cid);
      if (live?.combatants.length) {
        if (!(live.encounterId && (await saveFight(cid)))) {
          const a = await ask('first');
          if (!a) return;
          if (typeof a === 'object') await saveFightAs(cid, a.name);
        }
        // As at End combat: the old fight's monster HP stays on its map tokens.
        try { await (await import('../../lib/map/store.ts')).endCombatWriteBack(cid); } catch (err) { console.warn(err); }
      }
      const fresh = await db.encounters.get(e.id); // saving back above may have just updated this very encounter
      if (!fresh?.fight) throw new Error('That encounter is gone.');
      const r = await resumeFight(cid, fresh);
      if (r.dropped.length) toast(`No longer in the campaign, so left out: ${r.dropped.join(', ')}.`, true);
      if (r.sceneMissing) toast("The saved map's scene was deleted; loaded the fight without it.", true);
    });
    await reload();
  }
</script>

<section aria-labelledby="enc-h">
  <h2 id="enc-h" class="sr-only">Encounters</h2>
  {#if editing}
    <div class="editor">
      <label class="fld"><span class="caption">Encounter name</span><input bind:value={editing.name} maxlength="200" /></label>
      {#if editing.lines.length}
        <ul class="plain lines">
          {#each editing.lines as l, i (l.monsterId)}
            <li>
              <span class="grow">{lineName(l)}</span>
              <label class="row"><span class="sr-only">Count</span><input type="number" class="num" min="1" max="99" step="1" inputmode="numeric" aria-label="Count of {lineName(l)}" bind:value={l.count} /></label>
              <button type="button" class="x" aria-label="Remove {lineName(l)}" onclick={() => editing!.lines.splice(i, 1)}>Remove</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No monsters yet.</p>
      {/if}
      {#if editing.lines.length < MAX_LINES}
        <MonsterSearch {pool} label="Add a monster to the encounter" onadd={addLine} />
      {:else}
        <p class="muted">An encounter holds at most {MAX_LINES} lines.</p>
      {/if}
      <div class="row">
        <button type="button" class="primary" disabled={!editing.name.trim()} onclick={save}>Save encounter</button>
        <button type="button" onclick={() => (editing = undefined)}>Cancel</button>
      </div>
    </div>
  {:else}
    <button type="button" onclick={startNew}>New encounter</button>
  {/if}

  {#if encounters.length}
    <ul class="plain list">
      {#each encounters as e (e.id)}
        <li>
          <div class="row"><strong>{e.name}</strong>{#if combat?.encounterId === e.id}<Pill label="Current" accent />{/if}</div>
          <span class="muted small">{kind(e)}{#if !e.fight && e.monsters.length}: {e.monsters.map((l) => `${lineName(l)} ×${l.count}`).join(', ')}{/if}</span>
          <div class="row">
            {#if e.fight}
              <button type="button" class="primary" aria-label="Resume {e.name}" onclick={() => resume(e)}>Resume</button>
            {:else}
              <button type="button" class="primary" aria-label="Start {e.name}" disabled={!pool.length || !e.monsters.length} onclick={() => start(e)}>Start</button>
              <button type="button" aria-label="Edit {e.name}" onclick={() => startEdit(e)}>Edit</button>
            {/if}
            <button type="button" class="danger" aria-label="Delete {e.name}" onclick={() => del(e)}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No encounters yet. Prepare one here, or save a running fight from the “⋯” menu.</p>
  {/if}
</section>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-bottom: 0.75rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid var(--line);
  }

  .fld {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .lines li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0;
    border-bottom: 1px solid var(--line);
  }

  .grow {
    flex: 1 1 6rem;
    min-width: 0;
    color: var(--text-strong);
  }

  input[type='number'] {
    width: 4rem;
  }

  .x {
    color: var(--muted);
  }

  .list {
    margin-top: 0.75rem;
  }

  .list li {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.6rem 0;
    border-top: 1px solid var(--line);
  }

  .list strong {
    color: var(--text-strong);
  }

  .small {
    font-size: 0.85rem;
  }
</style>
