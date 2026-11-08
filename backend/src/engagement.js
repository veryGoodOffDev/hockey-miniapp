import { parseEngagementPeriod } from "./analyticsPeriods.js";
export function createEngagementHandler({
  q,
  authenticate,
  now = () => new Date(),
  logger = console,
}) {
  return async (req, res) => {
    try {
      if (!(await authenticate(req, res))) return;
      res.set("Cache-Control", "no-store");
      let period;
      try {
        period = parseEngagementPeriod(req.query, now());
      } catch (error) {
        return res.status(400).json({ ok: false, reason: error.message });
      }
      const { year: reqYear, month: reqMonth, monthKey } = period;

      const stats = await q(
        `SELECT to_char(visit_date, 'YYYY-MM-DD') AS day_key, COUNT(*)::int AS visitors
     FROM app_daily_visits
     WHERE visit_date >= DATE_TRUNC('month', $1::date)::date
       AND visit_date < (DATE_TRUNC('month', $1::date) + INTERVAL '1 month')::date
     GROUP BY visit_date
     ORDER BY visit_date ASC`,
        [monthKey],
      );

      const visitors = await q(
        `SELECT
       to_char(v.visit_date, 'YYYY-MM-DD') AS day_key,
       v.tg_id,
       p.display_name,
       p.first_name,
       p.last_name,
       p.username,
       p.jersey_number
     FROM app_daily_visits v
     JOIN players p ON p.tg_id = v.tg_id
     WHERE v.visit_date >= DATE_TRUNC('month', $1::date)::date
       AND v.visit_date < (DATE_TRUNC('month', $1::date) + INTERVAL '1 month')::date
     ORDER BY v.visit_date ASC, COALESCE(NULLIF(BTRIM(p.display_name), ''), NULLIF(BTRIM(p.first_name), ''), NULLIF(BTRIM(p.username), ''), p.tg_id::text) ASC`,
        [monthKey],
      );

      const playersCountRes = await q(
        `SELECT COUNT(*)::int AS total
     FROM players
     WHERE disabled = FALSE
       AND player_kind IN ('tg', 'manual')`,
      );

      const byDay = {};
      for (const row of stats.rows) {
        byDay[row.day_key] = Number(row.visitors) || 0;
      }

      const usersByDay = {};
      for (const row of visitors.rows) {
        if (!usersByDay[row.day_key]) usersByDay[row.day_key] = [];
        usersByDay[row.day_key].push({
          tg_id: Number(row.tg_id),
          display_name: row.display_name || "",
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          username: row.username || "",
          jersey_number: row.jersey_number,
        });
      }

      res.json({
        ok: true,
        year: reqYear,
        month: reqMonth,
        team_size: Number(playersCountRes.rows?.[0]?.total || 0),
        by_day: byDay,
        users_by_day: usersByDay,
      });
    } catch (error) {
      logger.error("[engagement]", error.message);
      res.status(503).json({ ok: false, reason: "engagement_unavailable" });
    }
  };
}
