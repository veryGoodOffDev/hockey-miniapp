export const DEFAULT_GAME_DURATION_MINUTES = 75;
export function gameDurationMinutes(game) {
  const value = game?.duration_minutes;
  return Number.isInteger(value) && value >= 1 && value <= 1440
    ? value
    : DEFAULT_GAME_DURATION_MINUTES;
}
export function gameEndAt(game) {
  return Date.parse(game?.starts_at) + gameDurationMinutes(game) * 60000;
}
export function getGameFlags(game, now = Date.now()) {
  const start = Date.parse(game?.starts_at);
  if (!Number.isFinite(start))
    return { isPast: false, isFinished: false, isLive: false };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const end = gameEndAt(game);
  return {
    isPast: start < today.getTime(),
    isFinished: now >= end,
    isLive: now >= start && now < end,
  };
}
export function formatGameDuration(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    return "От 1 минуты до 24 часов";
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return [hours ? `${hours} ч` : "", rest ? `${rest} мин` : ""]
    .filter(Boolean)
    .join(" ");
}
