#!/usr/bin/env node
/**
 * Flux CLI
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(body, null, 2))
}

// ── Commands ──────────────────────────────────────────────────────────────────

const commands = {

  // ── flux run ───────────────────────────────────────────────────────────────
  async run() {
    const { flags, positional } = parseArgs(args)
    const dir = projectDir(positional)
    const port = Number(flags.port ?? RUNTIME_PORT)

    const { loadProject, createRuntime } = await import('../src/loader.js')
    const { buildCheckpoint, saveCheckpoint, loadCheckpoint, listCheckpoints, restoreCheckpoint } =
      await import('../src/checkpoint.js')

    console.log(`Loading project from ${dir}`)
    const { unitConfigs, config } = await loadProject(dir)

    if (unitConfigs.length === 0) {
      console.error('No unit files found. Create *.unit.yaml files in the units/ directory.')
      process.exit(1)
    }

    const rt = createRuntime(unitConfigs)
    console.log(`Loaded ${unitConfigs.length} unit(s): ${unitConfigs.map(u => u.name).join(', ')}`)

    // Resolve the checkpoints directory from config (null if not configured)
    const cpDir = config.checkpoints?.dir
      ? resolve(dir, config.checkpoints.dir)
      : null

    const server = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204); res.end(); return
      }

      // ── POST /inject ──────────────────────────────────────────────────────
      if (req.method === 'POST' && req.url === '/inject') {
        try {
          const body = await readBody(req)
          const { topic, payload = {} } = body
          if (!topic) { json(res, 400, { error: 'topic is required' }); return }

          const entries = rt.inject(topic, payload)
          console.log(`  → ${topic} (${entries.length} messages)`)

          // Auto-save a checkpoint after each quiescence if a directory is configured
          if (cpDir) {
            const cp = buildCheckpoint(rt)
            await saveCheckpoint(cp, cpDir)
          }

          json(res, 200, { ok: true, entries })
        } catch (e) {
          json(res, 400, { error: e.message })
        }
        return
      }

      // ── GET /state ────────────────────────────────────────────────────────
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
        json(res, 200, state)
        return
      }

      // ── GET /bus ──────────────────────────────────────────────────────────
      if (req.method === 'GET' && req.url === '/bus') {
        json(res, 200, rt.bus.log)
        return
      }

      // ── GET /checkpoints ──────────────────────────────────────────────────
      if (req.method === 'GET' && req.url === '/checkpoints') {
        if (!cpDir) { json(res, 400, { error: 'No checkpoints.dir configured' }); return }
        const list = await listCheckpoints(cpDir)
        json(res, 200, list.map(cp => ({
          id: cp.id, name: cp.name, timestamp: cp.timestamp,
          tick: cp.tick, merkle_root: cp.merkle_root,
        })))
        return
      }

      // ── POST /checkpoint/save ─────────────────────────────────────────────
      if (req.method === 'POST' && req.url === '/checkpoint/save') {
        if (!cpDir) { json(res, 400, { error: 'No checkpoints.dir configured' }); return }
        try {
          const body = await readBody(req)
          const cp = buildCheckpoint(rt, { name: body.name ?? null })
          const filePath = await saveCheckpoint(cp, cpDir)
          console.log(`  ✓ Checkpoint saved: ${cp.id}${cp.name ? ` (${cp.name})` : ''}`)
          json(res, 200, { ok: true, id: cp.id, name: cp.name, path: filePath })
        } catch (e) {
          json(res, 500, { error: e.message })
        }
        return
      }

      // ── POST /checkpoint/restore ──────────────────────────────────────────
      if (req.method === 'POST' && req.url === '/checkpoint/restore') {
        if (!cpDir) { json(res, 400, { error: 'No checkpoints.dir configured' }); return }
        try {
          const body = await readBody(req)
          if (!body.id) { json(res, 400, { error: 'id is required' }); return }
          const cp = await loadCheckpoint(body.id, cpDir)
          restoreCheckpoint(rt, cp)
          console.log(`  ✓ Restored to checkpoint ${cp.id} (tick ${cp.tick})`)
          json(res, 200, { ok: true, id: cp.id, tick: cp.tick })
        } catch (e) {
          json(res, 404, { error: e.message })
        }
        return
      }

      json(res, 404, { error: 'not found' })
    })

    server.listen(port, () => {
      console.log(`Runtime listening on http://localhost:${port}`)
      console.log('  POST /inject              { "topic": "...", "payload": {...} }')
      console.log('  GET  /state               current unit states')
      console.log('  GET  /bus                 full message log')
      if (cpDir) {
        console.log('  GET  /checkpoints         list saved checkpoints')
        console.log('  POST /checkpoint/save     { "name": "optional-name" }')
        console.log('  POST /checkpoint/restore  { "id": "<id-or-name>" }')
      }
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

    const req = await fetch(`http://localhost:${port}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, payload }),
    }).catch(() => null)

    if (!req) {
      console.error(`Could not connect to runtime on port ${port}. Is 'flux run' running?`)
      process.exit(1)
    }

    const data = await req.json()
    if (!req.ok) { console.error(`Error: ${data.error}`); process.exit(1) }

    console.log(`Injected: ${topic}`)
    for (const e of data.entries) {
      const cause = e.parentId != null ? ` ← #${e.parentId}` : ' (root)'
      console.log(`  [${e.id}] ${e.topic}${cause}`)
    }
  },

  // ── flux checkpoint <subcommand> ──────────────────────────────────────────
  async checkpoint() {
    const { flags, positional } = parseArgs(args)
    const [subCmd, ...subArgs] = positional
    const port = Number(flags.port ?? RUNTIME_PORT)

    const { listCheckpoints } = await import('../src/checkpoint.js')

    async function getCpDir() {
      if (flags.dir) return resolve(flags.dir)
      const { loadProject } = await import('../src/loader.js')
      const { config } = await loadProject(resolve(process.cwd()))
      if (!config.checkpoints?.dir) {
        throw new Error('No checkpoints.dir in flux.config.yaml — use --dir=<path>')
      }
      return resolve(process.cwd(), config.checkpoints.dir)
    }

    // ── flux checkpoint list ───────────────────────────────────────────────
    if (!subCmd || subCmd === 'list') {
      const cpDir = await getCpDir()
      const cps = await listCheckpoints(cpDir)
      if (cps.length === 0) { console.log('No checkpoints found in', cpDir); return }
      console.log(`${cps.length} checkpoint(s) in ${cpDir}:\n`)
      for (const cp of cps) {
        const label = cp.name ? ` "${cp.name}"` : ''
        console.log(`  ${cp.id}${label}`)
        console.log(`    tick: ${cp.tick}  time: ${cp.timestamp}  root: ${cp.merkle_root}`)
      }
      return
    }

    // ── flux checkpoint save [name] ────────────────────────────────────────
    if (subCmd === 'save') {
      const name = subArgs[0] ?? null
      const res = await fetch(`http://localhost:${port}/checkpoint/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).catch(() => null)
      if (!res) {
        console.error(`Could not connect to runtime on port ${port}. Is 'flux run' running?`)
        process.exit(1)
      }
      const data = await res.json()
      if (!res.ok) { console.error(`Error: ${data.error}`); process.exit(1) }
      const label = data.name ? ` "${data.name}"` : ''
      console.log(`✓ Checkpoint saved: ${data.id}${label}`)
      return
    }

    // ── flux checkpoint restore <id> ──────────────────────────────────────
    if (subCmd === 'restore') {
      const id = subArgs[0]
      if (!id) { console.error('Usage: flux checkpoint restore <id-or-name>'); process.exit(1) }
      const res = await fetch(`http://localhost:${port}/checkpoint/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => null)
      if (!res) {
        console.error(`Could not connect to runtime on port ${port}. Is 'flux run' running?`)
        process.exit(1)
      }
      const data = await res.json()
      if (!res.ok) { console.error(`Error: ${data.error}`); process.exit(1) }
      console.log(`✓ Runtime restored to checkpoint ${data.id} (tick ${data.tick})`)
      return
    }

    console.error(`Unknown checkpoint subcommand: ${subCmd}`)
    console.error('Usage: flux checkpoint [list|save|restore] ...')
    process.exit(1)
  },

  // ── flux diff <id1> <id2> ─────────────────────────────────────────────────
  async diff() {
    const { flags, positional } = parseArgs(args)
    const [id1, id2] = positional

    if (!id1 || !id2) {
      console.error('Usage: flux diff <id1> <id2> [--dir=<checkpoints-dir>]')
      process.exit(1)
    }

    const { loadProject } = await import('../src/loader.js')
    const { loadCheckpoint, diffCheckpoints } = await import('../src/checkpoint.js')

    let cpDir = flags.dir ? resolve(flags.dir) : null
    if (!cpDir) {
      const { config } = await loadProject(resolve(process.cwd()))
      if (!config.checkpoints?.dir) {
        console.error('No checkpoints.dir configured. Use --dir=<path>'); process.exit(1)
      }
      cpDir = resolve(process.cwd(), config.checkpoints.dir)
    }

    let a, b
    try { a = await loadCheckpoint(id1, cpDir) }
    catch (e) { console.error(e.message); process.exit(1) }
    try { b = await loadCheckpoint(id2, cpDir) }
    catch (e) { console.error(e.message); process.exit(1) }

    const diff = diffCheckpoints(a, b)

    console.log(`Diff: ${a.id}${a.name ? ` (${a.name})` : ''} → ${b.id}${b.name ? ` (${b.name})` : ''}`)
    console.log(`  tick delta:   ${diff.tick_delta}`)
    console.log(`  new messages: ${diff.new_messages.length}`)

    if (diff.unchanged_units.length > 0) {
      console.log(`\nUnchanged: ${diff.unchanged_units.join(', ')}`)
    }

    const changedNames = Object.keys(diff.changed_units)
    if (changedNames.length === 0) {
      console.log('\nNo unit state changes.')
    } else {
      console.log('\nChanged units:')
      for (const [unit, { from, to }] of Object.entries(diff.changed_units)) {
        console.log(`\n  ${unit}:`)
        const tableNames = new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})])
        for (const tableName of tableNames) {
          const rowsFrom = from?.[tableName] ?? []
          const rowsTo   = to?.[tableName]   ?? []
          if (JSON.stringify(rowsFrom) !== JSON.stringify(rowsTo)) {
            console.log(`    ${tableName}:`)
            console.log(`      before: ${JSON.stringify(rowsFrom)}`)
            console.log(`      after:  ${JSON.stringify(rowsTo)}`)
          }
        }
      }
    }

    if (diff.new_messages.length > 0) {
      console.log('\nNew messages:')
      for (const m of diff.new_messages) {
        const cause = m.parentId != null ? ` ← #${m.parentId}` : ' (root)'
        console.log(`  [${m.id}] ${m.topic}${cause}  ${JSON.stringify(m.payload)}`)
      }
    }
  },

  // ── flux replay <id> ──────────────────────────────────────────────────────
  async replay() {
    const { flags, positional } = parseArgs(args)
    const [id] = positional

    if (!id) {
      console.error('Usage: flux replay <id-or-name> [--dir=<checkpoints-dir>]')
      process.exit(1)
    }

    const { loadProject, createRuntime } = await import('../src/loader.js')
    const { loadCheckpoint, hash } = await import('../src/checkpoint.js')

    const projDir = resolve(process.cwd())
    const { unitConfigs, config } = await loadProject(projDir)

    let cpDir = flags.dir ? resolve(flags.dir) : null
    if (!cpDir) {
      if (!config.checkpoints?.dir) {
        console.error('No checkpoints.dir configured. Use --dir=<path>'); process.exit(1)
      }
      cpDir = resolve(projDir, config.checkpoints.dir)
    }

    let original
    try { original = await loadCheckpoint(id, cpDir) }
    catch (e) { console.error(e.message); process.exit(1) }

    console.log(`Replaying checkpoint ${original.id}${original.name ? ` (${original.name})` : ''} — tick ${original.tick}`)

    // Only re-inject root messages (parentId=null); rules re-derive the cascades
    const rootMessages = original.bus_log.filter(m => m.parentId === null)
    console.log(`  ${rootMessages.length} root message(s) to replay\n`)

    const rt = createRuntime(unitConfigs)
    for (const msg of rootMessages) {
      rt.inject(msg.topic, msg.payload)
    }

    // Compare final merkle roots
    const snap = rt.snapshot()
    const unitHashes = {}
    for (const [name, state] of Object.entries(snap.units)) {
      unitHashes[name] = hash(state)
    }
    const replayRoot = hash({ units: unitHashes, bus: hash(snap.busLog) })

    if (replayRoot === original.merkle_root) {
      console.log(`✓ Replay verified — merkle root matches (${replayRoot})`)
    } else {
      console.log('✗ Replay diverged!')
      console.log(`  original: ${original.merkle_root}`)
      console.log(`  replay:   ${replayRoot}`)
      process.exit(1)
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

    const { errors, warnings } = checkProject(unitConfigs, topics)

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
  flux run [dir]                     Load units and start the runtime (HTTP on :4001)
  flux inject <topic> [json]         Inject a message into a running runtime
  flux scenario [name]               Run scenarios (--dir=<path> to specify project dir)
  flux check [dir]                   Validate unit files and topic registry
  flux checkpoint [list]             List saved checkpoints
  flux checkpoint save [name]        Save current runtime state as a named checkpoint
  flux checkpoint restore <id>       Restore a running runtime to a saved checkpoint
  flux diff <id1> <id2>              Diff two checkpoints — state changes and new messages
  flux replay <id>                   Re-run root messages from a checkpoint; verify merkle root
  flux studio                        Start the Scenario Builder UI on :4000
  flux dev                           Start the studio (alias for flux studio)

Options:
  --port=N          Override default port (runtime: 4001, studio: 4000)
  --dir=<path>      Override checkpoints directory (for diff/replay/checkpoint commands)

Examples:
  flux run ./examples/ecommerce
  flux inject commerce.cart.add '{"sku":"widget","price":9.99,"qty":1}'
  flux checkpoint save after-promo
  flux checkpoint list
  flux checkpoint restore after-promo
  flux diff abc12345 def67890
  flux replay abc12345
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
