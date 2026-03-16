# Flux

**A message-driven reactive programming runtime for Node.js, with a collaborative studio for teams.**

Flux is a programming model built around one idea: every piece of behaviour in a system is a **Unit** that reads typed messages off a shared **Bus**, updates its own private state, and emits new messages. Nothing else exists. No shared mutable state. No direct function calls between units. No hidden side effects.

The result is a system where every state change has a traceable cause, every sequence of events can be replayed exactly, and every rule can be tested in isolation against concrete scenarios — without mocking, without test databases, without reproducing production conditions manually.

---

## Contents

- [Why Flux](#why-flux)
- [Core Concepts](#core-concepts)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Writing Units](#writing-units)
- [The Topic Registry](#the-topic-registry)
- [Rules and Pattern Matching](#rules-and-pattern-matching)
- [Checkpoints](#checkpoints)
- [Scenarios](#scenarios)
- [The CLI](#the-cli)
- [The Studio (Web UI)](#the-studio-web-ui)
- [Running the Studio](#running-the-studio)
- [Configuration](#configuration)
- [Example: E-Commerce Cart](#example-e-commerce-cart)
- [Example: Pong](#example-pong)
- [Architecture](#architecture)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Why Flux

Most production bugs are not logic errors in isolation. They are emergent behaviours — the result of several units of logic interacting in a specific order under specific state conditions that nobody anticipated. They are hard to reproduce because reproducing them means reconstructing the exact sequence of events that triggered them, which is information most systems do not record.

Flux makes this information the primary artifact. The bus log is not a debugging aid bolted onto the side of a system. It is the system. Every state a unit is ever in is derivable from replaying the messages it received. Every message on the bus has a `parentId` pointing to the message that caused it. The causal chain from any state back to the original user action is always available, always complete.

This has practical consequences:

- **Bugs are reproducible by construction.** A defect is a checkpoint plus a message. Replay them and the bug reappears, every time, on any machine.
- **Tests are scenarios, not mocks.** A scenario is a sequence of messages and assertions on resulting state. No test database. No HTTP mocking. No test doubles. Inject messages, check state.
- **Non-developers can participate.** Business analysts describe rules as examples and constraints. Developers implement rules that satisfy those constraints. QA files defects by marking state transitions as wrong and describing the correct state. All three roles work in the same tool, on the same artifacts, without translation.
- **Deployments are safe by default.** Publishing a change is blocked if it breaks any scenario that was previously passing. The scenario library is the regression suite. It is built automatically from BA annotations and QA defects.

---

## Core Concepts

### Unit

A unit is an isolated container with two things: **state** (typed named tables) and **rules** (pattern-matched reactions to messages). Units cannot call each other. They cannot read each other's state directly. The only interface is the bus.

```yaml
name: cart
channels:
  - commerce.cart.*
state:
  items:
    sku:   string(32) not null
    qty:   u32        not null
    price: f32        not null
    index: sku
  totals:
    subtotal: f32 not null default 0
rules:
  - name: add_item
    match:
      topic: commerce.cart.add
      sku:   $sku
      price: $price
      qty:   $qty
    do: cart.rules.js#addItem
```

### Message

A message is an immutable JSON object with a required `topic` field and an arbitrary payload. Messages are the only way units communicate. Once emitted, a message cannot be changed.

```json
{ "topic": "commerce.cart.add", "sku": "widget-blue", "price": 9.99, "qty": 1 }
```

### Bus

The bus is an ordered, append-only log of every message ever sent. Units read from it, emit to it, and the runtime guarantees ordering within a tick. The bus is the source of truth. All unit state is derivable from replaying the bus log from any checkpoint.

### Rule

A rule has three parts: a **match pattern** that structurally checks a message, an optional **guard** that inspects the unit's current state, and a **do block** (a named export from a `.rules.js` file) that mutates state and emits messages. Rules are pure. No I/O. No randomness. No external calls.

### Checkpoint

A Merkle snapshot of the entire system — all unit states and the full bus log — taken when the bus goes quiet (quiescence). Checkpoints are named, stored on disk, and can be restored to replay any sequence of events from any point in history.

---

## Getting Started

### Requirements

- Node.js 20+
- npm 9+

### Install

```bash
npm install -g flux-runtime
```

Or use without installing:

```bash
npx flux-runtime
```

### Create a project

```bash
flux new my-project
cd my-project
```

This creates:

```
my-project/
  flux.config.yaml
  topics.flux.yaml
  units/
    example.unit.yaml
    example.rules.js
  scenarios/
    example.scenario.yaml
  checkpoints/
```

### Run

```bash
flux run
```

Loads all unit files, starts the runtime, and waits for injected messages. With `--watch`, restarts on file changes.

---

## Project Structure

```
my-project/
  flux.config.yaml          # project-wide settings
  topics.flux.yaml          # all valid message topics and their schemas
  units/
    cart.unit.yaml          # unit declaration (state schema, rule list)
    cart.rules.js           # rule logic (JS subset)
    cart.template.html      # optional: UI template bound to unit state
    inventory.unit.yaml
    inventory.rules.js
    payments.unit.yaml
    payments.rules.js
  scenarios/
    happy_checkout.scenario.yaml
    promo_code.scenario.yaml
    out_of_stock.scenario.yaml
  checkpoints/
    2026-03-14T14-22-00-A3f9.flux.yaml   # auto-generated at quiescence
    named/
      empty_cart.flux.yaml               # manually named checkpoints
```

Every directory name is configurable in `flux.config.yaml`. The structure above is the default.

---

## Writing Units

A unit is two files: a `.unit.yaml` declaration and a `.rules.js` logic file.

### The declaration file

```yaml
# cart.unit.yaml

name: cart

# channels declares which topics this unit receives
# supports wildcard: commerce.cart.* matches all subtopics
channels:
  - commerce.cart.*
  - commerce.checkout.submit

# state declares typed tables
# each named block is a table (multiple rows) or a record (single row)
state:

  # table with an index — O(1) lookup by sku
  items:
    sku:      string(32) not null
    qty:      u32        not null
    price:    f32        not null
    added_at: u64        not null    # tick number when added
    note:     string(128) null       # nullable — optional field
    index: sku
    max_rows: 100                    # enables stack allocation in compiled mode

  # record — single row
  totals:
    subtotal: f32        not null  default 0
    coupon:   string(16) null

# rules list — order determines priority if multiple match
rules:

  - name: add_item
    match:
      topic: commerce.cart.add
      sku:   $sku
      price: $price
      qty:   $qty
    guard: state.items.count() < 100
    do:    cart.rules.js#addItem      # filename#exportedFunctionName

  - name: apply_coupon
    match:
      topic: commerce.cart.coupon_applied
      code:  $code
      pct:   $pct
    do: cart.rules.js#applyCoupon

  - name: clear_on_checkout
    match:
      topic: commerce.checkout.submit
    do: cart.rules.js#clearOnCheckout
```

### The rules file

Rules are named exports. Each function receives four arguments:

| Argument | Type | Description |
|---|---|---|
| `state` | object | Mutable reference to this unit's state tables |
| `b` | object | Variable bindings from the match pattern (`$sku` → `b.$sku`) |
| `msg` | object | The full message that triggered this rule |
| `emit` | function | Emit a message onto the bus |

```js
// cart.rules.js

export function addItem(state, b, msg, emit) {
  const existing = state.items.find(b.$sku)

  if (existing) {
    existing.qty += b.$qty
  } else {
    state.items.insert({
      sku:      b.$sku,
      qty:      b.$qty,
      price:    b.$price,
      added_at: msg.tick,
    })
  }

  state.totals.subtotal += b.$price * b.$qty

  emit('commerce.cart.updated', {
    total:      state.totals.subtotal,
    item_count: state.items.count(),
  })
}

export function applyCoupon(state, b, msg, emit) {
  state.totals.coupon = b.$code
  state.totals.subtotal *= (1 - b.$pct / 100)

  emit('commerce.cart.updated', {
    total:      state.totals.subtotal,
    item_count: state.items.count(),
    coupon:     b.$code,
  })
}

export function clearOnCheckout(state, b, msg, emit) {
  const prev = state.totals.subtotal
  state.items.clear()
  state.totals.subtotal = 0
  state.totals.coupon = null

  emit('commerce.checkout.complete', {
    total:   prev,
    coupon:  state.totals.coupon,
  })
}
```

### Allowed JS subset

Rules are written in a restricted subset of JavaScript. The same syntax is valid in Node.js and compiles to C++ via the Flux compiler (Phase 6). The restrictions exist to ensure determinism and to make compilation tractable.

**Allowed:**
- Arithmetic: `+ - * / %`
- Comparison: `== != < > <= >=`
- Logical: `&& || !`
- Assignment: `= += -= *= /=`
- Control flow: `if / else if / else`, `while`, `for (C-style)`, `break`, `continue`, `return`
- Variable declaration: `const`, `let` (no `var`)
- State table methods: `.find(key)`, `.insert(row)`, `.delete(key)`, `.count()`, `.clear()`
- Emit: `emit(topic, payload)`
- Math: `Math.min`, `Math.max`, `Math.abs`, `Math.floor`, `Math.ceil`, `Math.sqrt`
- String: `.length`, basic concatenation

**Not allowed:**
- Closures or arrow functions stored in variables
- `async` / `await` / `Promise`
- `Math.random()` — use `msg.tick` as a deterministic seed if you need pseudo-random
- `Date.now()` — use `msg.tick`
- `fetch`, `XMLHttpRequest`, or any I/O
- `JSON.parse` / `JSON.stringify` — messages are already structured
- `eval` / `new Function()`
- Class definitions
- Prototype manipulation

Violations are reported as errors by `flux check` before the runtime loads any unit.

---

## The Topic Registry

Every message topic must be declared in `topics.flux.yaml` before it can be used. Emitting an undeclared topic is a runtime error (and will be a compile error in the compiled backend).

```yaml
# topics.flux.yaml

topics:

  commerce.cart.add:
    payload:
      sku:   string(32) not null
      price: f32        not null
      qty:   u32        not null
      note:  string(128) null
    cascade_budget: 8        # max downstream messages this can generate

  commerce.cart.updated:
    payload:
      total:      f32 not null
      item_count: u32 not null
      coupon:     string(16) null

  commerce.cart.coupon_applied:
    payload:
      code: string(16) not null
      pct:  f32        not null

  commerce.checkout.submit:
    payload:
      cart_id: string(64) not null
      user_id: string(64) not null
    cascade_budget: 20

  commerce.checkout.complete:
    payload:
      total:  f32 not null
      coupon: string(16) null
```

### Cascade budgets

The `cascade_budget` field on a topic declares the maximum number of downstream messages any single instance of that message type is allowed to generate — including messages emitted by messages it triggers, recursively.

```
commerce.checkout.submit (budget: 20)
  → commerce.checkout.complete         (1)
  → commerce.inventory.reserve         (2)
  → commerce.inventory.reserved        (3)
  → commerce.email.queued              (4)
  → commerce.analytics.event           (5)
  total: 5 — within budget
```

Exceeding the budget throws at runtime during development and will be a compile error in the compiled backend. Cycles — where message A eventually causes message A again — are detected at load time via static analysis of the topic dependency graph.

---

## Rules and Pattern Matching

### Structural matching

A match pattern checks message fields by value or binds them to variables. Variables start with `$`.

```yaml
match:
  topic: commerce.cart.add    # literal — must equal this string
  sku:   $sku                 # variable — binds message.sku to b.$sku
  qty:   $qty                 # variable — binds message.qty to b.$qty
  note:  null                 # literal null — matches only if note is absent/null
```

### Guards

A guard is a JS expression evaluated against `state` and the bound variables. If it returns falsy, the rule does not fire. Guards should be pure reads of state — no mutations, no emits.

```yaml
guard: state.items.count() < 100 && b.$price > 0
```

### Rule priority

Rules are evaluated in declaration order. The first matching rule fires and the rest are skipped. To have multiple rules fire on the same message, annotate with `match_all: true`:

```yaml
- name: log_all_cart_events
  match:
    topic: commerce.cart.*
  match_all: true             # fires alongside other matching rules
  do: analytics.rules.js#logCartEvent
```

---

## Checkpoints

Checkpoints are automatically saved to the `checkpoints/` directory when the bus reaches quiescence (no more pending messages). Each checkpoint file is a complete snapshot:

```yaml
# checkpoints/2026-03-14T14-22-00-A3f9.flux.yaml

id: A3f9
timestamp: 2026-03-14T14:22:00Z
parent: B2e8
tick: 47
merkle_root: "a3f9c2..."

units:
  cart:
    state:
      items:
        - { sku: widget-blue, qty: 2, price: 9.99, added_at: 3 }
      totals:
        subtotal: 19.98
        coupon: null
  inventory:
    state:
      stock:
        - { sku: widget-blue, qty: 48 }

bus_log:
  - { id: 0, tick: 1, topic: commerce.cart.add, sku: widget-blue, price: 9.99, qty: 1, parentId: null }
  - { id: 1, tick: 1, topic: commerce.cart.updated, total: 9.99, item_count: 1, parentId: 0 }
  # ...full log

defects: []
```

### Naming a checkpoint

```bash
flux checkpoint save --name empty_cart
```

Saves the current state as `checkpoints/named/empty_cart.flux.yaml`. Named checkpoints can be used as scenario starting points.

### Restoring a checkpoint

```bash
flux checkpoint restore empty_cart
```

### Diffing two checkpoints

```bash
flux diff A3f9 B2e8
```

Shows which unit states changed and which messages were emitted between the two checkpoints. Uses Merkle subtree comparison — only changed subtrees are printed.

---

## Scenarios

A scenario is a sequence of injected messages plus assertions on the resulting state. Scenarios are stored in `scenarios/` and run automatically by `flux publish` as a regression gate.

```yaml
# scenarios/promo_checkout.scenario.yaml

name: Promo code — 10% off
description: |
  Loyalty member applies SAVE10 to a cart with one item.
  Total should reflect 10% discount before checkout.

start_checkpoint: empty_cart   # optional — defaults to clean state

steps:

  - description: Customer adds blue widget
    inject:
      topic: commerce.cart.add
      sku: widget-blue
      price: 9.99
      qty: 1
    expect:
      - field: cart.totals.subtotal
        op: equals
        value: 9.99
      - field: cart.items
        op: contains_sku
        value: widget-blue

  - description: Customer applies SAVE10 coupon
    inject:
      topic: commerce.cart.coupon_applied
      code: SAVE10
      pct: 10
    expect:
      - field: cart.totals.subtotal
        op: equals
        value: 8.99
      - field: cart.totals.coupon
        op: equals
        value: SAVE10
    must_not:
      - field: cart.totals.subtotal
        op: equals
        value: 9.99    # original total — means discount was not applied

  - description: Customer checks out
    inject:
      topic: commerce.checkout.submit
      cart_id: cart_001
      user_id: user_123
    expect:
      - field: cart.totals.subtotal
        op: equals
        value: 0
    expect_message:
      - topic: commerce.checkout.complete
        field: total
        op: equals
        value: 8.99   # must use discounted total, not original
```

### Running scenarios

```bash
# run all scenarios
flux scenario

# run a specific scenario
flux scenario promo_checkout

# run scenarios for a specific unit
flux scenario --unit cart
```

### Defects in scenario files

When QA files a defect using the Studio, it is written into the relevant checkpoint file and also generates a scenario step. Defects are marked with their status:

```yaml
defects:
  - id: defect-007
    filed_by: sarah.qa
    filed_at: 2026-03-13T15:04:00Z
    checkpoint: A3f9
    tick: 3
    status: open           # open | resolved | wontfix
    message:
      topic: commerce.cart.coupon_applied
      code: SAVE10
      pct: 10
    before_state:
      cart.totals.subtotal: 9.99
      cart.totals.coupon: null
    actual_state:
      cart.totals.subtotal: 9.99    # unchanged — wrong
      cart.totals.coupon: SAVE10
    want_state:
      cart.totals.subtotal: 8.99    # should be discounted
      cart.totals.coupon: SAVE10
    notes: "Coupon code is stored but total is not reduced."
```

---

## The CLI

```
flux <command> [options]
```

### Commands

**Implemented**

```
flux run [dir]               Load units and start the HTTP runtime (default :4001)
flux inject <topic> [json]   Inject a message into a running runtime
flux check [dir]             Validate unit files and topic registry
flux scenario [name]         Run scenarios (--dir=<path> to specify project)
flux studio                  Serve the web Studio on :4000
flux dev                     Start the studio (alias for flux studio)
```

**Planned** *(declared in the roadmap, not yet wired up)*

```
flux new <name>              Create a new Flux project
flux run --watch             Restart on file changes
flux publish                 Run all scenarios, block if any fail, emit build artifact
flux checkpoint save [name]  Save current state as a named checkpoint
flux checkpoint restore <id> Restore runtime to a saved checkpoint
flux diff <id1> <id2>        Show state and bus differences between two checkpoints
flux replay <checkpoint>     Replay bus log from a checkpoint
flux fix <defect-id>         Replay from defect's before-state, check want-state
```

**Options**

```
--port=N   Override the default port (applies to run, inject, studio)
```

### Examples

```bash
# start the runtime on a specific port
flux run ./examples/ecommerce --port=4001

# inject a test message
flux inject commerce.cart.add '{"sku":"widget-blue","price":9.99,"qty":1}'

# check for errors before running
flux check

# run all scenarios and show a pass/fail summary
flux scenario

# start the Studio UI
flux studio
```

---

## The Studio (Web UI)

The Flux Studio is a browser tool that runs alongside the runtime. It has three primary views:

### Scenario Builder — Business Analyst view

Write scenarios in plain language. Each step is a natural-language description mapped to a concrete message. Expectations are point-and-click dropdowns — no code required. Step through the resulting transitions tick by tick and mark each one as correct or incorrect.

**Key interactions:**

- Type a step description in plain language
- Review and confirm the suggested message shape
- Add expectations: `cart.totals.subtotal equals 8.99`
- Add negative expectations: `cart.totals.subtotal must not equal 9.99`
- Step through transitions with ◀ / ▶ navigation
- Click **GOOD** or **BAD** on each transition
- When BAD: fill in the want-state and add a note for the developer
- Click **Share with Dev** to notify the assigned developer

### Rule Editor — Developer view

Split view: the unit's rule file on the left, live scenario results on the right. Results update on save. Failing scenarios show the exact tick, the message, the expected vs actual state delta, and the rule name and line number that fired. Click **↗ jump to line N** to scroll the editor to the responsible rule.

BA defect notes appear directly in the fail detail panel — no Jira, no Slack thread, no context switching.

**Key interactions:**

- Select a unit from the sidebar
- Edit the `.rules.js` file in the embedded editor
- Save — results update automatically
- Click a failing scenario to see the full trace
- Click **↗ jump to line** to navigate to the responsible rule
- When all scenarios pass: **Publish** button unlocks

### Timeline Inspector — QA view

Load any checkpoint file and step through the bus log. The full causal tree is visible — which message caused which other message, with `parentId` links going back to the original user action. Click any row to see the before/after state diff and file a defect.

**Key interactions:**

- Load a checkpoint (drag-and-drop or file picker)
- Browse the message timeline with causal indentation
- Click any message row to open the state diff panel
- Click **File Defect** to open the defect panel (pre-populated with before/message/actual state)
- Fill in the want-state and notes
- Click **Save Defect** — written to the checkpoint file and becomes a regression test

---

## Running the Studio

```bash
# start the studio (requires a running runtime or checkpoint directory)
flux studio

# start everything at once
flux dev
```

The studio opens at `http://localhost:4000` by default. It reads checkpoint files from the project's `checkpoints/` directory and scenario files from `scenarios/`. It writes defect annotations back to checkpoint files and new/updated scenarios back to `scenarios/`.

No database. No server state. Everything is in the files.

### Sharing the studio with a team

The Studio is a static HTML file served by the CLI's file server. For team use, point it at a shared checkpoint directory — an S3 bucket, a shared NFS mount, or a git-tracked folder. The only requirement is that the `checkpoints/` directory is readable by everyone who needs to use the Studio.

```yaml
# flux.config.yaml
studio:
  port: 4000
  checkpoint_dir: ./checkpoints    # or s3://my-bucket/flux-checkpoints
  scenario_dir: ./scenarios
  notify_on_defect: true           # sends a notification when a defect is filed
```

---

## Configuration

```yaml
# flux.config.yaml

project: my-project
version: 1

runtime:
  tick_limit: 1000          # max ticks before runaway cascade error
  checkpoint_on: quiescence # or: every_tick, every_n_ticks, manual
  checkpoint_every_n: 100   # used when checkpoint_on: every_n_ticks

units:
  dir: ./units

topics:
  file: ./topics.flux.yaml

scenarios:
  dir: ./scenarios

checkpoints:
  dir: ./checkpoints
  max_stored: 500           # older checkpoints are pruned beyond this count
  keep_named: true          # named checkpoints are never pruned

studio:
  port: 4000
  open_on_dev: true         # open browser automatically on flux dev

publish:
  require_all_scenarios: true  # block publish if any scenario fails
  run_check: true              # run flux check before scenarios
```

---

## Example: E-Commerce Cart

A complete working example with three units, four scenarios, and a defect demonstrating the full workflow.

### Topics

```yaml
# topics.flux.yaml
topics:
  commerce.cart.add:
    payload:
      sku:   string(32) not null
      price: f32        not null
      qty:   u32        not null
    cascade_budget: 5

  commerce.cart.updated:
    payload:
      total:      f32 not null
      item_count: u32 not null

  commerce.cart.coupon_applied:
    payload:
      code: string(16) not null
      pct:  f32        not null

  commerce.checkout.submit:
    payload:
      cart_id: string(64) not null
    cascade_budget: 15

  commerce.checkout.complete:
    payload:
      total: f32 not null

  commerce.inventory.reserve:
    payload:
      sku: string(32) not null
      qty: u32        not null

  commerce.email.queue:
    payload:
      to:      string(128) not null
      subject: string(256) not null
```

### Cart unit

```yaml
# units/cart.unit.yaml
name: cart
channels:
  - commerce.cart.*
  - commerce.checkout.submit

state:
  items:
    sku:   string(32) not null
    qty:   u32        not null
    price: f32        not null
    index: sku
    max_rows: 100

  totals:
    subtotal: f32        not null default 0
    coupon:   string(16) null

rules:
  - name: add_item
    match: { topic: commerce.cart.add, sku: $sku, price: $price, qty: $qty }
    guard: state.items.count() < 100
    do: cart.rules.js#addItem

  - name: apply_coupon
    match: { topic: commerce.cart.coupon_applied, code: $code, pct: $pct }
    do: cart.rules.js#applyCoupon

  - name: checkout
    match: { topic: commerce.checkout.submit }
    do: cart.rules.js#checkout
```

```js
// units/cart.rules.js
export function addItem(state, b, msg, emit) {
  const existing = state.items.find(b.$sku)
  if (existing) {
    existing.qty += b.$qty
  } else {
    state.items.insert({ sku: b.$sku, qty: b.$qty, price: b.$price })
  }
  state.totals.subtotal += b.$price * b.$qty
  emit('commerce.cart.updated', {
    total: state.totals.subtotal,
    item_count: state.items.count(),
  })
}

export function applyCoupon(state, b, msg, emit) {
  state.totals.coupon = b.$code
  state.totals.subtotal *= (1 - b.$pct / 100)
  emit('commerce.cart.updated', {
    total: state.totals.subtotal,
    item_count: state.items.count(),
  })
}

export function checkout(state, b, msg, emit) {
  const total = state.totals.subtotal
  state.items.clear()
  state.totals.subtotal = 0
  state.totals.coupon = null
  emit('commerce.checkout.complete', { total })
}
```

### Running the example

```bash
# clone and install
git clone https://github.com/flux-lang/flux
cd flux/examples/ecommerce
npm install

# start dev mode
flux dev

# in another terminal, inject some messages
flux inject commerce.cart.add '{"sku":"widget","price":9.99,"qty":1}'
flux inject commerce.cart.coupon_applied '{"code":"SAVE10","pct":10}'
flux inject commerce.checkout.submit '{"cart_id":"cart_001"}'

# run scenarios
flux scenario

# open the studio
open http://localhost:4000
```

---

## Example: Pong

Flux maps cleanly to game development. Every game frame is a tick. Player input is a message. Physics rules respond to `game.tick`. The render unit reads all state at the end of each tick and draws the frame.

```bash
cd examples/pong
flux dev
open http://localhost:4000
```

The Pong example demonstrates:

- **Clock unit** — emits `game.tick` at 60fps, injectable for deterministic replay
- **Paddle unit** — instantiated twice with different player bindings
- **Ball unit** — move, wall bounce, and paddle bounce rules
- **Score unit** — reacts to `game.ball_lost`, tracks points, emits `game.over`
- **Render unit** — reads all state on `render.frame`, draws the canvas
- **Input recording** — every keypress is a bus message; record a session by saving the bus log, replay it exactly by restoring a checkpoint and re-injecting the log

See [`docs/games.md`](docs/games.md) for full documentation on modeling Pong, Breakout, and Tetris in Flux.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Source files                                                │
│  topics.flux.yaml   *.unit.yaml   *.rules.js                 │
└──────────────────────────┬──────────────────────────────────┘
                           │  flux check + load
┌──────────────────────────▼──────────────────────────────────┐
│  Runtime (Node.js)                                           │
│                                                              │
│  Bus           — append-only message log                     │
│  Dispatcher    — topic string → matching units               │
│  Tick loop     — drain pending, fire rules, append emitted   │
│  Checkpointer  — Merkle snapshot at quiescence               │
│  Cascade guard — enforce topic budgets, detect cycles        │
└──────────────┬────────────────────────┬─────────────────────┘
               │                        │
               │ checkpoint files        │ HTTP + websocket
               ▼                        ▼
┌──────────────────────┐  ┌─────────────────────────────────┐
│  Checkpoint store    │  │  Studio (browser)                │
│  ./checkpoints/      │  │                                  │
│  *.flux.yaml         │  │  Scenario Builder  (BA)          │
│                      │  │  Rule Editor       (Dev)         │
│  read/write by       │  │  Timeline Inspector (QA)         │
│  both runtime        │  │                                  │
│  and studio          │  │  reads checkpoint files          │
│                      │  │  writes defect annotations       │
└──────────────────────┘  └─────────────────────────────────┘
```

### Bus entry structure

Every entry on the bus carries:

```
id:        sequential integer — stable message identifier
tick:      which tick this message was processed in
parentId:  id of the message that caused this one (null for injected messages)
topic:     string in Node.js runtime, u16 enum in compiled runtime
payload:   the message fields
ts:        wall clock timestamp (for debugging only — never used in rule logic)
```

The `parentId` chain from any message back to `null` is the complete causal history of that message. This is computed for free by the bus append operation and never requires any additional instrumentation.

### Merkle checkpoint structure

```
checkpoint_root
├── bus_hash           ← hash of the full ordered message log
├── units_hash
│   ├── cart_hash      ← hash of cart's full state
│   │   ├── items_hash
│   │   └── totals_hash
│   ├── inventory_hash
│   └── ...
└── tick_number

If cart state is unchanged between two checkpoints:
  cart_hash is identical.
  Comparison is O(1) for that subtree.
```

---

## Roadmap

The project is in active development. Phases are independently shippable.

| Phase | Status | Description |
|---|---|---|
| 1 — Core runtime | ✅ Complete | Unit loader, bus, tick loop, channel matching, CLI runner |
| 2 — Checkpoints | ✅ Complete | Merkle checkpoint, named snapshots, diff, replay |
| 3 — Scenarios | ✅ Complete | Scenario format, runner, pass/fail, publish gate |
| 4 — Studio QA view | 🔄 In progress | Timeline inspector, defect filing, causal visualiser |
| 5 — Studio BA view | 📋 Planned | Scenario builder, transition marker, conflict detection |
| 6 — Studio Dev view | 📋 Planned | Rule editor, live scenario results, trace drill-down |
| 7 — Compiler | 📋 Planned | Flux IR, type checker, cascade static analysis, C++ codegen |
| 8 — WASM build | 📋 Planned | Compile to WASM for browser-identical replay in Studio |
| 9 — Distribution | 📋 Planned | Key partitioning, CRDT state types, rejoin protocol |

### Known limitations

- **JS subset is enforced at runtime, not load time.** Forbidden constructs (closures, `async`, `Date.now`) will throw when first executed, not when the unit is loaded. The `flux check` command catches most violations statically but is not exhaustive. The compiler (Phase 7) will enforce the subset completely.
- **Topic pattern matching uses string comparison.** The `commerce.cart.*` wildcard is resolved by regex at dispatch time. In the compiled runtime this becomes a jump table indexed by integer enum.
- **Checkpoints are YAML.** Human-readable and debuggable but large for systems with many units or long bus logs. A binary checkpoint format is planned for Phase 7.
- **Studio BA and Dev views are in progress.** The Timeline Inspector (QA view) is available now. The Scenario Builder and Rule Editor ship with Phase 5 and 6.

---

## Contributing

Contributions are welcome. The project is most in need of:

- **Studio frontend** — the BA Scenario Builder and Dev Rule Editor views (Phase 5 & 6, React / TypeScript)
- **Planned CLI commands** — `flux new`, `--watch`, `flux publish`, `flux checkpoint`, `flux diff`, `flux replay`, `flux fix`
- **Examples** — new domains beyond e-commerce and games
- **Compiler work** — the Flux IR design is documented in [`docs/compiler.md`](docs/compiler.md)
- **Bug reports** — the defect format is in [`docs/defects.md`](docs/defects.md); filing a bug as a Flux scenario is appreciated but not required

The core runtime (bus, dispatcher, tick loop, Merkle checkpoints, scenario runner, CLI) has 139 tests at ≥95% line coverage.

### Development setup

```bash
git clone https://github.com/flux-lang/flux
cd flux
npm install
npm test

# run the e-commerce example in dev mode
cd examples/ecommerce
npx flux dev
```

### Contribution rules

1. Every rule change must have a scenario. The scenario covers the case the rule addresses. This is not optional.
2. The `flux publish` gate must pass before a PR is merged.
3. New topics added to examples must be added to `topics.flux.yaml` first.
4. JS subset violations in example code will fail CI.

### Filing bugs

The most useful bug report is a checkpoint and a message — the exact before-state and the message that triggered the wrong behaviour. If you are using the Studio, use the Timeline Inspector to file the defect and include the exported checkpoint file in the issue.

---

## License

MIT — see [LICENSE](LICENSE)

---

## Acknowledgements

Flux draws on decades of prior work. The ideas here are not new — the synthesis and the tooling are.

- **Eve** (Chris Granger, 2016) — the clearest prior expression of this programming model
- **Erlang/OTP** — actor isolation and fault tolerance as a design philosophy
- **Apache Kafka** — the log as the source of truth, not a side effect
- **CLIPS** — production rule systems with working memory, the 1980s version of this idea
- **Linda Tuple Spaces** — coordination through shared associative memory
- **The Elm Architecture** — the closest prior art to a single Flux unit
- **Dedalus** — logic-based distributed programming where time is explicit
