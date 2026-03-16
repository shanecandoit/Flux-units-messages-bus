/**
 * Checkpoint — named snapshots of full runtime state.
 *
 * A checkpoint stores:
 *   - All unit states
 *   - Full bus log
 *   - Tick number
 *   - Per-unit content hashes for O(n) diffing (SHA-256 of JSON-serialised state)
 *
 * Checkpoints are serialised as JSON files on disk:
 *   <checkpoints-dir>/<id>.json
 *
 * Named checkpoints set the `name` field; lookup by name scans all files.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

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

// ── File I/O ──────────────────────────────────────────────────────────────────

/**
 * Write a checkpoint to disk as <dir>/<id>.json.
 * Creates the directory if it does not exist.
 * Returns the absolute path of the written file.
 */
export async function saveCheckpoint(cp, dir) {
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, `${cp.id}.json`)
  await writeFile(filePath, JSON.stringify(cp, null, 2))
  return filePath
}

/**
 * Load a checkpoint from disk by id, name, or id prefix.
 * Tries <dir>/<idOrName>.json first; if not found, scans all .json files
 * for a matching `name` field or an id that starts with the given string.
 * Throws if nothing matches.
 */
export async function loadCheckpoint(idOrName, dir) {
  // Fast path: exact id match
  try {
    const raw = await readFile(join(dir, `${idOrName}.json`), 'utf8')
    return JSON.parse(raw)
  } catch { /* fall through */ }

  // Slow path: scan for name or id-prefix match
  const files = await readdir(dir).catch(() => [])
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const cp = JSON.parse(await readFile(join(dir, f), 'utf8'))
      if (cp.name === idOrName || cp.id?.startsWith(idOrName)) return cp
    } catch { /* skip corrupt files */ }
  }

  throw new Error(`Checkpoint '${idOrName}' not found in ${dir}`)
}

/**
 * List all checkpoints in a directory, sorted oldest-first by timestamp.
 * Skips files that cannot be parsed.
 */
export async function listCheckpoints(dir) {
  const files = await readdir(dir).catch(() => [])
  const results = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      results.push(JSON.parse(await readFile(join(dir, f), 'utf8')))
    } catch { /* skip */ }
  }
  return results.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/**
 * Restore a runtime to the state captured in a checkpoint.
 * Thin wrapper around runtime.restore() kept here so callers
 * only need to import from one place.
 */
export function restoreCheckpoint(runtime, cp) {
  runtime.restore(cp)
}
