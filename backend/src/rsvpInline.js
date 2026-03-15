import { InlineKeyboard } from "grammy";

export async function getReminderRsvpStats(query, gameId) {
  const [votesRes, playersRes] = await Promise.all([
    query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status='yes')::int AS in_count,
        COUNT(*) FILTER (WHERE status='no')::int AS out_count,
        COUNT(DISTINCT tg_id)::int AS voted_count
      FROM rsvps
      WHERE game_id=$1
      `,
      [gameId]
    ),
    query(
      `
      SELECT COUNT(*)::int AS total
      FROM players
      WHERE disabled IS DISTINCT FROM TRUE
        AND COALESCE(is_guest, FALSE) = FALSE
        AND COALESCE(player_kind, 'tg') = 'tg'
      `
    ),
  ]);

  const inCount = Number(votesRes.rows?.[0]?.in_count || 0);
  const outCount = Number(votesRes.rows?.[0]?.out_count || 0);
  const votedCount = Number(votesRes.rows?.[0]?.voted_count || 0);
  const totalPlayers = Number(playersRes.rows?.[0]?.total || 0);
  const pendingCount = Math.max(0, totalPlayers - votedCount);

  return {
    inCount,
    outCount,
    pendingCount,
  };
}

export function buildReminderKeyboard({ gameId, deepLink, stats }) {
  const kb = new InlineKeyboard().url("Открыть мини-приложение", deepLink).row();

  kb.text(`✅ IN (${stats.inCount})`, `rv:i:${gameId}`)
    .text(`❌ OUT (${stats.outCount})`, `rv:o:${gameId}`)
    .row()
    .text(`⏳ Не отметились (${stats.pendingCount})`, `rv:n:${gameId}`);

  return kb;
}
