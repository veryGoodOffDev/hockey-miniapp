import test from "node:test";
import assert from "node:assert/strict";
import {
  playerTeamColor,
  myGameTeamColor,
  fetchGameTeamColors,
} from "./teamColors.js";

test("existing A/B and raw detail formats map to white/blue; missing and ambiguous membership stay hidden", () => {
  assert.equal(
    playerTeamColor({ teamA: [{ tg_id: 1 }], teamB: [{ tg_id: "2" }] }, "1"),
    "white",
  );
  assert.equal(playerTeamColor({ team_a: [1], team_b: ["2"] }, 2), "blue");
  for (const teams of [
    null,
    {},
    { team_a: [], team_b: [] },
    { ok: false, team_a: [1] },
    { team_a: [1], team_b: [1] },
  ])
    assert.equal(playerTeamColor(teams, 1), null);
  assert.equal(playerTeamColor({ team_a: [1] }, null), null);
  const detail = {
    teams: { team_b: [{ tg_id: 1 }] },
    rsvps: [{ tg_id: "1", status: "yes" }],
  };
  assert.equal(myGameTeamColor(detail, 1), "blue");
  assert.equal(
    myGameTeamColor({ ...detail, rsvps: [{ tg_id: 1, status: "no" }] }, 1),
    null,
  );
  assert.equal(myGameTeamColor({ ...detail, rsvps: [] }, 1), null);
});
test("background loading only requests 12 unique joined live/upcoming games, limits concurrency and tolerates errors", async () => {
  const now = Date.now(),
    date = new Date(now + 86_400_000).toISOString();
  const games = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    my_status: "yes",
    status: "scheduled",
    starts_at: date,
  }));
  games.unshift(
    { ...games[0], id: 100, my_status: "no" },
    { ...games[0], id: 101, my_status: "maybe" },
    { ...games[0], id: 102, status: "cancelled" },
    {
      ...games[0],
      id: 103,
      starts_at: new Date(now - 86_400_000).toISOString(),
    },
  );
  games.push(games[5]);
  let active = 0,
    maxActive = 0;
  const calls = [],
    result = new Map();
  await fetchGameTeamColors({
    games,
    playerId: 7,
    now,
    onResult: (id, color) => result.set(id, color),
    request: async (url, opts) => {
      const id = new URL(url, "https://test.invalid").searchParams.get(
        "game_id",
      );
      calls.push(id);
      active++;
      maxActive = Math.max(maxActive, active);
      assert.equal(opts.timeoutMs, 10_000);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      if (id === "2") throw new Error("offline");
      return {
        game: { id },
        teams: { team_a: [7] },
        rsvps: [{ tg_id: 7, status: "yes" }],
      };
    },
  });
  assert.equal(maxActive, 2);
  assert.equal(calls.length, 12);
  assert.equal(new Set(calls).size, 12);
  assert.equal(result.get("1"), "white");
  assert.equal(result.get("2"), null);
  assert.ok(!calls.some((id) => Number(id) >= 100));
});
test("aborting cancels queued work and suppresses late results; wrong-game responses cannot set a hint", async () => {
  const controller = new AbortController(),
    result = [],
    date = new Date(Date.now() + 86_400_000).toISOString();
  const games = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    my_status: "yes",
    starts_at: date,
  }));
  let calls = 0;
  await fetchGameTeamColors({
    games,
    playerId: 1,
    signal: controller.signal,
    request: async () => {
      calls++;
      controller.abort();
      return {
        game: { id: 1 },
        teams: { team_a: [1] },
        rsvps: [{ tg_id: 1, status: "yes" }],
      };
    },
    onResult: (...args) => result.push(args),
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, []);
  await fetchGameTeamColors({
    games: games.slice(0, 1),
    playerId: 1,
    request: async () => ({
      game: { id: 999 },
      teams: { team_a: [1] },
      rsvps: [{ tg_id: 1, status: "yes" }],
    }),
    onResult: (...args) => result.push(args),
  });
  assert.deepEqual(result, []);
});
