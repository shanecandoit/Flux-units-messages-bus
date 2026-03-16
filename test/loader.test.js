import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  loadProject,
  loadUnitConfig,
  buildInitialState,
  createRuntime,
  checkProject,
} from '../src/loader.js'

// ── temp-unit helper ──────────────────────────────────────────────────────────

const tmpDirs = []

function tempUnit(yaml, rulesJs = null) {
  const dir = mkdtempSync(join(tmpdir(), 'flux-loader-test-'))
  tmpDirs.push(dir)
  writeFileSync(join(dir, 'unit.unit.yaml'), yaml)
  if (rulesJs !== null) writeFileSync(join(dir, 'unit.rules.js'), rulesJs)
  return join(dir, 'unit.unit.yaml')
}

after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, 'fixtures', 'simple')

// ── buildInitialState ──────────────────────────────────────────────────────

describe('buildInitialState', () => {
  it('record with defaults becomes a single-element array', () => {
    const state = buildInitialState({
      totals: { count: 'u32 not null default 0', label: 'string(32) null' },
    })
    assert.equal(state.totals.length, 1)
    assert.equal(state.totals[0].count, 0)
    assert.equal(state.totals[0].label, null)
  })

  it('table with index starts empty', () => {
    const state = buildInitialState({
      items: { sku: 'string(32) not null', qty: 'u32 not null', index: 'sku' },
    })
    assert.deepEqual(state.items, [])
  })

  it('explicit default value overrides type default', () => {
    const state = buildInitialState({
      cfg: { threshold: 'f32 not null default 99.5' },
    })
    assert.equal(state.cfg[0].threshold, 99.5)
  })

  it('nullable field with no default gets null', () => {
    const state = buildInitialState({
      rec: { code: 'string(16) null' },
    })
    assert.equal(state.rec[0].code, null)
  })

  it('skips index and max_rows pseudo-fields', () => {
    const state = buildInitialState({
      items: { sku: 'string(32) not null', index: 'sku', max_rows: 100 },
    })
    // items has an index key → treated as table (empty)
    assert.deepEqual(state.items, [])
  })
})

// ── loadUnitConfig ──────────────────────────────────────────────────────────

describe('loadUnitConfig', () => {
  it('loads name, channels, stateDecl, and rules', async () => {
    const cfg = await loadUnitConfig(join(FIXTURE, 'units', 'counter.unit.yaml'))
    assert.equal(cfg.name, 'counter')
    assert.deepEqual(cfg.channels, ['counter.*'])
    assert.ok('totals' in cfg.stateDecl)
    assert.equal(cfg.rules.length, 2)
  })

  it('compiles guard string into a function', async () => {
    const cfg = await loadUnitConfig(join(FIXTURE, 'units', 'counter.unit.yaml'))
    const incrementRule = cfg.rules.find(r => r.name === 'increment')
    assert.equal(typeof incrementRule.guard, 'function')
  })

  it('guard function evaluates correctly', async () => {
    const cfg = await loadUnitConfig(join(FIXTURE, 'units', 'counter.unit.yaml'))
    const incrementRule = cfg.rules.find(r => r.name === 'increment')
    const rt = createRuntime([cfg])
    const state = rt.state('counter')

    // count=0 → guard passes
    assert.equal(incrementRule.guard(state, {}), true)

    // Manually set count to 1000 → guard fails
    state.totals.get().count = 1000
    assert.equal(incrementRule.guard(state, {}), false)
  })

  it('loads rule do-function as a function', async () => {
    const cfg = await loadUnitConfig(join(FIXTURE, 'units', 'counter.unit.yaml'))
    assert.equal(typeof cfg.rules[0].do, 'function')
    assert.equal(typeof cfg.rules[1].do, 'function')
  })

  it('match pattern is preserved verbatim', async () => {
    const cfg = await loadUnitConfig(join(FIXTURE, 'units', 'counter.unit.yaml'))
    const incrementRule = cfg.rules.find(r => r.name === 'increment')
    assert.equal(incrementRule.match.topic, 'counter.increment')
    assert.equal(incrementRule.match.amount, '$amount')
  })
})

// ── loadProject ─────────────────────────────────────────────────────────────

describe('loadProject', () => {
  it('loads unit configs, topics, and scenario configs', async () => {
    const { unitConfigs, topics, scenarioConfigs } = await loadProject(FIXTURE)
    assert.equal(unitConfigs.length, 1)
    assert.equal(unitConfigs[0].name, 'counter')
    assert.ok('counter.increment' in topics)
    assert.ok('counter.reset' in topics)
    assert.equal(scenarioConfigs.length, 1)
    assert.equal(scenarioConfigs[0].name, 'Basic counter')
  })

  it('scenario steps have normalised inject shape', async () => {
    const { scenarioConfigs } = await loadProject(FIXTURE)
    const step = scenarioConfigs[0].steps[0]
    assert.equal(step.inject.topic, 'counter.increment')
    assert.equal(step.inject.payload.amount, 5)
  })

  it('handles missing topics.flux.yaml gracefully', async () => {
    // Point at a dir with no topics file — should not throw
    const { topics } = await loadProject(join(FIXTURE, 'units'))
    assert.deepEqual(topics, {})
  })
})

// ── createRuntime ────────────────────────────────────────────────────────────

describe('createRuntime', () => {
  it('creates a working runtime from loaded configs', async () => {
    const { unitConfigs } = await loadProject(FIXTURE)
    const rt = createRuntime(unitConfigs)
    const entries = rt.inject('counter.increment', { amount: 7 })
    assert.equal(entries.length, 2)  // inject + counter.updated
    assert.equal(rt.state('counter').totals.get().count, 7)
  })

  it('each call returns an independent runtime (no shared state)', async () => {
    const { unitConfigs } = await loadProject(FIXTURE)
    const rt1 = createRuntime(unitConfigs)
    const rt2 = createRuntime(unitConfigs)
    rt1.inject('counter.increment', { amount: 10 })
    assert.equal(rt1.state('counter').totals.get().count, 10)
    assert.equal(rt2.state('counter').totals.get().count, 0)
  })
})

// ── checkProject ─────────────────────────────────────────────────────────────

describe('checkProject', () => {
  it('passes for a valid project', async () => {
    const { unitConfigs, topics } = await loadProject(FIXTURE)
    const result = checkProject(unitConfigs, topics)
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
  })

  it('warns about topics not in registry', () => {
    const cfg = [{
      name: 'x',
      channels: ['foo.bar'],
      stateDecl: {},
      rules: [{ name: 'r', match: { topic: 'foo.bar' }, guard: null, do: () => {}, matchAll: false }],
    }]
    const { warnings } = checkProject(cfg, {})
    assert.ok(warnings.some(w => w.includes('foo.bar')))
  })

  it('errors on rule with no topic in match', () => {
    const cfg = [{
      name: 'x',
      channels: [],
      stateDecl: {},
      rules: [{ name: 'bad', match: {}, guard: null, do: () => {}, matchAll: false }],
    }]
    const { errors, ok } = checkProject(cfg, {})
    assert.equal(ok, false)
    assert.ok(errors.some(e => e.includes('no topic')))
  })

  it('does not warn about wildcard channel patterns', () => {
    const cfg = [{
      name: 'x',
      channels: ['foo.*'],
      stateDecl: {},
      rules: [{ name: 'r', match: { topic: 'foo.*' }, guard: null, do: () => {}, matchAll: false }],
    }]
    const { warnings } = checkProject(cfg, {})
    assert.equal(warnings.length, 0)
  })

  it('errors on unit with no name', () => {
    const cfg = [{ name: undefined, channels: [], stateDecl: {}, rules: [] }]
    const { errors, ok } = checkProject(cfg, {})
    assert.equal(ok, false)
    assert.ok(errors.some(e => e.includes("missing a 'name'")))
  })

  it('errors on duplicate unit names', () => {
    const unit = { name: 'foo', channels: [], stateDecl: {}, rules: [] }
    const { errors, ok } = checkProject([unit, { ...unit }], {})
    assert.equal(ok, false)
    assert.ok(errors.some(e => e.includes("Duplicate unit name") && e.includes('foo')))
  })

  it('warns on rule with no name', () => {
    const cfg = [{
      name: 'x',
      channels: [],
      stateDecl: {},
      rules: [{ name: undefined, match: { topic: 'foo.bar' }, guard: null, do: () => {}, matchAll: false }],
    }]
    const { warnings } = checkProject(cfg, { 'foo.bar': {} })
    assert.ok(warnings.some(w => w.includes("missing a 'name'")))
  })

  it('warns on duplicate rule names within a unit', () => {
    const rule = { name: 'dup', match: { topic: 'foo.bar' }, guard: null, do: () => {}, matchAll: false }
    const cfg = [{ name: 'x', channels: [], stateDecl: {}, rules: [rule, { ...rule }] }]
    const { warnings } = checkProject(cfg, { 'foo.bar': {} })
    assert.ok(warnings.some(w => w.includes("Duplicate rule name") && w.includes('dup')))
  })
})

// ── loadUnitConfig — error paths ──────────────────────────────────────────────

describe('loadUnitConfig — error paths', () => {
  it('throws when a rule is missing its do field', async () => {
    const path = tempUnit(`
name: bad
channels: []
rules:
  - name: broken
    match: { topic: foo.bar }
`)
    await assert.rejects(
      () => loadUnitConfig(path),
      /missing 'do' field/,
    )
  })

  it('throws when do field has no # separator', async () => {
    const path = tempUnit(`
name: bad
channels: []
rules:
  - name: broken
    match: { topic: foo.bar }
    do: norule
`)
    await assert.rejects(
      () => loadUnitConfig(path),
      /file\.js#functionName/,
    )
  })

  it('throws when the rules file does not exist', async () => {
    const path = tempUnit(`
name: bad
channels: []
rules:
  - name: broken
    match: { topic: foo.bar }
    do: nonexistent.rules.js#fn
`)
    await assert.rejects(
      () => loadUnitConfig(path),
      /not found/,
    )
  })

  it('throws when the named function is not exported', async () => {
    const path = tempUnit(`
name: bad
channels: []
rules:
  - name: broken
    match: { topic: foo.bar }
    do: unit.rules.js#missingFn
`, `export function otherFn() {}`)
    await assert.rejects(
      () => loadUnitConfig(path),
      /missingFn.*not found/,
    )
  })

  it('throws when guard is not a string', async () => {
    const path = tempUnit(`
name: bad
channels: []
rules:
  - name: broken
    match: { topic: foo.bar }
    guard: true
    do: unit.rules.js#fn
`, `export function fn() {}`)
    await assert.rejects(
      () => loadUnitConfig(path),
      /guard must be a JS expression string/,
    )
  })
})
