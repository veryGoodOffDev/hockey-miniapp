const failure = (reason, status = 400) =>
  Object.assign(new Error(reason), { status });
export function validateTeamLineup(layout, teams) {
  if (!layout || typeof layout !== "object") throw failure("bad_lineup");
  const clean = {};
  for (const key of ["A", "B"]) {
    const players = teams[key],
      ids = new Set(players.map((p) => String(p.tg_id))),
      goalies = new Set(
        players
          .filter((p) => String(p.position).toUpperCase() === "G")
          .map((p) => String(p.tg_id)),
      );
    const side = layout[key];
    if (
      !side ||
      !Array.isArray(side.ice) ||
      !Array.isArray(side.bench) ||
      side.ice.length > 6 ||
      side.bench.length > players.length
    )
      throw failure("bad_lineup");
    const seen = new Set();
    let skaters = 0,
      keepers = 0;
    const take = (id) => {
      id = String(id);
      if (!ids.has(id) || seen.has(id)) throw failure("bad_lineup_player");
      seen.add(id);
      return id;
    };
    const ice = side.ice.map((item) => {
      if (
        !item ||
        typeof item.x !== "number" ||
        typeof item.y !== "number" ||
        !Number.isFinite(item.x) ||
        !Number.isFinite(item.y) ||
        item.x < 0.14 ||
        item.x > 0.86 ||
        item.y < 0.2 ||
        item.y > 0.8
      )
        throw failure("bad_lineup_position");
      const id = take(item.id);
      if (goalies.has(id)) keepers++;
      else skaters++;
      return { id, x: item.x, y: item.y };
    });
    const bench = side.bench.map(take);
    if (
      seen.size !== ids.size ||
      skaters !== Math.min(5, players.length - goalies.size) ||
      keepers !== Math.min(1, goalies.size)
    )
      throw failure("bad_lineup_count");
    clean[key] = { ice, bench };
  }
  return clean;
}
export async function saveTeamLineup(q, { gameId, lineup, revision }) {
  if (
    !Number.isSafeInteger(gameId) ||
    gameId <= 0 ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    throw failure("bad_lineup_request");
  const row = (
    await q(
      "SELECT team_a,team_b,meta,lineup_revision FROM teams WHERE game_id=$1",
      [gameId],
    )
  ).rows[0];
  if (!row) throw failure("no_teams", 404);
  if (row.meta?.locked) throw failure("teams_locked", 423);
  if (row.lineup_revision !== revision) throw failure("lineup_conflict", 409);
  const positions = (
    await q(
      `SELECT p.tg_id,COALESCE(r.pos_override,p.position) AS position FROM rsvps r JOIN players p ON p.tg_id=r.tg_id WHERE r.game_id=$1 AND r.status='yes'`,
      [gameId],
    )
  ).rows;
  const map = new Map(positions.map((p) => [String(p.tg_id), p.position]));
  const patch = (list) =>
    list.map((p) => ({
      ...p,
      position: map.get(String(p.tg_id)) || p.position,
    }));
  const clean = validateTeamLineup(lineup, {
    A: patch(row.team_a),
    B: patch(row.team_b),
  });
  const saved = await q(
    `UPDATE teams SET lineup=$2,lineup_revision=lineup_revision+1 WHERE game_id=$1 AND lineup_revision=$3 AND COALESCE(meta->>'locked','false')<>'true' RETURNING lineup,lineup_revision`,
    [gameId, JSON.stringify(clean), revision],
  );
  if (!saved.rows[0]) throw failure("lineup_conflict", 409);
  return saved.rows[0];
}

export function lineupRosterSignature(A, B) {
  return JSON.stringify(
    [A, B].map((list) =>
      list
        .map((p) => [String(p.tg_id), String(p.position).toUpperCase() === "G"])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
  );
}
