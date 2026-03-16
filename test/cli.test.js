/**
 * CLI integration tests — spawn `node bin/flux.js <cmd>` as a subprocess and
 * verify stdout, exit code, and HTTP responses.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT    = join(__dirname, '..')
const FIXTURE = join(__dirname, 'fixtures', 'simple')
const FLUX    = join(ROOT, 'bin', 'flux.js')

function flux(...args) {
  return spawnSync(process.execPath, [FLUX, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15_000,
  })
}

// ── flux help ─────────────────────────────────────────────────────────────────

describe('flux help', () => {
  it('exits 0 and prints usage', () => {
    const r = flux('help')
    assert.equal(r.status, 0, r.stderr)
    assert.ok(r.stdout.includes('Usage:'))
    assert.ok(r.stdout.includes('flux run'))
    assert.ok(r.stdout.includes('flux scenario'))
    assert.ok(r.stdout.includes('flux check'))
  })

  it('unknown command exits 1 and mentions the command name', () => {
    const r = flux('totallymadeupcommand')
    assert.equal(r.status, 1)
    assert.ok(r.stderr.includes('totallymadeupcommand') || r.stdout.includes('totallymadeupcommand'))
  })
})

// ── flux check ────────────────────────────────────────────────────────────────

describe('flux check', () => {
  it('exits 0 and prints unit+topic count for a valid project', () => {
    const r = flux('check', FIXTURE)
    assert.equal(r.status, 0, r.stderr)
    assert.ok(r.stdout.includes('1 unit(s) OK'))
    assert.ok(r.stdout.includes('3 topic(s) registered'))
  })

  it('exits 0 with 0 units for an empty/missing directory', () => {
    // An empty path just means no units found — not an error condition
    const r = flux('check', '/tmp')
    assert.equal(r.status, 0, r.stderr)
    assert.ok(r.stdout.includes('0 unit(s) OK'))
  })
})

// ── flux scenario ─────────────────────────────────────────────────────────────

describe('flux scenario', () => {
  it('exits 0 and reports 1 passed scenario', () => {
    const r = flux('scenario', `--dir=${FIXTURE}`)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(r.stdout.includes('1 passed'))
    assert.ok(r.stdout.includes('Basic counter'))
  })

  it('exits 0 when name filter matches', () => {
    const r = flux('scenario', `--dir=${FIXTURE}`, 'Basic')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(r.stdout.includes('1 passed'))
  })

  it('exits 1 when name filter matches nothing', () => {
    const r = flux('scenario', `--dir=${FIXTURE}`, 'nonexistentScenarioXYZ')
    assert.equal(r.status, 1)
  })

  it('exits 1 when project directory has no units', () => {
    const r = flux('scenario', `--dir=${ROOT}`)  // root has no units/
    assert.equal(r.status, 1)
  })
})

// ── flux run + flux inject ────────────────────────────────────────────────────

describe('flux run (HTTP API)', () => {
  const PORT = 14_099  // test-only port, unlikely to conflict
  let server

  before(async () => {
    server = spawn(process.execPath, [FLUX, 'run', FIXTURE, `--port=${PORT}`], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Wait for the "listening" line on stdout
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('flux run did not start in time')), 10_000)
      server.stdout.on('data', chunk => {
        if (chunk.toString().includes('listening')) {
          clearTimeout(timeout)
          resolve()
        }
      })
      server.on('exit', code => {
        clearTimeout(timeout)
        reject(new Error(`flux run exited early with code ${code}`))
      })
    })
  })

  after(() => {
    server?.kill()
  })

  it('GET /state returns empty counter state', async () => {
    const res = await fetch(`http://localhost:${PORT}/state`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok('counter' in body)
    assert.equal(body.counter.totals[0].count, 0)
  })

  it('POST /inject increments the counter and returns bus entries', async () => {
    const res = await fetch(`http://localhost:${PORT}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'counter.increment', payload: { amount: 7 } }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(Array.isArray(body.entries))
    assert.equal(body.entries.length, 2)  // inject + counter.updated
    assert.equal(body.entries[1].topic, 'counter.updated')
  })

  it('GET /state reflects mutation from inject', async () => {
    const res = await fetch(`http://localhost:${PORT}/state`)
    const body = await res.json()
    assert.equal(body.counter.totals[0].count, 7)
  })

  it('GET /bus returns full log', async () => {
    const res = await fetch(`http://localhost:${PORT}/bus`)
    assert.equal(res.status, 200)
    const log = await res.json()
    assert.ok(Array.isArray(log))
    assert.ok(log.length >= 2)
  })

  it('POST /inject with missing topic returns 400', async () => {
    const res = await fetch(`http://localhost:${PORT}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: {} }),
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error)
  })

  it('GET /unknown returns 404', async () => {
    const res = await fetch(`http://localhost:${PORT}/notaroute`)
    assert.equal(res.status, 404)
  })

  it('OPTIONS returns 204 (CORS preflight)', async () => {
    const res = await fetch(`http://localhost:${PORT}/inject`, { method: 'OPTIONS' })
    assert.equal(res.status, 204)
  })
})

// ── Studio API (new routes) ────────────────────────────────────────────────────

describe('Studio API (HTTP)', () => {
  const PORT = 14_100
  let server

  before(async () => {
    server = spawn(process.execPath, [FLUX, 'run', FIXTURE, `--port=${PORT}`], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('flux run did not start')), 10_000)
      server.stdout.on('data', chunk => {
        if (chunk.toString().includes('listening')) { clearTimeout(timeout); resolve() }
      })
      server.on('exit', code => { clearTimeout(timeout); reject(new Error(`exited ${code}`)) })
    })
  })

  after(() => { server?.kill() })

  it('GET /units returns unit list with name, channels, rules, sourceFiles', async () => {
    const res = await fetch(`http://localhost:${PORT}/units`)
    assert.equal(res.status, 200)
    const units = await res.json()
    assert.ok(Array.isArray(units))
    assert.equal(units.length, 1)
    assert.equal(units[0].name, 'counter')
    assert.deepEqual(units[0].channels, ['counter.*'])
    assert.ok(Array.isArray(units[0].rules))
    assert.ok(units[0].rules.includes('increment'))
    assert.ok(Array.isArray(units[0].sourceFiles))
    assert.ok(units[0].sourceFiles[0].endsWith('counter.rules.js'))
  })

  it('GET /unit/counter/source returns JS source text', async () => {
    const res = await fetch(`http://localhost:${PORT}/unit/counter/source`)
    assert.equal(res.status, 200)
    const src = await res.text()
    assert.ok(src.includes('export function'))
  })

  it('GET /unit/nonexistent/source returns 404', async () => {
    const res = await fetch(`http://localhost:${PORT}/unit/nonexistent/source`)
    assert.equal(res.status, 404)
  })

  it('GET /scenarios returns scenario list', async () => {
    const res = await fetch(`http://localhost:${PORT}/scenarios`)
    assert.equal(res.status, 200)
    const list = await res.json()
    assert.ok(Array.isArray(list))
    assert.ok(list.length >= 1)
    assert.ok(list[0].name)
    assert.ok(list[0].filename.endsWith('.scenario.yaml') || list[0].filename.endsWith('.scenario.yml'))
  })

  it('POST /scenario/run returns results with step-level detail', async () => {
    const res = await fetch(`http://localhost:${PORT}/scenario/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body.results))
    assert.ok(body.results.length >= 1)
    const r = body.results[0]
    assert.ok('name' in r)
    assert.equal(r.passed, true)
    // step-level detail
    assert.ok(Array.isArray(r.steps))
    assert.ok(r.steps.length >= 1)
    assert.ok('description' in r.steps[0])
    assert.ok('passed' in r.steps[0])
    assert.ok(Array.isArray(r.steps[0].failures))
  })

  it('POST /scenario/run with name filter runs matching scenario', async () => {
    const res = await fetch(`http://localhost:${PORT}/scenario/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Basic counter' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.results.length, 1)
    assert.equal(body.results[0].name, 'Basic counter')
  })

  it('POST /scenarios requires filename and content', async () => {
    const res = await fetch(`http://localhost:${PORT}/scenarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'name: test' }),
    })
    assert.equal(res.status, 400)
  })

  it('POST /scenarios saves a file that then appears in GET /scenarios', async () => {
    const filename = 'test_autogenerated.scenario.yaml'
    const content = 'name: Auto-generated test scenario\nsteps: []\n'
    const saveRes = await fetch(`http://localhost:${PORT}/scenarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content }),
    })
    assert.equal(saveRes.status, 200)
    assert.equal((await saveRes.json()).ok, true)

    const listRes = await fetch(`http://localhost:${PORT}/scenarios`)
    const list = await listRes.json()
    assert.ok(list.some(s => s.filename === filename))
    assert.ok(list.some(s => s.name === 'Auto-generated test scenario'))
  })

  it('GET /checkpoint/:id returns 400 when no checkpoints.dir is configured', async () => {
    // The simple fixture has no checkpoints.dir — expect a clear error, not a crash
    const res = await fetch(`http://localhost:${PORT}/checkpoint/nonexistent`)
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error.includes('checkpoints'))
  })
})

// ── Studio API — checkpoint round-trip (ecommerce fixture has checkpoints dir) ──

describe('Studio API — checkpoint round-trip', () => {
  const PORT = 14_101
  const ECOMMERCE = join(__dirname, '..', 'examples', 'ecommerce')
  let server

  before(async () => {
    server = spawn(process.execPath, [FLUX, 'run', ECOMMERCE, `--port=${PORT}`], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('flux run did not start')), 10_000)
      server.stdout.on('data', chunk => {
        if (chunk.toString().includes('listening')) { clearTimeout(timeout); resolve() }
      })
      server.on('exit', code => { clearTimeout(timeout); reject(new Error(`exited ${code}`)) })
    })
  })

  after(() => { server?.kill() })

  it('GET /checkpoint/:id returns full checkpoint after save', async () => {
    // Inject a message so there is something worth checkpointing
    await fetch(`http://localhost:${PORT}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'commerce.cart.add', payload: { sku: 'widget', price: 9.99, qty: 1 } }),
    })

    // Save a named checkpoint
    const saveRes = await fetch(`http://localhost:${PORT}/checkpoint/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-cp' }),
    })
    assert.equal(saveRes.status, 200)
    const { id } = await saveRes.json()
    assert.ok(id)

    // Load it back via the new route
    const loadRes = await fetch(`http://localhost:${PORT}/checkpoint/${id}`)
    assert.equal(loadRes.status, 200)
    const cp = await loadRes.json()
    assert.equal(cp.id, id)
    assert.ok(Array.isArray(cp.bus_log))
    assert.ok(cp.bus_log.length >= 1)
    assert.ok(typeof cp.unit_hashes === 'object')
  })
})

// ── flux inject (standalone) ──────────────────────────────────────────────────

describe('flux inject (no runtime)', () => {
  it('exits 1 and prints helpful message when no runtime is listening', () => {
    // Use an obscure port that definitely has no runtime
    const r = flux('inject', 'counter.increment', '{"amount":1}', '--port=19998')
    assert.equal(r.status, 1)
    assert.ok(r.stderr.includes('connect') || r.stderr.includes('runtime') || r.stderr.includes('flux run'))
  })

  it('exits 1 when no topic provided', () => {
    const r = flux('inject')
    assert.equal(r.status, 1)
  })
})
