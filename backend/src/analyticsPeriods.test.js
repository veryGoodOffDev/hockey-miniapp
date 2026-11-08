import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEngagementPeriod,
  parseAttendanceRange,
} from "./analyticsPeriods.js";
const now = new Date("2026-11-08T09:00:00Z");
test("engagement keeps November/December and historical years instead of clamping to skill 1–10", () => {
  for (const year of [2024, 2025, 2026, 2027])
    for (let month = 1; month <= 12; month++) {
      assert.deepEqual(
        parseEngagementPeriod(
          { year: String(year), month: String(month) },
          now,
        ),
        {
          year,
          month,
          monthKey: `${year}-${String(month).padStart(2, "0")}-01`,
        },
      );
    }
  assert.equal(parseEngagementPeriod({}, now).monthKey, "2026-11-01");
  assert.equal(
    parseEngagementPeriod({}, new Date("2026-12-31T22:30:00Z")).monthKey,
    "2027-01-01",
  );
  for (const query of [
    { month: "13" },
    { month: "0" },
    { year: "1999" },
    { year: "2026.5" },
    { month: ["11"] },
  ])
    assert.throws(() => parseEngagementPeriod(query, now), /invalid_period/);
});
test("attendance ranges default to current team year, use inclusive days and reject invalid dates/ranges", () => {
  assert.deepEqual(parseAttendanceRange({}, now), {
    year: 2026,
    from: "2026-01-01",
    to: "2026-12-31",
  });
  assert.deepEqual(parseAttendanceRange({ year: "2025" }, now), {
    year: 2025,
    from: "2025-01-01",
    to: "2025-12-31",
  });
  assert.deepEqual(
    parseAttendanceRange({ from: "2024-02-29", to: "2024-03-01" }, now),
    { from: "2024-02-29", to: "2024-03-01" },
  );
  for (const query of [
    { from: "2026-02-29", to: "2026-03-01" },
    { from: "2026-04-31", to: "2026-05-01" },
    { from: "2026-11-08", to: "2026-11-01" },
    { from: "2026-01-01" },
    { year: "2026 OR true" },
  ])
    assert.throws(() => parseAttendanceRange(query, now));
  assert.throws(
    () => parseAttendanceRange({ from: "2000-01-01", to: "2026-12-31" }, now),
    /date_range_too_long/,
  );
});
