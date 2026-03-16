/**
 * Runtime HTTP server — all route handlers for `flux run`.
 *
 * Extracted from bin/flux.js so the CLI entry point stays lean.
 * Export: createRuntimeServer(rt, { unitConfigs, cpDir, scenariosDir })
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { loadScenarioConfig } from './loader.js'
import {
  buildCheckpoint, saveCheckpoint, loadCheckpoint, listCheckpoints, restoreCheckpoint,
} from './checkpoint.js'
import { runAllScenarios } from './scenario-runner.js'

// ── Shared helpers ────────────────────────────────────────────────────────────

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

// ── Server factory ────────────────────────────────────────────────────────────

/**
 * @param {object}      rt
 * @param {object}      opts
 * @param {Array}       opts.unitConfigs
 * @param {string|null} opts.cpDir         Absolute path to checkpoints dir, or null
 * @param {string}      opts.scenariosDir  Absolute path to scenarios dir
 */
export function createRuntimeServer(rt, { unitConfigs, cpDir, scenariosDir }) {
  return createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    // ── POST /inject ────────────────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/inject') {
      try {
        const { topic, payload = {} } = await readBody(req)
        if (!topic) { json(res, 400, { error: 'topic is required' }); return }
        const entries = rt.inject(topic, payload)
        console.log(`  → ${topic} (${entries.length} messages)`)
        if (cpDir) { const cp = buildCheckpoint(rt); await saveCheckpoint(cp, cpDir) }
        json(res, 200, { ok: true, entries })
      } catch (e) { json(res, 400, { error: e.message }) }
      return
    }

    // ── GET /state ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/state') {
      const state = {}
      for (const { name } of unitConfigs) {
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

    // ── GET /bus ────────────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/bus') {
      json(res, 200, rt.bus.log); return
    }

    // ── GET /checkpoints ────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/checkpoints') {
      if (!cpDir) { json(res, 400, { error: 'No checkpoints.dir configured' }); return }
      const list = await listCheckpoints(cpDir)
      json(res, 200, list.map(cp => ({
        id: cp.id, name: cp.name, timestamp: cp.timestamp,
        tick: cp.tick, merkle_root: cp.merkle_root,
      })))
      return
    }

    // ── POST /checkpoint/save ───────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/checkpoint/save') {
      if (!cpDir) { json(res, 400, { error: 'No checkpoints.dir configured' }); return }
      try {
        const { name = null } = await readBody(req)
        const cp = buildCheckpoint(rt, { name })
        const filePath = await saveCheckpoint(cp, cpDir)
        console.log(`  ✓ Checkpoint saved: ${cp.id}${cp.name ? ` (${cp.name})` : ''}`)
        json(res, 200, { ok: true, id: cp.id, name: cp.name, path: filePath })
      } catch (e) { json(res, 500, { error: e.message }) }
      return
    }

    // ── POST /checkpoint/restore ────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/checkpoint/restore') {
      if (!cpDir) { json(res, 400, { error: 'No checkpoints.dir configured' }); return }
      try {
        const { id } = await readBody(req)
        if (!id) { json(res, 400, { error: 'id is required' }); return }
        const cp = await loadCheckpoint(id, cpDir)
        restoreCheckpoint(rt, cp)
        console.log(`  ✓ Restored to checkpoint ${cp.id} (tick ${cp.tick})`)
        json(res, 200, { ok: true, id: cp.id, tick: cp.tick })
      } catch (e) { json(res, 404, { error: e.message }) }
      return
    }

    // ── GET /checkpoint/:id  (full JSON for Studio QA view) ─────────────────
    const cpMatch = req.url.match(/^\/checkpoint\/([^/]+)$/)
    if (req.method === 'GET' && cpMatch && cpMatch[1] !== 'save' && cpMatch[1] !== 'restore') {
      if (!cpDir) { json(res, 400, { error: 'No checkpoints.dir configured' }); return }
      try {
        json(res, 200, await loadCheckpoint(decodeURIComponent(cpMatch[1]), cpDir))
      } catch (e) { json(res, 404, { error: e.message }) }
      return
    }

    // ── GET /units ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/units') {
      json(res, 200, unitConfigs.map(u => ({
        name:        u.name,
        channels:    u.channels,
        rules:       u.rules.map(r => r.name),
        sourceFiles: u.sourceFiles,
      })))
      return
    }

    // ── GET|PUT /unit/:name/source  (Studio Dev view) ───────────────────────
    const unitSourceMatch = req.url.match(/^\/unit\/([^/]+)\/source$/)
    if (unitSourceMatch) {
      const name = decodeURIComponent(unitSourceMatch[1])
      const cfg = unitConfigs.find(u => u.name === name)
      if (!cfg) { json(res, 404, { error: `Unit '${name}' not found` }); return }
      if (!cfg.sourceFiles.length) { json(res, 404, { error: `Unit '${name}' has no source files` }); return }
      const src = cfg.sourceFiles[0]

      if (req.method === 'GET') {
        try {
          res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
          res.end(readFileSync(src, 'utf8'))
        } catch (e) { json(res, 500, { error: e.message }) }
        return
      }
      if (req.method === 'PUT') {
        try {
          const raw = await new Promise((ok, fail) => {
            let s = ''; req.on('data', d => { s += d })
            req.on('end', () => ok(s)); req.on('error', fail)
          })
          writeFileSync(src, raw, 'utf8')
          json(res, 200, { ok: true })
        } catch (e) { json(res, 500, { error: e.message }) }
        return
      }
    }

    // ── GET /scenarios ──────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/scenarios') {
      try {
        const files = existsSync(scenariosDir)
          ? readdirSync(scenariosDir).filter(f => f.endsWith('.scenario.yaml') || f.endsWith('.scenario.yml'))
          : []
        json(res, 200, files.map(f => {
          try   { const sc = loadScenarioConfig(join(scenariosDir, f)); return { name: sc.name, filename: f } }
          catch { return { name: f, filename: f } }
        }))
      } catch (e) { json(res, 500, { error: e.message }) }
      return
    }

    // ── POST /scenarios ─────────────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/scenarios') {
      try {
        const { filename, content } = await readBody(req)
        if (!filename) { json(res, 400, { error: 'filename is required' }); return }
        if (!content)  { json(res, 400, { error: 'content is required' }); return }
        mkdirSync(scenariosDir, { recursive: true })
        const filePath = join(scenariosDir, filename)
        writeFileSync(filePath, content, 'utf8')
        json(res, 200, { ok: true, path: filePath })
      } catch (e) { json(res, 500, { error: e.message }) }
      return
    }

    // ── POST /scenario/run ──────────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/scenario/run') {
      try {
        const { name } = await readBody(req)
        const files = existsSync(scenariosDir)
          ? readdirSync(scenariosDir).filter(f => f.endsWith('.scenario.yaml') || f.endsWith('.scenario.yml'))
          : []
        let scenarios = files.map(f => loadScenarioConfig(join(scenariosDir, f)))
        if (name) scenarios = scenarios.filter(s => s.name === name)
        const results = await runAllScenarios(scenarios, unitConfigs)
        json(res, 200, {
          ok:      results.every(r => r.passed),
          results: results.map(r => ({
            name:   r.name,
            passed: r.passed,
            steps:  r.steps.map(s => ({
              description: s.description,
              passed:      s.passed,
              failures:    s.failures ?? [],
            })),
          })),
        })
      } catch (e) { json(res, 500, { error: e.message }) }
      return
    }

    json(res, 404, { error: 'not found' })
  })
}
