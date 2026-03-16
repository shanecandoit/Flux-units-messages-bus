const SPEED  = 5
const HALF_W = 30   // half paddle width
const X_MIN  = HALF_W
const X_MAX  = 320 - HALF_W

export function movePaddle(state, b, msg, emit) {
  const pos = state.pos.get()
  if (b.$direction == 'left')  pos.x = Math.max(X_MIN, pos.x - SPEED)
  if (b.$direction == 'right') pos.x = Math.min(X_MAX, pos.x + SPEED)
}

export function broadcastPaddle(state, b, msg, emit) {
  emit('paddle.moved', { x: state.pos.get().x })
}
