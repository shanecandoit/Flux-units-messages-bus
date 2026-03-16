const PIECE_TYPES = 7
const SPAWN_X     = 3   // column to spawn at (left-centre of 10-wide board)
const SPAWN_Y     = 0   // row to spawn at (top of board)

export function spawnNext(state, b, msg, emit) {
  const bag = state.next.get()

  // Emit the spawn event for the piece that was queued
  emit('piece.spawned', {
    type:     bag.type,
    rotation: 0,
    x:        SPAWN_X,
    y:        SPAWN_Y,
  })

  // Advance to the next type in the cycle (deterministic — no randomness)
  bag.counter += 1
  bag.type     = bag.counter % PIECE_TYPES
}
