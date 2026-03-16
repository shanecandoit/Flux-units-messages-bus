import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Dispatcher } from '../src/dispatcher.js'

// Minimal unit stub
function makeUnit(name, channels) {
  return { name, channels }
}

describe('Dispatcher', () => {
  let d

  beforeEach(() => { d = new Dispatcher() })

  it('exact topic match', () => {
    const u = makeUnit('cart', ['commerce.cart.add'])
    d.registerUnit(u)
    assert.deepEqual(d.match('commerce.cart.add'), [u])
  })

  it('no match for different topic', () => {
    const u = makeUnit('cart', ['commerce.cart.add'])
    d.registerUnit(u)
    assert.deepEqual(d.match('commerce.cart.remove'), [])
  })

  it('wildcard matches all subtopics', () => {
    const u = makeUnit('cart', ['commerce.cart.*'])
    d.registerUnit(u)
    assert.deepEqual(d.match('commerce.cart.add'), [u])
    assert.deepEqual(d.match('commerce.cart.remove'), [u])
    assert.deepEqual(d.match('commerce.cart.update'), [u])
  })

  it('wildcard does not match parent topic', () => {
    const u = makeUnit('cart', ['commerce.cart.*'])
    d.registerUnit(u)
    assert.deepEqual(d.match('commerce.cart'), [])
  })

  it('wildcard does not match deeper nesting', () => {
    const u = makeUnit('cart', ['commerce.cart.*'])
    d.registerUnit(u)
    // commerce.cart.add.extra has two segments after prefix — not matched by single *
    assert.deepEqual(d.match('commerce.cart.add.extra'), [])
  })

  it('multiple units can match same topic', () => {
    const analytics = makeUnit('analytics', ['commerce.cart.*'])
    const cart = makeUnit('cart', ['commerce.cart.add'])
    d.registerUnit(analytics)
    d.registerUnit(cart)
    const matched = d.match('commerce.cart.add')
    assert.equal(matched.length, 2)
    assert.ok(matched.includes(analytics))
    assert.ok(matched.includes(cart))
  })

  it('unit with multiple channels is only returned once per topic', () => {
    const u = makeUnit('multi', ['commerce.cart.*', 'commerce.cart.add'])
    d.registerUnit(u)
    const matched = d.match('commerce.cart.add')
    assert.equal(matched.length, 1)
  })

  it('units getter returns all registered units', () => {
    const a = makeUnit('a', ['x.y'])
    const b = makeUnit('b', ['x.z'])
    d.registerUnit(a)
    d.registerUnit(b)
    assert.equal(d.units.length, 2)
  })
})
