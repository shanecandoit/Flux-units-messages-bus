/**
 * Checkpoint — named snapshots of full runtime state.
 *
 * A checkpoint stores:
 *   - All unit states
 *   - Full bus log
 *   - Tick number
 *   - Per-unit content hashes for O(n) diffing (SHA-256 of JSON-serialised state)
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
 * Diff two checkpoints. The first argument is the earlier checkpoint.
 *
 * Returns:
 *   {
 *     tick_delta:      number,
 *     changed_units:   { [unitName]: { from: state | null, to: state | null } },
 *     unchanged_units: string[],
 *     new_messages:    BusEntry[],  // entries added after checkpoint a
 *   }
 *
 * Note: if b.bus_log is shorter than a.bus_log (shouldn't happen in normal use),
 * new_messages will be empty.
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
