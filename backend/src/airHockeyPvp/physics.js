// PvP uses the same relative-velocity collisions and board mechanics as the bot mode.
export const MAX_PUCK_SPEED = 900;
export const MIN_PUCK_SPEED = 145;
export function collideMallet(p, m) {
  const dx = p.x - m.x,
    dy = p.y - m.y;
  const distance = Math.hypot(dx, dy),
    radius = p.r + m.r;
  if (distance >= radius) return false;
  const nx = distance ? dx / distance : 0,
    ny = distance ? dy / distance : 1;
  p.x = m.x + nx * radius;
  p.y = m.y + ny * radius;
  const approach = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  if (approach < 0) {
    p.vx -= 1.9 * approach * nx;
    p.vy -= 1.9 * approach * ny;
  }
  return true;
}

export function stepPuck(s, width, height, dt) {
  const { p, u, b } = s;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  collideMallet(p, u);
  collideMallet(p, b);
  const restitution = 0.93;
  if (p.x < p.r) {
    p.x = p.r;
    p.vx = Math.abs(p.vx) * restitution;
  }
  if (p.x > width - p.r) {
    p.x = width - p.r;
    p.vx = -Math.abs(p.vx) * restitution;
  }
  const left = width * 0.34,
    right = width * 0.66;
  // The whole puck must fit between the posts to enter the goal.
  const inGoal = p.x > left + p.r && p.x < right - p.r;
  if (p.y < p.r && !inGoal) {
    p.y = p.r;
    p.vy = Math.abs(p.vy) * restitution;
  }
  if (p.y > height - p.r && !inGoal) {
    p.y = height - p.r;
    p.vy = -Math.abs(p.vy) * restitution;
  }
  if (p.y < -p.r) return "player";
  if (p.y > height + p.r) return "bot";
  const friction = Math.pow(0.995, dt * 60);
  p.vx *= friction;
  p.vy *= friction;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > MAX_PUCK_SPEED) {
    p.vx *= MAX_PUCK_SPEED / speed;
    p.vy *= MAX_PUCK_SPEED / speed;
  } else if (speed < MIN_PUCK_SPEED) {
    p.vx = speed ? (p.vx / speed) * MIN_PUCK_SPEED : 0;
    p.vy = speed ? (p.vy / speed) * MIN_PUCK_SPEED : MIN_PUCK_SPEED;
  }
  // A corner rebound deterministically points inward; no random impulses.
  if (
    (p.x <= p.r + 0.5 || p.x >= width - p.r - 0.5) &&
    (p.y <= p.r + 0.5 || p.y >= height - p.r - 0.5)
  ) {
    const cornerSpeed = Math.max(MIN_PUCK_SPEED, Math.hypot(p.vx, p.vy));
    p.vx = ((p.x < width / 2 ? 1 : -1) * cornerSpeed) / Math.SQRT2;
    p.vy = ((p.y < height / 2 ? 1 : -1) * cornerSpeed) / Math.SQRT2;
  }
  return null;
}
