// A/B correspond to the existing team labels in the lineups screen.
export const TEAM_COLORS = {
  white: {
    label: "Белые",
    message: "Ты в команде белых",
    fill: "#f8fafc",
    stroke: "#9bacbf",
    stripe: "#bdcddd",
  },
  blue: {
    label: "Синие",
    message: "Ты в команде синих",
    fill: "#288bff",
    stroke: "#a4d4ff",
    stripe: "#153f88",
  },
};
const idOf = (player) =>
  player != null
    ? String(typeof player === "object" ? (player.tg_id ?? "") : player)
    : "";
export function playerTeamColor(teams, playerId) {
  if (!teams || teams.ok === false || playerId == null) return null;
  const id = String(playerId),
    a = teams.teamA ?? teams.team_a,
    b = teams.teamB ?? teams.team_b,
    white = Array.isArray(a) && a.some((p) => idOf(p) === id),
    blue = Array.isArray(b) && b.some((p) => idOf(p) === id);
  // Invalid or ambiguous membership must not tell someone to bring the wrong jersey.
  return white === blue ? null : white ? "white" : "blue";
}
export function myGameTeamColor(detail, playerId) {
  if (!detail || detail.ok === false || playerId == null) return null;
  const rsvp = detail.rsvps?.find((p) => idOf(p) === String(playerId));
  return rsvp?.status === "yes"
    ? playerTeamColor(detail.teams, playerId)
    : null;
}
// Existing detail endpoint only; two in-flight requests, no polling, no requests for OUT/past games.
export async function fetchGameTeamColors({
  games,
  playerId,
  request,
  signal,
  onResult,
  now = Date.now(),
}) {
  if (playerId == null || signal?.aborted) return;
  const ids = [
    ...new Set(
      games
        .filter(
          (g) =>
            g.my_status === "yes" &&
            g.status !== "cancelled" &&
            new Date(g.starts_at).getTime() + 2 * 60 * 60_000 > now,
        )
        .map((g) => String(g.id)),
    ),
  ].slice(0, 12);
  let next = 0;
  async function worker() {
    while (!signal?.aborted && next < ids.length) {
      const id = ids[next++];
      try {
        const detail = await request(
          `/api/game?game_id=${encodeURIComponent(id)}`,
          { signal, timeoutMs: 10_000 },
        );
        if (!signal?.aborted && String(detail?.game?.id) === id)
          onResult(id, myGameTeamColor(detail, playerId));
      } catch {
        // Optional jersey hints must never prevent cards or RSVP controls from loading.
        if (!signal?.aborted) onResult(id, null);
      }
    }
  }
  await Promise.all([worker(), worker()]);
}
