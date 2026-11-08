export function currentTeamYear(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      year: "numeric",
    }).format(now),
  );
}
export function yearRange(year) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
const dayMs = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
function periodStart(date, mode) {
  if (mode === "month") return date.slice(0, 7) + "-01";
  const time = Date.parse(date + "T00:00:00Z");
  return iso(time - ((new Date(time).getUTCDay() + 6) % 7) * dayMs);
}
function nextPeriod(key, mode) {
  if (mode === "week") return iso(Date.parse(key) + 7 * dayMs);
  const d = new Date(key + "T00:00:00Z");
  return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
export function summarizeGames(games) {
  const total = games.reduce((sum, g) => sum + g.players, 0);
  return {
    games: games.length,
    total,
    average: games.length ? total / games.length : null,
    min: games.length ? Math.min(...games.map((g) => g.players)) : null,
    max: games.length ? Math.max(...games.map((g) => g.players)) : null,
  };
}
export function attendanceBuckets(games, range, mode) {
  const buckets = new Map();
  for (
    let key = periodStart(range.from, mode);
    key <= range.to;
    key = nextPeriod(key, mode)
  ) {
    const next = nextPeriod(key, mode);
    buckets.set(key, {
      key,
      from: key < range.from ? range.from : key,
      to:
        iso(Date.parse(next) - dayMs) > range.to
          ? range.to
          : iso(Date.parse(next) - dayMs),
      games: [],
    });
  }
  for (const game of games) {
    if (game.date < range.from || game.date > range.to) continue;
    buckets.get(periodStart(game.date, mode))?.games.push(game);
  }
  return [...buckets.values()].map((b) => ({
    ...b,
    ...{ summary: summarizeGames(b.games) },
  }));
}
export function seasonStats(games) {
  const names = ["Зима", "Весна", "Лето", "Осень"];
  return names.map((name, i) => {
    const list = games.filter(
      (g) => Math.floor((Number(g.date.slice(5, 7)) % 12) / 3) === i,
    );
    return { name, ...summarizeGames(list) };
  });
}
export function bucketTitle(bucket, mode) {
  if (mode === "month")
    return new Date(bucket.key + "T00:00:00Z").toLocaleDateString("ru-RU", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    });
  const short = (d) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("ru-RU", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    });
  return `${short(bucket.from)}${bucket.from.slice(0, 4) !== bucket.to.slice(0, 4) ? ` ${bucket.from.slice(0, 4)}` : ""} — ${short(bucket.to)}, ${bucket.to.slice(0, 4)}`;
}
