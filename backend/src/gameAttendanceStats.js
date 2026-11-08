import { gameEndSql } from "./gameDuration.js";
import { parseAttendanceRange } from "./analyticsPeriods.js";

export function createGameAttendanceHandler({
  q,
  authenticate,
  now = () => new Date(),
  logger = console,
}) {
  return async (req, res) => {
    try {
      if (!(await authenticate(req, res))) return;
      const filter = parseAttendanceRange(req.query, now());
      const games = await q(
        `SELECT g.id, g.starts_at, g.location,
          to_char(g.starts_at AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS date,
          COUNT(r.tg_id) FILTER (WHERE r.status='yes')::int AS players
        FROM games g LEFT JOIN rsvps r ON r.game_id=g.id
        WHERE g.status <> 'cancelled' AND ${gameEndSql("g")} <= NOW()
          AND g.starts_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Moscow')
          AND g.starts_at < (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Moscow')
        GROUP BY g.id ORDER BY g.starts_at, g.id`,
        [filter.from, filter.to],
      );
      const years =
        await q(`SELECT DISTINCT EXTRACT(YEAR FROM starts_at AT TIME ZONE 'Europe/Moscow')::int AS year
        FROM games WHERE status <> 'cancelled' AND ${gameEndSql()} <= NOW() ORDER BY year`);
      res
        .set("Cache-Control", "no-store")
        .json({
          ok: true,
          filter,
          games: games.rows,
          years: years.rows.map((r) => r.year),
          as_of: now().toISOString(),
        });
    } catch (error) {
      if (!error.status) logger.error("[game attendance stats]", error.message);
      res
        .status(error.status || 503)
        .json({
          ok: false,
          reason: error.status ? error.message : "stats_unavailable",
        });
    }
  };
}
