#!/usr/bin/env node
/**
 * Flux CLI
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, writeFileSync } from 'node:fs'
import { join, extname, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RUNTIME_PORT = 4001

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml':  'text/yaml',
}

const [,, cmd = 'help', ...args] = process.argv

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const flags = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const [key, val] = a.slice(2).split('=')
      flags[key] = val ?? args[++i] ?? true
    } else {
      positional.push(a)
    }
  }
  return { flags, positional }
}

function projectDir(positional) {
  return resolve(positional[0] ?? process.cwd())
}

// ── Commands ──────────────────────────────────────────────────────────────────

const commands = {

  // ── flux run ───────────────────────────────────────────────────────────────
  async run() {
    const { flags, positional } = parseArgs(args)
    const dir = projectDir(positional)
    const port = Number(flags.port ?? RUNTIME_PORT)

    const { loadProject, createRuntime } = await import('../src/loader.js')

    console.log(`Loading project from ${dir}`)
    const { unitConfigs, topics } = await loadProject(dir)

    if (unitConfigs.length === 0) {
      console.error('No unit files found. Create *.unit.yaml files in the units/ directory.')
      process.exit(1)
    }

    const rt = createRuntime(unitConfigs)
    console.log(`Loaded ${unitConfigs.length} unit(s): ${unitConfigs.map(u => u.name).join(', ')}`)

    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (req.method === 'POST' && req.url === '/inject') {
        let body = ''
        req.on('data', d => { body += d })
        req.on('end', () => {
          try {
            const { topic, payload = {} } = JSON.parse(body)
            if (!topic) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: 'topic is required' }))
              return
            }
            const entries = rt.inject(topic, payload)
            console.log(`  → ${topic} (${entries.length} messages)`)
            res.writeHead(200)
            res.end(JSON.stringify({ ok: true, entries }))
          } catch (e) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        return
      }

      if (req.method === 'GET' && req.url === '/state') {
        const state = {}
        for (const name of unitConfigs.map(u => u.name)) {
          const unitState = rt.state(name)
          if (!unitState) continue
          state[name] = {}
          for (const [k, table] of Object.entries(unitState)) {
            state[name][k] = table.all ? table.all() : table
          }
        }
        res.writeHead(200)
        res.end(JSON.stringify(state, null, 2))
        return
      }

      if (req.method === 'GET' && req.url === '/bus') {
        res.writeHead(200)
        res.end(JSON.stringify(rt.bus.log, null, 2))
        return
      }

      res.writeHead(404)
      res.end(JSON.stringify({ error: 'not found' }))
    })

    server.listen(port, () => {
      console.log(`Runtime listening on http://localhost:${port}`)
      console.log('  POST /inject   { "topic": "...", "payload": {...} }')
      console.log('  GET  /state    current unit states')
      console.log('  GET  /bus      full message log')
      console.log('\nWaiting for messages. Press Ctrl+C to stop.')
    })
  },

  // ── flux inject ───────────────────────────────────────────────────────────
  async inject() {
    const { flags, positional } = parseArgs(args)
    const [topic, jsonArg] = positional
    const port = Number(flags.port ?? RUNTIME_PORT)

    if (!topic) {
      console.error('Usage: flux inject <topic> [json-payload]')
      process.exit(1)
    }

    let payload = {}
    if (jsonArg) {
      try { payload = JSON.parse(jsonArg) }
      catch (e) { console.error(`Invalid JSON payload: ${e.message}`); process.exit(1) }
    }

    const body = JSON.stringify({ topic, payload })
    const req = await fetch(`http://localhost:${port}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => null)

    if (!req) {
      console.error(`Could not connect to runtime on port ${port}. Is 'flux run' running?`)
      process.exit(1)
    }

    const data = await req.json()
    if (!req.ok) {
      console.error(`Error: ${data.error}`)
      process.exit(1)
    }

    console.log(`Injected: ${topic}`)
    for (const e of data.entries) {
      const cause = e.parentId != null ? ` ← #${e.parentId}` : ' (root)'
      console.log(`  [${e.id}] ${e.topic}${cause}`)
    }
  },

  // ── flux scenario ─────────────────────────────────────────────────────────
  async scenario() {
    const { flags, positional } = parseArgs(args)
    const dir = projectDir(flags.dir ? [flags.dir] : [])
    const filter = positional[0] ?? null

    const { loadProject } = await import('../src/loader.js')
    const { runAllScenarios, formatResults } = await import('../src/scenario-runner.js')

    const { unitConfigs, scenarioConfigs } = await loadProject(dir)

    if (unitConfigs.length === 0) {
      console.error('No units found.')
      process.exit(1)
    }

    const toRun = filter
      ? scenarioConfigs.filter(s =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.filePath?.includes(filter)
        )
      : scenarioConfigs

    if (toRun.length === 0) {
      console.error(filter ? `No scenarios matching '${filter}'` : 'No scenario files found.')
      process.exit(1)
    }

    console.log(`Running ${toRun.length} scenario(s)…`)
    const results = await runAllScenarios(toRun, unitConfigs)
    console.log(formatResults(results))

    const anyFailed = results.some(r => !r.passed)
    process.exit(anyFailed ? 1 : 0)
  },

  // ── flux check ────────────────────────────────────────────────────────────
  async check() {
    const { positional } = parseArgs(args)
    const dir = projectDir(positional)

    const { loadProject, checkProject } = await import('../src/loader.js')

    let unitConfigs, topics
    try {
      ;({ unitConfigs, topics } = await loadProject(dir))
    } catch (e) {
      console.error(`Load error: ${e.message}`)
      process.exit(1)
    }

    const { errors, warnings, ok } = checkProject(unitConfigs, topics)

    if (warnings.length > 0) {
      console.warn('Warnings:')
      warnings.forEach(w => console.warn(`  ⚠  ${w}`))
    }

    if (errors.length > 0) {
      console.error('Errors:')
      errors.forEach(e => console.error(`  ✗  ${e}`))
      process.exit(1)
    }

    const unitList = unitConfigs.map(u => u.name).join(', ')
    console.log(`✓ ${unitConfigs.length} unit(s) OK: ${unitList}`)
    console.log(`✓ ${Object.keys(topics).length} topic(s) registered`)
    if (warnings.length > 0) process.exit(0)
  },

  // ── flux studio ───────────────────────────────────────────────────────────
  studio() {
    const { flags } = parseArgs(args)
    const port = Number(flags.port ?? 4000)
    const studioDir = join(ROOT, 'studio')

    const server = createServer((req, res) => {
      let urlPath = req.url.split('?')[0]
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html'

      const filePath = join(studioDir, urlPath)
      if (!filePath.startsWith(studioDir)) {
        res.writeHead(403); res.end('Forbidden'); return
      }
      if (!existsSync(filePath)) {
        res.writeHead(404); res.end('Not found'); return
      }
      const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime })
      createReadStream(filePath).pipe(res)
    })

    server.listen(port, () => {
      console.log(`Flux Studio running at http://localhost:${port}`)
      console.log('Press Ctrl+C to stop.')
    })
  },

  // ── flux dev ─────────────────────────────────────────────────────────────
  dev() {
    console.log('flux dev — starting studio (use flux run in a separate terminal for the runtime)')
    commands.studio()
  },

  // ── flux help ─────────────────────────────────────────────────────────────
  help() {
    console.log(`
Flux — message-driven reactive programming runtime

Usage:
  flux run [dir]              Load units and start the runtime (HTTP API on :4001)
  flux inject <topic> [json]  Inject a message into a running runtime
  flux scenario [name]        Run scenarios (--dir=<path> to specify project dir)
  flux check [dir]            Validate unit files and topic registry
  flux studio                 Start the Scenario Builder UI on :4000
  flux dev                    Start the studio (alias)

Options:
  --port=N   Override default port

Examples:
  flux run
  flux run ./examples/ecommerce
  flux inject counter.increment '{"amount":5}'
  flux scenario
  flux scenario basic
  flux check
    `.trim())
  },
}

const fn = commands[cmd]
if (fn) {
  Promise.resolve(fn()).catch(e => { console.error(e.message); process.exit(1) })
} else {
  console.error(`Unknown command: ${cmd}`)
  commands.help()
  process.exit(1)
}
