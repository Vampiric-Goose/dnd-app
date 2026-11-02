<script lang="ts">
  // Choices a built character never made (a book upgrade added one, such as Variant Human's feat): only the unanswered ones, any level,
  // without levelling up. Saving re-embeds the content the answers use, as Level up does.
  import { embedContent, listChoices, validateCharacter, type Problem } from '../../lib/character/build.ts';
  import type { ContentIndex } from '../../lib/content/index.ts';
  import { db } from '../../lib/db.ts';
  import { navigate } from '../../lib/router.svelte.ts';
  import { computeSheet } from '../../lib/rules/sheet.ts';
  import { DEFAULT_SETTINGS } from '../../lib/settings.ts';
  import { app, getFullIndex, getIndex } from '../../lib/store.svelte.ts';
  import type { Character } from '../../lib/types.ts';
  import ChoicesStep from './ChoicesStep.svelte';
  import { message } from './labels.ts';

  let { params }: { params: { id: string } } = $props();

  let c: Character | undefined = $state();
  let index: ContentIndex | undefined = $state.raw();
  let error = $state('');
  /** The choices already answered when the page opened: hidden. The rest stay in view while they're answered. */
  let answered: Set<string> | undefined = $state.raw();

  $effect(() => {
    const id = params.id;
    db.characters.get(id).then(async (found) => {
      if (!found) return void (error = 'Character not found.');
      index = await (found.campaignId ? getIndex(found.campaignId) : getFullIndex());
      const s = app.campaigns.find((x) => x.id === found.campaignId)?.settings ?? DEFAULT_SETTINGS;
      answered = new Set(listChoices(found, index, s).filter((p) => p.answer).map((p) => p.key));
      c = structuredClone(found);
    }).catch((e) => (error = message(e)));
  });

  const settings = $derived(app.campaigns.find((x) => x.id === c?.campaignId)?.settings ?? DEFAULT_SETTINGS);
  const sheet = $derived(c && index ? computeSheet(embedContent(c, index), { settings, viewer: 'dm' }) : undefined);
  const problems = $derived<Problem[]>(c && index ? validateCharacter(c, index, settings) : []);
  let saving = $state(false);

  async function save() {
    if (!c || !index) return;
    saving = true;
    error = '';
    try {
      const done = embedContent($state.snapshot(c) as Character, index);
      await db.characters.put(done);
      navigate(`characters/${done.id}`);
    } catch (e) {
      error = message(e);
    } finally {
      saving = false;
    }
  }
</script>

<section class="choices" aria-labelledby="ch-h">
  <h1 id="ch-h">Choices to make{c ? `: ${c.name || 'Unnamed'}` : ''}</h1>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if c && index && sheet}
    <p class="muted">Choices this character hasn't made yet, such as a feat their race now offers. Nothing else changes.</p>
    <ChoicesStep bind:c {index} {settings} {sheet} {problems} hidden={answered} />
    <div class="row btns">
      <button type="button" class="primary" disabled={saving} onclick={save}>Save</button>
      <a class="btn" href="#/characters/{c.id}">Cancel</a>
    </div>
  {:else if !error}
    <p class="muted">Loading…</p>
  {/if}
</section>

<style>
  .choices {
    max-width: 44rem;
  }

  .btns {
    margin-top: 1rem;
  }

  .btns > * {
    min-height: 44px;
  }
</style>
