import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runtime, UnitInstance } from '../src/runtime.js'
import {
  buildCheckpoint, diffCheckpoints, hash,
  saveCheckpoint, loadCheckpoint, listCheckpoints, restoreCheckpoint,
} from '../src/checkpoint.js'

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
    const diff = diffCheckpoints(cp1, cp2)
    assert.ok(diff.tick_delta > 0)
  })

  it('handles unit present in b but not a', () => {
    const rt = makeCounterRuntime()
    const cp1 = buildCheckpoint(rt)
    const cp2 = {
      ...cp1,
      units: { ...cp1.units, new_unit: { rows: [] } },
      unit_hashes: { ...cp1.unit_hashes, new_unit: 'abc12345' },
    }
    const diff = diffCheckpoints(cp1, cp2)
    assert.ok('new_unit' in diff.changed_units)
    assert.equal(diff.changed_units.new_unit.from, null)
  })
})

// ── Runtime.restore / restoreCheckpoint ──────────────────────────────────────

describe('Runtime.restore', () => {
  it('restores unit state from checkpoint', () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 7 })
    const cp = buildCheckpoint(rt)

    rt.inject('counter.inc', { n: 100 })
    assert.equal(rt.state('counter').totals.get().count, 107)

    rt.restore(cp)
    assert.equal(rt.state('counter').totals.get().count, 7)
  })

  it('restores bus log length and tick', () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 1 })
    const cp = buildCheckpoint(rt)
    const tickAtCheckpoint = rt.bus.tick
    const logLenAtCheckpoint = rt.bus.log.length

    rt.inject('counter.inc', { n: 1 })
    assert.ok(rt.bus.log.length > logLenAtCheckpoint)

    rt.restore(cp)
    assert.equal(rt.bus.log.length, logLenAtCheckpoint)
    assert.equal(rt.bus.tick, tickAtCheckpoint)
  })

  it('runtime remains functional after restore', () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 5 })
    const cp = buildCheckpoint(rt)

    rt.inject('counter.inc', { n: 10 })
    rt.restore(cp)

    rt.inject('counter.inc', { n: 3 })
    assert.equal(rt.state('counter').totals.get().count, 8)
  })

  it('restored merkle root matches original checkpoint', () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 4 })
    const cp = buildCheckpoint(rt)

    rt.inject('counter.inc', { n: 99 })
    rt.restore(cp)

    const cp2 = buildCheckpoint(rt)
    assert.equal(cp2.merkle_root, cp.merkle_root)
  })

  it('restoring to initial state clears all injected data', () => {
    const rt = makeCounterRuntime()
    const cpEmpty = buildCheckpoint(rt)

    rt.inject('counter.inc', { n: 1 })
    rt.inject('counter.inc', { n: 2 })
    rt.restore(cpEmpty)

    assert.equal(rt.state('counter').totals.get().count, 0)
    assert.equal(rt.bus.log.length, 0)
  })
})

describe('restoreCheckpoint', () => {
  it('is an alias for runtime.restore', () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 2 })
    const cp = buildCheckpoint(rt)

    rt.inject('counter.inc', { n: 50 })
    restoreCheckpoint(rt, cp)
    assert.equal(rt.state('counter').totals.get().count, 2)
  })
})

// ── file I/O ──────────────────────────────────────────────────────────────────

describe('saveCheckpoint / loadCheckpoint / listCheckpoints', () => {
  let tmpDir

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flux-cp-test-'))
  })

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('saves a checkpoint as <id>.json and returns the path', async () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 3 })
    const cp = buildCheckpoint(rt)

    const filePath = await saveCheckpoint(cp, tmpDir)
    assert.ok(filePath.endsWith(`${cp.id}.json`))
  })

  it('creates the directory if it does not exist', async () => {
    const rt = makeCounterRuntime()
    const cp = buildCheckpoint(rt)
    const nested = join(tmpDir, 'new', 'nested', 'dir')
    await saveCheckpoint(cp, nested)
    const loaded = await loadCheckpoint(cp.id, nested)
    assert.equal(loaded.id, cp.id)
  })

  it('loads a checkpoint by exact id', async () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 9 })
    const cp = buildCheckpoint(rt)
    await saveCheckpoint(cp, tmpDir)

    const loaded = await loadCheckpoint(cp.id, tmpDir)
    assert.equal(loaded.id, cp.id)
    assert.equal(loaded.units.counter.totals[0].count, 9)
  })

  it('loads a checkpoint by name', async () => {
    const rt = makeCounterRuntime()
    const cp = buildCheckpoint(rt, { name: 'my-named-cp' })
    await saveCheckpoint(cp, tmpDir)

    const loaded = await loadCheckpoint('my-named-cp', tmpDir)
    assert.equal(loaded.name, 'my-named-cp')
    assert.equal(loaded.id, cp.id)
  })

  it('loads a checkpoint by id prefix', async () => {
    const rt = makeCounterRuntime()
    const cp = buildCheckpoint(rt, { name: 'prefix-test' })
    await saveCheckpoint(cp, tmpDir)

    const loaded = await loadCheckpoint(cp.id.slice(0, 4), tmpDir)
    assert.equal(loaded.id, cp.id)
  })

  it('throws when checkpoint not found', async () => {
    await assert.rejects(
      () => loadCheckpoint('doesnotexist', tmpDir),
      /not found/i
    )
  })

  it('listCheckpoints returns all checkpoints sorted oldest-first', async () => {
    const all = await listCheckpoints(tmpDir)
    assert.ok(all.length >= 1)
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1].timestamp <= all[i].timestamp)
    }
  })

  it('listCheckpoints returns empty array for missing directory', async () => {
    const cps = await listCheckpoints(join(tmpDir, 'nonexistent'))
    assert.deepEqual(cps, [])
  })

  it('round-trips: save → load → restore brings state back', async () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 42 })
    const cp = buildCheckpoint(rt)
    await saveCheckpoint(cp, tmpDir)

    rt.inject('counter.inc', { n: 1 })
    assert.equal(rt.state('counter').totals.get().count, 43)

    const loaded = await loadCheckpoint(cp.id, tmpDir)
    restoreCheckpoint(rt, loaded)
    assert.equal(rt.state('counter').totals.get().count, 42)
  })

  it('saved checkpoint merkle_root survives serialisation', async () => {
    const rt = makeCounterRuntime()
    rt.inject('counter.inc', { n: 5 })
    const cp = buildCheckpoint(rt)
    await saveCheckpoint(cp, tmpDir)

    const loaded = await loadCheckpoint(cp.id, tmpDir)
    assert.equal(loaded.merkle_root, cp.merkle_root)
  })
})
