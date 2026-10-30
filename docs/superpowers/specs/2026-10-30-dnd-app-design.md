# dnd-app: design

Date: 2026-10-30 · Status: draft, awaiting approval

## 1. What this is, and why

An all-in-one web app for running a **2014-rules D&D 5th edition** campaign. One DM and their
players use it for everything around the table: building and storing characters, monsters and
magic items; tracking inventory; and running combat with an initiative tracker and a shared,
live battle map.

The point is one tool instead of several. It should be free to host and fast on every device the
group owns, from a strong laptop to an old phone.

Success looks like this:

- A player builds a legal 2014 character from any official sourcebook the group has imported,
  plays it from the sheet, then exports it to PDF (and later markdown) and back with nothing lost.
- The DM hosts a session from their own browser. Players join with a code, see the live map in a
  tab, and drag their own token on their turn.
- None of this lags on a low-end phone.

## 2. People and roles

- **DM.** Owns a campaign. The DM's browser is the campaign's host and source of truth, and sees
  everything.
- **Player.** Owns their own characters and joins the DM's campaigns.
- One person can be the DM of one campaign and a player in another.
- There are no accounts. In each campaign, a player is a **player ID** the DM's device assigns at
  join: one letter and one number, such as B3. The campaign's join code is the only key (3.6).

## 3. Goals

### 3.1 Rules content

- **Built in: the SRD 5.1 only.** This is the free CC-BY-4.0 part of 2014 5e: races, the 12 classes
  with one subclass each, the Acolyte background, one feat, spells, equipment, magic items,
  monsters and conditions. Show the required attribution in the app:
  *"This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by
  Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document.
  The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License
  available at https://creativecommons.org/licenses/by/4.0/legalcode."*
- **Everything else comes from import.** This means the 2014-era sourcebooks: Player's Handbook,
  Xanathar's, Volo's, Tasha's, Sword Coast Adventurer's Guide, Mordenkainen's and so on.
  - The main path is **5etools JSON**. Accept both 5etools homebrew files and 5etools data files.
    The user picks files from disk, and the app never fetches content from any site by itself.
  - Accepted categories: races and subraces, classes, subclasses, class and subclass features,
    optional features (invocations, metamagic, fighting styles, maneuvers and so on),
    backgrounds, feats, spells, items, magic items, monsters and conditions.
  - Resolve 5etools `_copy` entries (an entity defined as "that one, with these changes")
    across all loaded packs. The bestiary files rely on this heavily.
  - Render 5etools inline tags such as `{@spell fireball}`, `{@damage 2d6}` and `{@dc 15}`, and its
    nested `entries` structure, into readable text inside the app.
- **Content packs.** Each import is a pack, named after its source and enabled or disabled per
  campaign. A pack can be re-imported to replace itself, or deleted.
- **Overlap with the SRD.** Some imported entities are the SRD version of the same thing, such as
  the PHB Fighter, Fireball or the MM Goblin. 5etools marks these with `srd`. They **merge into
  the built-in entity** instead of becoming a duplicate:
  - The book's text and extra fields are added.
  - The hand-written effects are kept.
  - The book's source code (for example PHB) becomes an alias, so imported subclasses that point
    at the PHB Fighter attach to it.

  Any other same-name entities from different packs are both kept and told apart by source.
- **2024 entries are dropped.** Current 5etools files mix in 2024-rules entries, such as the
  XPHB and XMM sources. Import skips them.
- **Paste-text import** for a single monster, spell or magic item. The user pastes one entry's
  text (for example, copied from a PDF they own) and the app parses it into a draft for review.
- Adventure books are not special. Their monsters and items come in like any other pack.

### 3.2 Characters

**Native creator.** Each step can be revisited.

1. Race and subrace.
2. Class, with a subclass at that class's level.
3. Ability scores: point buy (27 points, costs 8:0 to 15:9), the standard array
   (15, 14, 13, 12, 10, 8), or rolled (4d6, drop the lowest, six times).
4. Background.
5. Proficiency, skill, language and tool choices.
6. Equipment: the class and background packages, or starting gold.
7. Spells.
8. Details: name, alignment, personality, appearance, portrait.
9. Review.

A character can be created at any level. The creator then walks through each level-up in turn.

**Where characters live.**

- Characters are a personal roster on the player's device. Each one is in at most one campaign
  at a time. A character made before joining can be brought into a campaign later. Once it's in a
  campaign, it belongs to the player's ID there, so all of that player's devices get it.
- For a character in a campaign, the creator offers only the SRD and that campaign's enabled
  packs.
- **A character embeds a copy of every race, class, subclass, feature, feat, background and spell
  it uses.** Like inventory items, this keeps it working with correct numbers on any device,
  after a pack is disabled or deleted, and in exports.
- Pack changes never recompute a character on their own. An "update from source" action does
  that.
- A high-level caster comes to roughly 100 to 500 KB. Sync size limits must allow for that.

**Rules it enforces.**

- Prerequisites for multiclassing (13 in the primary ability, both for the new class and for
  each current one) and for feats.
- The ability score increase or feat choice at each class's ASI levels.
- Multiclass proficiencies.
- The multiclass spell slot table: full casters count fully, paladins and rangers count half
  (rounded down), Eldritch Knights and Arcane Tricksters count a third (rounded down), and
  artificers count half (rounded up). Pact Magic is tracked separately.
- Spells known versus prepared, cantrips, and the wizard's spellbook.
- Hit points: maximum at 1st level, then average or rolled (a campaign setting), plus the Con
  modifier at every level. A Con change applies back to every level.

**Bypassing the rules.** "Allow rule overrides" is an advanced setting that is off by default.
When it is on, the creator lets you pick anything regardless of prerequisites, and you can type
ability scores in by hand.

**Tasha's optional rules** are toggles in the campaign settings:

- Customizing Your Origin moves the racial ability score increases and swaps languages and
  proficiencies. It works on any race, including the SRD races.
- Optional class features, when a pack that contains them is loaded.

**Level-up flow.**

- Pick a class, and check multiclass rules if it's a new one.
- Hit points.
- New features.
- Every choice the new level grants: subclass, fighting style, ASI or feat, spells learned or
  swapped, expertise, invocations, metamagic and so on.

**Calculated values.** These are computed from build choices and equipped items: AC (armor
formulas, shields, Unarmored Defense and similar), attack and damage bonuses for each equipped
weapon, saves, skills (including expertise, Jack of All Trades and so on), passive Perception,
initiative, spell save DC and spell attack, proficiency bonus, speed, and carrying capacity.

- **Any calculated value can be overridden on the sheet**, always and not only in advanced mode.
- Overridden values are visibly marked, and each one can be reset back to the calculated value.

**Feature effects.** Features and items can carry machine-readable effects from a small
vocabulary, for example "+1 AC while wearing armor", "add Cha to saves", "set Str to 19",
"resistance to fire" or "advantage on X". These effects feed the calculations.

- For the SRD content, the builder writes these effects by hand.
- Imported content usually arrives as text only, so it shows as text. The user can add a custom
  effect on the sheet instead.

**Play mode on the sheet.**

- Current, maximum and temporary HP.
- Death saves. A natural 20 regains 1 HP. A natural 1 counts as two failures. Taking damage at
  0 HP counts as one failure, or two on a critical hit.
- Hit dice.
- Spell slots and pact slots.
- Class resources (rage, ki, sorcery points, channel divinity and so on), as counters with a
  maximum and a recharge rule (short rest, long rest or dawn).
- The 14 conditions and exhaustion levels 1 to 6.
- Inspiration.
- A **short rest** button: spend hit dice and roll Con, and recover short-rest resources and
  pact slots.
- A **long rest** button: full HP, half of total hit dice back (at least 1), all slots,
  long-rest resources, and one level of exhaustion removed.

**Dice roller.**

- Click any attack, damage, save, skill, check or initiative to roll it.
- Advantage and disadvantage.
- Critical hits double the damage dice.
- A free-text box for dice notation (for example `2d6+3` or `4d6kh3`).
- A roll log. During a live session, player rolls are public by default and the DM's rolls are
  private by default, and each roll can be flipped either way.

### 3.3 Items and inventory

- **Item compendium.** Mundane items are SRD equipment: weapons and their properties, armor and
  its Dex cap, Str requirement and stealth disadvantage, gear, tools and packs. Magic items come
  from the SRD plus imports.
- **Magic item creator.** Fields:
  - name and type
  - rarity
  - attunement: whether it's needed, and by whom
  - optional base item, for example a +1 longsword built on a longsword
  - bonuses to attack, damage, AC, saves and spell attack/DC
  - effects (from the 3.2 vocabulary)
  - charges: maximum and recharge rule, for example "1d6+1 at dawn"
  - a consumable flag
  - description
- **Inventory** for each character:
  - Entries carry quantity, equipped, attuned, charges left and notes.
  - Each entry **embeds a copy of the item's data** and links back to its source record. That
    way an item still works on a device that lacks the source pack, and after the source is
    deleted. An "update from source" action refreshes the copy.
  - Equipped items feed AC and attacks.
  - Using a consumable lowers its quantity, and using a charge lowers the charge count. Rests and
    "dawn" restore charges according to each item's rule.
- **Currency:** cp, sp, ep, gp, pp.
- **Attunement:** a 3-item limit. The app warns at the limit and doesn't block, and an override
  raises the limit for artificers.
- **Encumbrance** is a campaign option that is off by default.
  - Standard: carrying capacity is Str × 15.
  - Variant: encumbered above Str × 5, heavily encumbered above Str × 10.
  - Size multipliers apply to both.
- **Party loot.** A campaign-level inventory: the DM adds loot, players claim it, and items can
  be transferred between characters.
- **Player views and secret items.** Every item that reaches players has two versions: the true
  record, and a **player view** the DM controls. This covers mundane and magic items, in party
  loot or in any inventory.
  - The DM can give the item a different name for players and rewrite the description players
    see. An unidentified Potion of Poison can read "a cloudy red potion".
  - The DM can **redact** chosen parts of the text. Players see those parts as a blacked-out bar.
  - The DM can hide individual fields: rarity, attunement, bonuses, effects, charges, or a curse.
  - **Reveal.** The DM can uncover hidden parts one at a time, or all at once ("identify").
  - The true record lives only on the DM's device. Hidden parts are never sent to players, and a
    player's export holds only what that player can see.
  - Hidden effects don't change the player's calculated numbers until revealed. The DM's view of
    that character shows the true numbers, with the hidden effects marked.

### 3.4 Monsters

- **Monster creator.** It covers the full 2014 stat block:
  - size, type and alignment
  - AC and its source
  - HP from hit dice and Con
  - speeds
  - ability scores
  - saves and skills
  - damage vulnerabilities, resistances and immunities
  - condition immunities
  - senses and languages
  - CR, with XP and proficiency derived from it
  - traits, including spellcasting and innate spellcasting
  - actions, bonus actions, reactions, legendary actions (with the count per round), lair
    actions and regional effects
- New monsters can be built from scratch or **duplicated** from any existing monster and edited.
- **CR suggestion** is a campaign option that is off by default. It uses the DMG chapter 9 method:
  defensive CR from HP and AC, offensive CR from damage per round and attack bonus or save DC,
  then the average of the two.
- Monster storage covers the SRD, imported packs, and the DM's own monsters. The library is
  searchable and filterable, and long lists are virtualized because imports can hold thousands
  of monsters.

### 3.5 Import and export (markdown and PDF)

Characters, monsters and magic items all export to and import from **JSON (our own format) and
PDF**. Markdown follows later, in stage 6. It's wanted, but not critical.

- **Markdown (stage 6) follows Homebrewery/GM Binder style**, so monster stat blocks and item
  blocks paste straight into those tools.
  - Monsters use the Homebrewery V3 `{{monster,frame ...}}` block on export. Import accepts V3,
    the legacy V1/GM Binder `___ / > ## Name` style, and our own exports.
  - Items use the common Homebrewery item pattern: a heading, then an italic type, rarity and
    attunement line, then the description.
  - Characters use a readable sheet layout of our own design that still renders well in
    Homebrewery.
  - **Every export also embeds the full record as JSON inside an HTML comment.** Homebrewery
    doesn't show comments, and the embedded data makes re-import lossless. Markdown without that
    data, such as files from other tools, is parsed best-effort into a draft for review.
- **PDF.**
  - **Import** reads fillable-form PDFs through *field maps* written into the source code. Each
    supported layout is one map from PDF field names to our fields. Two are required: the
    official WotC 2014 fillable character sheet, and our own exported PDFs. More layouts are
    added later by adding a map. Text is read from form fields only, with no OCR and no parsing
    of whole book PDFs.
  - **Export** uses our own clean layout, not a copy of the official sheet's design.
    - Characters get several pages: main sheet, spells, and features and inventory.
    - Monsters get a stat block, and magic items get a card.
    - Our PDFs are **fillable forms** (and so readable through their own field map) and **embed
      the full JSON record**.
    - On re-import, the embedded record restores everything. Any form field the user edited in a
      PDF reader comes in as an edit, marked as an override where it conflicts with a calculated
      value.
  - A character imported from the official sheet comes in marked "imported, unverified". Values
    that disagree with the rules become overrides.
- **Backup.** Export a whole campaign, or everything, as a single file that includes images, and
  import it back. This is how data moves between devices.

### 3.6 Campaigns, sync and live sessions

- There can be several campaigns, each with its own characters, monsters, items, maps,
  encounters, settings and enabled packs.
- **The DM's browser hosts the campaign.** No server is involved: devices connect directly to
  each other over WebRTC, through PeerJS and its free public introduction ("signaling") service.
  - Game data never passes through that service. The data channel is encrypted.
  - The network is a star with the DM at the centre.
- **Joining.**
  1. The DM clicks "Host" and gets a join code and a link (`…/#/join/CODE`). The code is random,
     at least 10 characters, and stays fixed for the campaign so the link keeps working.
  2. **The join code is the only key.** There's no further approval step. A device that opens
     the link joins either as a new player or as an existing player ID.
  3. A new player gets the next free player ID: one letter and one number (A1 to Z9), unique
     within the campaign.
  4. **Ownership belongs to the player ID, not the device.** All of a player's devices can be used
     at the same time, and their changes reach each other through the DM.
  5. The DM can remove a player ID, and can **issue a new join code**, which disconnects anyone
     still using the old one. This is the remedy if the code leaks.
  6. **Lost or replaced device:** join again with the code and your player ID. The DM's copy
     restores your characters.
- **Sync rules.**
  - A player ID owns its characters. Any of that player's devices can edit them at any time,
    online or not. The DM can also edit any character, for example to apply combat damage or hand
    over an item.
  - Changes flow both ways whenever both devices are connected. Edits made while apart merge on
    the next connection. The builder must guarantee the following:
    - Concurrent edits to *different* fields of the same record all survive.
    - Concurrent additions to a list, such as inventory, all survive. Deletions stick.
    - Concurrent edits to the *same* field: the later edit wins, using a hybrid logical clock so
      device clock drift doesn't decide it. There is no conflict prompt.
  - Players sync only while the DM has the campaign open. That limitation is accepted.
- **What players receive.** This is enforced by never sending hidden data, not by hiding it in
  the UI.
  - Campaign name, rules settings, and the party roster.
  - The DM's enabled imported packs for player-facing categories (everything except monsters),
    so players can build characters. Packs are sent once and cached by content hash.
  - Monsters and items the DM made themself stay on the DM's device until handed out.
  - Their own characters in full. Other player characters as a read-only summary: name,
    portrait, race, class, level, HP bar and conditions.
  - Party loot. Every item, in party loot or in an inventory, arrives only as its player view
    (3.3). Hidden fields and redacted text are never sent.
  - Only the map scene the DM has marked "shown to players". Hidden tokens are never sent. Tokens
    inside fogged areas are not sent.
  - Monster tokens show a name (the DM can rename or mask it), size, portrait, condition icons and
    a health status (unhurt, bloodied or down), and never a stat block or exact HP.
  - The initiative order of visible combatants only, plus the round and whose turn it is.
  - Public rolls.
- **The DM's device validates every incoming message.** It checks the shape, checks ownership
  (a player can only change their own records and their own token), and enforces size limits.
- **Known network limit.** With no relay server, some networks block direct connections: some
  mobile carriers, and school or corporate Wi-Fi. Players on the same home Wi-Fi are fine. A
  custom TURN or signaling server setting can be added later.

### 3.7 Initiative tracker

**Core (always on).**

- Add combatants from tokens, from party characters, or from a prepared encounter.
- The app rolls monster initiative automatically, with an option to group identical monsters.
  Players either enter their own roll or let the app roll it.
- The order is sorted with ties broken by Dex score, then at random, and the DM can drag to
  reorder.
- Next and previous turn, a round counter, and adding or removing combatants mid-fight.

**Modules (the "modular dropdown").** The DM switches each one on or off from a dropdown in the
tracker, and the choice is saved per campaign.

- **HP:** damage, healing and temp HP. Monster HP is average or rolled (a campaign setting).
  Changing a player character's HP here edits that character, so their own sheet updates.
- **Conditions:** with optional durations in rounds, ending at the start or end of a chosen
  combatant's turn.
- **Concentration:** a flag on the combatant. When it takes damage, the app prompts a Con save
  with DC = max(10, half the damage).
- **Death saves:** for player characters at 0 HP.
- **Legendary actions:** a counter that resets at the start of the creature's turn.
- **Lair actions:** an entry at initiative 20 that loses ties.
- **Reactions:** a used/unused flag that resets at the start of the combatant's turn.

**Encounters.** The DM can prepare an encounter ahead of time, as a list of monsters and counts.
Starting it adds them to the tracker and places tokens on the current scene. Copies are numbered:
Goblin 1, Goblin 2.

The DM broadcasts each turn change to players, and that turn change is what gates token movement
(3.8).

### 3.8 Battle map

- **Scenes.** A campaign can hold many scenes, each with an uploaded background image.
  - Images are downscaled at import, to at most 4096 px on the longest side.
  - The DM preps scenes privately and marks one at a time as shown to players.
- **Grids.** Square, flat-top hex or pointy-top hex.
  - Cell size and an x/y offset are adjustable, so the grid can line up with a grid printed on
    the image. Color and opacity are adjustable, and feet per cell defaults to 5.
- **Tokens** are flat images, not miniatures.
  - A portrait is resized to at most 256 px. Without one, the token is a colored circle with
    initials.
  - Each token links to a character or monster record. Monster tokens carry their own instance
    state, such as HP.
  - Size follows creature size: Tiny takes a quarter cell, Small and Medium one cell, Large 2×2,
    Huge 3×3, Gargantuan 4×4.
  - Tokens snap to the grid. On hover or selection they show condition icons and an HP bar (the
    DM's view).
  - The DM can multi-select and move tokens, and can hide a token from players.
- **Movement.**
  - The DM moves anything.
  - A player can drag only their own token, and only on their turn in the initiative tracker. A
    campaign toggle, "free movement", lifts the turn rule.
  - Moves show the distance traveled and warn past the token's speed, without blocking.
- **Measuring.**
  - A ruler shows distance. On square grids the diagonal rule is 5-5-5 by default, with the DMG
    5-10-5 variant as an option. On hex grids each hex is 5 ft.
  - Area templates: cone (width equals the distance from the origin), sphere or circle, cube,
    line (5 ft wide by default) and cylinder. A template highlights the affected cells and lists
    the tokens inside.
  - A cell counts as affected when the template covers at least half of it (the DMG grid rule).
    Testing the cell's center is an acceptable approximation.
- **Fog of war** is a campaign option that is off by default.
  - The DM reveals and hides areas by hand, with a brush and a rectangle. There is no automatic
    line of sight or lighting.
  - Players see black. The DM sees a semi-transparent shade.
- **Controls.** Pan and zoom with mouse or touch (pinch), and full touch support for dragging
  tokens.
- **Players' view.** The map is a tab in the player's app. It shows the shown scene live, as the
  DM and other players move tokens.

### 3.9 Options

Per-campaign options are set by the DM and synced to players:

| Option | Default |
| --- | --- |
| Allow rule overrides in the creator (advanced) | off |
| Tasha's Customizing Your Origin | off |
| Tasha's optional class features | off |
| Multiclassing allowed | on |
| Feats allowed | on |
| HP on level up | average (or roll) |
| Encumbrance | off (or standard, or variant) |
| CR suggestion | off |
| Fog of war | off |
| Diagonal rule | 5-5-5 (or 5-10-5) |
| Free token movement | off |
| Monster HP | average (or roll) |
| Initiative modules | HP, conditions and death saves on; the rest off |
| Show monster health status to players | on |

Per-device options: theme (follows the system, light or dark).

## 4. Non-goals

- No accounts, no cloud backend, no always-on server.
- No offline support and no service worker. It's a web page. A web app manifest is included only
  so iPhone and iPad users can add it to the Home Screen, which protects its storage (see 6).
- No 2024 (5.5e) rules.
- No automatic line of sight or dynamic lighting. No 3D. No miniatures.
- No OCR and no parsing of whole book PDFs.
- No automatic combat resolution. Rolls are just rolls. The DM applies damage through the HP
  module, and templates show who's inside but don't apply effects.
- No voice or video, no chat beyond the roll log, no handouts or journal, no adventure runner,
  no encounter difficulty calculator. Each of these can be added later.
- One DM device per campaign. Moving it to another device goes through backup export and import.

## 5. Anti-goals

The app fails if any of these happen, even if it technically works:

- **It's slow or janky on a weak phone**, through a heavy first load or a laggy map.
- **It loses data**, through a sync overwrite or browser storage being cleared with no backup.
- **It leaks hidden DM information** to players: monster stats, hidden tokens, fogged tokens, or
  the hidden parts of items.
- **It distributes copyrighted content publicly.** The repo is public, so this would get it taken
  down.
- **It gets rules math wrong** that players trust, such as AC, slots or DCs.

## 6. Constraints

- **Hosting.** A static site on **GitHub Pages**, from the public repo `Vampiric-Goose/dnd-app`.
  GitHub's free plan only offers Pages for public repos. It is deployed by GitHub Actions on every
  push to `main` and served at `https://vampiric-goose.github.io/dnd-app/`. Pages has no SPA
  fallback, so routing uses URL hashes.
- **Legal.**
  - Only SRD 5.1 content ships in the repo or the build.
  - No hardcoded links to, or fetching from, 5etools or any other content site.
  - Test fixtures are written by us in 5etools format, not copied from books.
  - The official character sheet PDF isn't committed. Tests build a synthetic PDF with the same
    field names.
  - No WotC logos or trade dress, and no "Dungeons & Dragons" in the app's display name.
- **Performance.**
  - At most about 150 KB of gzipped JS on first load.
  - The map, PDF, P2P and import code load lazily, only when used.
  - The SRD data loads lazily and is cached in IndexedDB.
  - The map redraws only when something changes, with no constant render loop.
  - Targets: smooth with 50 tokens on a 4096 px map on a 2019-era budget Android phone and an
    older iPad, and long lists virtualized.
- **Storage.**
  - IndexedDB, with images stored as blobs keyed by content hash.
  - Call `navigator.storage.persist()`.
  - Safari can delete a site's storage after about 7 days of not visiting it. Apps added to the
    Home Screen are exempt, so on iPhone and iPad the app suggests adding it there.
  - Remind **every** user (DM and players) to back up when they have their own data and haven't
    backed up in 14 days.
  - Players' characters that are in a campaign can also be restored from the DM's copy (3.6).
- **Browsers.** The last two versions of Chrome, Edge, Firefox and Safari (iOS 16+).
- **Accessibility basics.** Labelled controls, keyboard use for the sheet and the initiative
  tracker, and readable contrast in both themes.

## 7. How: decided by the user

- A browser app in **TypeScript with Svelte 5, built with Vite**. The battle map draws on an
  HTML canvas.
- GitHub Pages hosting. Data lives on each device, and campaigns sync between devices.
- DM-hosted peer-to-peer sessions.
- The SRD built in, with 5etools import for the official books.
- PDF layouts as field maps written into the source code. Our own PDF design for export.
- Homebrewery-style markdown, as a later, non-critical stage.
- The join code is the only key: no approval step and no extra identity checks. A player ID can
  be used from several devices at once.
- Delivery in stages (section 9).

## 8. How: my calls, open to change

- PeerJS and its public signaling service, with Google's public STUN servers.
- `pdf-lib` for reading and writing PDF forms.
- Full JSON records embedded in exported markdown and PDF, for lossless round-trips.
- Inventory entries embed a copy of each item. Characters embed the content they use, and the
  creator offers only the campaign's packs.
- Book entities that overlap the SRD merge into the SRD entity. 2024 entries are dropped on
  import.
- A Home Screen manifest for iOS, and backup reminders for everyone at 14 days.
- Hidden item effects don't change the player's numbers until revealed. The DM's view shows the
  true numbers. Redacted text shows to players as a blacked-out bar.
- The visibility rules in 3.6: the health-status indicator, other characters as summaries, and
  monster packs kept from players.
- Packs are shared from the DM to players, except monsters.
- **Known leak:** the map's background image is sent whole, so a player who digs into the raw
  image data can see under the fog. Only tokens under fog are withheld. Fixing this would mean
  re-sending a new image after every reveal, which costs too much on weak devices.
- "Issue a new join code", to lock out a leaked code.
- Ties in initiative are broken by Dex, then at random.
- Prepared encounters.
- Roll visibility defaults: players public, DM private.
- Delivery split into five core stages instead of three, with markdown as a sixth.
- Repo name `dnd-app`. The display name is still to be chosen and must avoid WotC trademarks.

## 9. Delivery stages

Each stage ships to GitHub Pages and is usable on its own.

1. **Foundation, characters and items.**
   - App shell, campaigns stored locally, and storage with backup export and import.
   - The SRD pack, 5etools import for every player-facing category, and the compendium browser.
   - The character creator, level-up and play-mode sheet, and the dice roller.
   - The magic item creator, inventory and party loot (on one device for now).
   - PDF and JSON for characters and items.
2. **Monsters.**
   - The creator, the library, 5etools bestiary import with `_copy` resolution, and paste-text
     import (monsters, spells, items).
   - PDF and JSON for monsters, and the CR suggestion option.
3. **Campaign sync.**
   - Hosting, joining with player IDs, and issuing a new join code.
   - Character sync, party loot sync, pack sharing, and the shared roll log.
4. **Initiative tracker.** The core, all the modules, and prepared encounters.
5. **Battle map and live sessions.**
   - Scenes, grids, tokens, measuring, templates and fog.
   - The players' live map tab, with movement gated by turn.
6. **Markdown (later, not critical).** Homebrewery-style import and export for characters,
   monsters and items (3.5).

## 10. Left to the builder

- The internal data schema. It must be data-driven, so imported packs and the SRD go through the
  same engine. Store build choices and derive the numbers. Only overrides and play state are
  stored as values.
- How to source the SRD data in machine-readable form, for example from the 5e-bits
  `5e-database` project, after checking its license.
- The sync protocol's internals. Yjs is fine if it fits the size budget. So is a small
  hand-written field-level last-write-wins merge. Either must meet the guarantees in 3.6.
- The format of the backup file, and how exactly the JSON is embedded in a PDF.
- The visual design and layout, the PDF layout design, and the test tooling. At minimum there
  must be automated tests for:
  - the rules engine (checked against hand-verified example characters)
  - the importers
  - the sync merge
  - PDF round-trips, and markdown round-trips in stage 6
- Any other small library, within the size budget.

## 11. Inputs needed from the user

These files go in `C:\Users\bestj\dnd-app-testdata\`, outside the project, so they're never
committed. They're used only for local tests, to check the importers against real files.

**`5etools\`.** The easiest option is the whole 5etools `data` folder. Also note its version
number. If you copy only part of it, the files below are needed. The names come from recent
5etools versions.

| Stage | Files in `data\` |
| --- | --- |
| 1 | `races.json`, `backgrounds.json`, `feats.json`, `optionalfeatures.json`, `conditionsdiseases.json`, `books.json` |
| 1 | `items-base.json`, `items.json`, `magicvariants.json` |
| 1 | the `class\` folder (every `class-*.json` and `index.json`) |
| 1 | the `spells\` folder (every `spells-*.json`, `index.json` and `sources.json`), plus `generated\` if present, since some versions keep the spell-to-class lists there |
| 2 | the `bestiary\` folder (every `bestiary-*.json`, `index.json` and `legendarygroups.json`) |
| optional | the `fluff-*.json` files (lore text), `languages.json`, `skills.json`, `senses.json`, `actions.json`, `variantrules.json` |

**`pdf\`.**
- Required: a blank official 2014 fillable character sheet.
- Optional: a filled-in copy of the official sheet, a D&D Beyond PDF export, and any other sheet
  the group wants supported.

**`markdown\` (optional, for stage 6).** Homebrewery or GM Binder brews that contain monsters or
items.

**`homebrew\` (optional).** Any 5etools homebrew JSON files the group uses.
