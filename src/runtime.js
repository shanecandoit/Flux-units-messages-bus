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

  /** Register a compiled unit instance. */
  addUnit(unit) {
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
        const fired = unit.handleMessage(msg, (topic, payload) => {
          emitted.push({ topic, payload, parentId: msg.id })
        })
        if (!fired) continue
        // match_all: continue to next unit even after firing
        if (!unit.isMatchAll(msg.topic)) {
          // default: first matching unit per topic wins
          // (units are ordered by registration; match_all units break this)
        }
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

  /** Try to handle a message. Returns true if a rule fired. */
  handleMessage(msg, emit) {
    for (const rule of this._rules) {
      const bindings = this._matchRule(rule, msg)
      if (bindings === null) continue
      if (rule.guard && !rule.guard(this.state, bindings)) continue

      rule.do(this.state, bindings, msg, emit)
      if (!rule.matchAll) return true
      // matchAll: keep going through rules, but mark as fired
    }
    return false
  }

  isMatchAll(topic) {
    return this._rules.some(r => r.matchAll && this._topicMatches(r.match.topic, topic))
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
      return topic === prefix || topic.startsWith(prefix + '.')
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
      _rows: rows,
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
    }
  }

  snapshotState() {
    const snap = {}
    for (const [key, val] of Object.entries(this.state)) {
      if (val && Array.isArray(val._rows)) {
        snap[key] = val._rows.map(r => ({ ...r }))
      } else {
        snap[key] = { ...val }
      }
    }
    return snap
  }
}
