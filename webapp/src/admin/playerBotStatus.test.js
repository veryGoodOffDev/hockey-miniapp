import test from "node:test";
import assert from "node:assert/strict";
import { playerBotStatus, botLaunchSummary } from "./playerBotStatus.js";
test("only real Telegram accounts have launch status; missing history is unconfirmed, never proof of not starting", () => {
  assert.equal(
    playerBotStatus({ tg_id: 1, player_kind: "tg", bot_pm: { started: true } }),
    "started",
  );
  assert.equal(
    playerBotStatus({ tg_id: 2, bot_pm: { started: false } }),
    "unconfirmed",
  );
  assert.equal(
    playerBotStatus({ tg_id: 3, last_seen_at: "2026-10-24T10:00:00Z" }),
    "unconfirmed",
  );
  for (const p of [
    { tg_id: -1 },
    { tg_id: 5, player_kind: "manual" },
    { tg_id: 6, player_kind: "email" },
    { tg_id: 7, is_guest: true },
    { tg_id: 8, player_kind: "guest" },
  ])
    assert.equal(
      playerBotStatus({ ...p, bot_pm: { started: true } }),
      "unavailable",
    );
});
test("summary counts active Telegram players only and does not mutate input", () => {
  const players = [
    { tg_id: 1, bot_pm: { started: true } },
    { tg_id: 2, bot_pm: { started: false } },
    { tg_id: 3, disabled: true, bot_pm: { started: true } },
    { tg_id: -1, player_kind: "manual" },
  ];
  const original = structuredClone(players);
  assert.deepEqual(botLaunchSummary(players), { total: 2, started: 1 });
  assert.deepEqual(players, original);
  assert.deepEqual(botLaunchSummary([]), { total: 0, started: 0 });
});
