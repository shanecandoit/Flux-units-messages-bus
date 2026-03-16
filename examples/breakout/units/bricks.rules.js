const COLS        = 8
const ROWS        = 5
const POINTS_BASE = 50   // row 0 earns most points
const POINTS_STEP = 10   // each lower row earns 10 fewer

export function destroyBrick(state, b, msg, emit) {
  const key = b.$row * COLS + b.$col
  const brick = state.alive.find(key)
  if (!brick) return   // already destroyed — ignore

  state.alive.delete(key)

  const points = POINTS_BASE - b.$row * POINTS_STEP
  emit('brick.destroyed', { col: b.$col, row: b.$row, points })

  // If no bricks remain the level is cleared
  if (state.alive.count() == 0) {
    emit('level.cleared', { score: 0 })   // hud carries the actual total score
  }
}

// Helper called once (e.g. from a scenario setup step) to populate the full grid.
// Exposed as an exported function so it can be referenced in a rule.
export function fillGrid(state, b, msg, emit) {
  state.alive.clear()
  let row = 0
  while (row < ROWS) {
    let col = 0
    while (col < COLS) {
      state.alive.insert({ key: row * COLS + col, col, row })
      col++
    }
    row++
  }
}
