const WIN_SCORE = 7

export function onScore(state, b, msg, emit) {
  const t = state.totals.get()

  if (b.$player == 'left')  t.left  += 1
  if (b.$player == 'right') t.right += 1

  emit('score.updated', { left: t.left, right: t.right })

  if (t.left >= WIN_SCORE) {
    emit('game.over', { winner: 'left',  score_left: t.left, score_right: t.right })
  }
  if (t.right >= WIN_SCORE) {
    emit('game.over', { winner: 'right', score_left: t.left, score_right: t.right })
  }
}
