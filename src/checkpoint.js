/**
 * Checkpoint — named snapshots of full runtime state.
 *
 * A checkpoint stores:
 *   - All unit states
 *   - Full bus log
 *   - Tick number
 *   - Merkle-style hashes for fast diffing (simplified: JSON hash of each subtree)
 *
 * Checkpoints are serialised as JSON. (YAML conversion is a CLI concern.)
 */
import { createHash } from 'node:crypto'

export function hash(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 8)
}

export function buildCheckpoint(runtime, { id, name } = {}) {
  const snap = runtime.snapshot()
  const unitHashes = {}
  for (const [unitName, unitState] of Object.entries(snap.units)) {
    unitHashes[unitName] = hash(unitState)
  }

  return {
    id: id ?? hash({ tick: snap.tick, ts: Date.now() }),
    name: name ?? null,
    timestamp: new Date().toISOString(),
    tick: snap.tick,
    merkle_root: hash({ units: unitHashes, bus: hash(snap.busLog) }),
    unit_hashes: unitHashes,
    units: snap.units,
    bus_log: snap.busLog,
    defects: [],
  }
}

/**
 * Diff two checkpoints. Returns an object describing what changed.
 */
export function diffCheckpoints(a, b) {
  const changedUnits = {}

  const allUnits = new Set([...Object.keys(a.units), ...Object.keys(b.units)])
  for (const name of allUnits) {
    const hashA = a.unit_hashes?.[name] ?? null
    const hashB = b.unit_hashes?.[name] ?? null
    if (hashA !== hashB) {
      changedUnits[name] = { from: a.units[name] ?? null, to: b.units[name] ?? null }
    }
  }

  const newMessages = b.bus_log.slice(a.bus_log.length)

  return {
    tick_delta: b.tick - a.tick,
    changed_units: changedUnits,
    new_messages: newMessages,
    unchanged_units: [...allUnits].filter(n => !(n in changedUnits)),
  }
}
