/**
 * Runtime — tick loop, rule matching, and rule firing.
 *
 * A tick:
 *   1. Drain all pending messages from the bus.
 *   2. For each message, find matching units via the dispatcher.
 *   3. For each (unit, message), find the first matching rule.
 *   4. Evaluate the optional guard against current state + bindings.
 *   5. Call the rule's do-function with (state, bindings, msg, emit).
 *   6. Collect any emitted messages into the next pending batch.
 *   7. Repeat until the bus is quiet (quiescence).
 */
import { Bus } from './bus.js'
import { Dispatcher } from './dispatcher.js'

export class Runtime {
  constructor({ tickLimit = 1000 } = {}) {
    this.bus = new Bus()
    this.dispatcher = new Dispatcher()
    this._units = new Map()   // name → UnitInstance
    this._tickLimit = tickLimit
  }

  /** Register a compiled unit instance. Throws if a unit with that name is already registered. */
  addUnit(unit) {
    if (this._units.has(unit.name)) {
      throw new Error(`Unit '${unit.name}' is already registered`)
    }
    this._units.set(unit.name, unit)
    this.dispatcher.registerUnit(unit)
  }

  /** Inject a message and run to quiescence. Returns all new bus entries. */
  inject(topic, payload = {}) {
    const start = this.bus.log.length
    this.bus.inject(topic, payload, null)
    this._runToQuiescence()
    return this.bus.log.slice(start)
  }

  /** Run the tick loop until no more pending messages. */
  _runToQuiescence() {
    let ticks = 0
    while (this.bus.hasPending()) {
      if (++ticks > this._tickLimit) {
        throw new Error(`Tick limit ${this._tickLimit} exceeded — possible runaway cascade`)
      }
      this._processTick()
    }
  }

  _processTick() {
    const messages = this.bus.drainPending()
    const emitted = []

    for (const msg of messages) {
      const units = this.dispatcher.match(msg.topic)
      for (const unit of units) {
        unit.handleMessage(msg, (topic, payload) => {
          emitted.push({ topic, payload, parentId: msg.id })
        })
      }
    }

    for (const { topic, payload, parentId } of emitted) {
      this.bus.inject(topic, payload, parentId)
    }
  }

  /** Get unit state by name. */
  state(unitName) {
    return this._units.get(unitName)?.state ?? null
  }

  /** Snapshot all unit states (shallow clone). */
  snapshot() {
    const units = {}
    for (const [name, unit] of this._units) {
      units[name] = unit.snapshotState()
    }
    return {
      tick: this.bus.tick,
      units,
      busLog: [...this.bus.log],
    }
  }
}

/**
 * UnitInstance — holds state tables and a list of compiled rules.
 *
 * Rules are provided as objects:
 *   { name, match, guard?, do: fn, matchAll? }
 *
 * match is an object: { topic, ...fieldPatterns }
 *   field values are either a literal (must equal) or a string starting with $
 *   (a binding variable).
 */
export class UnitInstance {
  constructor({ name, channels, rules, initialState = {} }) {
    this.name = name
    this.channels = channels
    this.state = this._buildState(initialState)
    this._rules = rules
  }

  /** Try to handle a message. Returns true if any rule fired. */
  handleMessage(msg, emit) {
    let anyFired = false
    for (const rule of this._rules) {
      const bindings = this._matchRule(rule, msg)
      if (bindings === null) continue
      if (rule.guard && !rule.guard(this.state, bindings)) continue

      rule.do(this.state, bindings, msg, emit)
      anyFired = true
      if (!rule.matchAll) return true  // non-matchAll rule: stop on first match
      // matchAll rule: continue checking remaining rules
    }
    return anyFired
  }

  /** Returns binding map or null if no match. */
  _matchRule(rule, msg) {
    const pattern = rule.match
    if (!this._topicMatches(pattern.topic, msg.topic)) return null

    const bindings = {}
    for (const [key, val] of Object.entries(pattern)) {
      if (key === 'topic') continue
      const msgVal = msg.payload[key]
      if (typeof val === 'string' && val.startsWith('$')) {
        bindings[val] = msgVal
      } else {
        if (msgVal !== val) return null
      }
    }
    return bindings
  }

  _topicMatches(pattern, topic) {
    if (pattern === topic) return true
    if (typeof pattern === 'string' && pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2)
      // Single level only: foo.bar.* matches foo.bar.X but not foo.bar.X.Y
      if (topic.startsWith(prefix + '.')) {
        const remainder = topic.slice(prefix.length + 1)
        return !remainder.includes('.')
      }
    }
    return false
  }

  _buildState(initial) {
    // State tables are plain objects with helper methods mixed in.
    // Each table key in initial is an array of rows.
    const state = {}
    for (const [tableName, rows] of Object.entries(initial)) {
      state[tableName] = this._makeTable(rows)
    }
    return state
  }

  _makeTable(initialRows = []) {
    const rows = [...initialRows]
    return {
      /** Single-row record accessor — returns the first (and only) row. */
      get() { return rows[0] ?? null },
      insert(row) { rows.push({ ...row }) },
      find(key) {
        // Key can be a value (matched against first column) or a predicate fn
        if (typeof key === 'function') return rows.find(key) ?? null
        return rows.find(r => Object.values(r)[0] === key) ?? null
      },
      delete(key) {
        const idx = typeof key === 'function'
          ? rows.findIndex(key)
          : rows.findIndex(r => Object.values(r)[0] === key)
        if (idx !== -1) rows.splice(idx, 1)
      },
      count() { return rows.length },
      clear() { rows.splice(0) },
      all() { return [...rows] },
      // Internal — used only by snapshotState; not part of the rules API
      _rows: rows,
    }
  }

  snapshotState() {
    const snap = {}
    for (const [key, table] of Object.entries(this.state)) {
      snap[key] = table._rows.map(r => ({ ...r }))
    }
    return snap
  }
}
