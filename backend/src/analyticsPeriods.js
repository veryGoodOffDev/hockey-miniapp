const invalid = (reason) => Object.assign(new Error(reason), { status: 400 });
export function moscowYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return Object.fromEntries(
    parts
      .filter((p) => ["year", "month"].includes(p.type))
      .map((p) => [p.type, Number(p.value)]),
  );
}
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw invalid("invalid_period");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw invalid("invalid_period");
  return n;
}
export function parseEngagementPeriod(query, now = new Date()) {
  const current = moscowYearMonth(now);
  const year = integer(query.year, current.year, 2000, 2200);
  const month = integer(query.month, current.month, 1, 12);
  return {
    year,
    month,
    monthKey: `${year}-${String(month).padStart(2, "0")}-01`,
  };
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 10) === value &&
    value >= "2000-01-01" &&
    value <= "2200-12-31"
  );
}
export function parseAttendanceRange(query, now = new Date()) {
  if (query.from !== undefined || query.to !== undefined) {
    const { from, to } = query;
    if (!validDate(from) || !validDate(to) || from > to)
      throw invalid("invalid_date_range");
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 3660)
      throw invalid("date_range_too_long");
    return { from, to };
  }
  const year = integer(query.year, moscowYearMonth(now).year, 2000, 2200);
  return { year, from: `${year}-01-01`, to: `${year}-12-31` };
}
