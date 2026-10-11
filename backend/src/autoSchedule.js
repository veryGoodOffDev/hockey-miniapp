export function createAutoScheduleService({
  q,
  withTransaction,
  timeZone = "Europe/Moscow",
}) {
  const AUTO_SCHEDULE_TZ = timeZone;

  function getZonedDateParts(date, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = dtf.formatToParts(date);
    const get = (t) => Number(parts.find((x) => x.type === t)?.value || 0);
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second"),
    };
  }

  function getTimeZoneOffsetMinutes(date, timeZone) {
    const p = getZonedDateParts(date, timeZone);
    const asUtcTs = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    return (asUtcTs - date.getTime()) / 60000;
  }

  function zonedTimeToUtc(
    { year, month, day, hour, minute, second = 0 },
    timeZone,
  ) {
    const utcGuess = new Date(
      Date.UTC(year, month - 1, day, hour, minute, second),
    );
    const offset = getTimeZoneOffsetMinutes(utcGuess, timeZone);
    return new Date(utcGuess.getTime() - offset * 60_000);
  }

  function getWeekdayInZone(date, timeZone) {
    const raw = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(date);
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[raw] ?? 0;
  }
  const AUTO_SCHEDULE_DEFAULTS = {
    enabled: false,
    target_count: 12,
    weekday: 0, // 0=Sun..6=Sat
    time: "07:45",
    location: "",
    geo_lat: null,
    geo_lon: null,
  };

  async function getAutoScheduleConfig(query = q) {
    const raw = (
      await query("SELECT value FROM settings WHERE key=$1", [
        "auto_schedule_config",
      ])
    ).rows[0]?.value;
    if (!raw) return { ...AUTO_SCHEDULE_DEFAULTS };
    try {
      const parsed = JSON.parse(raw);
      return {
        ...AUTO_SCHEDULE_DEFAULTS,
        ...parsed,
        target_count: Math.max(
          1,
          Math.min(
            60,
            Number(parsed?.target_count ?? AUTO_SCHEDULE_DEFAULTS.target_count),
          ),
        ),
        weekday: Math.max(
          0,
          Math.min(
            6,
            Number(parsed?.weekday ?? AUTO_SCHEDULE_DEFAULTS.weekday),
          ),
        ),
        time: /^\d{2}:\d{2}$/.test(String(parsed?.time || ""))
          ? String(parsed.time)
          : AUTO_SCHEDULE_DEFAULTS.time,
        location: String(parsed?.location || "").trim(),
        geo_lat:
          parsed?.geo_lat === null || parsed?.geo_lat === ""
            ? null
            : Number(parsed?.geo_lat),
        geo_lon:
          parsed?.geo_lon === null || parsed?.geo_lon === ""
            ? null
            : Number(parsed?.geo_lon),
        enabled: !!parsed?.enabled,
      };
    } catch {
      return { ...AUTO_SCHEDULE_DEFAULTS };
    }
  }

  function nextTemplateDate(
    fromDate,
    weekday,
    hh,
    mm,
    timeZone = AUTO_SCHEDULE_TZ,
  ) {
    const local = getZonedDateParts(fromDate, timeZone);
    const fromWeekday = getWeekdayInZone(fromDate, timeZone);

    let dayShift = (weekday - fromWeekday + 7) % 7;

    let y = local.year;
    let m = local.month;
    let d = local.day;

    const addDays = (days) => {
      const tmp = new Date(Date.UTC(y, m - 1, d + days));
      y = tmp.getUTCFullYear();
      m = tmp.getUTCMonth() + 1;
      d = tmp.getUTCDate();
    };

    if (dayShift > 0) addDays(dayShift);

    let candidate = zonedTimeToUtc(
      { year: y, month: m, day: d, hour: hh, minute: mm, second: 0 },
      timeZone,
    );

    if (candidate <= fromDate) {
      addDays(7);
      candidate = zonedTimeToUtc(
        { year: y, month: m, day: d, hour: hh, minute: mm, second: 0 },
        timeZone,
      );
    }

    return candidate;
  }

  async function ensureAutoScheduledGames(options = {}) {
    return withTransaction(async (q) => {
      await q("SELECT pg_advisory_xact_lock(81732, 2)");
      const { dryRun = false, ignoreEnabled = false } = options;
      const cfg = await getAutoScheduleConfig(q);
      const targetCount = Math.max(
        1,
        Math.min(60, Number(cfg.target_count || 12)),
      );
      const upcoming = await q(
        `SELECT id, starts_at
       FROM games
      WHERE status='scheduled' AND starts_at > NOW() - INTERVAL '2 hours'
      ORDER BY starts_at ASC`,
      );

      const upcomingCount = upcoming.rows.length;
      const result = {
        ok: true,
        enabled: !!cfg.enabled,
        target_count: targetCount,
        upcoming: upcomingCount,
        created: 0,
        created_games: [],
      };
      if (!ignoreEnabled && !cfg.enabled)
        return { ...result, skipped: "disabled", cfg };
      if (upcomingCount >= targetCount)
        return { ...result, skipped: "enough_games", cfg };

      const time = String(cfg.time || "07:45");
      const [hh, mm] = time.split(":").map((x) => Number(x));
      if (
        !Number.isFinite(hh) ||
        !Number.isFinite(mm) ||
        hh < 0 ||
        hh > 23 ||
        mm < 0 ||
        mm > 59
      ) {
        return { ...result, ok: false, reason: "bad_time", cfg };
      }

      const lat = cfg.geo_lat === null ? null : Number(cfg.geo_lat);
      const lon = cfg.geo_lon === null ? null : Number(cfg.geo_lon);
      if ((lat === null) !== (lon === null))
        return { ...result, ok: false, reason: "bad_geo_pair", cfg };
      if (
        (lat !== null && !Number.isFinite(lat)) ||
        (lon !== null && !Number.isFinite(lon))
      ) {
        return { ...result, ok: false, reason: "bad_geo", cfg };
      }

      const need = targetCount - upcomingCount;
      const existingStarts = new Set(
        upcoming.rows.map((g) => new Date(g.starts_at).toISOString()),
      );
      let cursor = new Date(
        Math.max(
          Date.now(),
          upcoming.rows.length
            ? new Date(
                upcoming.rows[upcoming.rows.length - 1].starts_at,
              ).getTime()
            : 0,
        ),
      );

      for (let i = 0; i < need; i++) {
        let candidate = nextTemplateDate(
          cursor,
          Number(cfg.weekday || 0),
          hh,
          mm,
          AUTO_SCHEDULE_TZ,
        );
        let guard = 0;
        while (existingStarts.has(candidate.toISOString()) && guard < 120) {
          candidate = new Date(candidate.getTime() + 7 * 24 * 60 * 60 * 1000);
          guard++;
        }
        if (guard >= 120) break;

        cursor = candidate;
        existingStarts.add(candidate.toISOString());

        if (dryRun) {
          result.created += 1;
          result.created_games.push({
            starts_at: candidate.toISOString(),
            location: String(cfg.location || "").trim(),
            geo_lat: lat,
            geo_lon: lon,
          });
          continue;
        }

        const ins = await q(
          `INSERT INTO games(starts_at, location, status, geo_lat, geo_lon)
       VALUES($1,$2,'scheduled',$3,$4)
       RETURNING id, starts_at, location, geo_lat, geo_lon, status`,
          [
            candidate.toISOString(),
            String(cfg.location || "").trim(),
            lat,
            lon,
          ],
        );
        result.created += 1;
        result.created_games.push(ins.rows[0]);
      }

      return { ...result, cfg };
    });
  }

  return { getAutoScheduleConfig, ensureAutoScheduledGames };
}

export function startAutoScheduleWorker({
  ensure,
  intervalMs = 60_000,
  logger = console,
}) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await ensure();
      if (!result.ok)
        logger.error("[auto schedule] check failed:", result.reason);
      else if (result.created)
        logger.info("[auto schedule] games created:", result.created);
    } catch (error) {
      logger.error("[auto schedule] check failed:", error.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
