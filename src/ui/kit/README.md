# UI kit (Abyssal redesign)

The shared building blocks every page uses. Spec: `docs/superpowers/specs/2026-11-01-abyssal-redesign-design.md`.
Pages compose these; no page invents its own panel, tab, drawer, menu, pill, stat or HP-bar styling.

## Tokens and global classes (`src/app.css`)

Colours: `--bg`, `--rail`, `--panel`, `--raised` (selected), `--line` (hairlines), `--line-strong` (control borders), `--text`,
`--text-strong` (names, numbers, headings), `--muted`, `--label` (captions), `--accent` (the only accent), `--on-accent`,
`--danger` (damage, destructive, monster HP), `--roll-bg/-fg/-edge` (the sheet's last-roll strip only).
Also `--mono` (font stack), `--radius` (5 px), `--topbar-h` (measured sticky top-bar height), `--bottombar-h` (phone tab bar, 0 on desktop).
`--surface` and `--border` are legacy aliases (`--panel`, `--line-strong`) kept for old page styles; do not use them in new code.

Never hard-code a colour. Red only for damage, danger and warnings; amber only for the last-roll strip.

| Class | Use |
| --- | --- |
| `.num` | every number read at a glance (scores, modifiers, HP, AC, initiative, totals, counts): monospace, tabular |
| `.caption` | small uppercase caption ("HIT POINTS") |
| `.muted` | secondary text |
| `.error` | error text (red) |
| `.prose` | prose-only pages (About, long help): 46 rem measure instead of full width |
| `.row`, `.field`, `.check`, `.card`, `ul.plain`, `.sr-only` | as before, restyled |
| `button.primary` / `button.danger` | accent fill / red text and border; plain `button` is a transparent outline button |
| `button[aria-pressed=true]` | selected style (raised + accent border) for segmented toggles |

Selected rows (lists, tables): `background: var(--raised); box-shadow: inset 2px 0 var(--accent); color: var(--text-strong)`.
Base size is 14 px on desktop and 16 px on phones (rem follows it). Phones get 44 px controls from `app.css` automatically.

## Page layout

The shell (`App.svelte`) pads every page with `--page-pad` (sides) and `--page-pad-bottom` and gives it the full width beside the
rail; there is no centred column. A page about one selected thing wraps itself in `Workspace`, which cancels that padding and
lays out main + right panel edge to edge. Settings-style pages can stay plain and use `.prose` or their own max width.

## Workspace.svelte

Main column + optional right panel. Desktop >= 1024 px: 320 px panel; 768-1023 px: 260 px; both sticky under the top bar, full
height, scrolling on their own. < 768 px: the panel is a bottom sheet shown while `open` is true (handle folds it to one bar;
`onclose` adds a ✕ button). The floating Dice button hides while the sheet is open and unfolded.

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `children` | snippet | | main column |
| `panel` | snippet | | right panel / bottom sheet; omit for no panel |
| `panelLabel` | string | `'Details'` | the panel's aria-label and the sheet's title |
| `open` | boolean | `false` | phones: show the sheet (desktop panel always shows) |
| `onclose` | `() => void` | | phones: the sheet's close button (typically clears the selection) |
| `fill` | boolean | `false` | exactly one screen tall, main has no padding and clips (the map canvas) |

```svelte
<Workspace panelLabel="Combatant" open={selected !== undefined} onclose={() => (selected = undefined)}>
  <TurnBar />
  {#each rows as r}<Row {r} />{/each}
  {#snippet panel()}
    {#if selected}<CombatantDetail c={selected} />{:else}<p class="muted">Pick a row.</p>{/if}
  {/snippet}
</Workspace>
```

## Tabs.svelte

Underline tabs, `role="tablist"`, roving tabindex, Left/Right/Home/End move and activate.

| Prop | Type | |
| --- | --- | --- |
| `tabs` | `{ id: string; label: string; count?: number }[]` | ids without spaces; `count` shows in mono after the label |
| `value` | string, bindable | the active id |
| `label` | string | the tablist's aria-label |
| `onchange` | `(id) => void` | fires on a user change (for tabs kept in the URL) |
| `panel` | snippet `(id)` | optional: renders in a `role="tabpanel"` wired to the tab; else render content yourself |

```svelte
<Tabs label="Panel" tabs={[{ id: 'selected', label: 'Selected' }, { id: 'tokens', label: 'Tokens', count: tokens.length }]} bind:value={tab}>
  {#snippet panel(id)}
    {#if id === 'selected'}<SelectedTab />{:else}<TokensTab />{/if}
  {/snippet}
</Tabs>
```

## Drawer.svelte

A `<details>` fold: accent chevron, caption, a one-line summary shown only while closed. Drawers stack with hairline rules.

| Prop | Type | |
| --- | --- | --- |
| `title` | string | caption |
| `open` | boolean, bindable | default `false` |
| `summary` | snippet | one line beside the caption while closed (ellipsized) |
| `children` | snippet | the content |

```svelte
<Drawer title="Inventory">
  {#snippet summary()}<span class="num">{items.length}</span> items · <span class="num">{weight}</span> lb{/snippet}
  <Inventory />
</Drawer>
```

## Menu.svelte

A pull-down: trigger button + floating list in the top layer (native `popover`, so a scrolling panel never clips it). Escape and an
outside click close it; arrow keys / Home / End move; picking an item runs it, closes, and returns focus to the trigger.

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `label` | string | | trigger text ("+ Add", "⋯", "Rarity") |
| `ariaLabel` | string | | name for a glyph trigger ("More actions") |
| `items` | `MenuItem[]` | `[]` | see below |
| `children` | snippet `(close)` | | extra content after the items (a search box, a small form) |
| `active` | boolean | `false` | accent trigger (a filter that is set) |
| `primary` | boolean | `false` | accent-filled trigger |
| `caret` | boolean | `true` | the ▾ after the label (turn off for "⋯") |
| `align` | `'start' \| 'end'` | `'start'` | which trigger edge the list lines up with |
| `disabled` | boolean | `false` | |

`MenuItem` (exported from the component's module script) is `{ label, onselect, count?, checked?, danger?, disabled?, keepOpen? }`
or `{ separator: true }`. `checked` defined makes the item a `menuitemcheckbox` with a ✓ column; `keepOpen` keeps the menu open
(multi-select filters).

```svelte
<script lang="ts">
  import Menu, { type MenuItem } from '../kit/Menu.svelte';
  const rarityItems = $derived<MenuItem[]>([
    { label: 'Any rarity', checked: rarity === '', onselect: () => (rarity = '') },
    ...RARITIES.map((r) => ({ label: r, count: counts[r], checked: rarity === r, onselect: () => (rarity = r) })),
  ]);
</script>

<Menu label={rarity || 'Rarity'} active={rarity !== ''} items={rarityItems} />
<Menu label="⋯" ariaLabel="More combat actions" caret={false} align="end"
  items={[{ label: 'Sort', onselect: sort }, { separator: true }, { label: 'End combat', danger: true, onselect: end }]} />
<Menu label="+ Add" items={[{ label: 'Add party', onselect: addParty }]}>
  {#snippet children(close)}<MonsterSearch onadd={(m) => { add(m); close(); }} />{/snippet}
</Menu>
```

Needs the Popover API (Safari 17+, Chrome 114+, Firefox 125+).

## Pill.svelte

`label`, `onremove?`, `accent?`. With `onremove`: a removable filter pill, a button named "Remove {label}" showing "label ✕"
(44 px hit area on phones). Without: a static chip (conditions, sizes); `accent` gives the teal outline.

```svelte
{#if rarity}<Pill label={rarity} onremove={() => (rarity = '')} />{/if}
<Pill label="Bloodied" accent />
```

## Stat.svelte

Caption over a monospace value. `label`, `value` (string | number), `box?` (hairline box, for the ability row), `size?`
(`'sm' | 'md' | 'lg'`, default `'md'`), `children?` (rendered under the value, muted: the score under a modifier).

```svelte
<Stat label="AC" value={sheet.ac} />
<Stat label="Str" value={signed(mods.str)} box>{scores.str}</Stat>
<Stat label="Hit points" value="{hp} / {max}" size="lg" />
```

## Bar.svelte

Thin HP bar, `role="meter"`. `value`, `max`, `label` (accessible name), `tone?` (`'accent'` teal for characters, default;
`'danger'` red for monsters), `temp?` (temporary HP, a lighter segment). Print the numbers yourself in `.num`.

```svelte
<Bar value={c.hp} max={c.maxHp} label="{c.name} hit points" tone={c.kind === 'monster' ? 'danger' : 'accent'} />
```
