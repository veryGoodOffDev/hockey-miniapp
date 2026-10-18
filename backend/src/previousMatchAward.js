// Pick the immediate preceding non-cancelled game first, even when it has no award.
// Filtering for winners before LIMIT would incorrectly carry a trophy across several games.
export async function getPreviousMatchAward(q, gameId) {
  const result = await q(
    `
    SELECT previous.id AS game_id, previous.starts_at,
      previous.best_player_tg_id AS tg_id,
      COALESCE(NULLIF(BTRIM(winner.display_name), ''),
        NULLIF(BTRIM(winner.first_name), ''),
        CASE WHEN BTRIM(winner.username) <> '' THEN '@' || BTRIM(winner.username) END,
        previous.best_player_tg_id::text) AS name
    FROM (
      SELECT earlier.id, earlier.starts_at, earlier.best_player_tg_id
      FROM games earlier
      JOIN games current_game ON current_game.id=$1
      WHERE current_game.status <> 'cancelled' AND earlier.status <> 'cancelled'
        AND (earlier.starts_at, earlier.id) < (current_game.starts_at, current_game.id)
      ORDER BY earlier.starts_at DESC, earlier.id DESC
      LIMIT 1
    ) previous
    LEFT JOIN players winner ON winner.tg_id=previous.best_player_tg_id
    WHERE previous.best_player_tg_id IS NOT NULL
      AND previous.starts_at <= NOW() - INTERVAL '2 hours'
  `,
    [gameId],
  );
  return result.rows[0] || null;
}
