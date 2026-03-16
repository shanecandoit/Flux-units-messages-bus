# Test Coverage Report

Generated with Node.js built-in coverage (`--experimental-test-coverage`).

```
node --test --experimental-test-coverage test/*.test.js
```

## Summary

| Metric   | Coverage |
|----------|----------|
| Lines    | 99.79%   |
| Branches | 97.46%   |
| Functions| 93.10%   |
| Tests    | 49 / 49 passing |

## Per-file breakdown

| File               | Lines  | Branches | Functions | Uncovered lines |
|--------------------|--------|----------|-----------|-----------------|
| src/bus.js         | 100%   | 94.44%   | 100%      | —               |
| src/dispatcher.js  | 100%   | 100%     | 100%      | —               |
| src/runtime.js     | 98.96% | 93.44%   | 100%      | 132–133         |

## Uncovered code notes

### `src/runtime.js` lines 132–133

```js
// line 132-133 — inside _matchRule, literal field matching
} else {
  if (msgVal !== val) return null   // ← branch: msgVal === val (match succeeds)
}
```

This is the branch inside `_matchRule` where a pattern field is a literal value
(e.g. `note: null`) and the message field equals it — i.e. the match succeeds.
The failing-match branch is covered (returns `null`); the success path through a
literal match is not exercised by any current test. Low risk — same code path as
variable binding, just a different control flow branch.

### `src/bus.js` branch gap (94.44%)

The uncovered branch is in `causalChain` — the case where `byId.get(id)` returns
`undefined` for an id that does not exist in the log. Not a realistic scenario in
normal operation (the bus only returns ids it assigns), but not tested explicitly.

### `runtime.test.js` functions (87.01%)

The test file itself has a few helper arrow functions that are defined but only
called in some test cases (e.g. emit callbacks passed as `() => {}`). These show
up as uncovered function bodies in the coverage tool — not gaps in production code.

## What is covered

- **Bus**: append, inject, drainPending, hasPending, tick advancement, causalChain
  (root and multi-level), onAppend listeners, restore
- **Dispatcher**: exact match, wildcard single-level, no-match, multi-unit match,
  deduplication (unit with multiple channels)
- **Runtime — rule matching**: add/update/coupon/checkout rules, guard (pass and
  fail), unrelated topic (no fire), literal field matching
- **Runtime — match_all**: fires alongside normal rule, stops at first non-matchAll,
  returns `true` when only matchAll rules fire, multiple units receiving same message
- **Runtime — topic matching**: exact, wildcard single-level, wildcard rejects parent,
  wildcard rejects two levels deep, dispatcher/runtime agreement cross-test
- **Runtime — integration**: downstream entries, parentId chain, multi-level cascade
  A→B→C, full checkout sequence, snapshot shape, tick limit / cascade guard
- **State table helpers**: insert, count, get(), find (key and predicate), find
  null, delete, clear, all (copy isolation)

## How to re-run

```bash
npm test                                              # tests only
node --test --experimental-test-coverage test/*.test.js  # tests + coverage
```
