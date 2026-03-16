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
