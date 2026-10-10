const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const shorten = (value, size) => Array.from(String(value).replace(/\s+/g, " ")).slice(0, size).join("");

export function formatSupportRsvp(game, players, updatedAt, timeZone = "Europe/Moscow") {
  const date = (value, year = false) => new Date(value).toLocaleString("ru-RU", {
    timeZone, day: "2-digit", month: "2-digit", ...(year ? { year: "numeric" } : {}), hour: "2-digit", minute: "2-digit",
  });
  let text = `<b>🏒 ${escapeHtml(date(game.starts_at, true))}</b> · #${game.id}\n`;
  text += `${escapeHtml(shorten(game.location || "", 90))}${game.status === "cancelled" ? " · ОТМЕНЕНА" : ""}\n`;
  text += `<i>Время: ${escapeHtml(timeZone)}. Последняя отметка справа.</i>\n`;
  const manual = players.filter(p => ["yes", "no"].includes(p.status) && !p.auto_no);
  let omitted = 0;
  for (const [status, title] of [["yes", "👍 IN"], ["no", "😢 OUT"]]) {
    const rows = manual.filter(p => p.status === status);
    text += `\n<b>${title} — ${rows.length}</b>\n`;
    if (!rows.length) { text += "—\n"; continue; }
    text += "<pre>Игрок                 Отметился\n";
    for (const p of rows) {
      const name = p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || String(p.tg_id);
      const number = p.jersey_number != null ? ` #${p.jersey_number}` : "";
      const row = `${shorten(name + number, 20).padEnd(20)}  ${date(p.updated_at)}\n`;
      const encoded = escapeHtml(row);
      // Telegram has a 4096-character message limit. Keep an explicit overflow
      // count; the complete data remains available in the audit API/database.
      if (text.length + encoded.length > 3500) { omitted++; continue; }
      text += encoded;
    }
    text += "</pre>";
  }
  if (omitted) text += `\n<i>Ещё ${omitted} игроков: полный список в журнале отметок.</i>\n`;
  text += `\nОбновлено: ${escapeHtml(date(updatedAt, true))}`;
  return text;
}

export function createSupportRsvpWorker({ withTransaction, call, chatId, isAdmin, timeZone = "Europe/Moscow", logger = console }) {
  let botId = null, working = false, timer = null, pausedUntil = 0;
  const privateChat = /^[1-9]\d*$/.test(String(chatId || ""));
  async function tick() {
    if (working || !privateChat || Date.now() < pausedUntil) return;
    working = true;
    try {
      // Only the explicitly configured PRIVATE admin chat receives tables.
      // There is no public bot command/webhook for requesting this information.
      if (!(await isAdmin(chatId))) return;
      if (!botId) { const bot = await call("getMe", {}); if (!bot.is_bot || !bot.id) throw Error("support_bot_identity_invalid"); botId = bot.id; }
      await withTransaction(async q => {
        const lock = await q("SELECT pg_try_advisory_xact_lock(81732,1) AS locked");
        if (!lock.rows[0]?.locked) return;
        // The advisory lock serializes workers, but no row lock is held
        // during HTTPS: new marks can update the queue immediately.
        const pending = await q(`SELECT * FROM support_rsvp_dirty WHERE next_attempt_at<=NOW()
          ORDER BY changed_at,game_id LIMIT 1`);
        const item = pending.rows[0]; if (!item) return;
        const game = (await q("SELECT id,starts_at,location,status FROM games WHERE id=$1", [item.game_id])).rows[0];
        if (!game) return;
        const players = (await q(`SELECT p.tg_id,p.display_name,p.first_name,p.last_name,p.username,p.jersey_number,
          r.status,r.auto_no,r.updated_at FROM rsvps r JOIN players p ON p.tg_id=r.tg_id
          WHERE r.game_id=$1 AND r.status IN ('yes','no') AND r.auto_no=FALSE AND p.disabled=FALSE
          ORDER BY r.updated_at DESC,p.tg_id`, [item.game_id])).rows;
        const saved = (await q(`SELECT message_id,last_text FROM support_rsvp_messages
          WHERE game_id=$1 AND bot_id=$2 AND chat_id=$3`, [item.game_id, botId, chatId])).rows[0];
        if (!saved && !players.length) {
          await q("DELETE FROM support_rsvp_dirty WHERE game_id=$1 AND revision=$2", [item.game_id, item.revision]); return;
        }
        const text = formatSupportRsvp(game, players, item.changed_at, timeZone);
        let messageId = saved?.message_id;
        const payload = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: true };
        try {
          if (saved && saved.last_text !== text) {
            try { await call("editMessageText", { ...payload, message_id: messageId }); }
            catch (error) {
              if (/message is not modified/i.test(error.description || "")) { /* already current */ }
              else if (error.error_code === 400 && /message to edit not found/i.test(error.description || "")) messageId = null;
              else throw error;
            }
          }
          if (!messageId) messageId = (await call("sendMessage", payload)).message_id;
          if (!messageId) throw Error("support_message_id_missing");
          await q(`INSERT INTO support_rsvp_messages(game_id,bot_id,chat_id,message_id,last_text)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT(game_id,bot_id,chat_id)
            DO UPDATE SET message_id=EXCLUDED.message_id,last_text=EXCLUDED.last_text,updated_at=NOW()`,
          [item.game_id, botId, chatId, messageId, text]);
          await q("DELETE FROM support_rsvp_dirty WHERE game_id=$1 AND revision=$2", [item.game_id, item.revision]);
        } catch (error) {
          const delay = Math.max(2, Number(error.retry_after) || Math.min(300, 2 ** Math.min(8, item.attempts + 1)));
          await q(`UPDATE support_rsvp_dirty SET attempts=attempts+1,
            next_attempt_at=NOW()+($2 * INTERVAL '1 second') WHERE game_id=$1 AND revision=$3`, [item.game_id, delay, item.revision]);
          logger.error("[support RSVP] delivery deferred", { gameId: item.game_id, code: error.error_code || "delivery_failed" });
        }
      });
    } catch (error) {
      pausedUntil = Date.now() + Math.max(30, Number(error.retry_after) || 0) * 1000;
      logger.error("[support RSVP] synchronization unavailable");
    }
    finally { working = false; }
  }
  return {
    tick,
    start() { if (!timer && privateChat) { timer = setInterval(tick, 1500); timer.unref?.(); void tick(); } },
    stop() { clearInterval(timer); timer = null; },
  };
}
