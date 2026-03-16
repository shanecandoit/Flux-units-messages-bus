# Games in Flux

Flux maps cleanly to game development.  Every game frame is a tick.  Player
input is a message.  Physics rules react to `game.tick`.  State (ball position,
scores, board cells) lives inside units.  The bus log is a complete replay of
every frame — load a checkpoint to replay any match or debug any collision.

This document walks through the three game examples in `examples/`:

- [Pong](#pong)
- [Breakout](#breakout)
- [Tetrad (Tetris variant)](#tetrad)

---

## Pong

**Path:** `examples/pong/`

Classic two-player paddle game on a 320 × 240 screen.

### Units

| Unit    | Listens to                          | Emits                                        |
|---------|-------------------------------------|----------------------------------------------|
| `ball`  | `game.tick`, `paddles.moved`        | `ball.bounced`, `ball.scored`                |
| `paddles` | `game.tick`, `input.paddle.move`  | `paddles.moved`                              |
| `score` | `ball.scored`                       | `score.updated`, `game.over`                 |

### Architecture

```
Host / test
    │  game.tick {frame: N}         ← inject one per frame (or per test step)
    │  input.paddle.move {player, direction}
    ▼
┌─────────────────────────────────────────────────────┐
│  paddles unit                                        │
│  • movePaddle  — clamps paddle y to [20, 220]        │
│  • broadcastPositions — emits paddles.moved each tick│
└──────────────────────────┬──────────────────────────┘
                           │ paddles.moved {player, y}
                           ▼
┌─────────────────────────────────────────────────────┐
│  ball unit                                           │
│  • cachePaddlePos — stores latest paddle y values    │
│  • moveBall       — moves ball, tests all collisions │
│    wall bounce  → emits ball.bounced                 │
│    paddle miss  → emits ball.scored                  │
└──────────────────────────┬──────────────────────────┘
                           │ ball.scored {player}
                           ▼
┌─────────────────────────────────────────────────────┐
│  score unit                                          │
│  • onScore — increments counter, checks win limit    │
│    emits score.updated, game.over (at 7 pts)         │
└─────────────────────────────────────────────────────┘
```

### Key design choices

**Paddle positions travel via messages.**  The ball unit cannot read the
paddles unit's state directly.  Instead, `paddles` broadcasts a `paddles.moved`
message on every `game.tick`, and `ball` caches the positions in its own
`paddle_cache` table.  This is one tick behind — an intentional simplification
that works fine at 60 fps and is trivially testable.

**Score logic is tested by injecting `ball.scored` directly.**  In a running
game the ball's physics drives `ball.scored` naturally.  In scenarios you inject
`ball.scored` directly to test the score unit in isolation — no need to simulate
50+ physics ticks to drive the ball across the field.

### Running it

```bash
cd examples/pong
flux run .
# In another terminal:
flux inject game.tick '{"frame":1}'
flux inject input.paddle.move '{"player":"left","direction":"up"}'
```

### Scenarios

| Scenario | What it tests |
|----------|---------------|
| `rally_and_goal` | Ball movement, paddle input, first goal via direct injection |
| `game_over` | Seven goals fires `game.over` with correct winner |

---

## Breakout

**Path:** `examples/breakout/`

Single-player brick-clearing game.  8 × 5 brick grid, one paddle at the bottom.

### Units

| Unit     | Listens to                                | Emits                                             |
|----------|-------------------------------------------|---------------------------------------------------|
| `ball`   | `game.tick`, `paddle.moved`, `ball.hit_brick` | `ball.bounced`, `ball.hit_brick`, `ball.lost`  |
| `paddle` | `game.tick`, `input.paddle.move`          | `paddle.moved`                                    |
| `bricks` | `ball.hit_brick`                          | `brick.destroyed`, `level.cleared`                |
| `hud`    | `brick.destroyed`, `ball.lost`, `level.cleared` | `score.updated`, `game.over`              |

### Architecture

```
Host / test
    │  game.tick  ·  input.paddle.move
    ▼
┌──────────────────────────┐
│  paddle unit             │  → paddle.moved {x}
└────────────┬─────────────┘
             │ paddle.moved
             ▼
┌──────────────────────────────────────────────────────┐
│  ball unit                                            │
│  • cachePaddle   — stores latest paddle x            │
│  • markBrickDead — updates local dead_bricks cache   │
│  • moveBall:                                         │
│    - wall bounces    → ball.bounced                  │
│    - paddle bounce   → ball.bounced                  │
│    - brick collision → ball.bounced + ball.hit_brick │
│    - off bottom      → ball.lost                     │
└───────────────┬──────────────────────────────────────┘
                │ ball.hit_brick {col, row}    ball.lost
                ▼                              ▼
┌───────────────────────┐     ┌────────────────────────┐
│  bricks unit          │     │  hud unit               │
│  • destroyBrick       │     │  • addPoints            │
│    if alive: delete   │     │  • loseLife             │
│    emit brick.destroyed│    │  • nextLevel            │
│    if empty: level.   │     │  emits score.updated,   │
│    cleared            │     │  game.over              │
└───────────────────────┘     └────────────────────────┘
```

### Key design choice: dual dead-brick tracking

The `ball` unit and the `bricks` unit each track which bricks are dead
independently:

- **`bricks.alive`** — the authoritative table; used for scoring and
  level-clear detection.
- **`ball.dead_bricks`** — a cache the ball maintains so it stops bouncing
  off destroyed bricks without needing to read `bricks` state directly.

When `ball.hit_brick` fires, both units update in the same tick:
1. `bricks.destroyBrick` deletes from `bricks.alive`, emits `brick.destroyed`.
2. `ball.markBrickDead` inserts into `ball.dead_bricks`.

On the next tick, `ball.moveBall` skips dead bricks.

### Brick geometry

```
Screen: 320 × 240
Grid origin: (8, 30)   ← x=8, y=30
Brick size:  36 × 16   ← includes 2 px gap right + 2 px gap bottom
Grid:        8 cols × 5 rows

col 0: x ∈ [8,  42]    col 4: x ∈ [152, 186]
col 1: x ∈ [44, 78]    col 5: x ∈ [188, 222]
…                      col 7: x ∈ [260, 294]

row 0: y ∈ [30, 44]  ← 50 pts  (top row, hardest to reach)
row 1: y ∈ [46, 60]  ← 40 pts
row 2: y ∈ [62, 76]  ← 30 pts
row 3: y ∈ [78, 92]  ← 20 pts
row 4: y ∈ [94,108]  ← 10 pts  (bottom row, easiest)
```

### Scenarios

| Scenario | What it tests |
|----------|---------------|
| `first_brick` | Ball movement, paddle, ball.lost life tracking, game.over |
| `clear_row` | Destroying all 8 bricks in a row accumulates correct score |

---

## Tetrad

**Path:** `examples/tetrad/`

Single-player Tetris variant with 7 piece types, gravity, rotation, hard drop,
and line clearing.  Board is 10 × 20.

### Units

| Unit    | Listens to                                              | Emits                                       |
|---------|---------------------------------------------------------|---------------------------------------------|
| `piece` | `game.tick`, `input.piece.*`, `piece.spawned`           | `piece.locked`                              |
| `board` | `piece.locked`                                          | `lines.cleared`, `game.over`                |
| `hud`   | `lines.cleared`, `game.over`                            | `score.updated`                             |
| `bag`   | `piece.locked`                                          | `piece.spawned`                             |

### Architecture

```
Host / test
    │  game.tick · input.piece.move · input.piece.rotate · input.piece.drop
    ▼
┌──────────────────────────────────────────────────────┐
│  piece unit                                           │
│  • applyGravity — moves piece down; locks if blocked  │
│  • shiftPiece   — moves left / right / nudge down     │
│  • rotatePiece  — rotates CW or CCW (wall-kick skipped│
│                   in this version)                    │
│  • hardDrop     — instant drop then lock              │
│  • spawnPiece   — applies piece.spawned data          │
│                                                       │
│  Collision detection reads board_shadow (a local copy │
│  of filled cells maintained by the piece unit) plus   │
│  the CELLS offset table encoded in piece.rules.js.    │
└──────────────────────────┬───────────────────────────┘
                           │ piece.locked {type, rotation, x, y}
                           ├────────────────────────────┐
                           ▼                            ▼
        ┌──────────────────────────┐    ┌───────────────────────┐
        │  board unit              │    │  bag unit              │
        │  • lockPiece             │    │  • spawnNext           │
        │    place cells           │    │    emits piece.spawned │
        │    clear complete rows   │    │    with next type in   │
        │    emit lines.cleared    │    │    the cycle (0–6)     │
        │    emit game.over if     │    └───────────────────────┘
        │    row 0 is occupied     │
        └────────────┬─────────────┘
                     │ lines.cleared {count, score}
                     ▼
        ┌──────────────────────────┐
        │  hud unit                │
        │  • onLinesCleared        │
        │    score += pts × level  │
        │    level = lines÷10 + 1  │
        │    emit score.updated    │
        └──────────────────────────┘
```

### Piece encoding

Each piece type has 4 rotations.  Each rotation is a flat array of `[dcol, drow]`
pairs relative to the piece origin.

```js
// I-piece, rotation 0 (horizontal):
[0,1,  1,1,  2,1,  3,1]
// → cells at (origin+0, origin+1), (origin+1, origin+1), …

// T-piece, rotation 0 (T pointing up):
[0,1,  1,1,  2,1,  1,0]
// → three in a row plus one above the centre
```

The same table lives in both `piece.rules.js` (for collision detection) and
`board.rules.js` (for placing cells on lock).  This deliberate duplication
avoids cross-unit state reads — each unit is self-contained.

### No randomness

The allowed JS subset forbids `Math.random()`.  The `bag` unit cycles through
piece types 0–6 in order.  For deterministic replay this is ideal — the sequence
is fully reproducible from any checkpoint.  For production, you could replace the
cycle with a seeded PRNG operating on `msg.tick` as its seed.

### Scoring

| Lines cleared | Points (before level multiplier) |
|---------------|----------------------------------|
| 1             | 100                              |
| 2             | 300                              |
| 3             | 500                              |
| 4 (Tetrad)    | 800                              |

Level multiplier: `score += pts × level`.  Level advances every 10 lines.

### Scenarios

| Scenario | What it tests |
|----------|---------------|
| `place_piece` | Gravity, shift, hard drop, piece.locked, bag spawns next piece |
| `line_clear` | Score accumulation, level multiplier, level-up after 10 lines |

---

## Common patterns

### Testing without simulating every tick

In all three examples the scenarios inject causally important messages
(`ball.scored`, `brick.destroyed`, `lines.cleared`) directly rather than
simulating every physics tick.  This is the recommended approach:

```
Don't do this:                    Do this instead:
  inject game.tick × 60           inject ball.scored directly
  inject game.tick × 60           → score.updated fires in one step
  inject game.tick × 60           → test the scoring rule, not the physics
  (hope ball eventually scores)
```

Physics rules (movement, collision) are tested by checking a small number of
ticks at the start of a scenario — enough to verify the calculation is correct —
then skipping ahead by injecting the downstream events directly.

### Input recording and replay

Every keypress is a message on the bus.  To record a session:

```bash
# Start the runtime
flux run examples/pong

# Play the game — every input.paddle.move is appended to the bus log

# Save a checkpoint after the match
# (checkpoint files include the full bus log)
```

To replay: restore the checkpoint (loads the initial state) and re-inject the
`input.paddle.move` messages from the bus log.  The physics is deterministic, so
the match replays frame-for-frame.

### Defect filing

When a collision behaves unexpectedly, open the Timeline Inspector in the Studio
(`flux studio`), find the tick where the wrong bounce occurred, and click
**File Defect**.  The defect captures the exact before-state and the message
that triggered the wrong behaviour.  A developer can then run `flux fix <id>` to
replay from that exact state and iterate on the rule until the collision is
correct.

---

## What is not included (yet)

| Feature | Status |
|---------|--------|
| Rendering / canvas output | Out of scope — Studio visualises state; a renderer reads state via GET /state |
| Sound | Out of scope — no I/O in rules |
| Multiplayer / network | Phase 9 (distribution) |
| Wall-kick (Tetrad rotation) | Simplified — rotation fails silently if blocked |
| Row shift-down after line clear | Simplified — row is cleared but cells above do not shift |
| Seeded PRNG bag shuffle | Use `msg.tick` as a seed in a custom LCG if needed |
