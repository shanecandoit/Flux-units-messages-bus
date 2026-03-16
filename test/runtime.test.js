import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Runtime, UnitInstance } from '../src/runtime.js'

// ── helpers ────────────────────────────────────────────────────────────────

function makeCartUnit() {
  return new UnitInstance({
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
        do(state, b, msg, emit) {
          const existing = state.items.find(b['$sku'])
          if (existing) {
            existing.qty += b['$qty']
          } else {
            state.items.insert({ sku: b['$sku'], qty: b['$qty'], price: b['$price'] })
          }
          const row = state.totals._rows[0]
          row.subtotal += b['$price'] * b['$qty']
          emit('commerce.cart.updated', {
            total: row.subtotal,
            item_count: state.items.count(),
          })
        },
      },
      {
        name: 'apply_coupon',
        match: { topic: 'commerce.cart.coupon_applied', code: '$code', pct: '$pct' },
        do(state, b, msg, emit) {
          const row = state.totals._rows[0]
          row.coupon = b['$code']
          row.subtotal = row.subtotal * (1 - b['$pct'] / 100)
          emit('commerce.cart.updated', {
            total: row.subtotal,
            item_count: state.items.count(),
          })
        },
      },
      {
        name: 'checkout',
        match: { topic: 'commerce.checkout.submit' },
        do(state, b, msg, emit) {
          const row = state.totals._rows[0]
          const total = row.subtotal
          state.items.clear()
          row.subtotal = 0
          row.coupon = null
          emit('commerce.checkout.complete', { total })
        },
      },
    ],
  })
}

// ── UnitInstance tests ─────────────────────────────────────────────────────

describe('UnitInstance — rule matching', () => {
  let unit

  beforeEach(() => { unit = makeCartUnit() })

  it('fires add_item rule and inserts a row', () => {
    const emitted = []
    const msg = { topic: 'commerce.cart.add', payload: { sku: 'widget', price: 9.99, qty: 1 } }
    unit.handleMessage(msg, (t, p) => emitted.push({ t, p }))

    assert.equal(unit.state.items.count(), 1)
    assert.equal(unit.state.items.find('widget').qty, 1)
    assert.equal(emitted.length, 1)
    assert.equal(emitted[0].t, 'commerce.cart.updated')
  })

  it('increments qty when same sku added twice', () => {
    const msg = { topic: 'commerce.cart.add', payload: { sku: 'widget', price: 9.99, qty: 1 } }
    unit.handleMessage(msg, () => {})
    unit.handleMessage(msg, () => {})
    assert.equal(unit.state.items.find('widget').qty, 2)
    assert.equal(unit.state.items.count(), 1)
  })

  it('apply_coupon reduces subtotal', () => {
    const add = { topic: 'commerce.cart.add', payload: { sku: 'w', price: 10, qty: 1 } }
    unit.handleMessage(add, () => {})
    assert.equal(unit.state.totals._rows[0].subtotal, 10)

    const coupon = { topic: 'commerce.cart.coupon_applied', payload: { code: 'SAVE10', pct: 10 } }
    unit.handleMessage(coupon, () => {})
    assert.ok(Math.abs(unit.state.totals._rows[0].subtotal - 9) < 0.001)
  })

  it('guard prevents firing when item limit reached', () => {
    // Fill up to 100 items
    for (let i = 0; i < 100; i++) {
      unit.state.items.insert({ sku: `sku-${i}`, qty: 1, price: 1 })
    }
    const emitted = []
    const msg = { topic: 'commerce.cart.add', payload: { sku: 'new', price: 5, qty: 1 } }
    unit.handleMessage(msg, (t, p) => emitted.push(t))
    assert.equal(unit.state.items.count(), 100)
    assert.equal(emitted.length, 0)
  })

  it('no rule fires for unrelated topic', () => {
    const emitted = []
    const msg = { topic: 'commerce.payment.charged', payload: {} }
    const fired = unit.handleMessage(msg, (t, p) => emitted.push(t))
    assert.equal(fired, false)
    assert.equal(emitted.length, 0)
  })

  it('checkout clears cart and emits complete', () => {
    const add = { topic: 'commerce.cart.add', payload: { sku: 'w', price: 10, qty: 1 } }
    unit.handleMessage(add, () => {})
    const emitted = []
    const checkout = { topic: 'commerce.checkout.submit', payload: { cart_id: 'c1' } }
    unit.handleMessage(checkout, (t, p) => emitted.push({ t, p }))

    assert.equal(unit.state.items.count(), 0)
    assert.equal(unit.state.totals._rows[0].subtotal, 0)
    assert.equal(emitted[0].t, 'commerce.checkout.complete')
    assert.equal(emitted[0].p.total, 10)
  })
})

// ── Runtime integration tests ──────────────────────────────────────────────

describe('Runtime — integration', () => {
  let rt

  beforeEach(() => {
    rt = new Runtime()
    rt.addUnit(makeCartUnit())
  })

  it('inject returns all new bus entries including downstream', () => {
    const entries = rt.inject('commerce.cart.add', { sku: 'w', price: 5, qty: 2 })
    // Original + commerce.cart.updated emitted by rule
    assert.equal(entries.length, 2)
    assert.equal(entries[0].topic, 'commerce.cart.add')
    assert.equal(entries[1].topic, 'commerce.cart.updated')
  })

  it('downstream messages carry parentId of triggering message', () => {
    const entries = rt.inject('commerce.cart.add', { sku: 'w', price: 5, qty: 1 })
    assert.equal(entries[1].parentId, entries[0].id)
  })

  it('full checkout sequence produces correct final state', () => {
    rt.inject('commerce.cart.add', { sku: 'widget', price: 9.99, qty: 1 })
    rt.inject('commerce.cart.coupon_applied', { code: 'SAVE10', pct: 10 })
    rt.inject('commerce.checkout.submit', { cart_id: 'c1' })

    const state = rt.state('cart')
    assert.equal(state.items.count(), 0)
    assert.equal(state.totals._rows[0].subtotal, 0)
  })

  it('snapshot captures current tick and unit states', () => {
    rt.inject('commerce.cart.add', { sku: 'w', price: 5, qty: 1 })
    const snap = rt.snapshot()
    assert.ok(snap.tick > 0)
    assert.ok(Array.isArray(snap.units.cart.items))
    assert.equal(snap.units.cart.items.length, 1)
  })

  it('throws on tick limit exceeded (cascade guard)', () => {
    // Create a unit that immediately re-emits the same message → infinite loop
    const loopy = new UnitInstance({
      name: 'loopy',
      channels: ['loop.ping'],
      initialState: {},
      rules: [{
        name: 'bounce',
        match: { topic: 'loop.ping' },
        do(state, b, msg, emit) {
          emit('loop.ping', {})
        },
      }],
    })
    const rt2 = new Runtime({ tickLimit: 10 })
    rt2.addUnit(loopy)
    assert.throws(() => rt2.inject('loop.ping', {}), /Tick limit/)
  })
})

// ── State table helpers ────────────────────────────────────────────────────

describe('State table helpers', () => {
  let unit

  beforeEach(() => {
    unit = new UnitInstance({
      name: 'test',
      channels: [],
      initialState: { rows: [] },
      rules: [],
    })
  })

  it('insert and count', () => {
    unit.state.rows.insert({ id: 'a', val: 1 })
    unit.state.rows.insert({ id: 'b', val: 2 })
    assert.equal(unit.state.rows.count(), 2)
  })

  it('find by first-column value', () => {
    unit.state.rows.insert({ id: 'a', val: 99 })
    const found = unit.state.rows.find('a')
    assert.equal(found.val, 99)
  })

  it('find returns null when not found', () => {
    assert.equal(unit.state.rows.find('missing'), null)
  })

  it('find with predicate function', () => {
    unit.state.rows.insert({ id: 'a', val: 5 })
    unit.state.rows.insert({ id: 'b', val: 10 })
    const found = unit.state.rows.find(r => r.val > 7)
    assert.equal(found.id, 'b')
  })

  it('delete removes a row', () => {
    unit.state.rows.insert({ id: 'x', val: 1 })
    unit.state.rows.delete('x')
    assert.equal(unit.state.rows.count(), 0)
  })

  it('clear removes all rows', () => {
    unit.state.rows.insert({ id: 'a', val: 1 })
    unit.state.rows.insert({ id: 'b', val: 2 })
    unit.state.rows.clear()
    assert.equal(unit.state.rows.count(), 0)
  })

  it('all returns a copy of rows', () => {
    unit.state.rows.insert({ id: 'a', val: 1 })
    const all = unit.state.rows.all()
    assert.equal(all.length, 1)
    // Mutating the copy does not affect the table
    all.push({ id: 'fake' })
    assert.equal(unit.state.rows.count(), 1)
  })
})
