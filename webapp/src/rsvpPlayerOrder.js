export const playerPosition = (p) =>
  String(p.position || p.profile_position || "F").toUpperCase();
export function playerName(p) {
  const display = String(p.display_name || "").trim(),
    first = String(p.first_name || "").trim();
  return (
    display || first || (p.username ? `@${p.username}` : String(p.tg_id ?? "—"))
  );
}
export const POSITION_GROUPS = [
  { position: "G", title: "Вратари", icon: "🥅" },
  { position: "D", title: "Защитники", icon: "🛡" },
  { position: "F", title: "Нападающие", icon: "🏒" },
];
export function groupRsvpPlayers(list, tone, view = "list") {
  const time = (p) => {
    if (tone === "maybe") return Infinity;
    const value = p.status_changed_at ? Date.parse(p.status_changed_at) : NaN;
    return Number.isFinite(value) ? value : Infinity;
  };
  return POSITION_GROUPS.map((group) => ({
    ...group,
    players: list
      .filter((p) => {
        const position = playerPosition(p);
        return (
          (position === "G" || position === "D" ? position : "F") ===
          group.position
        );
      })
      .sort((a, b) => {
        if (view === "chips") {
          const lengthDifference =
            Array.from(playerName(a)).length - Array.from(playerName(b)).length;
          if (lengthDifference !== 0) return lengthDifference;
        }
        const first = time(a),
          second = time(b);
        if (first !== second) return first < second ? -1 : 1;
        return (
          playerName(a).localeCompare(playerName(b), "ru", {
            numeric: true,
            sensitivity: "base",
          }) || String(a.tg_id).localeCompare(String(b.tg_id))
        );
      }),
  })).filter((group) => group.players.length);
}
