export function addPoints(state, b, msg, emit) {
  const s = state.stats.get()
  s.score += b.$points
  emit('score.updated', { score: s.score, lives: s.lives })
}

export function loseLife(state, b, msg, emit) {
  const s = state.stats.get()
  s.lives -= 1
  emit('score.updated', { score: s.score, lives: s.lives })
  if (s.lives <= 0) {
    emit('game.over', { score: s.score })
  }
}

export function nextLevel(state, b, msg, emit) {
  const s = state.stats.get()
  s.level += 1
  emit('score.updated', { score: s.score, lives: s.lives })
}
