import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Bus } from '../src/bus.js'

describe('Bus', () => {
  let bus

  beforeEach(() => { bus = new Bus() })

  it('starts with empty log', () => {
    assert.equal(bus.log.length, 0)
    assert.equal(bus.tick, 0)
  })

  it('append adds an entry with sequential id', () => {
    const a = bus.append('foo.bar', { x: 1 })
    const b = bus.append('foo.baz', { x: 2 })
    assert.equal(a.id, 0)
    assert.equal(b.id, 1)
    assert.equal(bus.log.length, 2)
  })

  it('append sets parentId', () => {
    const parent = bus.append('a.b', {})
    const child = bus.append('a.c', {}, parent.id)
    assert.equal(child.parentId, parent.id)
  })

  it('inject queues a pending message', () => {
    assert.equal(bus.hasPending(), false)
    bus.inject('x.y', {})
    assert.equal(bus.hasPending(), true)
  })

  it('drainPending returns pending messages and advances tick', () => {
    bus.inject('x.y', { v: 1 })
    bus.inject('x.z', { v: 2 })
    const batch = bus.drainPending()
    assert.equal(batch.length, 2)
    assert.equal(bus.hasPending(), false)
    assert.equal(bus.tick, 1)
  })

  it('multiple drainPending calls advance tick each time', () => {
    bus.inject('a.b', {})
    bus.drainPending()
    bus.inject('a.c', {})
    bus.drainPending()
    assert.equal(bus.tick, 2)
  })

  it('causalChain returns ancestors in order root → leaf', () => {
    const root = bus.append('root', {})
    const mid = bus.append('mid', {}, root.id)
    const leaf = bus.append('leaf', {}, mid.id)

    const chain = bus.causalChain(leaf.id)
    assert.equal(chain.length, 3)
    assert.equal(chain[0].id, root.id)
    assert.equal(chain[1].id, mid.id)
    assert.equal(chain[2].id, leaf.id)
  })

  it('causalChain for a root message returns just itself', () => {
    const root = bus.append('root', {})
    assert.deepEqual(bus.causalChain(root.id), [root])
  })

  it('onAppend listener is called for each append', () => {
    const seen = []
    bus.onAppend(e => seen.push(e.topic))
    bus.append('a.b', {})
    bus.inject('c.d', {})
    assert.deepEqual(seen, ['a.b', 'c.d'])
  })

  it('multiple onAppend listeners all fire independently', () => {
    const a = [], b = []
    bus.onAppend(e => a.push(e.topic))
    bus.onAppend(e => b.push(e.id))
    bus.append('x.y', {})
    assert.equal(a.length, 1)
    assert.equal(b.length, 1)
    assert.equal(a[0], 'x.y')
    assert.equal(typeof b[0], 'number')
  })

  it('restore rebuilds log and resets nextId', () => {
    const entries = [
      { id: 0, tick: 1, parentId: null, topic: 'x.y', payload: {}, ts: 0 },
      { id: 1, tick: 1, parentId: 0, topic: 'x.z', payload: {}, ts: 0 },
    ]
    bus.restore(entries, 2)
    assert.equal(bus.log.length, 2)
    assert.equal(bus.tick, 2)
    // Next appended id should be 2
    const next = bus.append('a.b', {})
    assert.equal(next.id, 2)
  })
})
