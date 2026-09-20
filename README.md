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
- 2 / 3 / 4 survivors on 7×7 / 10×10 / 12×12 boards, 8 walls each. Survivors start at the middle of the board edges, the snake in the middle.
- The snake moves one cell like a pawn, is blocked by walls, cannot build walls and never jumps. Standing next to a survivor (no wall between) it **attacks** instead: the pawn fades away and is out of the game.
- Walls may never cut the snake off from any living survivor (same "path must exist" rule as the other modes).
- **Freeze ability**: the AI snake fires it after a random 7–12 of its own turns (the counter restarts with a new random 7–12 after each use); a player-controlled snake gets it every 6 turns and presses the *Freeze* button. A random survivor is petrified for **2 of his own turns**; the snake glows laser-red until the effect ends. Using the ability ends the snake's turn.
- Snake seat: choose **AI** or **Player** on the home screen. Online, the server AI plays the snake, or the last player to join controls it.
- AI snake: every turn it re-scores all survivors (path distance, frozen/helpless prey, prey with little room to escape) and keeps the current target unless another one is clearly better. AI survivors (Play vs AI) keep away from the snake and use walls when they clearly help.
- New files: `public/shared/survival-ai.js`, `public/js/snake-art.js`, `tests/survival-mode.test.mjs`.
- Also fixed: in Center mode the board no longer flips 180° for the top/side players after their first step.


## v0.12 — Survival refinements, board sizes, vs-AI clock
- **Board sizes (all modes):** 3 players always use 10×10 and 4 players always 12×12 (Survival counts survivors only, the snake is never counted). 2 players are unchanged (9×9, Survival 7×7). On even boards the Center goal is the middle 2×2 block and the Survival snake starts on the middle cell `(mid, mid)` with `mid = floor((size-1)/2)`.
- **Petrify (Survival):** first petrified turn = the whole turn is lost; second petrified turn = no moving, but the survivor may still build a wall or press *Skip turn*. It is skipped automatically if he has no walls left. Walls per survivor stay at 8.
- **Golden snake:** every kill turns the snake golden for its next 2 turns (a new kill renews it). While golden it may move **two cells** in a turn (no wall/pawn crossing, no returning to the start cell) or still do a normal single action (move one cell, attack, freeze). Human snake: click a golden ring for the double move. The AI snake takes the double move whenever it hunts, and still eats first when it can.
- **AI survivors online:** the "AI Players" row is now available in Survival too (same limits as the other modes: 3 survivors → 1 AI, 4 survivors → 2 AI); the Snake seat is chosen separately (server AI or the last human to join).
- **Stronger AI survivor** (`public/shared/survival-ai.js`): depth-limited minimax against a worst-case snake (it knows about the golden double move and about the petrify rules), scoring distance, the area it reaches first and above all whether that area still contains a loop to run around (a lone hunter cannot catch a runner who owns a loop). It walls only when a wall clearly pays for the lost tempo and no longer shuffles between two cells.
- **Play vs AI clock:** matches against AI only now have a 58 s turn clock (an expired turn is skipped, like online). Online games with real people keep the server's 32 s.
