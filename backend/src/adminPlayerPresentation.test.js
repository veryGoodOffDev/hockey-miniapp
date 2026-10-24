import test from "node:test";
import assert from "node:assert/strict";
import {
  canViewPlayerBotStatus,
  presentAdminPlayers,
} from "./adminPlayerPresentation.js";

const row = {
  tg_id: "10",
  display_name: "Иван",
  photo_url: "/original.png",
  avatar_file_id: "private-file-id",
  is_admin: false,
  pm_started: true,
  pm_started_at: "2026-10-01T10:00:00Z",
  pm_last_seen: "2026-10-20T12:00:00Z",
  last_seen_at: "2026-10-24T10:00:00Z",
};
const options = {
  envAdmins: new Set(["10"]),
  avatarUrl: (p) => `https://api.example/api/players/${p.tg_id}/avatar`,
};
test("bot-status visibility is restricted to the configured owner, not other environment admins", () => {
  assert.equal(canViewPlayerBotStatus(10, "10"), true);
  assert.equal(canViewPlayerBotStatus("10", " 10 "), true);
  for (const owner of ["", undefined, null, "0"])
    assert.equal(canViewPlayerBotStatus(10, owner), false);
  assert.equal(canViewPlayerBotStatus(20, "10"), false);
});
test("owner sees saved launch dates, avatar proxy and original editable photo URL", () => {
  const [player] = presentAdminPlayers([row], {
    ...options,
    canViewBotStatus: true,
  });
  assert.deepEqual(player.bot_pm, {
    started: true,
    started_at: row.pm_started_at,
    last_interaction_at: row.pm_last_seen,
  });
  assert.equal(player.avatar_url, "https://api.example/api/players/10/avatar");
  assert.equal(player.photo_url, "/original.png");
  assert.equal(player.is_admin, true);
  assert.equal(player.is_env_admin, true);
  assert.equal(player.last_seen_at, row.last_seen_at);
  for (const key of [
    "avatar_file_id",
    "pm_started",
    "pm_started_at",
    "pm_last_seen",
  ])
    assert.equal(key in player, false);
  assert.equal(row.avatar_file_id, "private-file-id");
});
test("non-owner payload omits all bot history even if DB rows contain it; no false delivery guarantee", () => {
  const [player] = presentAdminPlayers([row], {
    ...options,
    canViewBotStatus: false,
  });
  for (const key of [
    "bot_pm",
    "pm_started",
    "pm_started_at",
    "pm_last_seen",
    "avatar_file_id",
  ])
    assert.equal(key in player, false);
  const [unknown] = presentAdminPlayers(
    [{ tg_id: 11, is_admin: true, pm_started: false }],
    { ...options, canViewBotStatus: true },
  );
  assert.deepEqual(unknown.bot_pm, {
    started: false,
    started_at: null,
    last_interaction_at: null,
  });
  assert.equal(unknown.is_admin, true);
  assert.equal(unknown.is_env_admin, false);
});
