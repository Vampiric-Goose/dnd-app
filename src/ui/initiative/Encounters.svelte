<script lang="ts">
  import { addMonsters, encounterPicks } from '../../lib/combat/combat.ts';
  import { updateCombat } from '../../lib/combat/store.ts';
  import { db } from '../../lib/db.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, Encounter, MonsterDef } from '../../lib/types.ts';
  import { uid } from '../../lib/uid.ts';
  import { act } from './act.ts';
  import MonsterSearch from './MonsterSearch.svelte';

  let { campaign, encounters, pool, reload }: { campaign: Campaign; encounters: Encounter[]; pool: MonsterDef[]; reload: () => Promise<void> } = $props();

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
    await act(() => db.encounters.delete(e.id));
    await reload();
  }

  // Review Focus 5: monsters deleted or in a disabled pack are left out and named; the rest join the fight.
  async function start(e: Encounter) {
    const { picks, missing } = encounterPicks(e, (id) => monById.get(id));
    if (picks.length) await act(async () => {
      let before = new Set<string>();
      const after = await updateCombat(campaign.id, (c) => { before = new Set(c.combatants.map((x) => x.id)); return addMonsters(c, picks, campaign.settings.monsterHp); });
      const added = after.combatants.filter((x) => !before.has(x.id)), cid = campaign.id;
      // Stage 5: the new monsters get tokens on the current scene (the map chunk loads only here).
      void import('../../lib/map/store.ts').then((m) => m.placeCombatants(cid, added, (id) => monById.get(id)))
        .then((r) => {
          if (r.why === 'no scene' && added.length) toast('No scene to place tokens on.');
          else if (r.why === 'full') toast(`The scene is full (200 tokens): ${r.placed ? `only ${r.placed} placed` : 'no tokens placed'}.`, true);
        },(e) => toast(`Tokens not placed: ${e instanceof Error ? e.message : e}`, true));
    });
    if (missing.length) {
      const names = missing.map((id) => lineName(e.monsters.find((l) => l.monsterId === id) ?? { monsterId: id, count: 1 }));
      toast(`Not in this campaign any more, so left out: ${names.join(', ')}.`, true);
    }
    await reload();
  }
</script>

<section aria-labelledby="enc-h">
  <h2 id="enc-h">Encounters</h2>
  {#if editing}
    <div class="card">
      <label class="row"><span>Encounter name</span><input bind:value={editing.name} maxlength="200" /></label>
      {#if editing.lines.length}
        <ul class="plain">
          {#each editing.lines as l, i (l.monsterId)}
            <li class="row">
              <span class="grow">{lineName(l)}</span>
              <label class="row"><span>Count</span><input type="number" min="1" max="99" step="1" inputmode="numeric" aria-label="Count of {lineName(l)}" bind:value={l.count} /></label>
              <button type="button" aria-label="Remove {lineName(l)}" onclick={() => editing!.lines.splice(i, 1)}>Remove</button>
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
    <ul class="plain">
      {#each encounters as e (e.id)}
        <li class="card">
          <strong>{e.name}</strong>
          <span class="muted">{e.monsters.map((l) => `${lineName(l)} ×${l.count}`).join(', ') || 'No monsters'}</span>
          <div class="row">
            <button type="button" class="primary" aria-label="Start {e.name}" disabled={!pool.length || !e.monsters.length} onclick={() => start(e)}>Start</button>
            <button type="button" aria-label="Edit {e.name}" onclick={() => startEdit(e)}>Edit</button>
            <button type="button" class="danger" aria-label="Delete {e.name}" onclick={() => del(e)}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No prepared encounters.</p>
  {/if}
</section>

<style>
  section {
    margin-top: 1.5rem;
  }

  li.card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .grow {
    flex: 1 1 8rem;
  }

  input[type='number'] {
    width: 4rem;
  }
</style>
