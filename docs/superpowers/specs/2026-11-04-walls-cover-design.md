# Walls, doors and cover

**Why:** The DM wants walls drawn on a map to matter in play. Attacks and spells get the 2014 cover rules (half, three-quarters, total). Tokens can't walk through walls, and doors open and close.

## Decided with the user
- **Who draws:** the DM draws walls by hand, and they are saved with that map (scene).
- **Where cover comes from:**
  - **Geometry**, by the DMG corner rule, for full walls and closed doors.
  - **Fixed pieces:** a *low wall* gives half cover and an *arrow slit* gives three-quarters cover.
- **Creatures** between the attacker and the target give half cover automatically (PHB).
- **What walls block:** attacks, spells, spell areas and movement. Players' view of the map stays as now, with fog painted by hand. There is no automatic line of sight.
- **Doors:** the DM can open or close any door. A player can toggle a door their own token stands beside.

## Pieces
- A scene gains `walls: { id, a, b, kind, open? }[]`. The endpoints are in scene pixels. `kind` is one of `wall`, `low`, `slit` or `door`.
- Each kind behaves differently:

| Kind | Blocks movement | Blocks lines (cover geometry, areas) | Fixed cover |
|---|---|---|---|
| wall | yes | yes | — |
| door, closed | yes | yes | — |
| door, open | no | no | — |
| low wall | no | no | half |
| arrow slit | yes | no | three-quarters |

## Rules
- **Cover by geometry (DMG):**
  - From each corner of the attacker's space, draw lines to the four corners of the target's space. A creature larger than Medium uses its whole space.
  - The attacker uses the corner with the fewest blocked lines.
  - From that corner: 0 lines blocked is no cover, 1–2 is half, 3–4 is three-quarters.
  - If every line from every corner is blocked, the target has total cover.
  - Corners are inset a hair, so a wall drawn on a grid line blocks what lies behind it but not a creature standing along it.
- **Fixed cover:**
  - A low wall or arrow slit crossed by the line from the attacker's centre to the target's centre gives its cover.
  - So does another creature's space that this line passes through (half cover).
- **The result:** the highest of geometry, pieces and creatures.
  - Half cover is +2 AC and +2 on Dex saves; three-quarters is +5 and +5.
  - Total cover means the target can't be targeted directly.
- **Spell areas:**
  - A creature is caught only if the line from the area's point of origin to its centre crosses no blocking wall.
  - Its Dex save gets the cover bonus measured from that point.
- **Opportunity Attacks:** a foe across a wall (total cover) isn't asked.
- **Movement:**
  - A step from square to square that crosses a movement-blocking piece is refused. The route stops before it, and that goes for flying too.
  - This is checked where every move is written (`walkTokens`) and shown in the drag preview.

## Drawing and doors
- **The Walls tool (DM only, beside Fog):**
  - Pick a kind (Wall, Low wall, Arrow slit, Door, Erase).
  - Drag to draw one segment. The ends snap to grid corners or to an existing wall end; Alt draws freely.
  - In Erase, a tap removes a piece.
- **Toggling doors:** in the Select tool, tapping a door toggles it. A player's tap goes to the DM's device, which checks that one of their tokens stands within one square of the door.
- **What each side sees:**
  - The DM sees every piece, styled by kind.
  - Players see doors only, open or closed. They also receive the movement-blocking walls, so their drag preview stops at a wall.

## Non-goals
- Automatic vision or line of sight for players.
- Secret doors.
- Height.
- Difficult terrain from low walls.

## The builder's calls
- Exact styling, the hit tolerance for taps on pieces, and where the Walls tool's kind picker sits.
