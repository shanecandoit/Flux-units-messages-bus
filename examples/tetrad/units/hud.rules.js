// Level up every 10 lines cleared
const LINES_PER_LEVEL = 10

export function onLinesCleared(state, b, msg, emit) {
  const s     = state.stats.get()
  const bonus = s.level   // higher level = score multiplier
  s.score    += b.$score * bonus
  s.lines    += b.$count
  s.level     = Math.floor(s.lines / LINES_PER_LEVEL) + 1
  emit('score.updated', { score: s.score, level: s.level, lines: s.lines })
}

export function onGameOver(state, b, msg, emit) {
  const s = state.stats.get()
  emit('score.updated', { score: s.score, level: s.level, lines: s.lines })
}
