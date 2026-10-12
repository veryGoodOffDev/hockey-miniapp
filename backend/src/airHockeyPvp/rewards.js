import { PVP_CONFIG, PVP_REWARDS } from "./config.js";
export function createPvpRepository({
  q,
  withTransaction,
  config = PVP_CONFIG,
}) {
  const create = (room) =>
    q(
      `INSERT INTO air_hockey_pvp_matches(id,room_code,player_a_id,player_b_id,status) VALUES($1,$2,$3,$4,$5)`,
      [
        room.matchId,
        room.code,
        room.players[0].id,
        room.players[1]?.id || null,
        room.players[1] ? "countdown" : "waiting",
      ],
    );
  const join = (room) =>
    q(
      `UPDATE air_hockey_pvp_matches SET player_b_id=$2,status='countdown' WHERE id=$1 AND NOT reward_processed AND status IN ('waiting','countdown')`,
      [room.matchId, room.players[1].id],
    );
  const start = (room) =>
    q(
      `UPDATE air_hockey_pvp_matches SET started_at=NOW(),status='playing' WHERE id=$1 AND started_at IS NULL AND status='countdown'`,
      [room.matchId],
    );
  const finish = (room) =>
    withTransaction(async (tx) => {
      const row = (
        await tx(
          `SELECT * FROM air_hockey_pvp_matches WHERE id=$1 FOR UPDATE`,
          [room.matchId],
        )
      ).rows[0];
      if (!row) throw new Error("match_missing");
      if (row.reward_processed)
        return {
          rewards: [row.reward_a, row.reward_b],
          reasons: [row.reward_reason_a, row.reward_reason_b],
        };
      const players = room.players.filter(Boolean),
        winner = room.winner,
        reason = room.finishReason;
      // Serialize limits across matches for both participants, in stable order.
      for (const id of players
        .map((p) => p.id)
        .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))) {
        await tx(
          `INSERT INTO user_game_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING`,
          [id],
        );
        await tx(
          `SELECT user_id FROM user_game_profiles WHERE user_id=$1 FOR UPDATE`,
          [id],
        );
      }
      const rewards = [0, 0],
        reasons = ["not_completed", "not_completed"];
      const completed =
        room.status === "finished" &&
        winner != null &&
        room.players[1] &&
        (reason === "goals"
          ? room.score[winner] === config.goalsToWin
          : reason === "disconnect");
      const durationOk =
        room.activeMs >=
        (reason === "disconnect"
          ? config.minTechnicalActiveMs
          : config.minRewardActiveMs);
      const technicalOk =
        reason !== "disconnect" ||
        room.score[0] + room.score[1] >= config.minTechnicalGoals;
      for (let slot = 0; slot < players.length; slot++) {
        const userId = room.players[slot].id,
          other = room.players[1 - slot]?.id;
        if (!completed) {
          reasons[slot] = "not_completed";
          continue;
        }
        if (!durationOk || !technicalOk) {
          reasons[slot] = "too_short";
          continue;
        }
        if (reason === "disconnect" && slot !== winner) {
          reasons[slot] = "left_match";
          continue;
        }
        const limits = (
          await tx(
            `SELECT
        COUNT(*) FILTER(WHERE (player_a_id=$1 AND reward_a>0) OR (player_b_id=$1 AND reward_b>0))::int AS daily,
        COUNT(*) FILTER(WHERE ((player_a_id=$1 AND player_b_id=$2 AND reward_a>0) OR (player_b_id=$1 AND player_a_id=$2 AND reward_b>0)))::int AS pair
        FROM air_hockey_pvp_matches WHERE reward_processed AND finished_at >= date_trunc('day',NOW() AT TIME ZONE $3) AT TIME ZONE $3`,
            [userId, other, config.timeZone],
          )
        ).rows[0];
        if (limits.daily >= config.maxDailyRewards) {
          reasons[slot] = "daily_limit";
          continue;
        }
        if (limits.pair >= config.maxPairRewards) {
          reasons[slot] = "pair_limit";
          continue;
        }
        rewards[slot] = slot === winner ? PVP_REWARDS.win : PVP_REWARDS.loss;
        reasons[slot] = "awarded";
      }
      await tx(
        `UPDATE air_hockey_pvp_matches SET score_a=$2,score_b=$3,winner_id=$4,status=$5,finished_at=NOW(),active_ms=$6,finish_reason=$7,reward_a=$8,reward_b=$9,reward_reason_a=$10,reward_reason_b=$11,reward_processed=TRUE WHERE id=$1`,
        [
          room.matchId,
          ...room.score,
          winner == null ? null : room.players[winner].id,
          room.status,
          Math.round(room.activeMs),
          reason,
          ...rewards,
          ...reasons,
        ],
      );
      for (let slot = 0; slot < players.length; slot++) {
        const id = room.players[slot].id,
          amount = rewards[slot];
        if (completed)
          await tx(
            `UPDATE user_game_profiles SET sheep_coins=sheep_coins+$2,total_sheep_coins_earned=total_sheep_coins_earned+$2,wins=wins+$3,losses=losses+$4,total_games=total_games+1,updated_at=NOW() WHERE user_id=$1`,
            [id, amount, slot === winner ? 1 : 0, slot !== winner ? 1 : 0],
          );
        if (amount)
          await tx(
            `INSERT INTO sheep_coin_transactions(user_id,amount,type,source,pvp_match_id) VALUES($1,$2,$3,'pvp',$4)`,
            [
              id,
              amount,
              slot === winner ? "air_hockey_pvp_win" : "air_hockey_pvp_loss",
              room.matchId,
            ],
          );
      }
      return { rewards, reasons };
    });
  // A process restart loses live physics: do not award abandoned sessions.
  const recover = () =>
    q(
      `UPDATE air_hockey_pvp_matches SET status='cancelled',finish_reason='server_restart',finished_at=NOW(),reward_processed=TRUE WHERE status NOT IN ('finished','cancelled')`,
    );
  return { create, join, start, finish, recover };
}
