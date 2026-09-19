# GridGate v0.5.0
Browser wall-and-path strategy game with 2–4 players, Classic/Race/Center modes, four AI levels, light/dark themes, Cloudflare Workers + Durable Objects multiplayer, 32-second server-authoritative turns, reconnect diagnostics, and responsive SVG controls.

Run: `npm install && npm test && npm run dev`
Deploy: `npm run deploy`


## AI v0.10 improvements
- Targeted wall candidates are generated from opponents' current shortest paths.
- Walls are ranked by opponent delay versus self-damage.
- Emergency defense blocks opponents that are one or two moves from winning when possible.
- Veteran/Expert use ordered alpha-beta search with iterative deepening and a transposition table.
- Expert uses a bounded search budget to stay browser-friendly.
- Backtracking is penalized unless search finds a tactical reason for it.
- When clearly ahead, stronger AI levels conserve walls and convert the lead by racing.


## v0.11 — Survival mode (new)
A fourth mode where nobody races: a **Snake** starts in the middle of the board and hunts the survivors. The last survivor alive wins.
- 2 / 3 / 4 survivors on 7×7 / 9×9 / 11×11 boards, 8 walls each. Survivors start at the middle of the board edges.
- The snake moves one cell like a pawn, is blocked by walls, cannot build walls and never jumps. Standing next to a survivor (no wall between) it **attacks** instead: the pawn fades away and is out of the game.
- Walls may never cut the snake off from any living survivor (same "path must exist" rule as the other modes).
- **Freeze ability**: the AI snake fires it after a random 7–12 of its own turns (the counter restarts with a new random 7–12 after each use); a player-controlled snake gets it every 6 turns and presses the *Freeze* button. A random survivor is petrified for **2 of his own turns**; the snake glows laser-red until the effect ends. Using the ability ends the snake's turn.
- Snake seat: choose **AI** or **Player** on the home screen. Online, the server AI plays the snake, or the last player to join controls it.
- AI snake: every turn it re-scores all survivors (path distance, frozen/helpless prey, prey with little room to escape) and keeps the current target unless another one is clearly better. AI survivors (Play vs AI) keep away from the snake and use walls when they clearly help.
- New files: `public/shared/survival-ai.js`, `public/js/snake-art.js`, `tests/survival-mode.test.mjs`.
- Also fixed: in Center mode the board no longer flips 180° for the top/side players after their first step.
