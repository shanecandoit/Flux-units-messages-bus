export function addItem(state, b, msg, emit) {
  const existing = state.items.find(b['$sku'])
  if (existing) {
    existing.qty += b['$qty']
  } else {
    state.items.insert({ sku: b['$sku'], qty: b['$qty'], price: b['$price'] })
  }
  const totals = state.totals._rows[0]
  totals.subtotal += b['$price'] * b['$qty']
  emit('commerce.cart.updated', {
    total: totals.subtotal,
    item_count: state.items.count(),
  })
}

export function applyCoupon(state, b, msg, emit) {
  const totals = state.totals._rows[0]
  totals.coupon = b['$code']
  totals.subtotal = totals.subtotal * (1 - b['$pct'] / 100)
  emit('commerce.cart.updated', {
    total: totals.subtotal,
    item_count: state.items.count(),
  })
}

export function checkout(state, b, msg, emit) {
  const totals = state.totals._rows[0]
  const total = totals.subtotal
  state.items.clear()
  totals.subtotal = 0
  totals.coupon = null
  emit('commerce.checkout.complete', { total })
}
