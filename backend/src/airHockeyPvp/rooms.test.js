import test from "node:test";
import assert from "node:assert/strict";
import { PvpRooms } from "./rooms.js";
import { PVP_CONFIG } from "./config.js";
import { MIN_PUCK_SPEED, MAX_PUCK_SPEED, stepPuck } from "./physics.js";
const flush = () => new Promise((r) => setImmediate(r));
function fixture() {
  let now = 0,
    finishes = 0,
    creates = 0;
  const repository = {
    create: async () => {
      creates++;
    },
    join: async () => {},
    start: async () => {},
    finish: async () => {
      finishes++;
      return { rewards: [25, 3], reasons: ["awarded", "awarded"] };
    },
  };
  const rooms = new PvpRooms({
    repository,
    now: () => now,
    config: { ...PVP_CONFIG, countdownMs: 30, goalPauseMs: 0, finishedMs: 50 },
  });
  return {
    rooms,
    repository,
    advance: async (ms) => {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 16);
        rooms.tick();
        await flush();
      }
    },
    finishes: () => finishes,
    creates: () => creates,
  };
}
const a = { id: "1", name: "Иван" },
  b = { id: "2", name: "Алексей" };
test("room create/join/countdown/full/finished/rematch and cleanup", async () => {
  const f = fixture(),
    room = await f.rooms.create(a);
  assert.match(room.code, /^\d{4}$/);
  assert.equal(room.status, "waiting");
  await assert.rejects(f.rooms.create(a), /already_in_room/);
  await f.rooms.join(b, room.code);
  await assert.rejects(f.rooms.join({ id: 3 }, room.code), /room_full/);
  await f.advance(64);
  assert.equal(room.status, "playing");
  for (let i = 0; i < 7; i++) {
    room.physics.p = { x: 195, y: -11, r: 12, vx: 0, vy: -400 };
    room.physics.b.x = 32;
    f.rooms.advance(room, 1 / 180);
  }
  assert.deepEqual(room.score, [0, 7]);
  assert.equal(room.winner, 1);
  await flush();
  assert.equal(f.finishes(), 1);
  f.rooms.finish(room, 0, "goals");
  assert.equal(f.finishes(), 1);
  await assert.rejects(f.rooms.join({ id: 3 }, room.code), /room_finished/);
  const old = room.matchId;
  await f.rooms.rematch(a.id);
  assert.equal(room.matchId, old);
  await f.rooms.rematch(b.id);
  assert.notEqual(room.matchId, old);
  assert.equal(f.creates(), 2);
  assert.equal(room.status, "countdown");
  f.rooms.finish(room, null, "cancelled");
  await flush();
  await f.advance(64);
  assert.equal(f.rooms.rooms.size, 0);
  assert.equal(f.rooms.users.size, 0);
  f.rooms.start();
  assert.ok(f.rooms.timer);
  f.rooms.stop();
  assert.equal(f.rooms.timer, null);
});
test("server validates/clamps own half and limits paddle speed independently of client timestamps", async () => {
  const f = fixture(),
    r = await f.rooms.create(a);
  await f.rooms.join(b, r.code);
  await f.advance(64);
  assert.equal(f.rooms.move("1", { x: NaN, y: 3 }), false);
  assert.equal(f.rooms.move("1", { x: "100", y: 3 }), false);
  f.rooms.move("1", { x: -1e9, y: 1e9, timestamp: 1e30 });
  f.rooms.move("2", { x: 1e9, y: -1e9 });
  assert.equal(r.targets[0].x, 32);
  assert.equal(r.targets[0].y, 298);
  assert.equal(r.targets[1].y, 362);
  const before = { ...r.physics.b };
  f.rooms.advance(r, 1 / 180);
  assert.ok(
    Math.hypot(r.physics.b.x - before.x, r.physics.b.y - before.y) <=
      PVP_CONFIG.paddleSpeed / 180 + 0.0001,
  );
  assert.ok(r.physics.b.y <= 298);
  assert.ok(r.physics.u.y >= 362);
  assert.ok(Math.hypot(r.physics.b.vx, r.physics.b.vy) <= 1100.01);
});
test("disconnect pauses, reconnect resumes, timeout finishes only once", async () => {
  const f = fixture(),
    r = await f.rooms.create(a);
  await f.rooms.join(b, r.code);
  await f.advance(64);
  f.rooms.disconnect(a.id);
  assert.equal(r.status, "reconnecting");
  const active = r.activeMs;
  await f.advance(1000);
  assert.equal(r.activeMs, active);
  f.rooms.reconnect(a);
  assert.equal(r.status, "playing");
  f.rooms.disconnect(a.id);
  await f.advance(20016);
  assert.equal(r.status, "finished");
  assert.equal(r.winner, 1);
  assert.equal(r.finishReason, "disconnect");
  assert.equal(f.finishes(), 1);
  assert.ok(r.activeMs < 60000);
  await f.advance(100);
  assert.equal(f.finishes(), 1);
});
test("both disconnected cancels; waiting cancel frees user; persistence retries", async () => {
  const f = fixture();
  await f.rooms.create(a);
  f.rooms.leave(a.id);
  assert.equal(f.rooms.current(a.id), null);
  await flush();
  const r = await f.rooms.create(a);
  await f.rooms.join(b, r.code);
  await f.advance(64);
  f.rooms.disconnect(a.id);
  f.rooms.disconnect(b.id);
  await f.advance(20016);
  assert.equal(r.status, "cancelled");
  assert.equal(r.winner, null);
  const g = fixture(),
    s = await g.rooms.create(a);
  let attempts = 0;
  g.repository.finish = async () => {
    if (++attempts === 1) throw new Error("temporary");
    return { rewards: [0, 0], reasons: ["not_completed", "not_completed"] };
  };
  g.rooms.logger = { error: () => {} };
  g.rooms.finish(s, null, "cancelled");
  await flush();
  assert.ok(s.pendingReward);
  await g.advance(2016);
  assert.equal(attempts, 2);
  assert.equal(s.pendingReward, false);
});
test("puck has capped speed, real goals and deterministic corner exit", () => {
  const s = {
    b: { x: 32, y: 100, r: 32, vx: 0, vy: 0 },
    u: { x: 32, y: 500, r: 32, vx: 0, vy: 0 },
    p: { x: 12, y: 12, r: 12, vx: -900, vy: -900 },
  };
  stepPuck(s, 390, 660, 1 / 180);
  assert.ok(s.p.vx > 0 && s.p.vy > 0);
  assert.ok(Math.hypot(s.p.vx, s.p.vy) <= MAX_PUCK_SPEED + 0.01);
  s.p = { x: 195, y: 300, r: 12, vx: 0, vy: 0 };
  stepPuck(s, 390, 660, 1 / 180);
  assert.equal(Math.hypot(s.p.vx, s.p.vy), MIN_PUCK_SPEED);
  s.p = { x: 195, y: 672, r: 12, vx: 0, vy: 200 };
  assert.equal(stepPuck(s, 390, 660, 1 / 180), "bot");
});

test("concurrent create/join cannot place one identity in two rooms", async () => {
  const f = fixture();
  let release;
  f.repository.create = () =>
    new Promise((r) => {
      release = r;
    });
  const creating = f.rooms.create(a);
  await assert.rejects(f.rooms.create(a), /already_in_room/);
  release();
  const first = await creating;
  f.repository.create = async () => {};
  const second = await f.rooms.create({ id: "3" });
  f.repository.join = () =>
    new Promise((r) => {
      release = r;
    });
  const joining = f.rooms.join(b, first.code);
  await assert.rejects(f.rooms.join(b, second.code), /already_in_room/);
  release();
  await joining;
});
test("rematch is single-flight and a disconnect before its countdown cannot award a technical win", async () => {
  const f = fixture(),
    r = await f.rooms.create(a);
  await f.rooms.join(b, r.code);
  await f.advance(64);
  f.rooms.finish(r, 0, "goals");
  await flush();
  await f.rooms.rematch(a.id);
  let release;
  f.repository.create = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const rematch = f.rooms.rematch(b.id);
  await assert.rejects(f.rooms.rematch(a.id), /rematch_unavailable/);
  release();
  await rematch;
  assert.equal(r.started, false);
  f.rooms.disconnect(a.id);
  await f.advance(20016);
  assert.equal(r.status, "cancelled");
  assert.equal(r.winner, null);
});

test("closing a finished client prevents starting a rematch until reconnect", async () => {
  const f = fixture(),
    r = await f.rooms.create(a);
  await f.rooms.join(b, r.code);
  await f.advance(64);
  f.rooms.finish(r, 0, "goals");
  await flush();
  await f.rooms.rematch(a.id);
  f.rooms.disconnect(a.id);
  assert.equal(r.players[0].connected, false);
  assert.equal(r.rematch.size, 0);
  await assert.rejects(f.rooms.rematch(b.id), /opponent_left/);
  f.rooms.reconnect(a);
  await f.rooms.rematch(b.id);
  await f.rooms.rematch(a.id);
  assert.equal(r.status, "countdown");
});
