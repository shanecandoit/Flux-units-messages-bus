/**
 * Scenario runner — executes scenario configs against a fresh runtime.
 *
 * Returns a ScenarioResult per scenario:
 *   { name, passed, steps: [StepResult] }
 *
 * StepResult:
 *   { description, passed, failures: string[], busEntries: BusEntry[] }
 */
import { createRuntime } from './loader.js'

// ── Public API ────────────────────────────────────────────────────────────────

export async function runScenario(scenarioConfig, unitConfigs) {
  const rt = createRuntime(unitConfigs)
  const stepResults = []

  for (const step of scenarioConfig.steps) {
    const before = rt.bus.log.length
    const busEntries = rt.inject(step.inject.topic, step.inject.payload ?? {})

    const failures = []

    for (const exp of step.expect) {
      const result = checkAssertion(rt, busEntries, exp)
      if (!result.ok) failures.push(`EXPECT ${formatAssertion(exp)}: ${result.reason}`)
    }

    for (const exp of step.mustNot) {
      const result = checkAssertion(rt, busEntries, exp)
      if (result.ok) failures.push(`MUST NOT ${formatAssertion(exp)}: assertion unexpectedly passed`)
    }

    for (const exp of step.expectMessage ?? []) {
      const result = checkMessageAssertion(busEntries, exp)
      if (!result.ok) failures.push(`EXPECT MESSAGE ${formatAssertion(exp)}: ${result.reason}`)
    }

    stepResults.push({
      description: step.description,
      passed:      failures.length === 0,
      failures,
      busEntries,
    })
  }

  const passed = stepResults.every(s => s.passed)
  return { name: scenarioConfig.name, passed, steps: stepResults }
}

export async function runAllScenarios(scenarioConfigs, unitConfigs) {
  const results = []
  for (const sc of scenarioConfigs) {
    results.push(await runScenario(sc, unitConfigs))
  }
  return results
}

// ── Field resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a dot-notation field path against runtime state.
 *
 * Patterns:
 *   unit.table          → table.all()   (multi-row)
 *   unit.record         → record.get()  (single row)
 *   unit.record.field   → record.get()[field]
 */
export function resolveField(runtime, fieldPath) {
  const parts = fieldPath.split('.')
  if (parts.length < 2) return undefined

  const [unitName, tableName, ...rest] = parts
  const state = runtime.state(unitName)
  if (!state) return undefined

  const table = state[tableName]
  if (!table) return undefined

  if (rest.length === 0) {
    // Return entire table as array, or record as object
    if (typeof table.all === 'function') return table.all()
    return table
  }

  const record = typeof table.get === 'function' ? table.get() : null
  if (!record) return undefined
  return rest.reduce((obj, key) => obj?.[key], record)
}

// ── Assertion checking ────────────────────────────────────────────────────────

function checkAssertion(runtime, busEntries, exp) {
  const value = resolveField(runtime, exp.field)
  return evaluate(value, exp.op, exp.value)
}

function checkMessageAssertion(busEntries, exp) {
  const matching = busEntries.filter(e => e.topic === exp.topic)
  if (matching.length === 0) {
    return { ok: false, reason: `no message with topic '${exp.topic}' was emitted` }
  }
  // Check that at least one matching message satisfies the field assertion
  for (const entry of matching) {
    const value = exp.field ? entry.payload[exp.field] : entry.payload
    const result = evaluate(value, exp.op, exp.value)
    if (result.ok) return { ok: true }
  }
  const actual = matching.map(e => JSON.stringify(e.payload)).join(', ')
  return { ok: false, reason: `found message(s) but field '${exp.field}' did not match. Got: ${actual}` }
}

function evaluate(actual, op, expected) {
  const exp = coerce(expected)

  switch (op) {
    case 'equals':
      if (actual == exp) return ok()
      return fail(`expected ${JSON.stringify(exp)}, got ${JSON.stringify(actual)}`)

    case 'not_equals':
      if (actual != exp) return ok()
      return fail(`expected value to not equal ${JSON.stringify(exp)}`)

    case 'greater_than':
      if (Number(actual) > Number(exp)) return ok()
      return fail(`expected ${actual} > ${exp}`)

    case 'less_than':
      if (Number(actual) < Number(exp)) return ok()
      return fail(`expected ${actual} < ${exp}`)

    case 'contains':
      if (Array.isArray(actual)) {
        const hit = actual.some(row =>
          Object.values(row)[0] == exp ||
          Object.values(row).some(v => v == exp)
        )
        if (hit) return ok()
        return fail(`array does not contain ${JSON.stringify(exp)}`)
      }
      if (typeof actual === 'string') {
        if (actual.includes(String(exp))) return ok()
        return fail(`"${actual}" does not contain "${exp}"`)
      }
      return fail(`cannot use 'contains' on ${typeof actual}`)

    case 'exists':
      if (actual !== null && actual !== undefined) return ok()
      return fail(`expected field to exist, got ${actual}`)

    case 'not_exists':
      if (actual === null || actual === undefined) return ok()
      return fail(`expected field to not exist, got ${JSON.stringify(actual)}`)

    default:
      return fail(`unknown operator '${op}'`)
  }
}

function coerce(val) {
  if (val === null || val === undefined) return null
  if (typeof val === 'number' || typeof val === 'boolean') return val
  const n = Number(val)
  return isNaN(n) ? val : n
}

const ok   = ()       => ({ ok: true })
const fail = reason   => ({ ok: false, reason })

// ── Formatting ────────────────────────────────────────────────────────────────

function formatAssertion(exp) {
  if (exp.op === 'exists' || exp.op === 'not_exists') {
    return `${exp.field} ${exp.op}`
  }
  return `${exp.field ?? exp.topic} ${exp.op} ${JSON.stringify(exp.value ?? exp.field)}`
}

export function formatResults(results) {
  const lines = []
  let totalPass = 0, totalFail = 0

  for (const sc of results) {
    const icon = sc.passed ? '✅' : '❌'
    lines.push(`\n${icon} ${sc.name}`)
    for (const step of sc.steps) {
      const stepIcon = step.passed ? '  ✓' : '  ✗'
      lines.push(`${stepIcon} ${step.description || '(no description)'}`)
      for (const f of step.failures) {
        lines.push(`      ${f}`)
      }
    }
    sc.passed ? totalPass++ : totalFail++
  }

  lines.push(`\n${totalPass + totalFail} scenarios — ${totalPass} passed, ${totalFail} failed`)
  return lines.join('\n')
}
