export function increment(state, b, msg, emit) {
  state.totals.get().count += b['$amount']
  emit('counter.updated', { count: state.totals.get().count })
}

export function reset(state, b, msg, emit) {
  state.totals.get().count = 0
  emit('counter.updated', { count: 0 })
}
