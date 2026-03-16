import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadProject, loadScenarioConfig } from '../src/loader.js'
import { runScenario, runAllScenarios, resolveField, formatResults } from '../src/scenario-runner.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, 'fixtures', 'simple')

// ── resolveField ──────────────────────────────────────────────────────────

describe('resolveField', () => {
  let rt

  // Build a small runtime to test against
  before_each_hack: {
    // We use a module-level setup instead of beforeEach since we only need one
  }

  it('resolves a record field', async () => {
    const { unitConfigs } = await loadProject(FIXTURE)
    const { createRuntime } = await import('../src/loader.js')
    const rt = createRuntime(unitConfigs)
    rt.inject('counter.increment', { amount: 42 })
    const val = resolveField(rt, 'counter.totals.count')
    assert.equal(val, 42)
  })

  it('resolves a full record (2-part path)', async () => {
    const { unitConfigs, createRuntime: cr } = await import('../src/loader.js')
    const { loadProject: lp } = await import('../src/loader.js')
    const { unitConfigs: uc } = await lp(FIXTURE)
    const { createRuntime } = await import('../src/loader.js')
    const rt = createRuntime(uc)
    const val = resolveField(rt, 'counter.totals')
    assert.ok(Array.isArray(val))
  })

  it('returns undefined for unknown unit', async () => {
    const { unitConfigs } = await loadProject(FIXTURE)
    const { createRuntime } = await import('../src/loader.js')
    const rt = createRuntime(unitConfigs)
    assert.equal(resolveField(rt, 'nonexistent.table.field'), undefined)
  })
})

// ── runScenario ───────────────────────────────────────────────────────────

describe('runScenario — basic counter', () => {
  let unitConfigs, scenarioConfigs

  const setup = async () => {
    const proj = await loadProject(FIXTURE)
    unitConfigs = proj.unitConfigs
    scenarioConfigs = proj.scenarioConfigs
  }

  it('all steps pass for the happy-path scenario', async () => {
    await setup()
    const result = await runScenario(scenarioConfigs[0], unitConfigs)
    assert.equal(result.passed, true, formatResults([result]))
    assert.equal(result.steps.length, 3)
    assert.ok(result.steps.every(s => s.passed))
  })

  it('returns step descriptions', async () => {
    await setup()
    const result = await runScenario(scenarioConfigs[0], unitConfigs)
    assert.equal(result.steps[0].description, 'Increment by 5')
  })

  it('includes bus entries per step', async () => {
    await setup()
    const result = await runScenario(scenarioConfigs[0], unitConfigs)
    // Each increment step should have 2 entries: inject + counter.updated
    assert.equal(result.steps[0].busEntries.length, 2)
    assert.equal(result.steps[0].busEntries[1].topic, 'counter.updated')
  })
})

describe('runScenario — assertion failures', () => {
  it('fails when expect value is wrong', async () => {
    const { unitConfigs } = await loadProject(FIXTURE)
    const sc = {
      name: 'failing',
      steps: [{
        description: 'wrong value',
        inject: { topic: 'counter.increment', payload: { amount: 5 } },
        expect: [{ field: 'counter.totals.count', op: 'equals', value: 99 }],
        mustNot: [],
        expectMessage: [],
      }],
    }
    const result = await runScenario(sc, unitConfigs)
    assert.equal(result.passed, false)
    assert.ok(result.steps[0].failures[0].includes('EXPECT'))
  })

  it('fails when must_not assertion passes', async () => {
    const { unitConfigs } = await loadProject(FIXTURE)
    const sc = {
      name: 'must-not-fail',
      steps: [{
        description: 'must_not catches wrong state',
        inject: { topic: 'counter.increment', payload: { amount: 5 } },
        expect: [],
        mustNot: [{ field: 'counter.totals.count', op: 'equals', value: 5 }],
        expectMessage: [],
      }],
    }
    const result = await runScenario(sc, unitConfigs)
    assert.equal(result.passed, false)
    assert.ok(result.steps[0].failures[0].includes('MUST NOT'))
  })

  it('fails when expected message not emitted', async () => {
    const { unitConfigs } = await loadProject(FIXTURE)
    const sc = {
      name: 'missing-message',
      steps: [{
        description: 'no such message',
        inject: { topic: 'counter.increment', payload: { amount: 1 } },
        expect: [],
        mustNot: [],
        expectMessage: [{ topic: 'counter.totally.fake', field: 'count', op: 'equals', value: 1 }],
      }],
    }
    const result = await runScenario(sc, unitConfigs)
    assert.equal(result.passed, false)
  })

  it('passes expect_message when correct message emitted', async () => {
    const { unitConfigs } = await loadProject(FIXTURE)
    const sc = {
      name: 'message-check',
      steps: [{
        description: 'counter.updated emitted with correct count',
        inject: { topic: 'counter.increment', payload: { amount: 7 } },
        expect: [],
        mustNot: [],
        expectMessage: [{ topic: 'counter.updated', field: 'count', op: 'equals', value: 7 }],
      }],
    }
    const result = await runScenario(sc, unitConfigs)
    assert.equal(result.passed, true, formatResults([result]))
  })
})

describe('runScenario — operators', () => {
  async function run(op, value, amount = 5) {
    const { unitConfigs } = await loadProject(FIXTURE)
    const sc = {
      name: 'op-test',
      steps: [{
        description: `op: ${op}`,
        inject: { topic: 'counter.increment', payload: { amount } },
        expect: [{ field: 'counter.totals.count', op, value }],
        mustNot: [],
        expectMessage: [],
      }],
    }
    return runScenario(sc, unitConfigs)
  }

  it('equals passes', async () => {
    const r = await run('equals', 5)
    assert.equal(r.passed, true)
  })

  it('not_equals passes when different', async () => {
    const r = await run('not_equals', 99)
    assert.equal(r.passed, true)
  })

  it('greater_than passes', async () => {
    const r = await run('greater_than', 4)
    assert.equal(r.passed, true)
  })

  it('less_than passes', async () => {
    const r = await run('less_than', 6)
    assert.equal(r.passed, true)
  })

  it('exists passes when field present', async () => {
    const r = await run('exists', undefined)
    assert.equal(r.passed, true)
  })

  it('not_exists fails when field is present', async () => {
    const r = await run('not_exists', undefined)
    assert.equal(r.passed, false)
  })
})

describe('runScenario — state isolation between runs', () => {
  it('each runScenario starts with fresh state', async () => {
    const { unitConfigs, scenarioConfigs } = await loadProject(FIXTURE)
    const r1 = await runScenario(scenarioConfigs[0], unitConfigs)
    const r2 = await runScenario(scenarioConfigs[0], unitConfigs)
    assert.equal(r1.passed, true)
    assert.equal(r2.passed, true)
  })
})

describe('runAllScenarios', () => {
  it('runs all scenarios and returns results array', async () => {
    const { unitConfigs, scenarioConfigs } = await loadProject(FIXTURE)
    const results = await runAllScenarios(scenarioConfigs, unitConfigs)
    assert.equal(results.length, 1)
    assert.equal(results[0].passed, true)
  })
})

describe('formatResults', () => {
  it('includes pass/fail summary line', async () => {
    const { unitConfigs, scenarioConfigs } = await loadProject(FIXTURE)
    const results = await runAllScenarios(scenarioConfigs, unitConfigs)
    const output = formatResults(results)
    assert.ok(output.includes('1 scenarios'))
    assert.ok(output.includes('1 passed'))
  })
})
