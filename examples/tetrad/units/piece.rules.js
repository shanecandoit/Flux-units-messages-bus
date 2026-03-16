// ── Board constants ───────────────────────────────────────────────────────────
const BOARD_W = 10
const BOARD_H = 20

// ── Piece cell offsets ────────────────────────────────────────────────────────
// CELLS[type][rotation] = array of [dcol, drow] offsets from origin.
// Types: 0=I  1=O  2=T  3=S  4=Z  5=J  6=L
// Rotations 0–3 (CW).  Encoded as flat arrays [dc0,dr0, dc1,dr1, dc2,dr2, dc3,dr3].

const CELLS = [
  // I — 4 rotations
  [ [0,1, 1,1, 2,1, 3,1],   // 0: horizontal
    [2,0, 2,1, 2,2, 2,3],   // 1: vertical
    [0,2, 1,2, 2,2, 3,2],   // 2: horizontal (alt row)
    [1,0, 1,1, 1,2, 1,3] ], // 3: vertical (alt col)

  // O — same in all rotations
  [ [1,0, 2,0, 1,1, 2,1],
    [1,0, 2,0, 1,1, 2,1],
    [1,0, 2,0, 1,1, 2,1],
    [1,0, 2,0, 1,1, 2,1] ],

  // T
  [ [0,1, 1,1, 2,1, 1,0],   // 0: T up
    [1,0, 1,1, 1,2, 2,1],   // 1: T right
    [0,1, 1,1, 2,1, 1,2],   // 2: T down
    [1,0, 1,1, 1,2, 0,1] ], // 3: T left

  // S
  [ [1,0, 2,0, 0,1, 1,1],
    [1,0, 1,1, 2,1, 2,2],
    [1,1, 2,1, 0,2, 1,2],
    [0,0, 0,1, 1,1, 1,2] ],

  // Z
  [ [0,0, 1,0, 1,1, 2,1],
    [2,0, 1,1, 2,1, 1,2],
    [0,1, 1,1, 1,2, 2,2],
    [1,0, 0,1, 1,1, 0,2] ],

  // J
  [ [0,0, 0,1, 1,1, 2,1],
    [1,0, 2,0, 1,1, 1,2],
    [0,1, 1,1, 2,1, 2,2],
    [1,0, 1,1, 0,2, 1,2] ],

  // L
  [ [2,0, 0,1, 1,1, 2,1],
    [1,0, 1,1, 1,2, 2,2],
    [0,1, 1,1, 2,1, 0,2],
    [0,0, 1,0, 1,1, 1,2] ],
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCells(type, rotation) {
  return CELLS[type][rotation]
}

// Returns true if the piece at (type, rotation, ox, oy) has no collision
// with the left/right/bottom walls or any cell in board_shadow.
function canPlace(state, type, rotation, ox, oy) {
  const offsets = getCells(type, rotation)
  let i = 0
  while (i < offsets.length) {
    const dc = offsets[i]
    const dr = offsets[i + 1]
    const c  = ox + dc
    const r  = oy + dr
    if (c < 0 || c >= BOARD_W) return false
    if (r >= BOARD_H) return false
    // Check board shadow — indexed by col, find first row match
    const shadow = state.board_shadow.find(c)
    if (shadow && shadow.row == r) return false
    i += 2
  }
  return true
}

// ── Exported rule functions ───────────────────────────────────────────────────

export function applyGravity(state, b, msg, emit) {
  const p = state.active.get()
  if (canPlace(state, p.type, p.rotation, p.x, p.y + 1)) {
    p.y += 1
  } else {
    // Cannot move down — lock the piece
    emit('piece.locked', { type: p.type, rotation: p.rotation, x: p.x, y: p.y })
  }
}

export function shiftPiece(state, b, msg, emit) {
  const p = state.active.get()
  if (b.$direction == 'left'  && canPlace(state, p.type, p.rotation, p.x - 1, p.y)) p.x -= 1
  if (b.$direction == 'right' && canPlace(state, p.type, p.rotation, p.x + 1, p.y)) p.x += 1
  if (b.$direction == 'down'  && canPlace(state, p.type, p.rotation, p.x,     p.y + 1)) p.y += 1
}

export function rotatePiece(state, b, msg, emit) {
  const p      = state.active.get()
  const nRot   = b.$direction == 'cw'
    ? (p.rotation + 1) % 4
    : (p.rotation + 3) % 4
  if (canPlace(state, p.type, nRot, p.x, p.y)) p.rotation = nRot
}

export function hardDrop(state, b, msg, emit) {
  const p = state.active.get()
  while (canPlace(state, p.type, p.rotation, p.x, p.y + 1)) {
    p.y += 1
  }
  emit('piece.locked', { type: p.type, rotation: p.rotation, x: p.x, y: p.y })
}

export function spawnPiece(state, b, msg, emit) {
  const p      = state.active.get()
  p.type       = b.$type
  p.rotation   = b.$rotation
  p.x          = b.$x
  p.y          = b.$y
}
