# BA Guide: Building Scenarios in Flux Studio

This guide walks through the Flux Studio Scenario Builder from a Business Analyst's perspective. No code required — you describe what should happen, inject messages, and mark each result as correct or wrong.

**Start the studio:**
```bash
flux studio          # opens http://localhost:4000
```

---

## The layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ◉ Flux Studio  [ Scenario Builder ]  [ Rule Editor ]  [ Timeline ]         │
├──────────────────┬──────────────────────────────────────┬────────────────────┤
│  SCENARIOS    +  │                                      │  YAML PREVIEW      │
│                  │  (scenario name)                     │                    │
│  scenario name   │                                      │  name: ...         │
│  scenario name   │  steps go here                       │  steps:            │
│                  │                                      │    ...             │
│                  │  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │                    │
│                  │       + Add step                     │                    │
│                  │  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │  [ Copy YAML    ]  │
│                  │                                      │  [ Download .yaml] │
└──────────────────┴──────────────────────────────────────┴────────────────────┘
```

Three panels:
- **Left** — list of scenarios in this project
- **Centre** — the active scenario's steps
- **Right** — live YAML preview of the scenario (updates as you type)

---

## Example: Promo code checkout

We'll build the scenario: *a loyalty member applies SAVE10 to a cart with one item, then checks out.*

### Step 1 — Create the scenario

Click **+** in the sidebar. A new scenario appears. Rename it:

```
┌──────────────────┬──────────────────────────────────────────────────────────┐
│  SCENARIOS    +  │  Promo code — 10% off          [ Export YAML ]  [ ✕ ]   │
│                  ├──────────────────────────────────────────────────────────┤
│ ▶ Promo code     │                                                          │
│   — 10% off      │         No steps yet                                     │
│   draft  0 steps │         Click "Add step" to describe the first action.   │
│                  │                                                          │
│                  │   ╔══════════════════════════════════════════════════╗   │
│                  │   ║                  + Add step                      ║   │
│                  │   ╚══════════════════════════════════════════════════╝   │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

---

### Step 2 — Add the first step

Click **+ Add step**. A step card opens. Fill in what the customer does:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ① Customer adds blue widget                     commerce.cart.add    ○    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  DESCRIPTION   [ Customer adds blue widget                               ]  │
│                                                                             │
│  TOPIC         [ commerce.cart.add                             ▼         ]  │
│                                                                             │
│  PAYLOAD       ┌──────────────────────────────────────────────────────┐    │
│                │ {                                                    │    │
│                │   "sku": "widget-blue",                              │    │
│                │   "price": 9.99,                                     │    │
│                │   "qty": 1                                           │    │
│                │ }                                                    │    │
│                └──────────────────────────────────────────────────────┘    │
│                                                                             │
│  EXPECT (all must pass)                                                     │
│  + Add expectation                                                          │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  VERDICT                                                                    │
│  [  ✅ GOOD — transition is correct  ]  [  ❌ BAD — something is wrong  ]   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The **Topic** dropdown is pre-populated with known topics from the project. Select `commerce.cart.add`, then fill in the JSON payload.

---

### Step 3 — Add expectations

Click **+ Add expectation** to assert on state after the message is processed. Add two:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  EXPECT (all must pass)                                                     │
│                                                                             │
│  [ cart.totals.subtotal      ] [ equals ▼ ] [ 9.99              ] [ × ]   │
│  [ cart.items                ] [ contains▼] [ widget-blue       ] [ × ]   │
│                                                                             │
│  + Add expectation                                                          │
│                                                                             │
│  MUST NOT (any failing = defect)                                            │
│  + Add must-not                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Field path** is dot-notation into the unit's state: `cart.totals.subtotal`, `cart.items`. **Op** is `equals`, `not_equals`, `greater_than`, `less_than`, `contains`, `exists`, or `not_exists`.

---

### Step 4 — Mark the transition

You've reviewed the expected behaviour. This transition is correct — click **GOOD**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  VERDICT                                                                    │
│                                                                             │
│  ┌─────────────────────────────────┐  ┌────────────────────────────────┐   │
│  │  ✅ GOOD — transition is correct│  │  ❌ BAD — something is wrong   │   │
│  └─────────────────────────────────┘  └────────────────────────────────┘   │
│             ▲ selected (green border)                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

The step card collapses. The step number badge turns green. The sidebar badge updates:

```
┌──────────────────┐
│ ▶ Promo code     │
│   — 10% off      │
│   draft  1 step  │
│                  │
│  ① ✅  Customer adds blue widget     commerce.cart.add    │
│  ② ○   Customer applies SAVE10...    ← next step          │
└──────────────────┘
```

---

### Step 5 — Add the coupon step, mark it BAD

Add a second step for the coupon. Fill in the topic and payload, then add expectations and a must-not:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ② Customer applies SAVE10 coupon         commerce.cart.coupon_applied  ○  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TOPIC     [ commerce.cart.coupon_applied                    ▼          ]  │
│  PAYLOAD   [ { "code": "SAVE10", "pct": 10 }                            ]  │
│                                                                             │
│  EXPECT (all must pass)                                                     │
│  [ cart.totals.subtotal ] [ equals  ▼ ] [ 8.99       ] [ × ]              │
│  [ cart.totals.coupon   ] [ equals  ▼ ] [ SAVE10     ] [ × ]              │
│                                                                             │
│  MUST NOT (any failing = defect)                                            │
│  [ cart.totals.subtotal ] [ equals  ▼ ] [ 9.99       ] [ × ]              │
│    ↑ the original total — if this passes, the discount was not applied     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

You've tested this in the system and the total is **not** being reduced — only the coupon code is stored. Click **BAD**. A want-state panel expands below the verdict buttons:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  VERDICT                                                                    │
│                                                                             │
│  [  ✅ GOOD — transition is correct  ]  ┌─ ❌ BAD — something is wrong ─┐  │
│                                         └── selected (red border) ──────┘  │
│                                                                             │
│  ╔═══════════════════════════════════════════════════════════════════════╗  │
│  ║  Describe the correct state (field: value, one per line)             ║  │
│  ║  ┌───────────────────────────────────────────────────────────────┐  ║  │
│  ║  │ cart.totals.subtotal: 8.99                                    │  ║  │
│  ║  │ cart.totals.coupon: SAVE10                                    │  ║  │
│  ║  └───────────────────────────────────────────────────────────────┘  ║  │
│  ║                                                                       ║  │
│  ║  Note for developer                                                   ║  │
│  ║  [ Coupon code is stored but total is not reduced.               ]   ║  │
│  ╚═══════════════════════════════════════════════════════════════════════╝  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Fill in the state you expected to see and a short note. This becomes a defect entry in the scenario file — the developer will see it directly in their Rule Editor, no Jira ticket required.

---

### Step 6 — Add the checkout step

Add a third step for checkout. No issues here, mark it **GOOD**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ① ✅  Customer adds blue widget       commerce.cart.add                 │
│  ② ❌  Customer applies SAVE10 coupon  commerce.cart.coupon_applied      │
│  ③ ✅  Customer checks out             commerce.checkout.submit          │
│                                                                          │
│  ╔═════════════════════════════════════════════╗                         │
│  ║              + Add step                     ║                         │
│  ╚═════════════════════════════════════════════╝                         │
└──────────────────────────────────────────────────────────────────────────┘
```

The sidebar badge changes to **1 bad**:

```
┌──────────────────┐
│ ▶ Promo code     │
│   — 10% off      │
│   1 bad  3 steps │
└──────────────────┘
```

---

### Step 7 — Review the YAML and export

The right panel shows the full scenario YAML, updating live as you work:

```
┌────────────────────────────────────────────┐
│  YAML PREVIEW                              │
│                                            │
│  name: "Promo code — 10% off"             │
│                                            │
│  steps:                                    │
│                                            │
│    - description: Customer adds blue widget│
│      inject:                               │
│        topic: commerce.cart.add            │
│        sku: widget-blue                    │
│        price: 9.99                         │
│        qty: 1                              │
│      expect:                               │
│        - field: cart.totals.subtotal       │
│          op: equals                        │
│          value: 9.99                       │
│                                            │
│    - description: Customer applies SAVE10  │
│      inject:                               │
│        topic: commerce.cart.coupon_applied │
│        code: SAVE10                        │
│        pct: 10                             │
│      expect:                               │
│        - field: cart.totals.subtotal       │
│          op: equals                        │
│          value: 8.99                       │
│      # QA defect                           │
│      # note: Coupon stored but total       │
│      #       not reduced.                  │
│      want_state:                           │
│        cart.totals.subtotal: 8.99          │
│        cart.totals.coupon: SAVE10          │
│                                            │
│  [ Copy YAML ]  [ Download .scenario.yaml ]│
└────────────────────────────────────────────┘
```

Click **Download .scenario.yaml** to save the file. Drop it into your project's `scenarios/` directory and it becomes a regression test — the next `flux publish` will run it automatically.

---

## What happens next

Once the scenario file is in `scenarios/`, the developer picks it up in the Rule Editor. The defect note you wrote appears directly in their fail detail panel alongside the rule name and line number that fired. No handoff document, no ticket — they see your want-state and note in the same tool they use to fix the rule.

When the rule is fixed, the BAD step becomes a passing assertion. The scenario runs on every subsequent `flux publish`. If a future change re-introduces the bug, the publish gate catches it.

```
BA files defect in Studio
         ↓
scenario YAML written to scenarios/
         ↓
developer fixes rule (sees your note in Rule Editor)
         ↓
flux publish runs scenario — passes
         ↓
future regression → publish blocks, defect resurfaces
```

---

## Tips

- **Be specific in want-state.** The more precise the field values, the more useful the regression test. `cart.totals.subtotal: 8.99` is better than `discount was applied`.
- **Use must-not for the original (wrong) value.** If you expect `8.99` after a discount, add a must-not for `9.99`. This distinguishes "discount applied correctly" from "discount applied but wrong amount".
- **One step per user action.** Keep steps granular. A step that injects three messages at once is harder to debug than three separate steps.
- **Start checkpoint.** If your scenario starts from a known state (e.g. a pre-filled cart), set the `start_checkpoint` field at the top of the scenario. Named checkpoints are saved with `flux checkpoint save --name my_state`.
