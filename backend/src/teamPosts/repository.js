export function createTeamPostRepository(q, { getChatId, parseTeamIds }) {
  return {
    async context(gameId) {
      const result = await q(
        `SELECT g.id,g.starts_at,g.location,g.status,t.team_a,t.team_b FROM games g LEFT JOIN teams t ON t.game_id=g.id WHERE g.id=$1`,
        [gameId],
      );
      const game = result.rows[0];
      if (!game)
        throw Object.assign(new Error("game_not_found"), { status: 404 });
      if (game.status === "cancelled")
        throw Object.assign(new Error("game_cancelled"), { status: 403 });
      const idsA = parseTeamIds(game.team_a),
        idsB = parseTeamIds(game.team_b);
      if (game.team_a == null && game.team_b == null)
        throw Object.assign(new Error("no_teams"), { status: 400 });
      const chatId = Number(await getChatId());
      if (!Number.isFinite(chatId) || chatId === 0)
        throw Object.assign(new Error("chat_not_set"), { status: 400 });
      const ids = [...new Set([...idsA, ...idsB])];
      const people = await q(
        `SELECT p.tg_id,p.display_name,p.first_name,p.username,p.jersey_number,COALESCE(r.pos_override,p.position) AS position FROM players p LEFT JOIN rsvps r ON r.game_id=$2 AND r.tg_id=p.tg_id AND r.status='yes' WHERE p.tg_id=ANY($1::bigint[])`,
        [ids, gameId],
      );
      const map = new Map(
        people.rows.map((player) => [String(player.tg_id), player]),
      );
      const hydrate = (id) =>
        map.get(String(id)) || {
          tg_id: id,
          display_name: String(id),
          position: "F",
        };
      const rsvps = await q(
        `SELECT tg_id FROM rsvps WHERE game_id=$1 AND status='yes'`,
        [gameId],
      );
      const yes = new Set(rsvps.rows.map((row) => String(row.tg_id))),
        assigned = new Set(ids.map(String));
      const removed = [...assigned].filter((id) => !yes.has(id)).length,
        added = [...yes].filter((id) => !assigned.has(id)).length;
      return {
        game,
        chatId,
        teamA: idsA.map(hydrate),
        teamB: idsB.map(hydrate),
        stale: removed > 0 || added > 0,
        removed,
        added,
      };
    },
    async find(gameId, chatId) {
      const result = await q(
        `SELECT id,chat_id,message_id,text,meta FROM bot_messages WHERE kind='teams' AND deleted_at IS NULL AND chat_id=$1 AND COALESCE(meta->>'game_id','')=$2 ORDER BY id DESC`,
        [chatId, String(gameId)],
      );
      return result.rows;
    },
    async insert({ context, part, text, meta, sentBy, messageId }) {
      const result = await q(
        `INSERT INTO bot_messages(chat_id,message_id,kind,text,parse_mode,disable_web_page_preview,reply_markup,meta,sent_by_tg_id) VALUES($1,$2,'teams',$3,'HTML',TRUE,$4::jsonb,$5::jsonb,$6) RETURNING id,chat_id,message_id,text,meta`,
        [
          context.chatId,
          messageId,
          text,
          JSON.stringify(part.replyMarkup),
          JSON.stringify(meta),
          sentBy || null,
        ],
      );
      return result.rows[0];
    },
    async update(record, { part, text, meta, sentBy }) {
      await q(
        `UPDATE bot_messages SET text=$2,parse_mode='HTML',disable_web_page_preview=TRUE,reply_markup=$3::jsonb,meta=$4::jsonb,sent_by_tg_id=COALESCE($5,sent_by_tg_id),checked_at=NOW() WHERE id=$1`,
        [
          record.id,
          text,
          JSON.stringify(part.replyMarkup),
          JSON.stringify(meta),
          sentBy || null,
        ],
      );
    },
    async missing(record) {
      await q(
        `UPDATE bot_messages SET deleted_at=NOW(),delete_reason='missing_in_chat',checked_at=NOW() WHERE id=$1`,
        [record.id],
      );
    },
  };
}
