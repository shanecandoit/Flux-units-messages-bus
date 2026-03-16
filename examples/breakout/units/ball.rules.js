// ── Screen and object constants ───────────────────────────────────────────────
const W      = 320
const H      = 240
const R      = 5        // ball radius

// Brick grid  (8 cols × 5 rows)
const COLS    = 8
const ROWS    = 5
const BX_OFF  = 8       // left edge of col 0
const BY_OFF  = 30      // top  edge of row 0
const BW      = 36      // brick width  (includes 2 px right gap)
const BH      = 16      // brick height (includes 2 px bottom gap)

// Paddle (fixed y=220, half-width=30, half-height=4)
const PY      = 220
const PH_W    = 30
const PH_H    = 4

// Respawn position after ball.lost
const SPAWN_X = 160
const SPAWN_Y = 180

export function cachePaddle(state, b, msg, emit) {
  state.paddle_cache.get().x = b.$x
}

export function markBrickDead(state, b, msg, emit) {
  const key = b.$row * COLS + b.$col
  if (!state.dead_bricks.find(key)) {
    state.dead_bricks.insert({ key })
  }
}

export function moveBall(state, b, msg, emit) {
  const ball = state.pos.get()
  const px   = state.paddle_cache.get().x

  let nx  = ball.x + ball.vx
  let ny  = ball.y + ball.vy
  let nvx = ball.vx
  let nvy = ball.vy

  // ── Wall bounces ──────────────────────────────────────────────────────────
  if (nx < R) {
    nx  = R
    nvx = 0 - nvx
    emit('ball.bounced', { surface: 'left_wall', x: nx, y: ny })
  }
  if (nx > W - R) {
    nx  = W - R
    nvx = 0 - nvx
    emit('ball.bounced', { surface: 'right_wall', x: nx, y: ny })
  }
  if (ny < R) {
    ny  = R
    nvy = 0 - nvy
    emit('ball.bounced', { surface: 'top_wall', x: nx, y: ny })
  }

  // ── Paddle collision ──────────────────────────────────────────────────────
  // Ball hits top face of paddle when coming downward
  if (nvy > 0 && ny > PY - PH_H - R && ny < PY + PH_H && nx >= px - PH_W && nx <= px + PH_W) {
    ny  = PY - PH_H - R
    nvy = 0 - Math.abs(nvy)
    emit('ball.bounced', { surface: 'paddle', x: nx, y: ny })
  }

  // ── Ball lost (below paddle) ───────────────────────────────────────────────
  if (ny > H) {
    emit('ball.lost', { x: nx, y: ny })
    nx  = SPAWN_X
    ny  = SPAWN_Y
    nvx = 3
    nvy = -3
  }

  // ── Brick collision ───────────────────────────────────────────────────────
  // Ball carries its own dead_bricks cache so it only bounces off alive bricks.
  // Emit ball.hit_brick for the first collision found; the bricks unit handles
  // removing the brick and awarding points.
  let hitCol = -1
  let hitRow = -1
  let hitFromSide = false

  let row = 0
  while (row < ROWS && hitCol < 0) {
    let col = 0
    while (col < COLS && hitCol < 0) {
      const dead = state.dead_bricks.find(row * COLS + col)
      if (!dead) {
        const bx1 = BX_OFF + col * BW
        const bx2 = bx1 + BW - 2
        const by1 = BY_OFF + row * BH
        const by2 = by1 + BH - 2

        if (nx >= bx1 - R && nx <= bx2 + R && ny >= by1 - R && ny <= by2 + R) {
          hitCol = col
          hitRow = row
          // Side hit if ball entered from the left or right
          hitFromSide = (ball.x < bx1 || ball.x > bx2)
        }
      }
      col++
    }
    row++
  }

  if (hitCol >= 0) {
    if (hitFromSide) {
      nvx = 0 - nvx
    } else {
      nvy = 0 - nvy
    }
    emit('ball.bounced', { surface: 'brick', x: nx, y: ny })
    emit('ball.hit_brick', { col: hitCol, row: hitRow, x: nx, y: ny })
  }

  ball.x  = nx
  ball.y  = ny
  ball.vx = nvx
  ball.vy = nvy
}
