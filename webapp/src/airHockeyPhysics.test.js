import assert from "node:assert/strict";
import test from "node:test";
import { BOT_LEVELS, collideMallet, moveBot, predictPuckX, stepPuck, MAX_PUCK_SPEED } from "./airHockeyPhysics.js";

const W = 360, H = 620, dt = 1 / 240;
function randomSeed(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
function state(puck = {}) {
  return {
    p: { x: 180, y: 240, vx: 0, vy: -80, r: 10, ...puck },
    b: { x: 180, y: 58, vx: 0, vy: 0, r: 22 },
    u: { x: 180, y: H - 58, vx: 0, vy: 0, r: 22 },
  };
}

test("shot prediction follows single and multiple board rebounds", () => {
  assert.equal(predictPuckX({ x: 180, y: 258, vx: 300, vy: -200, r: 10 }, 58, W), 220);
  assert.equal(predictPuckX({ x: 180, y: 258, vx: -980, vy: -200, r: 10 }, 58, W), 140);
});

test("a stationary mallet reflects incoming pucks without accelerating separating pucks", () => {
  const m = { x: 180, y: 58, vx: 0, vy: 0, r: 22 };
  const p = { x: 180, y: 86, vx: 0, vy: -80, r: 10 };
  collideMallet(p, m);
  assert.ok(p.vy > 0);
  p.y = 86; p.vy = 90;
  collideMallet(p, m);
  assert.equal(p.vy, 90);
});

test("goal mouth requires the entire puck to fit; high-speed impacts remain bounded", () => {
  const blocked = state({ x: W * .34 + 5, y: 8, vy: -100 });
  stepPuck(blocked, W, H, dt);
  assert.ok(blocked.p.vy > 0);
  assert.equal(stepPuck(state({ y: -11, vy: -100 }), W, H, dt), "player");
  assert.equal(stepPuck(state({ y: H + 11, vy: 100 }), W, H, dt), "bot");
  const s = state({ x: 40, y: 380, vx: 4000, vy: 1000 });
  stepPuck(s, W, H, dt);
  assert.ok(Math.hypot(s.p.vx, s.p.vy) <= MAX_PUCK_SPEED + .001);
});

for (const level of Object.keys(BOT_LEVELS)) {
  test(`${level}: intercepts a gentle shot and actively shoots a reachable puck`, () => {
    const gentle = state(), random = randomSeed(71);
    let returned = false;
    for (let i = 0; i < 240 * 3; i++) {
      moveBot(gentle, W, H, dt, level, random);
      const who = stepPuck(gentle, W, H, dt);
      assert.notEqual(who, "player", "gentle central shot must not be dodged");
      if (gentle.p.vy > 100) { returned = true; break; }
    }
    assert.ok(returned);
    const attack = state({ y: 170, vy: 0 }), attackRandom = randomSeed(71);
    let fastestShot = 0, furthestForward = 0;
    for (let i = 0; i < 240 * 3; i++) {
      moveBot(attack, W, H, dt, level, attackRandom);
      stepPuck(attack, W, H, dt);
      fastestShot = Math.max(fastestShot, attack.p.vy);
      furthestForward = Math.max(furthestForward, attack.b.y);
      assert.ok(attack.b.y >= attack.b.r && attack.b.y <= H / 2 - attack.b.r);
      assert.ok(Math.hypot(attack.b.vx, attack.b.vy) <= BOT_LEVELS[level].speed + .001);
    }
    assert.ok(furthestForward > 120, "bot must leave the goalkeeper position");
    assert.ok(fastestShot > 180, "bot must drive the puck toward the player's goal");
  });

  test(`${level}: can concede shots rather than being an unbeatable goalkeeper`, () => {
    let goals = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const random = randomSeed(seed * 718);
      const s = state({ x: 40 + random() * 280, y: 320, vx: (random() - .5) * 550, vy: -(150 + random() * 600) });
      s.b.x = 40 + random() * 280;
      for (let i = 0; i < 240 * 3; i++) {
        moveBot(s, W, H, dt, level, random);
        const who = stepPuck(s, W, H, dt);
        if (who === "player") { goals++; break; }
        if (who || (s.p.vy > 100 && s.p.y < H / 2)) break;
      }
    }
    assert.ok(goals > 0, "at least some shots should beat this level");
    assert.ok(goals < 120, "the bot must still defend most attacks");
  });
}
