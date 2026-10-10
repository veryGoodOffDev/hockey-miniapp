export const MAX_PUCK_SPEED = 900;
export const MIN_PUCK_SPEED = 80;
export const BOT_LEVELS = Object.freeze({
  easy: { speed: 205, acceleration: 950, reaction: .24, error: 36, mistake: .24 },
  normal: { speed: 285, acceleration: 1350, reaction: .17, error: 24, mistake: .17 },
  hard: { speed: 365, acceleration: 1800, reaction: .11, error: 15, mistake: .11 },
  pro: { speed: 445, acceleration: 2300, reaction: .075, error: 9, mistake: .07 },
});

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// Fold the projected path at both side boards, including multiple rebounds.
export function predictPuckX(puck, y, width) {
  const time = puck.vy < -1 ? Math.max(0, (y - puck.y) / puck.vy) : 0;
  const span = width - puck.r * 2;
  const unfolded = puck.x + puck.vx * time - puck.r;
  const folded = ((unfolded % (span * 2)) + span * 2) % (span * 2);
  return puck.r + (folded > span ? span * 2 - folded : folded);
}

export function moveBot(s, width, height, dt, difficulty, random = Math.random) {
  const cfg = BOT_LEVELS[difficulty] || BOT_LEVELS.normal;
  const { p, b, u } = s;
  const brain = s.brain ||= { wait: 0, target: { x: width / 2, y: 65 } };
  brain.wait -= dt;
  if (brain.wait <= 0) {
    const reaction = cfg.reaction * (.85 + random() * .3);
    const miss = random() < cfg.mistake;
    brain.wait = reaction + (miss ? .14 : 0);
    const error = (random() * 2 - 1) * (miss ? Math.max(42, cfg.error * 2.5) : cfg.error);
    const homeY = Math.min(68, height * .15);
    let x = width / 2, y = homeY;
    brain.mode = "recover";
    if (p.vy < -210) {
      // Hold a line between the puck and our goal, rather than retreating
      // at puck speed. Anticipate shots that rebound off the side boards.
      brain.mode = "defend";
      x = predictPuckX(p, homeY, width) + error;
    } else if (p.y < height / 2 + p.r && p.y > b.r + p.r) {
      brain.mode = "attack";
      // Approach from our goal side, then drive THROUGH the puck. Aim for
      // the open side of the opponent's goal, not straight at their mallet.
      const aimX = width / 2 + (u.x >= width / 2 ? -1 : 1) * width * .10;
      const dx = aimX - p.x, dy = height - p.y, length = Math.hypot(dx, dy);
      const nx = dx / length, ny = dy / length;
      const behindX = p.x - nx * (p.r + b.r + 8);
      const behindY = p.y - ny * (p.r + b.r + 8);
      const linedUp = Math.abs(b.x - behindX) < b.r * 1.2 && b.y < p.y && p.y - b.y < p.r + b.r + 45;
      x = (linedUp ? p.x + nx * 42 : behindX) + error * .45;
      y = linedUp ? p.y + ny * 42 : behindY;
      if (miss) y -= 28;
    } else if (p.y <= b.r + p.r) {
      brain.mode = "defend";
      x = p.x + error;
      y = b.r;
    }
    brain.target = { x: clamp(x, b.r, width - b.r), y: clamp(y, b.r, height / 2 - b.r) };
  }
  const dx = brain.target.x - b.x, dy = brain.target.y - b.y;
  const distance = Math.hypot(dx, dy);
  // Accelerate and brake: no teleporting or full-speed impulses at rest.
  const speed = Math.min(cfg.speed, Math.sqrt(2 * cfg.acceleration * distance));
  const desiredX = distance ? dx / distance * speed : 0;
  const desiredY = distance ? dy / distance * speed : 0;
  const dvx = desiredX - b.vx, dvy = desiredY - b.vy;
  const change = Math.hypot(dvx, dvy);
  const ratio = change ? Math.min(1, cfg.acceleration * dt / change) : 0;
  b.vx += dvx * ratio; b.vy += dvy * ratio;
  const oldX = b.x, oldY = b.y;
  b.x = clamp(b.x + b.vx * dt, b.r, width - b.r);
  b.y = clamp(b.y + b.vy * dt, b.r, height / 2 - b.r);
  b.vx = (b.x - oldX) / dt; b.vy = (b.y - oldY) / dt;
}

export function collideMallet(p, m) {
  const dx = p.x - m.x, dy = p.y - m.y;
  const distance = Math.hypot(dx, dy), radius = p.r + m.r;
  if (distance >= radius) return false;
  const nx = distance ? dx / distance : 0, ny = distance ? dy / distance : 1;
  p.x = m.x + nx * radius; p.y = m.y + ny * radius;
  const approach = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  if (approach < 0) {
    p.vx -= 1.9 * approach * nx;
    p.vy -= 1.9 * approach * ny;
  }
  return true;
}

export function stepPuck(s, width, height, dt) {
  const { p, u, b } = s;
  p.x += p.vx * dt; p.y += p.vy * dt;
  collideMallet(p, u); collideMallet(p, b);
  const restitution = .93;
  if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * restitution; }
  if (p.x > width - p.r) { p.x = width - p.r; p.vx = -Math.abs(p.vx) * restitution; }
  const left = width * .34, right = width * .66;
  // The whole puck must fit between the posts to enter the goal.
  const inGoal = p.x > left + p.r && p.x < right - p.r;
  if (p.y < p.r && !inGoal) { p.y = p.r; p.vy = Math.abs(p.vy) * restitution; }
  if (p.y > height - p.r && !inGoal) { p.y = height - p.r; p.vy = -Math.abs(p.vy) * restitution; }
  if (p.y < -p.r) return "player";
  if (p.y > height + p.r) return "bot";
  const friction = Math.pow(.995, dt * 60);
  p.vx *= friction; p.vy *= friction;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > MAX_PUCK_SPEED) { p.vx *= MAX_PUCK_SPEED / speed; p.vy *= MAX_PUCK_SPEED / speed; }
  else if (speed < MIN_PUCK_SPEED) {
    p.vx = speed ? p.vx / speed * MIN_PUCK_SPEED : 0;
    p.vy = speed ? p.vy / speed * MIN_PUCK_SPEED : MIN_PUCK_SPEED;
  }
  return null;
}
