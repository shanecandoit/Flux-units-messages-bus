import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Runtime, UnitInstance } from '../src/runtime.js'
import { buildCheckpoint, diffCheckpoints, hash } from '../src/checkpoint.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeCounterRuntime() {
  const rt = new Runtime()
  rt.addUnit(new UnitInstance({
    name: 'counter',
    channels: ['counter.*'],
    initialState: { totals: [{ count: 0 }] },
    rules: [{
      name: 'inc',
      match: { topic: 'counter.inc', n: '$n' },
      do(state, b, msg, emit) {
        state.totals.get().count += b['$n']
        emit('counter.updated', { count: state.totals.get().count })
      },
    }],
  }))
  return rt
}

// ── hash ──────────────────────────────────────────────────────────────────────

describe('hash', () => {
  it('returns an 8-char hex string', () => {
    const h = hash({ foo: 'bar' })
    assert.match(h, /^[0-9a-f]{8}$/)
  })

  it('same input → same hash', () => {
    assert.equal(hash({ a: 1 }), hash({ a: 1 }))
  })

  it('different input → different hash', () => {
    assert.notEqual(hash({ a: 1 }), hash({ a: 2 }))
  })
})

// ── buildCheckpoint ───────────────────────────────────────────────────────────

describe('buildCheckpoint', () => {
  it('captures tick, unit states, and bus log', () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 5 })

    const cp = buildCheckpoint(rt)
    assert.ok(cp.tick > 0)
    assert.ok(Array.isArray(cp.units.counter.totals))
    assert.equal(cp.units.counter.totals[0].count, 5)
    assert.equal(cp.bus_log.length, 2)  // inject + counter.updated
  })

  it('assigns an id and timestamp', () => {
    const rt = makeCounterRuntime()
    const cp = buildCheckpoint(rt)
    assert.ok(cp.id)
    assert.ok(cp.timestamp)
  })

  it('accepts a custom name', () => {
    const rt = makeCounterRuntime()
    const cp = buildCheckpoint(rt, { name: 'after_first_inc' })
    assert.equal(cp.name, 'after_first_inc')
  })

  it('sets merkle_root and unit_hashes', () => {
    const rt = makeCounterRuntime()
    const cp = buildCheckpoint(rt)
    assert.ok(cp.merkle_root)
    assert.ok(cp.unit_hashes.counter)
  })

  it('unit hash changes when state changes', () => {
    const rt = makeCounterRuntime()
    const cp1 = buildCheckpoint(rt)
    rt.inject('counter.inc', { n: 1 })
    const cp2 = buildCheckpoint(rt)
    assert.notEqual(cp1.unit_hashes.counter, cp2.unit_hashes.counter)
  })

  it('unit hash is stable when state unchanged', () => {
    const rt1 = makeCounterRuntime()
    const rt2 = makeCounterRuntime()
    const cp1 = buildCheckpoint(rt1)
    const cp2 = buildCheckpoint(rt2)
    assert.equal(cp1.unit_hashes.counter, cp2.unit_hashes.counter)
  })

  it('initialises defects as empty array', () => {
    const rt = makeCounterRuntime()
    const cp = buildCheckpoint(rt)
    assert.deepEqual(cp.defects, [])
  })
})

// ── diffCheckpoints ───────────────────────────────────────────────────────────

describe('diffCheckpoints', () => {
  it('shows no changes between identical checkpoints', () => {
    const rt = makeCounterRuntime()
    const cp1 = buildCheckpoint(rt)
    const cp2 = buildCheckpoint(rt)
    const diff = diffCheckpoints(cp1, cp2)
    assert.deepEqual(diff.changed_units, {})
    assert.equal(diff.new_messages.length, 0)
    assert.equal(diff.tick_delta, 0)
  })

  it('detects changed unit state', () => {
    const rt = makeCounterRuntime()
    const cp1 = buildCheckpoint(rt)
    rt.inject('counter.inc', { n: 3 })
    const cp2 = buildCheckpoint(rt)
    const diff = diffCheckpoints(cp1, cp2)
    assert.ok('counter' in diff.changed_units)
    assert.equal(diff.changed_units.counter.from.totals[0].count, 0)
    assert.equal(diff.changed_units.counter.to.totals[0].count, 3)
  })

  it('reports new messages since first checkpoint', () => {
    const rt = makeCounterRuntime()
    const cp1 = buildCheckpoint(rt)
    rt.inject('counter.inc', { n: 1 })
    const cp2 = buildCheckpoint(rt)
    const diff = diffCheckpoints(cp1, cp2)
    assert.equal(diff.new_messages.length, 2)  // inject + counter.updated
    assert.equal(diff.new_messages[0].topic, 'counter.inc')
  })

  it('reports unchanged units correctly', () => {
    const rt = makeCounterRuntime()
    const cp1 = buildCheckpoint(rt)
    const cp2 = buildCheckpoint(rt)
    const diff = diffCheckpoints(cp1, cp2)
    assert.ok(diff.unchanged_units.includes('counter'))
  })

  it('calculates tick_delta', () => {
    const rt = makeCounterRuntime()
    const cp1 = buildCheckpoint(rt)
    rt.inject('counter.inc', { n: 1 })
    rt.inject('counter.inc', { n: 1 })
    const cp2 = buildCheckpoint(rt)
    assert.ok(diff => diff.tick_delta >= 0)
    const diff = diffCheckpoints(cp1, cp2)
    assert.ok(diff.tick_delta > 0)
  })

  it('handles unit present in b but not a', () => {
    const rt = makeCounterRuntime()
    const cp1 = buildCheckpoint(rt)

    // Simulate a second unit appearing in cp2
    const cp2 = { ...cp1, units: { ...cp1.units, new_unit: { rows: [] } }, unit_hashes: { ...cp1.unit_hashes, new_unit: 'abc12345' } }
    const diff = diffCheckpoints(cp1, cp2)
    assert.ok('new_unit' in diff.changed_units)
    assert.equal(diff.changed_units.new_unit.from, null)
  })
})
