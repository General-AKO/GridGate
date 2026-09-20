// Illustrations for the mode-selection screen (one wide 640x280 picture per mode) and their captions.
// The pictures are generated as SVG strings from a few helpers so they stay crisp at any size and share the
// board / pawn / wall look of the real game. `modeArt()` needs a unique `uid` per inserted copy because
// gradients are referenced by id (two copies with the same ids would break when one of them is hidden).
import { SNAKE_ART } from './snake-art.js';

export const MODE_ORDER = ['classic', 'race', 'center', 'survival'];

export const MODE_INFO = {
  classic: { title: 'Classic', tagline: 'Cross the board to the opposite side', short: 'Opposite side' },
  race: { title: 'Race', tagline: 'Same start line — first one to the finish wins', short: 'Same row → finish' },
  center: { title: 'Center', tagline: 'Everyone rushes for the middle square', short: 'Reach the middle' },
  survival: { title: 'Survival', tagline: 'Outlive the snake — the last survivor wins', short: 'Escape the snake' },
};

const W = 640, H = 280, CELL = 48, GAP = 8, STEP = CELL + GAP, COLS = 11, ROWS = 5, X0 = 12, Y0 = 4;
const px = (c) => X0 + CELL / 2 + c * STEP;
const py = (r) => Y0 + CELL / 2 + r * STEP;
const n1 = (n) => Math.round(n * 10) / 10;

const COLORS = { blue: '#4d8dff', red: '#ff6b6b', green: '#4fcf8d', orange: '#ffa24d' };
const DEEP = { blue: '#2c62d6', red: '#cf3f3f', green: '#2a9f66', orange: '#d9761f' };

function boardLayer(pal) {
  let out = `<rect width="${W}" height="${H}" fill="${pal.bg}"/>`;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    out += `<rect x="${X0 + c * STEP}" y="${Y0 + r * STEP}" width="${CELL}" height="${CELL}" rx="9" fill="${pal.cell}"/>`;
  }
  return out;
}

function tintRow(r, color) {
  let out = '';
  for (let c = 0; c < COLS; c++) out += `<rect x="${X0 + c * STEP}" y="${Y0 + r * STEP}" width="${CELL}" height="${CELL}" rx="9" fill="${color}"/>`;
  return out;
}

/** A wall: 'H' lies between row r and r+1 covering columns c and c+1, 'V' between column c and c+1 covering rows r and r+1. */
function wall(kind, r, c, color) {
  const x = kind === 'H' ? X0 + c * STEP : X0 + c * STEP + CELL - 1;
  const y = kind === 'H' ? Y0 + r * STEP + CELL - 1 : Y0 + r * STEP;
  const w = kind === 'H' ? 2 * CELL + GAP : GAP + 2;
  const h = kind === 'H' ? GAP + 2 : 2 * CELL + GAP;
  return `<rect x="${x}" y="${y + 2}" width="${w}" height="${h}" rx="5" fill="rgba(0,0,0,.28)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width="1.2"/>`;
}

function pawn(x, y, color, { ghost = false, stone = false, uid = 'u', scale = 1 } = {}) {
  const g = `translate(${n1(x)} ${n1(y)}) scale(${scale})`;
  if (ghost) {
    return `<g transform="${g}" opacity=".5"><circle r="19" fill="${color}" fill-opacity=".28" stroke="#fff" stroke-width="2.4" stroke-dasharray="4 5"/><path d="M-7,-7 L7,7 M7,-7 L-7,7" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>`;
  }
  if (stone) {
    return `<g transform="${g}"><ellipse cy="20" rx="15" ry="5" fill="rgba(0,0,0,.35)"/><circle r="19" fill="${color}" stroke="#d5d9de" stroke-width="3"/><circle r="19" fill="url(#${uid}-stone)" opacity=".86"/>`
      + `<path d="M-5,-17 L-2,-8 L-9,-2 M5,-17 L3,-8 L10,-3 L6,6 M-2,17 L0,8 L-10,6" fill="none" stroke="rgba(38,42,50,.75)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<text y="6" text-anchor="middle" font-size="16" font-weight="900" fill="#1f252c" stroke="rgba(255,255,255,.6)" stroke-width="2.4" paint-order="stroke">2</text></g>`;
  }
  return `<g transform="${g}"><ellipse cy="20" rx="15" ry="5" fill="rgba(0,0,0,.3)"/><circle r="19" fill="${color}" stroke="#fff" stroke-width="3"/><ellipse cx="-6" cy="-8" rx="8" ry="4.5" fill="rgba(255,255,255,.38)" transform="rotate(-28)"/></g>`;
}

/** Dotted route with an arrow head; points are [row, col] cell coordinates. */
function route(points, color, width = 4.4) {
  const pts = points.map(([r, c]) => [px(c), py(r)]);
  const [ax, ay] = pts[pts.length - 2], [bx, by] = pts[pts.length - 1];
  const a = Math.atan2(by - ay, bx - ax), s = 11;
  const tip = [bx + Math.cos(a) * 3, by + Math.sin(a) * 3];
  const p1 = [tip[0] - Math.cos(a - 0.5) * s * 1.5, tip[1] - Math.sin(a - 0.5) * s * 1.5];
  const p2 = [tip[0] - Math.cos(a + 0.5) * s * 1.5, tip[1] - Math.sin(a + 0.5) * s * 1.5];
  return `<polyline points="${pts.map((p) => p.map(n1).join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0.1 10.5"/>`
    + `<path d="M${n1(tip[0])},${n1(tip[1])} L${n1(p1[0])},${n1(p1[1])} L${n1(p2[0])},${n1(p2[1])} Z" fill="${color}"/>`;
}

const WOOD = { bg: '#c39a5b', cell: '#f0dcae' };
const NIGHT = { bg: '#0b111b', cell: '#1a2536' };

function vignette(uid, strength = 0.22) {
  return `<defs><linearGradient id="${uid}-vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${strength}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#${uid}-vg)"/>`;
}

const SCENES = {
  // Two pawns, opposite goal rows, walls that force detours.
  classic: (uid) => boardLayer(WOOD) + tintRow(0, 'rgba(77,141,255,.42)') + tintRow(4, 'rgba(255,107,107,.42)')
    + wall('H', 2, 2, DEEP.red) + wall('H', 1, 7, DEEP.blue) + wall('V', 2, 4, DEEP.red)
    + route([[4, 3], [3, 3], [3, 4], [1, 4], [0, 4]], DEEP.blue)
    + route([[0, 7], [1, 7], [1, 6], [4, 6]], DEEP.red)
    + pawn(px(3), py(4), COLORS.blue) + pawn(px(7), py(0), COLORS.red) + vignette(uid),

  // Four pawns on the same start row, a checkered finish line on the far side.
  race: (uid) => {
    let checks = '';
    for (let i = 0; i < 23; i++) for (let j = 0; j < 2; j++) checks += `<rect x="${i * 28}" y="${j * 28}" width="28" height="28" fill="${(i + j) % 2 ? '#1c1c1c' : '#f6f6f6'}"/>`;
    const lanes = [[2, 'blue'], [4, 'red'], [6, 'green'], [8, 'orange']];
    return boardLayer(WOOD) + checks + `<rect y="54" width="${W}" height="4" fill="#f5b301"/>`
      + lanes.map(([c, k]) => route([[3, c], [1, c]], DEEP[k])).join('')
      + wall('H', 2, 4, '#8b5d2b') + wall('V', 2, 8, '#8b5d2b')
      + lanes.map(([c, k]) => pawn(px(c), py(4), COLORS[k])).join('') + vignette(uid);
  },

  // Everybody converges on the glowing middle square.
  center: (uid) => boardLayer(WOOD)
    + `<defs><radialGradient id="${uid}-glow"><stop offset="0" stop-color="#ffd54a" stop-opacity=".95"/><stop offset=".55" stop-color="#ffb300" stop-opacity=".38"/><stop offset="1" stop-color="#ffb300" stop-opacity="0"/></radialGradient></defs>`
    + `<circle cx="${px(5)}" cy="${py(2)}" r="88" fill="url(#${uid}-glow)"/>`
    + `<rect x="${X0 + 5 * STEP}" y="${Y0 + 2 * STEP}" width="${CELL}" height="${CELL}" rx="9" fill="#ffe08a"/>`
    + [38, 26, 14].map((r, i) => `<circle cx="${px(5)}" cy="${py(2)}" r="${r}" fill="none" stroke="${i % 2 ? '#e8a100' : '#ffb300'}" stroke-width="3" opacity="${0.95 - i * 0.12}"/>`).join('')
    + `<circle cx="${px(5)}" cy="${py(2)}" r="6.5" fill="#d98e00"/>`
    + wall('H', 0, 2, DEEP.green) + wall('V', 3, 7, DEEP.orange)
    + route([[0, 5], [1, 5]], DEEP.red) + route([[4, 5], [3, 5]], DEEP.blue) + route([[2, 1], [2, 3]], DEEP.green) + route([[2, 9], [2, 7]], DEEP.orange)
    + pawn(px(5), py(0), COLORS.red) + pawn(px(5), py(4), COLORS.blue) + pawn(px(1), py(2), COLORS.green) + pawn(px(9), py(2), COLORS.orange) + vignette(uid, 0.18),

  // The snake in the middle, a petrified survivor in its laser, a fallen pawn and two runners.
  survival: (uid) => {
    const sx = px(5), sy = py(2), vx = px(2), vy = py(2);
    return boardLayer(NIGHT)
      + `<defs><radialGradient id="${uid}-stone" cx=".38" cy=".32" r=".78"><stop offset="0" stop-color="#dfe3e8"/><stop offset="1" stop-color="#79818a"/></radialGradient>`
      + `<radialGradient id="${uid}-aura"><stop offset="0" stop-color="#ff3b4e" stop-opacity=".55"/><stop offset="1" stop-color="#ff3b4e" stop-opacity="0"/></radialGradient></defs>`
      + `<circle cx="${sx}" cy="${sy}" r="96" fill="url(#${uid}-aura)"/>`
      + wall('H', 1, 8, '#7d3a3a') + wall('V', 3, 3, '#7d3a3a')
      + `<line x1="${sx}" y1="${sy}" x2="${vx}" y2="${vy}" stroke="rgba(255,59,78,.4)" stroke-width="11" stroke-linecap="round"/><line x1="${sx}" y1="${sy}" x2="${vx}" y2="${vy}" stroke="#ff7480" stroke-width="3" stroke-linecap="round" stroke-dasharray="8 7"/>`
      + route([[3, 8], [3, 10]], '#4d8dff') + route([[0, 8], [0, 10]], '#ffa24d')
      + pawn(px(8), py(3), COLORS.blue) + pawn(px(8), py(0), COLORS.orange)
      + pawn(px(9), py(4), COLORS.green, { ghost: true })
      + pawn(vx, vy, COLORS.red, { stone: true, uid })
      + `<g class="piece-s charged" transform="translate(${sx} ${sy}) scale(1.7)"><circle class="sn-aura" r="32"/><circle class="sn-base" r="26.5"/><g class="sn-turn" style="transform:rotate(180deg)"><g class="sn-wiggle">${SNAKE_ART}</g></g></g>`
      + vignette(uid, 0.3);
  },
};

/** Returns the full `<svg>` markup of a mode picture. `uid` must be unique per inserted copy. */
export function modeArt(mode, uid = 'art') {
  const scene = SCENES[mode] || SCENES.classic;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${(MODE_INFO[mode] || MODE_INFO.classic).title} mode">${scene(uid)}</svg>`;
}
