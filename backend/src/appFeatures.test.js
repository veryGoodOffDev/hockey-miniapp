import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import {
  createAppFeatures,
  normalizeAppFeatures,
  featureForRequest,
  DEFAULT_APP_FEATURES,
} from "./appFeatures.js";

test("new installations keep all features; booleans are strict and missing flags default to enabled", () => {
  for (const value of [null, undefined, "invalid", "{}", []]) {
    assert.deepEqual(normalizeAppFeatures(value), DEFAULT_APP_FEATURES);
  }
  assert.deepEqual(
    normalizeAppFeatures(
      '{"chat":false,"game_comments":"false","air_hockey":0,"unknown":false}',
    ),
    {
      chat: false,
      game_comments: true,
      air_hockey: true,
    },
  );
});

test("gates cover chat aliases, comments and hockey starts but preserve Telegram administration and current settlements", () => {
  for (const path of [
    "/api/chat/unread-total",
    "/api/chat/conversations",
    "/api/chat/messages",
    "/api/chat/messages/1/react",
    "/api/chat/dm/1/clear",
    "/api/messages/1",
    "/api/messages/1/reactions",
  ])
    assert.equal(featureForRequest(path, "POST"), "chat");
  for (const path of [
    "/api/game-comments",
    "/api/game-comments/1",
    "/api/game-comments/1/react",
    "/api/game-comments/1/pin",
    "/api/game-comments/1/reactors",
  ])
    assert.equal(featureForRequest(path, "DELETE"), "game_comments");
  for (const path of [
    "/api/game/air-hockey/start",
    "/api/game/shop/unlock-easy",
  ])
    assert.equal(featureForRequest(path, "POST"), "air_hockey");
  for (const path of [
    "/api/game/air-hockey/pvp/ticket",
    "/api/game/air-hockey/match-123/finish",
    "/api/me",
    "/api/games",
    "/api/game",
    "/api/features",
    "/api/admin/features",
    "/api/admin/chat-messages",
    "/api/admin/bot-messages/send",
    "/api/game/profile",
    "/api/game/shop/premium",
    "/api/messages-unrelated",
  ])
    assert.equal(featureForRequest(path, "POST"), null);
});

test("HTTP: persistent partial settings, admin-only strict writes, data-preserving API gates and re-enable", async () => {
  let stored,
    writes = 0,
    routeCalls = 0,
    broken = false;
  const q = async (sql, params) => {
    if (broken) throw new Error("offline");
    if (sql.startsWith("INSERT")) {
      assert.match(sql, /settings.value::jsonb \|\| EXCLUDED.value::jsonb/);
      stored = JSON.stringify({
        ...JSON.parse(stored || "{}"),
        ...JSON.parse(params[1]),
      });
      writes++;
    }
    return { rows: stored ? [{ value: stored }] : [] };
  };
  const features = createAppFeatures({
    q,
    logger: { error() {} },
    authenticate: (req, res) => {
      const user = req.header("x-test-user");
      if (!user) {
        res.status(401).json({ ok: false });
        return null;
      }
      return { id: user };
    },
    authorizeAdmin: (req, res, user) => {
      if (user.id === "admin") return true;
      res.status(403).json({ ok: false, reason: "not_admin" });
      return false;
    },
  });
  const app = express();
  app.use(express.json(), features.middleware);
  app.get("/api/features", features.read);
  app.patch("/api/admin/features", features.update);
  app.all(
    [
      "/api/chat/messages",
      "/api/game-comments",
      "/api/game/air-hockey/start",
      "/api/game/air-hockey/abc/finish",
      "/api/admin/chat-messages",
    ],
    (req, res) => {
      routeCalls++;
      res.json({ ok: true });
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = "GET", body, user = "admin") => {
    const res = await fetch(url + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(user ? { "x-test-user": user } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      data: await res.json(),
      cache: res.headers.get("cache-control"),
    };
  };
  try {
    assert.equal(
      (await request("/api/features", "GET", undefined, null)).status,
      401,
    );
    assert.equal(
      (await request("/api/admin/features", "PATCH", { chat: false }, "player"))
        .status,
      403,
    );
    assert.equal(writes, 0);
    for (const body of [
      {},
      [],
      { chat: "false" },
      { chat: 0 },
      { chat: null },
      { unknown: false },
      { chat: false, unknown: true },
    ])
      assert.equal(
        (await request("/api/admin/features", "PATCH", body)).status,
        400,
      );
    assert.equal(writes, 0);
    assert.deepEqual(
      (await request("/api/features")).data.features,
      DEFAULT_APP_FEATURES,
    );
    await request("/api/admin/features", "PATCH", { chat: false });
    await request("/api/admin/features", "PATCH", { game_comments: false });
    await request("/api/admin/features", "PATCH", { air_hockey: false });
    const read = await request("/api/features", "GET", undefined, "player");
    assert.equal(read.cache, "no-store");
    assert.deepEqual(read.data.features, {
      chat: false,
      game_comments: false,
      air_hockey: false,
    });
    // A new service instance reads the same persisted setting (no process-local defaults).
    assert.deepEqual(await createAppFeatures({ q }).get(), read.data.features);
    for (const [path, method, feature] of [
      ["/api/chat/messages", "POST", "chat"],
      ["/api/game-comments", "GET", "game_comments"],
      ["/api/game/air-hockey/start", "POST", "air_hockey"],
    ]) {
      const result = await request(path, method);
      assert.equal(result.status, 403);
      assert.deepEqual(result.data, {
        ok: false,
        reason: "feature_disabled",
        feature,
      });
    }
    assert.equal(routeCalls, 0);
    assert.equal(
      (await request("/api/game/air-hockey/abc/finish", "POST")).status,
      200,
    );
    assert.equal((await request("/api/admin/chat-messages")).status, 200);
    await request("/api/admin/features", "PATCH", DEFAULT_APP_FEATURES);
    assert.equal((await request("/api/chat/messages", "POST")).status, 200);
    assert.equal((await request("/api/game-comments")).status, 200);
    assert.equal(
      (await request("/api/game/air-hockey/start", "POST")).status,
      200,
    );
    broken = true;
    assert.equal((await request("/api/chat/messages", "POST")).status, 503);
    assert.equal((await request("/api/features")).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
