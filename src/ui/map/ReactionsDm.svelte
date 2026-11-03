<script lang="ts">
  // Reactions, DM side, on whatever page is open (mounted in App): what the DM answers for (monsters, PCs whose player isn't connected);
  // a connected player's reactors are only waited on, and the DM may pass for them.
  import { dmAnswers, dmCards } from '../../lib/combat/reactionCard.ts';
  import { answer, pass, reactions } from '../../lib/combat/reactionStack.svelte.ts';
  import { db } from '../../lib/db.ts';
  import { session } from '../../lib/sync/session.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, Character, Combat } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import ReactionCard, { type Card } from './ReactionCard.svelte';

  let { campaign }: { campaign: Campaign } = $props();

  let chars: Character[] = $state.raw([]);
  let combat: Combat | undefined = $state.raw();
  $effect(() => {
    void session.rev; void reactions.open.length;
    const id = campaign.id;
    Promise.all([db.characters.list(id), db.combat.get(id)]).then(([c, k]) => { if (id === campaign.id) { chars = c; combat = k; } }, (e) => toast(message(e), true));
  });

  const cards = $derived.by((): Card[] => {
    const mine = dmAnswers(combat?.combatants ?? [], (id) => chars.find((c) => c.id === id)?.ownerId, session.online), now = Date.now();
    return dmCards(reactions.open, mine).map((c) => ({ ask: c.ask, trigger: c.trigger, ms: Math.max(0, c.deadline - now), rows: c.mine,
      ...(c.others.length && { also: c.others.map((r) => ({ id: r.id, name: r.name })) }) }));
  });
  const passFor = (ask: string, id?: string) => { for (const r of id ? [id] : cards.find((c) => c.ask === ask)?.rows.map((x) => x.id) ?? []) pass(ask, r); };
</script>

<ReactionCard {cards} onanswer={(ask, id, o) => void answer(ask, { reactor: id, option: o.id, ...(o.slot !== undefined && { slot: o.slot }) })} onpass={passFor} />
