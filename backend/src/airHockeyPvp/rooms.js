import { randomInt, randomUUID } from "node:crypto";
import { PVP_CONFIG } from "./config.js";
import { stepPuck } from "./physics.js";
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export class PvpRooms {
  constructor({
    repository,
    config = PVP_CONFIG,
    now = Date.now,
    send = () => {},
    logger = console,
  }) {
    this.repository = repository;
    this.config = config;
    this.now = now;
    this.send = send;
    this.logger = logger;
    this.rooms = new Map();
    this.users = new Map();
    this.timer = null;
    this.lastTick = now();
  }
  start() {
    if (this.timer) return;
    this.lastTick = this.now();
    this.timer = setInterval(() => this.tick(), 1000 / this.config.tickHz);
    this.timer.unref?.();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.rooms.clear();
    this.users.clear();
  }
  player(user) {
    return {
      id: String(user.id),
      name: String(user.name || "Игрок").slice(0, 80),
      connected: true,
      deadline: null,
    };
  }
  reset(room) {
    const c = this.config;
    room.physics = {
      b: { x: c.width / 2, y: 70, r: c.paddleRadius, vx: 0, vy: 0 },
      u: { x: c.width / 2, y: c.height - 70, r: c.paddleRadius, vx: 0, vy: 0 },
      p: { x: c.width / 2, y: c.height / 2, r: c.puckRadius, vx: 110, vy: 240 },
    };
    room.targets = [
      { x: c.width / 2, y: 70 },
      { x: c.width / 2, y: c.height - 70 },
    ];
    room.score = [0, 0];
    room.activeMs = 0;
    room.goalUntil = 0;
    room.winner = null;
    room.rewards = null;
    room.reasons = null;
    room.pendingReward = false;
    room.started = false;
    room.starting = false;
    room.retryAt = 0;
    room.rematch = new Set();
  }
  current(id) {
    const code = this.users.get(String(id));
    return code ? this.rooms.get(code) : null;
  }
  async create(user) {
    if (this.current(user.id)) throw new Error("already_in_room");
    if (this.rooms.size >= this.config.maxRooms) throw new Error("server_busy");
    let code;
    for (let i = 0; i < 100; i++) {
      code = String(randomInt(1000, 10000));
      if (!this.rooms.has(code)) break;
      code = null;
    }
    if (!code) throw new Error("server_busy");
    const room = {
      code,
      matchId: randomUUID(),
      players: [this.player(user), null],
      status: "waiting",
      createdAt: this.now(),
      lastSnapshot: 0,
    };
    this.reset(room);
    this.rooms.set(code, room);
    this.users.set(String(user.id), code);
    try {
      await this.repository.create(room);
    } catch (error) {
      this.remove(room);
      throw error;
    }
    this.broadcast(room, "room_state");
    return room;
  }
  async join(user, code) {
    const room = this.rooms.get(String(code));
    if (!room) throw new Error("room_not_found");
    if (["finished", "cancelled"].includes(room.status))
      throw new Error("room_finished");
    const own = room.players.findIndex((p) => p?.id === String(user.id));
    if (own >= 0) {
      this.reconnect(user);
      return room;
    }
    if (room.players[1]) throw new Error("room_full");
    if (this.current(user.id)) throw new Error("already_in_room");
    room.players[1] = this.player(user);
    this.users.set(String(user.id), room.code);
    try {
      await this.repository.join(room);
    } catch (e) {
      if (this.users.get(String(user.id)) === room.code)
        this.users.delete(String(user.id));
      if (!["finished", "cancelled"].includes(room.status))
        room.players[1] = null;
      throw e;
    }
    if (["finished", "cancelled"].includes(room.status)) {
      this.users.delete(String(user.id));
      throw new Error("room_finished");
    }
    room.status = room.players.every((p) => p.connected)
      ? "countdown"
      : "reconnecting";
    room.resumeStatus = "countdown";
    room.countdownLeft = this.config.countdownMs;
    this.broadcast(room, "room_state");
    return room;
  }
  reconnect(user) {
    const room = this.current(user.id);
    if (!room) return null;
    const slot = room.players.findIndex((p) => p?.id === String(user.id));
    const p = room.players[slot];
    p.connected = true;
    p.deadline = null;
    if (
      room.status === "reconnecting" &&
      room.players.filter(Boolean).every((p) => p.connected)
    ) {
      room.status = room.resumeStatus;
      this.broadcast(room, "reconnect");
    }
    this.send(String(user.id), "room_state", this.snapshot(room, slot));
    return room;
  }
  disconnect(id) {
    const room = this.current(id);
    if (!room) return;
    const p = room.players.find((p) => p?.id === String(id));
    p.connected = false;
    if (["finished", "cancelled"].includes(room.status)) {
      room.rematch.delete(String(id));
      this.broadcast(room, "room_state");
      return;
    }
    p.deadline = this.now() + this.config.reconnectMs;
    if (room.status !== "reconnecting") {
      room.resumeStatus = room.status;
      room.status = "reconnecting";
    }
    for (const m of [room.physics.b, room.physics.u]) m.vx = m.vy = 0;
    room.targets = [
      { x: room.physics.b.x, y: room.physics.b.y },
      { x: room.physics.u.x, y: room.physics.u.y },
    ];
    this.broadcast(room, "disconnect");
  }
  move(id, data) {
    const room = this.current(id);
    if (!room || room.status !== "playing" || room.goalUntil > this.now())
      return false;
    if (
      typeof data?.x !== "number" ||
      typeof data?.y !== "number" ||
      !Number.isFinite(data.x) ||
      !Number.isFinite(data.y)
    )
      return false;
    const slot = room.players.findIndex((p) => p?.id === String(id)),
      c = this.config,
      r = c.paddleRadius;
    room.targets[slot] = {
      x: clamp(data.x, r, c.width - r),
      y: clamp(
        data.y,
        slot === 0 ? r : c.height / 2 + r,
        slot === 0 ? c.height / 2 - r : c.height - r,
      ),
    };
    return true;
  }
  snapshot(room, slot) {
    return {
      code: room.code,
      matchId: room.matchId,
      slot,
      status: room.status,
      players: room.players.map((p) =>
        p ? { id: p.id, name: p.name, connected: p.connected } : null,
      ),
      score: room.score,
      physics: room.physics,
      width: this.config.width,
      height: this.config.height,
      countdown: Math.ceil((room.countdownLeft || 0) / 1000),
      goal: room.goalUntil > this.now() ? room.goal : null,
      winner: room.winner,
      finishReason: room.finishReason,
      rewards: room.rewards,
      rewardReasons: room.reasons,
      rewardPending: room.pendingReward,
      rematch: [...room.rematch],
      serverTime: this.now(),
    };
  }
  broadcast(room, event) {
    room.players.forEach((p, slot) => {
      if (p?.connected) this.send(p.id, event, this.snapshot(room, slot));
    });
  }
  finish(room, winner, reason) {
    if (["finished", "cancelled"].includes(room.status)) return;
    room.status = winner == null ? "cancelled" : "finished";
    room.winner = winner;
    room.finishReason = reason;
    room.finishedAt = this.now();
    room.pendingReward = true;
    this.broadcast(room, "room_state");
    void this.persistFinish(room);
  }
  async persistFinish(room) {
    if (room.saving || !room.pendingReward) return;
    room.saving = true;
    try {
      const out = await this.repository.finish(room);
      room.rewards = out.rewards;
      room.reasons = out.reasons;
      room.pendingReward = false;
      this.broadcast(room, "finish");
    } catch (e) {
      this.logger.error("[PvP] finish persistence failed", e.message);
      room.retryAt = this.now() + 2000;
    } finally {
      room.saving = false;
    }
  }
  leave(id) {
    const room = this.current(id);
    if (!room) return;
    if (["finished", "cancelled"].includes(room.status)) {
      this.users.delete(String(id));
      room.rematch.clear();
      const player = room.players.find((p) => p?.id === String(id));
      player.connected = false;
      this.broadcast(room, "room_state");
      return;
    }
    if (!room.players[1]) this.finish(room, null, "cancelled");
    else {
      const other = room.players.findIndex((p) => p?.id !== String(id));
      this.finish(
        room,
        room.started && room.players[other]?.connected ? other : null,
        "disconnect",
      );
    }
    this.users.delete(String(id));
  }
  async rematch(id) {
    const room = this.current(id);
    if (
      !room ||
      room.status !== "finished" ||
      room.pendingReward ||
      room.rematching
    )
      throw new Error("rematch_unavailable");
    if (
      room.players.some(
        (p) => !p?.connected || this.users.get(p.id) !== room.code,
      )
    )
      throw new Error("opponent_left");
    room.rematch.add(String(id));
    if (room.rematch.size < 2) {
      this.broadcast(room, "room_state");
      return;
    }
    room.rematching = true;
    const nextMatchId = randomUUID();
    try {
      await this.repository.create({ ...room, matchId: nextMatchId });
    } catch (e) {
      room.rematch.clear();
      throw e;
    } finally {
      room.rematching = false;
    }
    room.matchId = nextMatchId;
    this.reset(room);
    if (
      room.players.some(
        (p) => !p.connected || this.users.get(p.id) !== room.code,
      )
    ) {
      room.status = "waiting";
      this.finish(room, null, "cancelled");
      throw new Error("opponent_left");
    }
    room.status = "countdown";
    room.countdownLeft = this.config.countdownMs;
    room.createdAt = this.now();
    room.finishReason = null;
    this.broadcast(room, "room_state");
  }
  tick() {
    const now = this.now(),
      dt = Math.min(0.05, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    for (const room of this.rooms.values()) {
      if (["finished", "cancelled"].includes(room.status)) {
        if (room.rematching) continue;
        if (room.pendingReward && now >= (room.retryAt || 0))
          void this.persistFinish(room);
        if (
          !room.pendingReward &&
          now - room.finishedAt >= this.config.finishedMs
        )
          this.remove(room);
        continue;
      }
      if (now - room.createdAt > this.config.maxMatchMs) {
        this.finish(room, null, "time_limit");
        continue;
      }
      if (
        room.status === "waiting" &&
        now - room.createdAt >= this.config.waitingMs
      ) {
        this.finish(room, null, "waiting_timeout");
        continue;
      }
      if (room.status === "reconnecting") {
        const expired = room.players.findIndex(
          (p) => p && !p.connected && p.deadline <= now,
        );
        if (expired >= 0) {
          const other = room.players[1 - expired];
          this.finish(
            room,
            other?.connected && room.started ? 1 - expired : null,
            "disconnect",
          );
        }
        continue;
      }
      if (room.status === "countdown") {
        room.countdownLeft = Math.max(0, room.countdownLeft - dt * 1000);
        if (!room.countdownLeft && !room.starting) {
          room.starting = true;
          void this.repository
            .start(room)
            .then(() => {
              room.started = true;
              if (room.status === "countdown") room.status = "playing";
              else if (room.status === "reconnecting")
                room.resumeStatus = "playing";
              this.broadcast(room, "room_state");
            })
            .catch((e) => {
              this.logger.error("[PvP] start failed", e.message);
              this.finish(room, null, "server_error");
            })
            .finally(() => {
              room.starting = false;
            });
        }
      }
      if (room.status === "playing") {
        if (room.goalUntil <= now) {
          room.activeMs += dt * 1000;
          const n = Math.max(1, Math.ceil(dt / (1 / 180)));
          for (let i = 0; i < n; i++) {
            this.advance(room, dt / n);
            if (room.goalUntil > now || room.status !== "playing") break;
          }
        }
      }
      if (now - room.lastSnapshot >= 1000 / this.config.snapshotHz) {
        room.lastSnapshot = now;
        this.broadcast(room, "game_state");
      }
    }
  }
  advance(room, dt) {
    if (dt <= 0) return;
    const c = this.config;
    [room.physics.b, room.physics.u].forEach((m, slot) => {
      const t = room.targets[slot],
        dx = t.x - m.x,
        dy = t.y - m.y,
        d = Math.hypot(dx, dy),
        ratio = d ? Math.min(1, (c.paddleSpeed * dt) / d) : 0;
      const ox = m.x,
        oy = m.y;
      m.x += dx * ratio;
      m.y += dy * ratio;
      m.vx = (m.x - ox) / dt;
      m.vy = (m.y - oy) / dt;
    });
    const goal = stepPuck(room.physics, c.width, c.height, dt);
    if (goal) {
      const slot = goal === "player" ? 1 : 0;
      room.score[slot]++;
      room.goal = slot;
      room.goalUntil = this.now() + c.goalPauseMs;
      this.broadcast(room, "goal");
      if (room.score[slot] >= c.goalsToWin) {
        this.finish(room, slot, "goals");
        return;
      }
      room.physics.p = {
        x: c.width / 2,
        y: c.height / 2,
        r: c.puckRadius,
        vx: 110 * (room.score.reduce((a, b) => a + b, 0) % 2 ? 1 : -1),
        vy: slot === 0 ? 240 : -240,
      };
      for (const m of [room.physics.b, room.physics.u]) m.vx = m.vy = 0;
    }
  }
  remove(room) {
    this.rooms.delete(room.code);
    room.players.forEach((p) => {
      if (p && this.users.get(p.id) === room.code) this.users.delete(p.id);
    });
  }
}
