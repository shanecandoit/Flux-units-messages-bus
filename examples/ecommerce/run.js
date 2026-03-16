/**
 * E-commerce example — runs the cart unit and exercises the full checkout flow.
 * Usage: node examples/ecommerce/run.js
 */
import { Runtime, UnitInstance } from '../../src/runtime.js'
import { addItem, applyCoupon, checkout } from './units/cart.rules.js'

const rt = new Runtime()

rt.addUnit(new UnitInstance({
  name: 'cart',
  channels: ['commerce.cart.*', 'commerce.checkout.submit'],
  initialState: {
    items: [],
    totals: [{ subtotal: 0, coupon: null }],
  },
  rules: [
    {
      name: 'add_item',
      match: { topic: 'commerce.cart.add', sku: '$sku', price: '$price', qty: '$qty' },
      guard: (state) => state.items.count() < 100,
      do: addItem,
    },
    {
      name: 'apply_coupon',
      match: { topic: 'commerce.cart.coupon_applied', code: '$code', pct: '$pct' },
      do: applyCoupon,
    },
    {
      name: 'checkout',
      match: { topic: 'commerce.checkout.submit' },
      do: checkout,
    },
  ],
}))

function log(label, entries) {
  console.log(`\n── ${label}`)
  for (const e of entries) {
    const cause = e.parentId != null ? ` (caused by #${e.parentId})` : ' (injected)'
    console.log(`  [${e.id}] ${e.topic}${cause}`)
    console.log(`       ${JSON.stringify(e.payload)}`)
  }
}

function cartState() {
  const s = rt.state('cart')
  return {
    items: s.items.all(),
    totals: s.totals._rows[0],
  }
}

// ── Add item
log('inject: commerce.cart.add', rt.inject('commerce.cart.add', { sku: 'widget-blue', price: 9.99, qty: 1 }))
console.log('  state:', cartState())

// ── Add another
log('inject: commerce.cart.add (qty 2)', rt.inject('commerce.cart.add', { sku: 'gadget-red', price: 4.50, qty: 2 }))
console.log('  state:', cartState())

// ── Apply coupon
log('inject: commerce.cart.coupon_applied', rt.inject('commerce.cart.coupon_applied', { code: 'SAVE10', pct: 10 }))
console.log('  state:', cartState())

// ── Checkout
log('inject: commerce.checkout.submit', rt.inject('commerce.checkout.submit', { cart_id: 'cart_001' }))
console.log('  state:', cartState())

console.log('\n── Full bus log')
for (const e of rt.bus.log) {
  const tick = `t${e.tick}`.padEnd(3)
  const parent = e.parentId != null ? `← #${e.parentId}` : '← (root)'
  console.log(`  #${e.id} ${tick}  ${e.topic.padEnd(32)} ${parent}`)
}
