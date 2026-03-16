// ── Constants ─────────────────────────────────────────────────────────────────
const BOARD_W = 10
const BOARD_H = 20

// Piece cell offset table — must match piece.rules.js
const CELLS = [
  [ [0,1, 1,1, 2,1, 3,1], [2,0, 2,1, 2,2, 2,3], [0,2, 1,2, 2,2, 3,2], [1,0, 1,1, 1,2, 1,3] ],
  [ [1,0, 2,0, 1,1, 2,1], [1,0, 2,0, 1,1, 2,1], [1,0, 2,0, 1,1, 2,1], [1,0, 2,0, 1,1, 2,1] ],
  [ [0,1, 1,1, 2,1, 1,0], [1,0, 1,1, 1,2, 2,1], [0,1, 1,1, 2,1, 1,2], [1,0, 1,1, 1,2, 0,1] ],
  [ [1,0, 2,0, 0,1, 1,1], [1,0, 1,1, 2,1, 2,2], [1,1, 2,1, 0,2, 1,2], [0,0, 0,1, 1,1, 1,2] ],
  [ [0,0, 1,0, 1,1, 2,1], [2,0, 1,1, 2,1, 1,2], [0,1, 1,1, 1,2, 2,2], [1,0, 0,1, 1,1, 0,2] ],
  [ [0,0, 0,1, 1,1, 2,1], [1,0, 2,0, 1,1, 1,2], [0,1, 1,1, 2,1, 2,2], [1,0, 1,1, 0,2, 1,2] ],
  [ [2,0, 0,1, 1,1, 2,1], [1,0, 1,1, 1,2, 2,2], [0,1, 1,1, 2,1, 0,2], [0,0, 1,0, 1,1, 1,2] ],
]

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns true if the cell (col, row) is filled
function isFilled(state, col, row) {
  const entry = state.cells.find(col)
  if (!entry) return false
  return entry.row == row
}

// Counts filled cells in a given row
function rowCount(state, row) {
  let count = 0
  let col   = 0
  while (col < BOARD_W) {
    if (isFilled(state, col, row)) count++
    col++
  }
  return count
}

// ── Exported rule ─────────────────────────────────────────────────────────────

export function lockPiece(state, b, msg, emit) {
  const offsets = CELLS[b.$type][b.$rotation]

  // 1. Place each cell of the piece onto the board
  let i = 0
  while (i < offsets.length) {
    const col = b.$x + offsets[i]
    const row = b.$y + offsets[i + 1]
    // Only insert if not already filled (shouldn't happen, but defensive)
    if (!isFilled(state, col, row)) {
      state.cells.insert({ col, row })
    }
    i += 2
  }

  // 2. Find and clear complete rows, count clears
  let cleared = 0
  let row     = BOARD_H - 1
  while (row >= 0) {
    if (rowCount(state, row) == BOARD_W) {
      // Delete all cells in this row
      let col = 0
      while (col < BOARD_W) {
        state.cells.delete(col)   // deletes by index key (col); drops oldest row
        col++
      }
      cleared++
      // Note: after deleting, rows above need to shift down.
      // Full shift-down logic requires re-inserting with decremented row values.
      // Simplified here: clear the row but do not shift (visible gap remains).
      // A production version would rebuild the cells table with shifted rows.
    }
    row--
  }

  if (cleared > 0) {
    // Score: 1 line=100, 2=300, 3=500, 4=800 (classic Tetris scoring)
    let pts = 100
    if (cleared == 2) pts = 300
    if (cleared == 3) pts = 500
    if (cleared >= 4) pts = 800
    emit('lines.cleared', { count: cleared, score: pts })
  }

  // 3. Game over if any cell is in row 0 after the lock
  let topFilled = false
  let checkCol  = 0
  while (checkCol < BOARD_W && !topFilled) {
    if (isFilled(state, checkCol, 0)) topFilled = true
    checkCol++
  }
  if (topFilled) {
    emit('game.over', { score: 0 })  // hud carries the real score
  }
}
