import { getLegalPawnMoves, validateWallPlacement, reachedGoal, getSnakeAttackTargets, getSnakeDashMoves, getSnake, isSnake, isAlive, isSnakeEnraged } from '../shared/game-engine.js';
import { SNAKE_ART } from './snake-art.js';

const NS = 'http://www.w3.org/2000/svg';
const CELL = 58, GAP = 12, PAD = 10, LONG_PRESS_MS = 260, TOUCH_PREVIEW_OFFSET_PX = 44;
const HOME_ROTATION = { bottom: 0, top: 2, left: 1, right: 3 };
const FACING = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const el = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

export class BoardView {
  constructor(svg, callbacks) {
    this.svg = svg; this.callbacks = callbacks;
    this.wallOrientation = 'H'; this.wallModeEnabled = true;
    this.state = null; this.activePlayerId = null; this.viewerPlayerId = null; this.interactive = false;
    this.touchGesture = null; this.suppressClickUntil = 0;
    this.layers = null; this.pieces = null; this.pieceKey = ''; this.lastMoveNumber = null; this.lastRotation = null;
    this.snakeAngle = null; this.fxSeen = undefined; this.zapUntil = 0;
    svg.addEventListener('contextmenu', e => e.preventDefault());
    svg.addEventListener('dragstart', e => e.preventDefault());
    svg.addEventListener('selectstart', e => e.preventDefault());
    svg.addEventListener('click', e => { if (performance.now() < this.suppressClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    svg.addEventListener('pointerdown', e => this.onPointerDown(e));
    svg.addEventListener('pointermove', e => this.onPointerMove(e));
    svg.addEventListener('pointerup', e => this.onPointerUp(e));
    svg.addEventListener('pointercancel', e => this.onPointerCancel(e));
  }

  /** Forget everything animated (new game, new room): pieces are rebuilt and no old effect is replayed. */
  resetView() { this.pieces = null; this.pieceKey = ''; this.lastMoveNumber = null; this.lastRotation = null; this.snakeAngle = null; this.fxSeen = undefined; this.zapUntil = 0; if (this.layers) { this.layers.pawns.replaceChildren(); this.layers.fx.replaceChildren(); } }

  metrics() { const size = this.state?.boardSize || 9; return { size, total: PAD * 2 + CELL * size + GAP * (size - 1) }; }
  viewerPlayer() { return this.state?.players?.find(p => p.id === this.viewerPlayerId) || this.state?.players?.[0] || null; }
  activeIsSnake() { return this.state?.players?.find(p => p.id === this.activePlayerId)?.role === 'snake'; }
  activeWallBanned() { return Boolean(this.state?.players?.find(p => p.id === this.activePlayerId)?.wallBanned); }
  rotation() {
    const p = this.viewerPlayer(); if (!p || !this.state) return 0;
    if (p.goal === 'top') return 0;
    if (p.goal === 'bottom') return 2;
    if (p.goal === 'right') return 1;
    if (p.goal === 'left') return 3;
    if (p.role === 'snake') return 0;
    // Modes without an edge goal remember the side a pawn started on, so the board never flips while the pawn walks around.
    if (p.home in HOME_ROTATION) return HOME_ROTATION[p.home];
    const s = this.state.boardSize - 1;
    if (p.row === s) return 0; if (p.row === 0) return 2; if (p.col === 0) return 1; if (p.col === s) return 3;
    return 0;
  }
  logicalToViewCell(row, col) { const s = (this.state?.boardSize || 9) - 1, r = this.rotation(); if (r === 1) return { row: s - col, col: row }; if (r === 2) return { row: s - row, col: s - col }; if (r === 3) return { row: col, col: s - row }; return { row, col }; }
  viewToLogicalCell(row, col) { const s = (this.state?.boardSize || 9) - 1, r = this.rotation(); if (r === 1) return { row: col, col: s - row }; if (r === 2) return { row: s - row, col: s - col }; if (r === 3) return { row: s - col, col: row }; return { row, col }; }
  cellXY(row, col) { const v = this.logicalToViewCell(row, col); return { x: PAD + v.col * (CELL + GAP), y: PAD + v.row * (CELL + GAP) }; }
  cellCenter(row, col) { const { x, y } = this.cellXY(row, col); return { x: x + CELL / 2, y: y + CELL / 2 }; }
  rawCellXY(row, col) { return { x: PAD + col * (CELL + GAP), y: PAD + row * (CELL + GAP) }; }
  rawWallRect(w) { const b = this.rawCellXY(w.row, w.col); return w.orientation === 'H' ? { x: b.x, y: b.y + CELL, width: CELL * 2 + GAP, height: GAP } : { x: b.x + CELL, y: b.y, width: GAP, height: CELL * 2 + GAP }; }
  transformRect(rect) {
    const { total } = this.metrics(), r = this.rotation(); if (r === 0) return rect;
    if (r === 1) return { x: total - (rect.y + rect.height), y: rect.x, width: rect.height, height: rect.width };
    if (r === 2) return { x: total - (rect.x + rect.width), y: total - (rect.y + rect.height), width: rect.width, height: rect.height };
    return { x: rect.y, y: total - (rect.x + rect.width), width: rect.height, height: rect.width };
  }
  wallRect(w) { return this.transformRect(this.rawWallRect(w)); }
  visualOrientationOf(w) { const r = this.rotation(); return r % 2 === 0 ? w.orientation : (w.orientation === 'H' ? 'V' : 'H'); }
  setWallOrientation(v) { if (!['H', 'V', null].includes(v)) return; if (v === null) this.wallModeEnabled = false; else { this.wallOrientation = v; this.wallModeEnabled = true; } if (this.state) this.render(this.state, this.activePlayerId, this.interactive, this.viewerPlayerId); }
  getWallMode() { return this.wallModeEnabled ? this.wallOrientation : null; }

  // ------------------------------------------------------------------------------------------
  // Layers: the static board is rebuilt on every render, the pieces live in a persistent layer so
  // CSS transitions (sliding, petrifying, fading) run on the very same DOM nodes.
  // ------------------------------------------------------------------------------------------
  ensureLayers() {
    if (this.layers) return;
    const defs = el('defs');
    const stone = el('radialGradient', { id: 'stoneGrad', cx: '38%', cy: '32%', r: '78%' });
    stone.append(el('stop', { offset: '0%', 'stop-color': '#dfe3e8' }), el('stop', { offset: '100%', 'stop-color': '#79818a' }));
    defs.append(stone);
    this.layers = { defs, board: el('g', { class: 'layer-board' }), links: el('g', { class: 'layer-links' }), pawns: el('g', { class: 'layer-pawns' }), overlay: el('g', { class: 'layer-overlay' }), fx: el('g', { class: 'layer-fx' }) };
    this.svg.replaceChildren(defs, this.layers.board, this.layers.links, this.layers.pawns, this.layers.overlay, this.layers.fx);
  }

  render(state, activePlayerId, interactive, viewerPlayerId = activePlayerId) {
    this.ensureLayers();
    this.state = state; this.activePlayerId = activePlayerId; this.viewerPlayerId = viewerPlayerId || activePlayerId; this.interactive = interactive;
    this.cancelTouchGesture();
    const { size, total } = this.metrics();
    this.svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    const board = this.layers.board; board.replaceChildren();
    board.append(el('rect', { x: 0, y: 0, width: total, height: total, rx: 18, class: 'board-bg' }));
    const legal = interactive && activePlayerId ? getLegalPawnMoves(state, activePlayerId) : [], set = new Set(legal.map(m => `${m.row},${m.col}`));
    // An enraged snake controlled by a person may also move two cells: those cells get a glowing ring.
    const dashes = interactive && activePlayerId && this.activeIsSnake() ? getSnakeDashMoves(state) : [], dashSet = new Set(dashes.map(m => `${m.row},${m.col}`));
    const goalPlayer = state.players[state.turn] || state.players.find(p => p.id === activePlayerId) || state.players[0];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const { x, y } = this.cellXY(r, c);
      const isActiveGoal = goalPlayer ? reachedGoal(state, goalPlayer, r, c) : false;
      const goalClass = isActiveGoal ? `goal-cell goal-${goalPlayer.id.toLowerCase()}` : '';
      const sq = el('rect', { x, y, width: CELL, height: CELL, rx: 8, class: `board-cell ${goalClass}`.trim() });
      sq.addEventListener('click', () => { if (!interactive) return; if (set.has(`${r},${c}`)) this.callbacks.onMove?.(r, c); else if (dashSet.has(`${r},${c}`)) this.callbacks.onDash?.(r, c); });
      board.append(sq);
      if (set.has(`${r},${c}`)) { const m = el('circle', { cx: x + CELL / 2, cy: y + CELL / 2, r: 8, class: 'legal-move' }); m.addEventListener('click', () => this.callbacks.onMove?.(r, c)); board.append(m); }
      else if (dashSet.has(`${r},${c}`)) { const m = el('circle', { cx: x + CELL / 2, cy: y + CELL / 2, r: 12, class: 'dash-move' }); m.addEventListener('click', () => this.callbacks.onDash?.(r, c)); board.append(m); }
    }
    for (const w of state.walls) board.append(el('rect', { ...this.wallRect(w), rx: 5, class: `placed-wall owner-${(w.owner || 'P1').toLowerCase()}` }));
    if (interactive && activePlayerId && this.wallModeEnabled && !this.activeIsSnake() && !this.activeWallBanned()) this.renderDesktopWallTargets(state, activePlayerId);
    this.syncPieces(state);
    this.renderLinksAndTargets(state);
    this.observeEvent(state);
  }

  // ------------------------------------------------------------------------------------------
  // Pieces
  // ------------------------------------------------------------------------------------------
  createPiece(p) {
    const root = el('g', { class: `piece piece-${p.id.toLowerCase()}`, 'data-player': p.id });
    const body = el('g', { class: 'piece-body' });
    root.append(body);
    if (isSnake(p)) {
      const aura = el('circle', { r: 32, class: 'sn-aura' });
      const disc = el('circle', { r: 26.5, class: 'sn-base' });
      const turn = el('g', { class: 'sn-turn' }), lunge = el('g', { class: 'sn-lunge' }), wiggle = el('g', { class: 'sn-wiggle' });
      wiggle.innerHTML = SNAKE_ART;
      lunge.append(wiggle); turn.append(lunge);
      body.append(aura, disc, turn);
      return { root, body, turn, lunge };
    }
    const cracks = el('path', { class: 'stone-cracks', d: 'M-5,-17 L-2,-8 L-9,-2 M5,-17 L3,-8 L10,-3 L6,6 M-2,17 L0,8 L-10,6', fill: 'none' });
    const count = el('text', { class: 'freeze-count', 'text-anchor': 'middle', y: 6 });
    body.append(
      el('circle', { cx: 0, cy: 3, r: 19, class: 'pawn-shadow' }),
      el('circle', { cx: 0, cy: 0, r: 19, class: `pawn ${p.id.toLowerCase()}` }),
      el('circle', { cx: 0, cy: 0, r: 19, class: 'stone-fill', fill: 'url(#stoneGrad)' }),
      cracks, count,
    );
    return { root, body, count };
  }

  syncPieces(state) {
    const key = `${state.boardSize}|${state.players.map(p => p.id).join(',')}`;
    const restarted = this.lastMoveNumber !== null && state.moveNumber < this.lastMoveNumber;
    const reset = !this.pieces || key !== this.pieceKey || restarted;
    if (reset) {
      this.layers.pawns.replaceChildren(); this.layers.fx.replaceChildren();
      this.pieces = new Map(); this.pieceKey = key; this.snakeAngle = null;
      if (restarted) this.fxSeen = state.lastEvent ? state.lastEvent.n : -1;
    }
    const rotation = this.rotation();
    const instant = reset || this.lastRotation !== rotation;
    if (instant) this.layers.pawns.classList.add('instant');
    const anyFrozen = state.players.some(q => !isSnake(q) && isAlive(q) && q.frozen > 0);
    for (const p of state.players) {
      let rec = this.pieces.get(p.id);
      if (!rec) { rec = this.createPiece(p); this.pieces.set(p.id, rec); this.layers.pawns.append(rec.root); }
      const c = this.cellCenter(p.row, p.col);
      rec.root.style.transform = `translate(${c.x}px, ${c.y}px)`;
      rec.root.classList.toggle('dead', !isAlive(p));
      rec.root.classList.toggle('frozen', p.frozen > 0);
      if (isSnake(p)) {
        rec.root.classList.toggle('charged', anyFrozen);
        rec.root.classList.toggle('enraged', isSnakeEnraged(state));
        const target = this.snakeAngleFor(p);
        if (this.snakeAngle === null) this.snakeAngle = target;
        else this.snakeAngle += ((target - this.snakeAngle + 540) % 360) - 180;
        rec.turn.style.transform = `rotate(${this.snakeAngle}deg)`;
      } else {
        rec.count.textContent = p.frozen > 0 ? String(p.frozen) : '';
      }
    }
    if (instant) { void this.layers.pawns.getBoundingClientRect(); this.layers.pawns.classList.remove('instant'); }
    this.lastRotation = rotation; this.lastMoveNumber = state.moveNumber;
  }

  snakeAngleFor(p) {
    const [dr, dc] = FACING[p.facing] || FACING.right;
    const a = this.logicalToViewCell(p.row, p.col), b = this.logicalToViewCell(p.row + dr, p.col + dc);
    return Math.atan2(b.row - a.row, b.col - a.col) * 180 / Math.PI;
  }

  renderLinksAndTargets(state) {
    const { links, overlay } = this.layers;
    links.replaceChildren(); overlay.replaceChildren();
    const snake = getSnake(state);
    if (!snake) return;
    const from = this.cellCenter(snake.row, snake.col);
    const fresh = performance.now() < this.zapUntil;
    // Laser beam from the snake to every survivor that is still petrified.
    for (const p of state.players) {
      if (isSnake(p) || !isAlive(p) || !(p.frozen > 0)) continue;
      const to = this.cellCenter(p.row, p.col);
      links.append(
        el('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: `laser-link laser-glow${fresh ? ' zap' : ''}` }),
        el('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: `laser-link laser-core${fresh ? ' zap' : ''}` }),
      );
    }
    // Clickable red targets for a human-controlled snake.
    if (this.interactive && this.activeIsSnake()) {
      for (const id of getSnakeAttackTargets(state)) {
        const p = state.players.find(q => q.id === id); const c = this.cellCenter(p.row, p.col);
        const g = el('g', { class: 'attack-target' });
        g.append(el('circle', { cx: c.x, cy: c.y, r: 27, class: 'attack-ring' }), el('path', { d: `M${c.x - 9},${c.y} H${c.x + 9} M${c.x},${c.y - 9} V${c.y + 9}`, class: 'attack-cross' }));
        g.addEventListener('click', () => this.callbacks.onAttack?.(id));
        overlay.append(g);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // One-off effects (lunge, burst, laser flash). Detected by comparing the event counter so a
  // reconnecting client does not replay old events.
  // ------------------------------------------------------------------------------------------
  observeEvent(state) {
    const ev = state.lastEvent || null;
    if (this.fxSeen === undefined) { this.fxSeen = ev ? ev.n : -1; return; }
    if (!ev || ev.n <= this.fxSeen) return;
    this.fxSeen = ev.n;
    this.playEventFx(state, ev);
  }

  animate(node, frames, options) {
    if (node && typeof node.animate === 'function') { try { return node.animate(frames, options); } catch { /* ignore */ } }
    return null;
  }

  burst(row, col, kind) {
    const c = this.cellCenter(row, col);
    const ring = el('circle', { cx: c.x, cy: c.y, r: 20, class: `fx-burst fx-${kind}` });
    ring.style.transformBox = 'fill-box'; ring.style.transformOrigin = 'center';
    this.layers.fx.append(ring);
    const anim = this.animate(ring, [{ opacity: 0.95, transform: 'scale(0.55)' }, { opacity: 0, transform: 'scale(2.3)' }], { duration: 700, easing: 'ease-out' });
    if (anim) anim.onfinish = () => ring.remove(); else setTimeout(() => ring.remove(), 700);
  }

  playEventFx(state, ev) {
    const snake = getSnake(state), rec = snake ? this.pieces?.get(snake.id) : null;
    const victim = state.players.find(p => p.id === ev.target);
    if (!victim) return;
    if (ev.type === 'kill') {
      if (snake && rec) {
        const a = this.cellXY(snake.row, snake.col), b = this.cellXY(victim.row, victim.col);
        const dx = (b.x - a.x) * 0.62, dy = (b.y - a.y) * 0.62;
        this.animate(rec.lunge, [{ transform: 'translate(0px, 0px)' }, { transform: `translate(${dx}px, ${dy}px)`, offset: 0.38 }, { transform: 'translate(0px, 0px)' }], { duration: 460, easing: 'ease-out' });
      }
      this.burst(victim.row, victim.col, 'kill');
    } else if (ev.type === 'freeze') {
      this.zapUntil = performance.now() + 1000;
      if (rec) { rec.root.classList.add('zapping'); setTimeout(() => rec.root.classList.remove('zapping'), 1200); }
      this.burst(victim.row, victim.col, 'freeze');
      if (snake) this.burst(snake.row, snake.col, 'freeze');
    }
  }

  // ------------------------------------------------------------------------------------------
  // Wall placement (unchanged behaviour)
  // ------------------------------------------------------------------------------------------
  renderDesktopWallTargets(state, pid) {
    const slots = state.boardSize - 1, owner = `preview-${pid.toLowerCase()}`;
    for (let r = 0; r < slots; r++) for (let c = 0; c < slots; c++) for (const orientation of ['H', 'V']) {
      const w = { row: r, col: c, orientation }; if (this.visualOrientationOf(w) !== this.wallOrientation) continue;
      const valid = validateWallPlacement(state, w), t = el('rect', { ...this.wallRect(w), rx: 5, class: `wall-target ${owner} ${valid.ok ? 'wall-valid' : 'wall-invalid'}` });
      t.addEventListener('click', () => { if (valid.ok) this.callbacks.onWall?.(w); });
      this.layers.board.append(t);
    }
  }
  eventToSvgPoint(e, applyTouchOffset = false) {
    const rect = this.svg.getBoundingClientRect(), { total } = this.metrics(); if (!rect.width || !rect.height) return null;
    const x = (e.clientX - rect.left) * total / rect.width; let y = (e.clientY - rect.top) * total / rect.height;
    if (applyTouchOffset) y -= TOUCH_PREVIEW_OFFSET_PX * total / rect.height;
    return { x, y, inside: x >= 0 && x <= total && y >= 0 && y <= total };
  }
  nearestWallAt(pt) {
    if (!pt?.inside) return null; const slots = this.state.boardSize - 1; let best = null, d = Infinity;
    for (let r = 0; r < slots; r++) for (let c = 0; c < slots; c++) for (const orientation of ['H', 'V']) {
      const w = { row: r, col: c, orientation }; if (this.visualOrientationOf(w) !== this.wallOrientation) continue;
      const q = this.wallRect(w), cx = q.x + q.width / 2, cy = q.y + q.height / 2, dd = (pt.x - cx) ** 2 + (pt.y - cy) ** 2; if (dd < d) { d = dd; best = w; }
    }
    return best;
  }
  removeTouchPreview() { this.svg.querySelector('.touch-wall-preview')?.remove(); }
  updateTouchPreview(e) {
    const g = this.touchGesture; if (!g?.active) return;
    const pt = this.eventToSvgPoint(e, true); g.inside = !!pt?.inside; g.wall = this.nearestWallAt(pt);
    this.removeTouchPreview(); if (!g.wall) return;
    const v = validateWallPlacement(this.state, g.wall); g.valid = v.ok;
    this.svg.append(el('rect', { ...this.wallRect(g.wall), rx: 5, class: `wall-target touch-wall-preview preview-${this.activePlayerId.toLowerCase()} ${v.ok ? 'wall-valid' : 'wall-invalid'}` }));
  }
  onPointerDown(e) {
    if (e.pointerType === 'mouse' || !this.interactive || !this.activePlayerId || !this.wallModeEnabled || this.activeIsSnake() || this.activeWallBanned()) return;
    this.cancelTouchGesture();
    const g = { pointerId: e.pointerId, active: false, wall: null, valid: false, inside: false, timer: null, lastEvent: e };
    this.touchGesture = g;
    g.timer = setTimeout(() => { if (this.touchGesture !== g) return; g.active = true; this.suppressClickUntil = performance.now() + 700; try { this.svg.setPointerCapture(e.pointerId); } catch { /* ignore */ } this.updateTouchPreview(g.lastEvent); }, LONG_PRESS_MS);
  }
  onPointerMove(e) { const g = this.touchGesture; if (!g || g.pointerId !== e.pointerId) return; g.lastEvent = e; if (!g.active) return; e.preventDefault(); this.updateTouchPreview(e); }
  onPointerUp(e) {
    const g = this.touchGesture; if (!g || g.pointerId !== e.pointerId) return; clearTimeout(g.timer);
    if (g.active) {
      e.preventDefault(); this.updateTouchPreview(e);
      const w = g.wall, place = g.inside && g.valid && w;
      this.suppressClickUntil = performance.now() + 700; this.removeTouchPreview(); this.touchGesture = null;
      try { this.svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (place) this.callbacks.onWall?.(w);
    } else this.touchGesture = null;
  }
  onPointerCancel(e) { if (this.touchGesture?.pointerId === e.pointerId) this.cancelTouchGesture(); }
  cancelTouchGesture() { if (this.touchGesture?.timer) clearTimeout(this.touchGesture.timer); this.touchGesture = null; this.removeTouchPreview(); }
}
