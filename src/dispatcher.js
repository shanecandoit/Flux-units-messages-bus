/**
 * Dispatcher — maps topic strings to matching units.
 *
 * Supports exact matches and single-level wildcard suffix: commerce.cart.*
 */
export class Dispatcher {
  constructor() {
    // Map<unit, Set<pattern>>
    this._subscriptions = new Map()
    // Compiled regex cache for wildcard patterns
    this._patternCache = new Map()
  }

  /** Register a unit as interested in a topic pattern. */
  subscribe(unit, pattern) {
    if (!this._subscriptions.has(unit)) {
      this._subscriptions.set(unit, new Set())
    }
    this._subscriptions.get(unit).add(pattern)
  }

  /** Register all channels from a unit declaration. */
  registerUnit(unit) {
    for (const pattern of unit.channels) {
      this.subscribe(unit, pattern)
    }
  }

  /** Return all units whose channel patterns match this topic. */
  match(topic) {
    const matched = []
    for (const [unit, patterns] of this._subscriptions) {
      for (const pattern of patterns) {
        if (this._matches(pattern, topic)) {
          matched.push(unit)
          break  // a unit only appears once even if multiple patterns match
        }
      }
    }
    return matched
  }

  _matches(pattern, topic) {
    if (pattern === topic) return true
    if (!pattern.includes('*')) return false

    if (!this._patternCache.has(pattern)) {
      // Convert 'foo.bar.*' → /^foo\.bar\.[^.]+$/
      const regexStr = '^' + pattern
        .split('.')
        .map(seg => seg === '*' ? '[^.]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\.') + '$'
      this._patternCache.set(pattern, new RegExp(regexStr))
    }

    return this._patternCache.get(pattern).test(topic)
  }

  /** All registered units. */
  get units() {
    return [...this._subscriptions.keys()]
  }
}
