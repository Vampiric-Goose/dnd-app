<script lang="ts">
  // Reactions, player side: this player's own cards, on whatever page is open (mounted in App like the save prompt). The DM's device chose who
  // may react and checks every answer; an answer that needs dice rolls them here.
  import { aimPlan } from '../../lib/combat/aiming.ts';
  import type { ReactOption } from '../../lib/combat/reactions.ts';
  import { pcActions, type TurnAction } from '../../lib/combat/turnActions.ts';
  import { featureList } from '../../lib/character/play.ts';
  import { db } from '../../lib/db.ts';
  import { roll as rollDie } from '../../lib/rolls.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { sendReact, session } from '../../lib/sync/session.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import type { Campaign, Character } from '../../lib/types.ts';
  import { message } from '../creator/labels.ts';
  import { rollAim } from './aimRoll.ts';
  import ReactionCard, { type Card } from './ReactionCard.svelte';

  let { campaign }: { campaign: Campaign } = $props();

  let chars: Character[] = $state.raw([]);
  $effect(() => { void session.rev; const id = campaign.id; db.characters.list(id).then((c) => { if (id === campaign.id) chars = c; }, (e) => toast(message(e), true)); });

  /** Rows answered or passed, hidden until the DM's next message drops them (a double tap sends one answer). */
  let answered: Record<string, true> = $state({});
  const cards = $derived((session.reactions?.prompts ?? []).map((p): Card => ({ ask: p.ask, trigger: p.trigger, ms: p.ms,
    rows: p.reactors.filter((r) => !answered[p.ask + r.characterId]).map((r) => ({ id: r.characterId, name: r.name, options: r.options })) })).filter((c) => c.rows.length));

  function react(ask: string, characterId: string, o: ReactOption | 'pass') {
    if (session.status !== 'online') { toast("You're offline: that wasn't sent.", true); return; }
    const c = chars.find((x) => x.id === characterId);
    try {
      const sheet = c && computeSheet(c, { settings: campaign.settings, viewer: 'player' }), features = c ? featureList(c, campaign.settings) : [];
      const find = (f: (a: TurnAction) => boolean) => (c && sheet ? pcActions(c, sheet, features).find(f) : undefined);
      const aim = (a: TurnAction | undefined, level?: number) => {
        const plan = a && aimPlan(a, { level, features: features.map((f) => f.name) });
        if (!a || !plan) throw new Error(`${c?.name ?? 'That character'} can't do that.`);
        return { rolled: rollAim(a.name, plan).rolled, toggles: [] }; // ponytail: the damage dice stay unshown (the DM's device rolls on from these); the target is the DM's to pick
      };
      if (o === 'pass') sendReact(ask, characterId, 'pass');
      else if (o.id === 'oa' && o.spell) sendReact(ask, characterId, 'oa', { spell: o.spell, aim: aim(find((a) => !!a.spell && a.name === o.spell)) }); // War Caster
      else if (o.id === 'oa') sendReact(ask, characterId, 'oa', { aim: aim(find((a) => a.id === 'react:opportunity')) });
      else if (o.id === 'more') sendReact(ask, characterId, 'more', { key: o.key, ...(o.slot !== undefined && { slot: o.slot }), ...(o.strike && { aim: aim(find((a) => a.id === 'react:opportunity')) }) });
      else if (o.id === 'rebuke') sendReact(ask, characterId, 'rebuke', { slot: o.slot, aim: aim(find((a) => !!a.spell && a.name === 'Hellish Rebuke'), o.slot) });
      else if (o.id === 'counterspell') sendReact(ask, characterId, 'counterspell', { slot: o.slot, d20: rollDie(`${c?.name ?? 'Counterspell'}: Counterspell check`, '1d20', { mode: 'normal' }).faces[0] });
      else sendReact(ask, characterId, o.id, o.slot === undefined ? {} : { slot: o.slot });
      answered[ask + characterId] = true;
    } catch (e) { toast(e instanceof Error ? e.message : String(e), true); }
  }
  const pass = (ask: string, id?: string) => { for (const r of id ? [id] : cards.find((c) => c.ask === ask)?.rows.map((x) => x.id) ?? []) react(ask, r, 'pass'); };
</script>

<ReactionCard {cards} note={session.reactions?.waiting ? 'Waiting on reactions…' : undefined} onanswer={react} onpass={pass} />
