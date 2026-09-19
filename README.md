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
