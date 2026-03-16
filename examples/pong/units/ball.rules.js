// Screen constants
const W = 320
const H = 240
const R = 5          // ball radius

// Paddle geometry
const LP_X  = 12     // left paddle centre x
const RP_X  = 308    // right paddle centre x
const PW    = 8      // paddle half-width
const PH    = 20     // paddle half-height

// Respawn speed after a goal
const INIT_VX = 3
const INIT_VY = 2

export function cachePaddlePos(state, b, msg, emit) {
  const p = state.paddle_cache.find(b.$player)
  if (p) {
    p.y = b.$y
  } else {
    state.paddle_cache.insert({ player: b.$player, y: b.$y })
  }
}

export function moveBall(state, b, msg, emit) {
  const ball = state.pos.get()

  // Look up cached paddle positions (default to centre if not yet received)
  const lp = state.paddle_cache.find('left')
  const rp = state.paddle_cache.find('right')
  let lpy = 120
  let rpy = 120
  if (lp) lpy = lp.y
  if (rp) rpy = rp.y

  let nx  = ball.x + ball.vx
  let ny  = ball.y + ball.vy
  let nvx = ball.vx
  let nvy = ball.vy

  // ── Wall bounces ────────────────────────────────────────────────────────────
  if (ny < R) {
    ny  = R
    nvy = 0 - nvy
    emit('ball.bounced', { surface: 'top_wall', x: nx, y: ny })
  }
  if (ny > H - R) {
    ny  = H - R
    nvy = 0 - nvy
    emit('ball.bounced', { surface: 'bottom_wall', x: nx, y: ny })
  }

  // ── Paddle collisions ───────────────────────────────────────────────────────
  // Left paddle: centre x=12, half-width=8 → ball hits right face at x≈20
  if (nvx < 0 && nx < LP_X + PW + R && nx > LP_X - PW && ny >= lpy - PH && ny <= lpy + PH) {
    nx  = LP_X + PW + R
    nvx = 0 - nvx
    emit('ball.bounced', { surface: 'left_paddle', x: nx, y: ny })
  }
  // Right paddle: centre x=308, half-width=8 → ball hits left face at x≈300
  if (nvx > 0 && nx > RP_X - PW - R && nx < RP_X + PW && ny >= rpy - PH && ny <= rpy + PH) {
    nx  = RP_X - PW - R
    nvx = 0 - nvx
    emit('ball.bounced', { surface: 'right_paddle', x: nx, y: ny })
  }

  // ── Goals ───────────────────────────────────────────────────────────────────
  if (nx < 0) {
    // Right player scores — ball passed left paddle
    emit('ball.scored', { player: 'right', x: nx, y: ny })
    nx  = W / 2
    ny  = H / 2
    nvx = INIT_VX
    nvy = INIT_VY
  }
  if (nx > W) {
    // Left player scores — ball passed right paddle
    emit('ball.scored', { player: 'left', x: nx, y: ny })
    nx  = W / 2
    ny  = H / 2
    nvx = 0 - INIT_VX
    nvy = INIT_VY
  }

  ball.x  = nx
  ball.y  = ny
  ball.vx = nvx
  ball.vy = nvy
}
