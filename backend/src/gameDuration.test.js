import test from "node:test";
import assert from "node:assert/strict";
import { parseGameDuration, gameEndSql } from "./gameDuration.js";
import {
  getGameFlags,
  gameEndAt,
  formatGameDuration,
  gameDurationMinutes,
} from "../../webapp/src/gameTiming.js";
test("duration defaults to 75 minutes; API accepts only whole minutes within one day", () => {
  assert.equal(parseGameDuration(), 75);
  for (const n of [1, 60, 75, 90, 1440]) assert.equal(parseGameDuration(n), n);
  for (const n of [0, -1, 1441, 75.5, NaN, Infinity, null, "75", [], true])
    assert.throws(() => parseGameDuration(n), /bad_duration_minutes/);
  assert.match(gameEndSql("g"), /g.starts_at \+ g.duration_minutes/);
  assert.throws(() => gameEndSql("g;DELETE"), /invalid_sql_alias/);
});
test("07:45 + 75 minutes ends at 09:00; custom duration, exact boundary and midnight remain correct", () => {
  const game = { starts_at: "2026-11-08T07:45:00+03:00", duration_minutes: 75 };
  const end = Date.parse("2026-11-08T09:00:00+03:00");
  assert.equal(gameEndAt(game), end);
  assert.equal(getGameFlags(game, end - 1).isLive, true);
  assert.equal(getGameFlags(game, end - 1).isFinished, false);
  assert.equal(getGameFlags(game, end).isFinished, true);
  assert.equal(getGameFlags(game, end).isLive, false);
  assert.equal(
    getGameFlags({ ...game, duration_minutes: 90 }, end).isLive,
    true,
  );
  assert.equal(
    getGameFlags({ ...game, duration_minutes: 60 }, end).isFinished,
    true,
  );
  assert.equal(gameDurationMinutes({}), 75);
  assert.equal(formatGameDuration(75), "1 ч 15 мин");
  assert.equal(formatGameDuration(90), "1 ч 30 мин");
  assert.equal(getGameFlags({}, end).isFinished, false);
  const late = { starts_at: "2026-11-08T23:45:00Z", duration_minutes: 75 };
  assert.equal(gameEndAt(late), Date.parse("2026-11-09T01:00:00Z"));
});
