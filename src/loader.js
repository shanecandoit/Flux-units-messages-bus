/**
 * Loader — reads a Flux project from disk.
 *
 * Returns unit configs (not instances) so that fresh UnitInstances can be
 * created per-scenario-run without re-parsing YAML or re-importing JS.
 *
 * Unit config shape:
 *   { name, channels, stateDecl, rules: [{ name, match, guard, do, matchAll }] }
 *
 * Usage:
 *   const { unitConfigs, topics } = await loadProject('./my-project')
 *   const runtime = createRuntime(unitConfigs)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load as parseYaml } from 'js-yaml'
import { Runtime, UnitInstance } from './runtime.js'

// ── Project loading ───────────────────────────────────────────────────────────

export async function loadProject(projectDir) {
  const configPath = join(projectDir, 'flux.config.yaml')
  const config = existsSync(configPath)
    ? (parseYaml(readFileSync(configPath, 'utf8')) ?? {})
    : {}

  const unitsDir   = join(projectDir, stripDotSlash(config.units?.dir   ?? 'units'))
  const topicsFile = join(projectDir, stripDotSlash(config.topics?.file ?? 'topics.flux.yaml'))
  const scenariosDir = join(projectDir, stripDotSlash(config.scenarios?.dir ?? 'scenarios'))

  const topics = existsSync(topicsFile)
    ? (parseYaml(readFileSync(topicsFile, 'utf8'))?.topics ?? {})
    : {}

  const unitConfigs = []
  if (existsSync(unitsDir)) {
    const files = readdirSync(unitsDir).filter(f => f.endsWith('.unit.yaml'))
    for (const file of files) {
      unitConfigs.push(await loadUnitConfig(join(unitsDir, file)))
    }
  }

  const scenarioConfigs = []
  if (existsSync(scenariosDir)) {
    const files = readdirSync(scenariosDir)
      .filter(f => f.endsWith('.scenario.yaml') || f.endsWith('.scenario.yml'))
    for (const file of files) {
      scenarioConfigs.push(loadScenarioConfig(join(scenariosDir, file)))
    }
  }

  return { unitConfigs, topics, scenarioConfigs, config }
}

// ── Unit config loading ───────────────────────────────────────────────────────

export async function loadUnitConfig(unitFilePath) {
  const yaml = parseYaml(readFileSync(unitFilePath, 'utf8'))
  const unitDir = dirname(unitFilePath)

  const rules = []
  for (const decl of yaml.rules ?? []) {
    rules.push(await compileRule(decl, unitDir))
  }

  return {
    name:      yaml.name,
    channels:  yaml.channels ?? [],
    stateDecl: yaml.state ?? {},
    rules,
  }
}

async function compileRule(decl, unitDir) {
  const doFn = await loadRuleFunction(decl.do, unitDir)
  const guardFn = decl.guard
    ? new Function('state', 'b', `return !!(${decl.guard})`)
    : null

  return {
    name:     decl.name,
    match:    decl.match ?? {},
    guard:    guardFn,
    do:       doFn,
    matchAll: decl.match_all ?? false,
  }
}

async function loadRuleFunction(doRef, unitDir) {
  if (!doRef) throw new Error(`Rule is missing 'do' field`)
  const hashIdx = doRef.lastIndexOf('#')
  if (hashIdx === -1) throw new Error(`Rule 'do' must be 'file.js#functionName', got: ${doRef}`)

  const fileRef = doRef.slice(0, hashIdx)
  const fnName  = doRef.slice(hashIdx + 1)
  const filePath = resolve(unitDir, fileRef)

  if (!existsSync(filePath)) throw new Error(`Rules file not found: ${filePath}`)

  const mod = await import(pathToFileURL(filePath).href)
  if (typeof mod[fnName] !== 'function') {
    throw new Error(`Function '${fnName}' not found in ${filePath}`)
  }
  return mod[fnName]
}

// ── State initialisation ──────────────────────────────────────────────────────

export function buildInitialState(stateDecl) {
  const initial = {}
  for (const [tableName, tableDef] of Object.entries(stateDecl)) {
    if (typeof tableDef !== 'object' || tableDef === null) continue
    if ('index' in tableDef) {
      // Multi-row table — start empty
      initial[tableName] = []
    } else {
      // Record (single row) — initialise with defaults
      const row = {}
      for (const [field, typeDef] of Object.entries(tableDef)) {
        if (field === 'index' || field === 'max_rows') continue
        row[field] = parseDefault(typeDef)
      }
      initial[tableName] = [row]
    }
  }
  return initial
}

function parseDefault(typeDef) {
  if (typeDef === null || typeDef === undefined) return null
  const str = String(typeDef)

  const m = str.match(/\bdefault\s+(\S+)/)
  if (m) return coerceValue(m[1])

  if (/\bnull\b/.test(str) && !/\bnot null\b/.test(str)) return null

  if (/\bf(32|64)\b|\bu(8|16|32|64)\b|\bi(8|16|32|64)\b/.test(str)) return 0
  if (/\bstring\b/.test(str)) return ''
  if (/\bbool\b/.test(str)) return false
  return null
}

function coerceValue(str) {
  if (str === 'null')  return null
  if (str === 'true')  return true
  if (str === 'false') return false
  const n = Number(str)
  return isNaN(n) ? str : n
}

// ── Runtime factory ───────────────────────────────────────────────────────────

/** Create a fresh Runtime with a fresh UnitInstance for each config. */
export function createRuntime(unitConfigs, opts = {}) {
  const rt = new Runtime(opts)
  for (const cfg of unitConfigs) {
    rt.addUnit(new UnitInstance({
      name:         cfg.name,
      channels:     cfg.channels,
      initialState: buildInitialState(cfg.stateDecl),
      rules:        cfg.rules,
    }))
  }
  return rt
}

// ── Scenario config loading ───────────────────────────────────────────────────

export function loadScenarioConfig(scenarioFilePath) {
  const yaml = parseYaml(readFileSync(scenarioFilePath, 'utf8'))
  return {
    name:            yaml.name ?? 'Unnamed scenario',
    description:     yaml.description ?? '',
    startCheckpoint: yaml.start_checkpoint ?? null,
    steps:           (yaml.steps ?? []).map(normaliseStep),
    filePath:        scenarioFilePath,
  }
}

function normaliseStep(step) {
  const { topic, ...payload } = step.inject ?? {}
  return {
    description:   step.description ?? '',
    inject:        { topic, payload },
    expect:        step.expect     ?? [],
    mustNot:       step.must_not   ?? [],
    expectMessage: step.expect_message ?? [],
  }
}

// ── Topic registry checks ─────────────────────────────────────────────────────

export function checkProject(unitConfigs, topics) {
  const errors = []
  const warnings = []
  const topicNames = new Set(Object.keys(topics))

  for (const cfg of unitConfigs) {
    for (const rule of cfg.rules) {
      const ruleTopic = rule.match?.topic
      if (!ruleTopic) {
        errors.push(`[${cfg.name}] Rule '${rule.name}' has no topic in match pattern`)
        continue
      }
      // Wildcard patterns can't be validated against the registry
      if (!ruleTopic.includes('*') && !topicNames.has(ruleTopic)) {
        warnings.push(`[${cfg.name}] Rule '${rule.name}' matches topic '${ruleTopic}' which is not in topics.flux.yaml`)
      }
    }

    for (const channel of cfg.channels) {
      if (!channel.includes('*') && !topicNames.has(channel)) {
        warnings.push(`[${cfg.name}] Channel '${channel}' is not in topics.flux.yaml`)
      }
    }
  }

  return { errors, warnings, ok: errors.length === 0 }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripDotSlash(p) {
  return p.replace(/^\.\//, '')
}
