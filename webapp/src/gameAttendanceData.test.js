import test from "node:test";
import assert from "node:assert/strict";
import {
  attendanceBuckets,
  summarizeGames,
  seasonStats,
  currentTeamYear,
} from "./gameAttendanceData.js";
test("weekly/monthly attendance uses games as denominator, keeps true zero and gaps distinct", () => {
  const games = [
    { id: 1, date: "2026-01-01", players: 10 },
    { id: 2, date: "2026-01-04", players: 30 },
    { id: 3, date: "2026-01-19", players: 0 },
    { id: 4, date: "2026-03-01", players: 35 },
  ];
  const range = { from: "2026-01-01", to: "2026-12-31" };
  const weeks = attendanceBuckets(games, range, "week");
  assert.equal(weeks[0].key, "2025-12-29");
  assert.equal(weeks[0].from, "2026-01-01");
  assert.equal(weeks[0].summary.average, 20);
  assert.equal(weeks[1].summary.average, null);
  assert.equal(weeks.find((b) => b.key === "2026-01-19").summary.average, 0);
  assert.equal(weeks.at(-1).to, "2026-12-31");
  const months = attendanceBuckets(games, range, "month");
  assert.equal(months.length, 12);
  assert.equal(months[0].summary.average, 40 / 3);
  assert.equal(months[1].summary.average, null);
  assert.equal(months[2].summary.average, 35);
  assert.deepEqual(summarizeGames(games), {
    games: 4,
    total: 75,
    average: 18.75,
    min: 0,
    max: 35,
  });
});
test("custom ranges clip week/month boundaries, include leap days, preserve seasons and Moscow New Year", () => {
  const games = [
    { date: "2024-02-28", players: 99 },
    { date: "2024-02-29", players: 20 },
    { date: "2024-03-01", players: 30 },
    { date: "2024-12-01", players: 10 },
  ];
  const bins = attendanceBuckets(
    games,
    { from: "2024-02-29", to: "2024-03-01" },
    "month",
  );
  assert.deepEqual(
    bins.map((b) => [b.from, b.to, b.summary.average]),
    [
      ["2024-02-29", "2024-02-29", 20],
      ["2024-03-01", "2024-03-01", 30],
    ],
  );
  assert.equal(seasonStats(games)[0].games, 3);
  assert.equal(seasonStats(games)[1].average, 30);
  assert.equal(seasonStats(games)[2].average, null);
  assert.equal(currentTeamYear(new Date("2026-12-31T22:00:00Z")), 2027);
});
