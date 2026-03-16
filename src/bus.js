/**
 * Bus — append-only message log.
 *
 * Every message on the bus has:
 *   id       : sequential integer
 *   tick     : which tick it was processed in
 *   parentId : id of the message that caused this one (null for injected)
 *   topic    : string
 *   payload  : arbitrary object
 *   ts       : wall-clock Date.now() — debugging only, never used in rules
 */
export class Bus {
  constructor() {
    this._log = []
    this._nextId = 0
    this._pending = []   // messages queued but not yet processed this tick
    this._tick = 0
    this._listeners = [] // callbacks notified on each append
  }

  /** Append a message to the log and return the entry. */
  append(topic, payload = {}, parentId = null) {
    const entry = {
      id: this._nextId++,
      tick: this._tick,
      parentId,
      topic,
      payload,
      ts: Date.now(),
    }
    this._log.push(entry)
    for (const fn of this._listeners) fn(entry)
    return entry
  }

  /** Queue a message for processing in the current tick. */
  inject(topic, payload = {}, parentId = null) {
    const entry = this.append(topic, payload, parentId)
    this._pending.push(entry)
    return entry
  }

  /** Drain and return all pending messages, then advance the tick. */
  drainPending() {
    const batch = this._pending.splice(0)
    this._tick++
    return batch
  }

  /** Returns true if there are messages waiting to be processed. */
  hasPending() {
    return this._pending.length > 0
  }

  /** Full ordered log (immutable view). */
  get log() {
    return this._log
  }

  get tick() {
    return this._tick
  }

  /** Register a listener called whenever a message is appended. */
  onAppend(fn) {
    this._listeners.push(fn)
  }

  /** Causal ancestors of a given message id (inclusive). */
  causalChain(id) {
    const byId = new Map(this._log.map(e => [e.id, e]))
    const chain = []
    let current = byId.get(id)
    while (current) {
      chain.unshift(current)
      current = current.parentId != null ? byId.get(current.parentId) : null
    }
    return chain
  }

  /** Restore from a serialised log (used by checkpoint restore). */
  restore(log, tick) {
    this._log = log.map(e => ({ ...e }))
    this._nextId = log.length > 0 ? log[log.length - 1].id + 1 : 0
    this._tick = tick
    this._pending = []
  }
}
