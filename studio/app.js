/**
 * Flux Studio — BA Scenario Builder
 *
 * Self-contained vanilla JS. No build step, no dependencies.
 * Works from file:// or served by the CLI's static server.
 */

// ── State ──────────────────────────────────────────────────────────────────

const OPERATORS = ['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'exists', 'not_exists']

const DEFAULT_TOPICS = [
  'commerce.cart.add',
  'commerce.cart.coupon_applied',
  'commerce.checkout.submit',
  'commerce.cart.updated',
  'commerce.checkout.complete',
  'commerce.inventory.reserve',
  'game.tick',
  'game.input',
]

let state = {
  scenarios: [],
  activeScenarioId: null,
  activeStepIdx: null,
  topics: [...DEFAULT_TOPICS],
}

function activeScenario() {
  return state.scenarios.find(s => s.id === state.activeScenarioId) ?? null
}

function newId() {
  return Math.random().toString(36).slice(2, 9)
}

function newScenario(name = 'Untitled scenario') {
  return {
    id: newId(),
    name,
    description: '',
    startCheckpoint: '',
    steps: [],
    createdAt: new Date().toISOString(),
  }
}

function newStep() {
  return {
    id: newId(),
    description: '',
    inject: { topic: '', payload: '{}' },
    expect: [],
    mustNot: [],
    verdict: null,    // null | 'good' | 'bad'
    wantState: '',
    badNote: '',
  }
}

function newExpectation() {
  return { id: newId(), field: '', op: 'equals', value: '' }
}

// ── Persistence ────────────────────────────────────────────────────────────

function saveToLocalStorage() {
  try {
    localStorage.setItem('flux_studio_state', JSON.stringify(state))
  } catch (_) {}
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem('flux_studio_state')
    if (raw) {
      const loaded = JSON.parse(raw)
      state = { ...state, ...loaded }
    }
  } catch (_) {}
}

// ── YAML serialisation ─────────────────────────────────────────────────────

function scenarioToYaml(scenario) {
  const lines = []
  lines.push(`name: ${yamlStr(scenario.name)}`)
  if (scenario.description) {
    lines.push(`description: |`)
    lines.push(`  ${scenario.description.replace(/\n/g, '\n  ')}`)
  }
  if (scenario.startCheckpoint) {
    lines.push(`start_checkpoint: ${yamlStr(scenario.startCheckpoint)}`)
  }
  lines.push('')
  lines.push('steps:')

  for (const step of scenario.steps) {
    lines.push('')
    lines.push(`  - description: ${yamlStr(step.description || '(no description)')}`)

    // inject
    lines.push('    inject:')
    lines.push(`      topic: ${yamlStr(step.inject.topic || '(no topic)')}`)
    try {
      const payload = JSON.parse(step.inject.payload || '{}')
      for (const [k, v] of Object.entries(payload)) {
        lines.push(`      ${k}: ${yamlVal(v)}`)
      }
    } catch (_) {
      lines.push(`      # invalid JSON payload`)
    }

    // expect
    if (step.expect.length > 0) {
      lines.push('    expect:')
      for (const e of step.expect) {
        if (!e.field) continue
        lines.push(`      - field: ${yamlStr(e.field)}`)
        lines.push(`        op: ${e.op}`)
        if (e.op !== 'exists' && e.op !== 'not_exists') {
          lines.push(`        value: ${yamlVal(e.value)}`)
        }
      }
    }

    // must_not
    if (step.mustNot.length > 0) {
      lines.push('    must_not:')
      for (const e of step.mustNot) {
        if (!e.field) continue
        lines.push(`      - field: ${yamlStr(e.field)}`)
        lines.push(`        op: ${e.op}`)
        if (e.op !== 'exists' && e.op !== 'not_exists') {
          lines.push(`        value: ${yamlVal(e.value)}`)
        }
      }
    }

    // verdict
    if (step.verdict === 'bad' && (step.wantState || step.badNote)) {
      lines.push('    # QA defect')
      if (step.badNote) lines.push(`    # note: ${step.badNote}`)
      if (step.wantState) {
        lines.push('    want_state:')
        step.wantState.split('\n').forEach(l => l && lines.push(`      ${l}`))
      }
    }
  }

  return lines.join('\n')
}

function yamlStr(s) {
  if (/[:#\[\]{},&*?|<>=!%@`'"]/.test(s) || s.includes('\n')) {
    return `"${s.replace(/"/g, '\\"')}"`
  }
  return s || '""'
}

function yamlVal(v) {
  if (v === null || v === undefined || v === '') return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'string') {
    const n = Number(v)
    if (!isNaN(n) && v.trim() !== '') return v
    return yamlStr(v)
  }
  return JSON.stringify(v)
}

// ── Syntax-highlighted YAML ────────────────────────────────────────────────

function highlightYaml(yaml) {
  return yaml
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split('\n')
    .map(line => {
      // Comment lines
      if (/^\s*#/.test(line)) {
        return `<span style="color:var(--text-dim)">${line}</span>`
      }
      // Key: value
      return line.replace(/^(\s*)([\w_-]+)(:)(.*)$/, (_, indent, key, colon, rest) => {
        const restHl = rest
          .replace(/"([^"]*)"/, '<span class="yaml-string">"$1"</span>')
          .replace(/\b(\d+\.?\d*)\b/, '<span class="yaml-number">$1</span>')
          .replace(/\bnull\b/, '<span class="yaml-null">null</span>')
          .replace(/\b(true|false)\b/, '<span class="yaml-number">$1</span>')
        return `${indent}<span class="yaml-key">${key}</span>${colon}${restHl}`
      })
    })
    .join('\n')
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  renderSidebar()
  renderMain()
  renderDetail()
}

function renderSidebar() {
  const list = document.getElementById('scenario-list')
  if (state.scenarios.length === 0) {
    list.innerHTML = `<div style="padding:20px 12px;color:var(--text-dim);font-size:12px">No scenarios yet.<br>Click + to create one.</div>`
    return
  }

  list.innerHTML = state.scenarios.map(s => {
    const stepCount = s.steps.length
    const bads = s.steps.filter(st => st.verdict === 'bad').length
    const goods = s.steps.filter(st => st.verdict === 'good').length
    const isActive = s.id === state.activeScenarioId

    let badge = ''
    if (stepCount === 0) {
      badge = '<span class="badge badge-draft">draft</span>'
    } else if (bads > 0) {
      badge = `<span class="badge badge-fail">${bads} bad</span>`
    } else if (goods === stepCount) {
      badge = `<span class="badge badge-pass">pass</span>`
    } else {
      badge = `<span class="badge badge-draft">${stepCount} steps</span>`
    }

    return `
      <div class="scenario-item ${isActive ? 'active' : ''}" data-id="${s.id}" onclick="selectScenario('${s.id}')">
        <div class="scenario-item-name">${escHtml(s.name)}${badge}</div>
        <div class="scenario-item-meta">${stepCount} step${stepCount !== 1 ? 's' : ''}</div>
      </div>`
  }).join('')
}

function renderMain() {
  const sc = activeScenario()

  if (!sc) {
    document.getElementById('main-content').innerHTML = `
      <div class="main-toolbar">
        <span style="color:var(--text-dim);font-size:13px">Select or create a scenario</span>
      </div>
      <div class="steps-container">
        <div class="empty-state">
          <h3>No scenario selected</h3>
          <p>Create a new scenario with the + button in the sidebar,<br>or select one to start editing.</p>
        </div>
      </div>`
    return
  }

  const stepsHtml = sc.steps.length === 0
    ? `<div class="empty-state"><h3>No steps yet</h3><p>Click "Add step" below to describe the first action.</p></div>`
    : sc.steps.map((step, i) => renderStep(step, i)).join('')

  document.getElementById('main-content').innerHTML = `
    <div class="main-toolbar">
      <input class="scenario-name-input" id="scenario-name" value="${escAttr(sc.name)}"
        placeholder="Scenario name…" oninput="updateScenarioName(this.value)">
      <button class="btn btn-secondary" onclick="exportYaml()">Export YAML</button>
      <button class="btn btn-danger btn-icon" onclick="deleteScenario()" title="Delete scenario">✕</button>
    </div>
    <div class="steps-container" id="steps-container">
      ${stepsHtml}
      <div class="add-step-area" onclick="addStep()">+ Add step</div>
    </div>`
}

function renderStep(step, idx) {
  const isOpen = state.activeStepIdx === idx
  const topicOptions = state.topics.map(t =>
    `<option value="${escAttr(t)}" ${t === step.inject.topic ? 'selected' : ''}>${escHtml(t)}</option>`
  ).join('')

  const expectRows = (arr, type) => arr.map((e, ei) => `
    <div class="expect-row">
      <input type="text" value="${escAttr(e.field)}" placeholder="field path e.g. cart.totals.subtotal"
        oninput="updateExpect('${type}',${idx},${ei},'field',this.value)">
      <select onchange="updateExpect('${type}',${idx},${ei},'op',this.value)">
        ${OPERATORS.map(op => `<option value="${op}" ${op === e.op ? 'selected' : ''}>${op}</option>`).join('')}
      </select>
      <input type="text" value="${escAttr(e.value)}" placeholder="expected value"
        oninput="updateExpect('${type}',${idx},${ei},'value',this.value)"
        ${e.op === 'exists' || e.op === 'not_exists' ? 'disabled style="opacity:0.4"' : ''}>
      <button class="remove-btn" onclick="removeExpect('${type}',${idx},${ei})">×</button>
    </div>`).join('')

  const verdictGoodSel = step.verdict === 'good' ? 'selected' : ''
  const verdictBadSel = step.verdict === 'bad' ? 'selected' : ''
  const wantStateVisible = step.verdict === 'bad' ? 'block' : 'none'

  let payloadError = ''
  try { JSON.parse(step.inject.payload || '{}') } catch (e) {
    payloadError = `<div class="payload-error">⚠ ${escHtml(e.message)}</div>`
  }

  const statusIcon = step.verdict === 'good' ? '✅' : step.verdict === 'bad' ? '❌' : '○'

  return `
    <div class="step-card ${isOpen ? 'active' : ''}" id="step-${idx}">
      <div class="step-header" onclick="toggleStep(${idx})">
        <div class="step-number">${idx + 1}</div>
        <div class="step-desc ${step.description ? '' : 'step-desc-placeholder'}">
          ${step.description ? escHtml(step.description) : 'Describe this step…'}
        </div>
        <div style="font-size:11px;color:var(--text-dim)">${escHtml(step.inject.topic || '—')}</div>
        <div class="step-status-icon">${statusIcon}</div>
      </div>
      <div class="step-body ${isOpen ? 'open' : ''}">

        <div class="field-row">
          <div class="field-label">Description</div>
          <input type="text" value="${escAttr(step.description)}" placeholder="What does the user do?"
            oninput="updateStep(${idx},'description',this.value)">
        </div>

        <div class="field-row">
          <div class="field-label">Topic</div>
          <select onchange="updateStepTopic(${idx},this.value)">
            <option value="">— select topic —</option>
            ${topicOptions}
            <option value="__custom">Custom…</option>
          </select>
        </div>
        ${step.inject.topic && !state.topics.includes(step.inject.topic) ? `
        <div class="field-row">
          <div class="field-label"></div>
          <input type="text" value="${escAttr(step.inject.topic)}" placeholder="Custom topic"
            oninput="updateStep(${idx},'inject.topic',this.value)">
        </div>` : ''}

        <div class="field-row">
          <div class="field-label">Payload</div>
          <div style="flex:1">
            <div class="payload-editor">
              <textarea oninput="updateStep(${idx},'inject.payload',this.value)"
                placeholder='{"sku":"widget-blue","price":9.99,"qty":1}'>${escHtml(step.inject.payload)}</textarea>
            </div>
            ${payloadError}
          </div>
        </div>

        <div class="section-title">Expect (all must pass)</div>
        <div class="expect-list" id="expect-${idx}">
          ${expectRows(step.expect, 'expect')}
        </div>
        <button class="add-link" onclick="addExpect('expect',${idx})">+ Add expectation</button>

        <div class="section-title">Must not (any failing = defect)</div>
        <div class="expect-list" id="mustnot-${idx}">
          ${expectRows(step.mustNot, 'mustNot')}
        </div>
        <button class="add-link" onclick="addExpect('mustNot',${idx})">+ Add must-not</button>

        <div class="section-title">Verdict</div>
        <div class="verdict-row">
          <button class="verdict-btn verdict-good ${verdictGoodSel}"
            onclick="setVerdict(${idx},'good')">✅ GOOD — transition is correct</button>
          <button class="verdict-btn verdict-bad ${verdictBadSel}"
            onclick="setVerdict(${idx},'bad')">❌ BAD — something is wrong</button>
        </div>
        <div class="want-state-box" id="want-box-${idx}" style="display:${wantStateVisible}">
          <label>Describe the correct state (field: value, one per line)</label>
          <textarea placeholder="cart.totals.subtotal: 8.99&#10;cart.totals.coupon: SAVE10"
            oninput="updateStep(${idx},'wantState',this.value)">${escHtml(step.wantState)}</textarea>
          <label style="margin-top:8px">Note for developer</label>
          <input type="text" value="${escAttr(step.badNote)}" placeholder="What went wrong?"
            oninput="updateStep(${idx},'badNote',this.value)">
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:12px">
          <button class="btn btn-danger" onclick="removeStep(${idx})">Remove step</button>
        </div>
      </div>
    </div>`
}

function renderDetail() {
  const sc = activeScenario()
  const body = document.getElementById('detail-body')
  if (!sc) {
    body.innerHTML = `<p style="color:var(--text-dim);font-size:13px">Select a scenario to see its YAML preview.</p>`
    return
  }
  const yaml = scenarioToYaml(sc)
  body.innerHTML = `<pre class="yaml-preview">${highlightYaml(yaml)}</pre>`
}

// ── Actions ────────────────────────────────────────────────────────────────

window.selectScenario = function(id) {
  state.activeScenarioId = id
  state.activeStepIdx = null
  render()
}

window.addScenario = function() {
  const sc = newScenario()
  state.scenarios.push(sc)
  state.activeScenarioId = sc.id
  state.activeStepIdx = null
  saveToLocalStorage()
  render()
}

window.deleteScenario = function() {
  if (!confirm('Delete this scenario?')) return
  state.scenarios = state.scenarios.filter(s => s.id !== state.activeScenarioId)
  state.activeScenarioId = state.scenarios[0]?.id ?? null
  state.activeStepIdx = null
  saveToLocalStorage()
  render()
}

window.updateScenarioName = function(val) {
  const sc = activeScenario()
  if (!sc) return
  sc.name = val
  saveToLocalStorage()
  renderSidebar()
  renderDetail()
}

window.addStep = function() {
  const sc = activeScenario()
  if (!sc) return
  const step = newStep()
  sc.steps.push(step)
  state.activeStepIdx = sc.steps.length - 1
  saveToLocalStorage()
  renderMain()
  renderDetail()
  // Scroll new step into view
  setTimeout(() => {
    const el = document.getElementById(`step-${state.activeStepIdx}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, 50)
}

window.removeStep = function(idx) {
  const sc = activeScenario()
  if (!sc) return
  sc.steps.splice(idx, 1)
  state.activeStepIdx = null
  saveToLocalStorage()
  renderMain()
  renderDetail()
}

window.toggleStep = function(idx) {
  state.activeStepIdx = state.activeStepIdx === idx ? null : idx
  renderMain()
}

window.updateStep = function(idx, path, val) {
  const sc = activeScenario()
  if (!sc) return
  const step = sc.steps[idx]
  if (path.includes('.')) {
    const [a, b] = path.split('.')
    step[a][b] = val
  } else {
    step[path] = val
  }
  saveToLocalStorage()
  renderDetail()
  // Re-render the step card header (description + payload error)
  const card = document.getElementById(`step-${idx}`)
  if (card) {
    const header = card.querySelector('.step-desc')
    if (header) {
      header.textContent = step.description || 'Describe this step…'
      header.classList.toggle('step-desc-placeholder', !step.description)
    }
  }
}

window.updateStepTopic = function(idx, val) {
  if (val === '__custom') {
    updateStep(idx, 'inject.topic', '')
  } else {
    updateStep(idx, 'inject.topic', val)
  }
  renderMain()
  renderDetail()
}

window.addExpect = function(type, stepIdx) {
  const sc = activeScenario()
  if (!sc) return
  const step = sc.steps[stepIdx]
  const arr = type === 'expect' ? step.expect : step.mustNot
  arr.push(newExpectation())
  saveToLocalStorage()
  renderMain()
  renderDetail()
}

window.removeExpect = function(type, stepIdx, expectIdx) {
  const sc = activeScenario()
  if (!sc) return
  const step = sc.steps[stepIdx]
  const arr = type === 'expect' ? step.expect : step.mustNot
  arr.splice(expectIdx, 1)
  saveToLocalStorage()
  renderMain()
  renderDetail()
}

window.updateExpect = function(type, stepIdx, expectIdx, field, val) {
  const sc = activeScenario()
  if (!sc) return
  const step = sc.steps[stepIdx]
  const arr = type === 'expect' ? step.expect : step.mustNot
  arr[expectIdx][field] = val
  saveToLocalStorage()
  renderDetail()
}

window.setVerdict = function(idx, verdict) {
  const sc = activeScenario()
  if (!sc) return
  const step = sc.steps[idx]
  step.verdict = step.verdict === verdict ? null : verdict
  saveToLocalStorage()
  renderSidebar()
  renderMain()
  renderDetail()
}

window.exportYaml = function() {
  const sc = activeScenario()
  if (!sc) return
  const yaml = scenarioToYaml(sc)
  const blob = new Blob([yaml], { type: 'text/yaml' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${sc.name.replace(/\s+/g, '_').toLowerCase()}.scenario.yaml`
  a.click()
  URL.revokeObjectURL(a.href)
  showToast('Scenario exported', 'success')
}

window.copyYaml = function() {
  const sc = activeScenario()
  if (!sc) return
  const yaml = scenarioToYaml(sc)
  navigator.clipboard.writeText(yaml).then(() => showToast('Copied to clipboard', 'success'))
}

window.importYamlFile = function() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.yaml,.yml'
  input.onchange = e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      showToast(`Loaded ${file.name} — YAML import not yet implemented in this preview`, 'error')
    }
    reader.readAsText(file)
  }
  input.click()
}

window.addCustomTopic = function() {
  const t = prompt('Enter custom topic (e.g. my.domain.event):')
  if (t && t.trim()) {
    state.topics.push(t.trim())
    saveToLocalStorage()
    renderMain()
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────

function showToast(msg, type = '') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = `toast ${type} show`
  clearTimeout(el._timer)
  el._timer = setTimeout(() => { el.className = 'toast' }, 2800)
}

// ── Utils ──────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ── Boot ───────────────────────────────────────────────────────────────────

loadFromLocalStorage()

// Seed with a demo scenario if empty
if (state.scenarios.length === 0) {
  const demo = newScenario('Promo code — 10% off')
  demo.description = 'Loyalty member applies SAVE10 to a cart with one item.\nTotal should reflect 10% discount before checkout.'
  demo.startCheckpoint = 'empty_cart'

  const s1 = newStep()
  s1.description = 'Customer adds blue widget'
  s1.inject.topic = 'commerce.cart.add'
  s1.inject.payload = '{"sku":"widget-blue","price":9.99,"qty":1}'
  s1.expect.push({ id: newId(), field: 'cart.totals.subtotal', op: 'equals', value: '9.99' })
  s1.verdict = 'good'
  demo.steps.push(s1)

  const s2 = newStep()
  s2.description = 'Customer applies SAVE10 coupon'
  s2.inject.topic = 'commerce.cart.coupon_applied'
  s2.inject.payload = '{"code":"SAVE10","pct":10}'
  s2.expect.push({ id: newId(), field: 'cart.totals.subtotal', op: 'equals', value: '8.99' })
  s2.expect.push({ id: newId(), field: 'cart.totals.coupon', op: 'equals', value: 'SAVE10' })
  s2.mustNot.push({ id: newId(), field: 'cart.totals.subtotal', op: 'equals', value: '9.99' })
  s2.verdict = 'bad'
  s2.wantState = 'cart.totals.subtotal: 8.99\ncart.totals.coupon: SAVE10'
  s2.badNote = 'Coupon code is stored but total is not reduced.'
  demo.steps.push(s2)

  const s3 = newStep()
  s3.description = 'Customer checks out'
  s3.inject.topic = 'commerce.checkout.submit'
  s3.inject.payload = '{"cart_id":"cart_001","user_id":"user_123"}'
  s3.expect.push({ id: newId(), field: 'cart.totals.subtotal', op: 'equals', value: '0' })
  demo.steps.push(s3)

  state.scenarios.push(demo)
  state.activeScenarioId = demo.id
  saveToLocalStorage()
}

render()
