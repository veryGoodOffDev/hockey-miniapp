const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const shorten = (value, size) => Array.from(String(value).replace(/\s+/g, " ")).slice(0, size).join("");

export function formatSupportRsvp(game, players, updatedAt, timeZone = "Europe/Moscow") {
  const date = (value, year = false) => new Date(value).toLocaleString("ru-RU", {
    timeZone, day: "2-digit", month: "2-digit", ...(year ? { year: "numeric" } : {}), hour: "2-digit", minute: "2-digit",
  });
  let text = `<b>🏒 ${escapeHtml(date(game.starts_at, true))}</b> · #${game.id}\n`;
  text += `${escapeHtml(shorten(game.location || "", 90))}${game.status === "cancelled" ? " · ОТМЕНЕНА" : ""}\n`;
  text += `<i>Время: ${escapeHtml(timeZone)}. Последнее действие справа.</i>\n`;
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
      const suffix = p.last_interaction_kind === "position" ? " (смена позиции)" : "";
      const row = `${shorten(name + number, 20).padEnd(20)}  ${date(p.last_interaction_at || p.updated_at)}${suffix}\n`;
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

export function formatSupportGameMenu(games, timeZone = "Europe/Moscow") {
  return {
    text: "<b>🏒 Ближайшие игры</b>\nВыберите игру, чтобы увидеть отметки и время изменений." +
      (games.length ? "" : "\nБлижайших игр пока нет."),
    reply_markup: { inline_keyboard: games.slice(0, 12).map(g => [{
      text: new Date(g.starts_at).toLocaleString("ru-RU", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) +
        (g.location ? ` · ${shorten(g.location, 35)}` : ""), callback_data: `sr:game:${g.id}`,
    }]).concat([[{ text: "🔄 Обновить список", callback_data: "sr:list" }]]) },
  };
}

export function createSupportRsvpWorker({ withTransaction, call, chatId, isAdmin, timeZone = "Europe/Moscow", logger = console, mainBotId = null }) {
  let botId = null, working = false, timer = null, pausedUntil = 0, failures = 0;
  const privateChat = /^[1-9]\d*$/.test(String(chatId || ""));
  async function tick() {
    if (working || !privateChat || Date.now() < pausedUntil) return;
    working = true;
    try {
      if (!(await isAdmin(chatId))) return;
      if (!botId) {
        const bot = await call("getMe", {});
        if (!bot.is_bot || !bot.id) throw Error("support_bot_identity_invalid");
        if (mainBotId && Number(bot.id) === Number(mainBotId)) throw Object.assign(Error("support bot must be separate"), { error_code: "same_as_main_bot" });
        botId = bot.id;
      }
      await withTransaction(async q => {
        const lock = await q("SELECT pg_try_advisory_xact_lock(81732,1) AS locked");
        if (!lock.rows[0]?.locked) return;
        await q("INSERT INTO support_rsvp_views(bot_id,chat_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [botId,chatId]);
        await q("INSERT INTO support_rsvp_offsets(bot_id) VALUES($1) ON CONFLICT DO NOTHING", [botId]);
        const view = (await q("SELECT * FROM support_rsvp_views WHERE bot_id=$1 AND chat_id=$2", [botId,chatId])).rows[0];
        let offset = Number((await q("SELECT next_offset FROM support_rsvp_offsets WHERE bot_id=$1", [botId])).rows[0].next_offset);
        const updates = await call("getUpdates", { offset, limit: 50, timeout: 0, allowed_updates: ["message","callback_query"] });
        const answers = []; let forceRefresh = false;
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          const cb = update.callback_query, message = cb?.message || update.message;
          const sender = cb?.from || update.message?.from;
          if (!message || message.chat?.type !== "private" || String(message.chat.id) !== String(chatId) || String(sender?.id) !== String(chatId)) continue;
          if (cb) {
            if (!view.message_id || String(cb.message.message_id) !== String(view.message_id)) {
              answers.push({ callback_query_id: cb.id, text: "Это старое меню. Отправьте /games." }); continue;
            }
            if (cb.data === "sr:list") { forceRefresh = true; view.mode = "list"; view.game_id = null; }
            else if (/^sr:game:[1-9]\d*$/.test(cb.data || "")) {
              forceRefresh = true;
              const id = Number(cb.data.split(":")[2]);
              if (Number.isSafeInteger(id) && id <= 2147483647 && (await q("SELECT id FROM games WHERE id=$1", [id])).rowCount) {
                view.mode = "game"; view.game_id = id;
              } else { view.mode = "list"; view.game_id = null; }
            }
            answers.push({ callback_query_id: cb.id });
          } else if (/^\/(start|games)(?:@\w+)?(?:\s|$)/.test(message.text || "") || message.text === "Ближайшие игры") {
            forceRefresh = true; view.mode = "list"; view.game_id = null;
          }
        }
        let content;
        if (view.mode === "game" && view.game_id) {
          const game = (await q("SELECT id,starts_at,location,status,updated_at FROM games WHERE id=$1", [view.game_id])).rows[0];
          if (game) {
            const players = (await q(`SELECT p.tg_id,p.display_name,p.first_name,p.last_name,p.username,p.jersey_number,
              r.status,r.auto_no,r.updated_at,r.status_changed_at,r.last_interaction_at,r.last_interaction_kind,
              COALESCE(r.pos_override,p.position) AS position FROM rsvps r JOIN players p ON p.tg_id=r.tg_id
              WHERE r.game_id=$1 AND r.status IN ('yes','no') AND r.auto_no=FALSE AND p.disabled=FALSE
              ORDER BY r.last_interaction_at DESC,p.tg_id`, [view.game_id])).rows;
            const last = (await q("SELECT MAX(changed_at) AS at FROM rsvp_history WHERE game_id=$1", [view.game_id])).rows[0]?.at;
            const updatedAt = new Date(Math.max(new Date(last || game.updated_at).getTime(),new Date(game.updated_at).getTime()));
            content = { text: formatSupportRsvp(game, players, updatedAt, timeZone),
              reply_markup: { inline_keyboard: [[{ text: "← К играм", callback_data: "sr:list" }]] } };
          } else { view.mode = "list"; view.game_id = null; }
        }
        if (!content) {
          if (view.mode === "home") content = { text: "<b>Личные отметки на игры</b>\nОткройте список ближайших игр.",
            reply_markup: { inline_keyboard: [[{ text: "Показать ближайшие игры", callback_data: "sr:list" }]] } };
          else {
            view.mode = "list"; view.game_id = null;
            content = formatSupportGameMenu((await q("SELECT id,starts_at,location FROM games WHERE status='scheduled' AND starts_at>=NOW() ORDER BY starts_at,id LIMIT 12")).rows, timeZone);
          }
        }
        const encoded = JSON.stringify(content);
        const payload = { chat_id: chatId, ...content, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: true };
        let messageId = view.message_id;
        if (messageId && (view.last_payload !== encoded || forceRefresh)) {
          try { await call("editMessageText", { ...payload, message_id: messageId }); }
          catch (error) {
            if (/message is not modified/i.test(error.description || "")) { /* already current */ }
            else if (error.error_code === 400 && /message to edit not found/i.test(error.description || "")) messageId = null;
            else throw error;
          }
        }
        if (!messageId) messageId = (await call("sendMessage", payload)).message_id;
        if (!messageId) throw Error("support_message_id_missing");
        await q(`UPDATE support_rsvp_views SET message_id=$3,mode=$4,game_id=$5,last_payload=$6
          WHERE bot_id=$1 AND chat_id=$2`, [botId,chatId,messageId,view.mode,view.game_id,encoded]);
        await q("UPDATE support_rsvp_offsets SET next_offset=$2 WHERE bot_id=$1", [botId,offset]);
        // Inactive games need no message delivery. Their current marks and
        // history are persisted; opening the game always reads fresh data.
        await q("DELETE FROM support_rsvp_dirty WHERE changed_at < NOW()");
        for (const answer of answers) {
          try { await call("answerCallbackQuery", answer); }
          catch (error) { if (error.error_code !== 400) logger.error("[support RSVP] callback acknowledgement failed"); }
        }
      });
      failures = 0;
    } catch (error) {
      failures++;
      pausedUntil = Date.now() + Math.max(2, Number(error.retry_after) || Math.min(300,2 ** Math.min(8,failures))) * 1000;
      logger.error("[support RSVP] synchronization deferred", { code: error.error_code || "sync_failed" });
    } finally { working = false; }
  }
  return {
    tick,
    start() { if (!timer && privateChat) { timer = setInterval(tick,1500); timer.unref?.(); void tick(); } },
    stop() { clearInterval(timer); timer = null; },
  };
}
