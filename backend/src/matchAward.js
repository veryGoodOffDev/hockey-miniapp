import { gameEndSql } from "./gameDuration.js";
const fail = (message, status) => Object.assign(new Error(message), { status });
export function createMatchAwardHandler({
  withTransaction,
  authenticate,
  logger = console,
}) {
  return async (req, res) => {
    try {
      const user = await authenticate(req, res);
      if (!user) return;
      const gameId = Number(req.params.id);
      const raw = req.body?.best_player_tg_id;
      const playerId =
        raw === null
          ? null
          : typeof raw === "number" ||
              (typeof raw === "string" && /^-?\d+$/.test(raw))
            ? Number(raw)
            : NaN;
      if (!Number.isSafeInteger(gameId) || gameId <= 0)
        throw fail("bad_game_id", 400);
      if (
        playerId !== null &&
        (!Number.isSafeInteger(playerId) || playerId === 0)
      )
        throw fail("bad_player", 400);
      const game = await withTransaction(async (q) => {
        const result = await q(
          `SELECT g.*, ${gameEndSql("g")} <= clock_timestamp() AS has_ended FROM games g WHERE g.id=$1 FOR UPDATE`,
          [gameId],
        );
        const current = result.rows[0];
        if (!current) throw fail("game_not_found", 404);
        if (current.status === "cancelled") throw fail("game_cancelled", 409);
        if (!current.has_ended) throw fail("game_not_finished", 409);
        if (playerId !== null) {
          const player = (
            await q("SELECT tg_id,disabled FROM players WHERE tg_id=$1", [
              playerId,
            ])
          ).rows[0];
          if (!player || player.disabled) throw fail("bad_player", 400);
        }
        return (
          await q(
            `UPDATE games SET best_player_tg_id=$2,best_player_set_by=$3,
          best_player_set_at=NOW(),best_player_source='manual',updated_at=NOW()
          WHERE id=$1 RETURNING *`,
            [gameId, playerId, user.id],
          )
        ).rows[0];
      });
      res.json({ ok: true, game });
    } catch (error) {
      if (!error.status) logger.error("[match award]", error.message);
      res.status(error.status || 503).json({
        ok: false,
        reason: error.status ? error.message : "award_unavailable",
      });
    }
  };
}
