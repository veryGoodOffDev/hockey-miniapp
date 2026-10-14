export const playerId = (p) => String(p.tg_id);
export const isGoalie = (p) => String(p?.position).toUpperCase() === "G";
export function defaultTeamLineup(players) {
  const goalie = players.find(isGoalie),
    skaters = players.filter((p) => !isGoalie(p)),
    defenders = skaters
      .filter((p) => String(p.position).toUpperCase() === "D")
      .slice(0, 2);
  const ordered = [
    ...defenders,
    ...skaters.filter((p) => !defenders.includes(p)),
  ].slice(0, 5);
  const spots = [
    { x: 0.28, y: 0.62 },
    { x: 0.72, y: 0.62 },
    { x: 0.2, y: 0.28 },
    { x: 0.5, y: 0.25 },
    { x: 0.8, y: 0.28 },
  ];
  const ice = ordered.map((p, i) => ({ id: playerId(p), ...spots[i] }));
  if (goalie) ice.push({ id: playerId(goalie), x: 0.5, y: 0.8 });
  const ids = new Set(ice.map((p) => p.id));
  return {
    ice,
    bench: players.filter((p) => !ids.has(playerId(p))).map(playerId),
  };
}
export function initialLineup(teams, saved) {
  const out = {};
  for (const key of ["A", "B"]) {
    const side = saved?.[key],
      players = teams[key],
      ids = new Set(players.map(playerId));
    const selected = side?.ice?.map((p) => p.id) || [],
      all = [...selected, ...(side?.bench || [])];
    const goalies = side?.ice?.filter((item) =>
      isGoalie(players.find((p) => playerId(p) === item.id)),
    ).length;
    const valid =
      side &&
      all.length === ids.size &&
      new Set(all).size === ids.size &&
      all.every((id) => ids.has(id)) &&
      goalies === Math.min(1, players.filter(isGoalie).length) &&
      side.ice.length - goalies ===
        Math.min(5, players.filter((p) => !isGoalie(p)).length);
    out[key] = valid ? structuredClone(side) : defaultTeamLineup(players);
  }
  return out;
}
// Replacements only happen within one team and between players of the same goalie/skater kind.
export function moveLineupPlayer(
  layout,
  teams,
  key,
  id,
  destination,
  point = { x: 0.5, y: 0.4 },
) {
  const next = structuredClone(layout),
    side = next[key],
    players = teams[key],
    player = players.find((p) => playerId(p) === id);
  if (!player) return layout;
  const sameKind = (other) =>
    isGoalie(players.find((p) => playerId(p) === other)) === isGoalie(player);
  const index = side.ice.findIndex((p) => p.id === id),
    benchIndex = side.bench.indexOf(id);
  if (destination === "bench" && index >= 0) {
    const replacement = side.bench.findIndex(sameKind);
    if (replacement < 0) return layout;
    const swap = side.bench[replacement];
    side.bench[replacement] = id;
    side.ice[index].id = swap;
    return next;
  }
  if (destination === "ice") {
    if (index >= 0) {
      side.ice[index] = { id, ...point };
      return next;
    }
    if (benchIndex < 0) return layout;
    const candidates = side.ice
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => sameKind(p.id))
      .sort(
        (a, b) =>
          Math.hypot(a.p.x - point.x, a.p.y - point.y) -
          Math.hypot(b.p.x - point.x, b.p.y - point.y),
      );
    if (!candidates.length) return layout;
    const target = candidates[0];
    side.bench[benchIndex] = target.p.id;
    side.ice[target.i] = { id, ...point };
    return next;
  }
  return layout;
}
