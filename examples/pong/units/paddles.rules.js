const SPEED  = 4    // pixels per tick
const Y_MIN  = 20   // paddle half-height from top wall
const Y_MAX  = 220  // paddle half-height from bottom wall

export function movePaddle(state, b, msg, emit) {
  // Initialise the row on first input from this player
  let p = state.players.find(b.$player)
  if (!p) {
    state.players.insert({ player: b.$player, y: 120 })
    p = state.players.find(b.$player)
  }

  if (b.$direction == 'up') {
    p.y = Math.max(Y_MIN, p.y - SPEED)
  }
  if (b.$direction == 'down') {
    p.y = Math.min(Y_MAX, p.y + SPEED)
  }
}

export function broadcastPositions(state, b, msg, emit) {
  // Emit a paddles.moved for every player so the ball unit can cache positions.
  // Uses a C-style index loop because the allowed subset does not include forEach.
  const rows = state.players.all()
  for (let i = 0; i < rows.length; i++) {
    emit('paddles.moved', { player: rows[i].player, y: rows[i].y })
  }
}
