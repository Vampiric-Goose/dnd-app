# DNDND redesign: "Abyssal instrument"

The app should look like a crafted tool, not generic AI-made web pages. The user's words: "teal and dark, sleek design with minimalist
tones. The space should be fully used, but the information [shouldn't be] overwhelming. More nesting and pull-downs instead of drowning
in parameters." The user chose direction A ("Abyssal instrument") over two others, approved the Map and Combat layouts and Items
layout A, asked that the rest of the app get the same treatment, and wants the app always dark. Approved mockups:
`docs/superpowers/specs/abyssal-mockups/` (`directions.html` option A, `three-pages.html` Map and Combat, `items-v2.html` option A).

## Goals
- One visual system across every page: near-black blue-green ground, one sharp teal accent, hairline rules instead of boxes, monospace numbers.
- Use the whole screen on desktop. Pages that are about one selected thing use **navigation · workspace · right panel**.
- Three tiers of controls everywhere: **always visible** (touched every minute), **one tap away** (pull-down, "+ Add" menu, a tool's options
  strip, a row's detail panel), **tucked away** ("⋯" menu, a settings tab, folded drawers). Folded drawers show a one-line summary when closed.
- Phones stay first-class: one column, bottom tab bar (already built), the right panel becomes a bottom sheet.

## Non-goals
- No feature changes or rules changes. Every existing control still exists somewhere (moved, folded or tucked away), with its label and
  behaviour. No data, sync or storage changes.
- No light theme (removed: the app is always dark). Spec 3.9's "per-device theme follows the system" is replaced by this decision.

## Anti-goals (what would make it slop)
- Gradients, glows, glassmorphism, drop-shadow cards everywhere, emoji icons, rounded "bubbly" pills on everything, purple.
- Several accent colours. Teal is the only accent; red only for damage, danger and warnings; amber only for the dice "last roll" highlight.
- Big empty padded cards with little in them; centred narrow columns on a wide screen.

## Visual system (tokens in `src/app.css`, dark only)
| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0a1113` | page ground |
| `--rail` | `#070d0e` | left navigation |
| `--panel` | `#0c1719` | right panel, menus, bottom sheet |
| `--raised` | `#0f2a2b` | selected row / active nav background |
| `--line` | `#14272a` | hairline rules and panel borders |
| `--line-strong` | `#1d3a3a` | control borders |
| `--text` | `#cfe3df` | body text |
| `--text-strong` | `#eafffb` | names, numbers, headings |
| `--muted` | `#6f8f8b` | secondary text (check ≥ 4.5:1 on `--bg`; lighten if needed) |
| `--label` | `#5f8783` | small uppercase captions (≥ 4.5:1 on its background; lighten if needed) |
| `--accent` | `#2dd4bf` | the one accent: active, selected, primary button fill, focus ring |
| `--on-accent` | `#04201d` | text on accent fill |
| `--danger` | `#e5484d` | damage, destructive, monster HP bars |
| `--roll` | amber, existing roll strip colours retuned to the dark ground | last-roll strip only |

- **Type:** system UI sans for text (no web fonts: first load budget); `ui-monospace, Consolas, monospace` for every number a player reads
  at a glance (scores, modifiers, HP, AC, initiative, dice totals, counts in filters). Captions: 10–11 px uppercase, 0.12–0.14em tracking.
  Names: 15–22 px, `--text-strong`. Base 14 px desktop, 15–16 px phone.
- **Shape:** radius 4–7 px on controls; no shadows except floating menus/sheets. Rules are 1 px `--line`. Selected items: `--raised`
  background plus a 2 px inset left bar in `--accent`.
- **Buttons:** default = transparent with `--line-strong` border; primary = accent fill (`--on-accent` text); danger = red text/border.
  Minimum 44 px tall touch targets on phones (desktop may be 32–36 px).
- **Focus:** visible 2 px `--accent` ring on every control. Contrast AA for all text.

## Shared building blocks (in `src/ui/kit/`, used by every page)
- `Workspace.svelte`: grid of main + optional right panel (`panel` snippet). Desktop ≥ 1024 px: panel 280–340 px on the right, full height,
  scrolls on its own. 768–1023 px: panel narrower. < 768 px: panel becomes a bottom sheet that slides up when there is a selection
  (handle to collapse; a close button), main uses the full width.
- `Tabs.svelte`: underline tabs (accent underline on the active one), keyboard arrow navigation, `role="tablist"`.
- `Drawer.svelte`: a `<details>`-based fold with a caption, a one-line `summary` snippet shown when closed, accent chevron.
- `Menu.svelte`: a pull-down (button + popover list, Escape and outside-click close, arrow keys), used for "+ Add", "⋯", filter pull-downs
  with counts and checkmarks, and the scene picker.
- `Pill.svelte` (removable filter pill "Rare ✕"), `Stat.svelte` (caption + monospace value), `Bar.svelte` (thin HP bar; teal for
  characters, red for monsters).
- Pages compose these; no page invents its own panel, tab or drawer styling.

## App shell
- Left rail on desktop: the name **DNDND** (letter-spaced), then nav; active item uses the selected style. Campaign picker and the
  viewer toggle move to a slim top bar in the workspace header (the joined-player rule stays: no toggle in a player campaign).
  Sync status chip stays in that top bar.
- Phone: bottom bar (Characters, Combat, Map, Items, More) as built; restyled to the tokens.
- Backup banner: a slim one-line strip, not a card. Dice tray button: restyled (accent outline), stays out of the way of bottom sheets.
- Toasts: dark panel, accent or red left bar.

## Pages
**Map** (approved mockup): the canvas fills the workspace. Floating top-left segmented tool switcher (Select · Ruler · Template · Fog;
Box select stays reachable from Select's options strip). Under it, the active tool's options strip only (fog brush/rectangle/size/
reveal/hide/all; template shape/size/width and its "inside" list; box select hint). Top-right: scene picker (a Menu: scenes, "New scene…",
with a "Shown" accent dot) and the Show/Stop showing toggle. Bottom-right: − Fit +. Right panel tabs: **Selected** (name, size, HP with
damage/heal, hidden toggle, portrait, Add to combat, Remove; multi-select shows count + bulk actions), **Tokens** (list + one "+ Add"
Menu: Add party, a character, monster search with count), **Scene** (rename, grid form, Detect grid, free movement, delete scene).
Player map: same canvas and floating zoom; the right panel shows own tokens and the turn status.

**Combat** (approved mockup): a turn bar (Round, whose turn, ◀ Prev, Next turn ▶ primary, "+ Add" Menu: party, character, monster
search, lair; "⋯" Menu: Modules, Group identical monsters, Sort, Roll unrolled, End combat). Setup state shows Start instead of Next.
Rows: initiative (mono), name, HP bar (+ number on hover/wide), condition chips; current turn uses the selected style; drag + up/down
buttons keep working (move buttons can live in the row's panel on phones). Clicking a row selects it; the right panel shows its full
controls (HP with damage/heal/temp, conditions with durations, concentration, death saves, legendary, reaction, stat block, notes, remove)
as drawers. Second panel tab: **Encounters**. Player tracker: same rows, read-only, own initiative entry.

**Items** (approved option A): tabs All items / Unassigned (with count), "+ New item". Search plus pull-down filters (Kind, Rarity,
Type, Source, Sort) with counts and checkmarks; active filters as removable pills plus "N items · clear". A sortable table (Name, Type,
Rarity, Attunement, Source). Right panel: the chosen item (Give to…, To Unassigned, quantity, description drawer open, Player view,
Customize, Export PDF tucked). Item editor and character inventory (`EntryRow`) use drawers and an actions Menu instead of open panels.

**Character sheet:** header (name, race · class · level, AC, speed, initiative as Stats); ability row of six Stats; main column of
drawers (Attacks open by default, Skills & saves, Features, Spells, Inventory, Notes/custom effects) each with a closed summary; right
panel = live status (HP big mono + bar + HpControls, temp HP, conditions, death saves, hit dice/rests, last roll). Edit mode stays.
**Characters list:** a dense list (name, race/class/level, HP bar, owner) with the selected character's summary in the panel; party roster
for synced campaigns; import tucked in a Menu.
**Creator / Level up:** step list on the left of the workspace (or a compact stepper), current step in the middle, a live summary panel.
**Compendium and Monsters:** same as Items (search + filter pull-downs + table/list + detail panel with the stat block/entry).
**Campaigns, Settings, Packs, Join, About:** settings-style pages: grouped drawers with summaries, one column up to ~900 px with
captions in a left gutter on wide screens; destructive actions tucked and red.

## Constraints
- Svelte 5, existing code. No new dependencies; no web fonts. First load ≤ 150 KB gzipped (`npm run size`, now 58.8 KB).
- `npm run check` clean, `npx vitest run` passes (tests are logic-level; behaviour must not change).
- Accessibility: labels kept (`aria-label`s the code already has), keyboard reachable menus/tabs/drawers, focus ring, AA contrast,
  44 px touch targets on phones, no horizontal page scroll at 375 px.
- Remove the light theme and the `prefers-color-scheme` light tokens; `color-scheme: dark`; manifest/theme-color dark.

## Left to the builder
Exact spacing, icon glyphs (plain text glyphs like ▾ ▸ ◀ ▶ ⋯ ✕; no icon font), breakpoints within the stated ranges, how each smaller
page arranges its drawers, and the right-panel content of pages not mocked up, following the patterns above.
