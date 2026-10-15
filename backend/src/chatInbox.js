// Only the configured team group is archived; private bot conversations never enter this inbox.
export const CHAT_REACTIONS = ["👍", "❤️", "🔥", "👏", "😁", "😢"];
const fail = (reason, status = 400) =>
  Object.assign(new Error(reason), { status });
export function messageId(value) {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647)
    throw fail("bad_message_id");
  return id;
}
export async function ensureChatInboxSchema(q) {
  await q(`CREATE TABLE IF NOT EXISTS chat_inbox_messages (
    chat_id BIGINT NOT NULL, message_id BIGINT NOT NULL,
    sender_name TEXT NOT NULL, sender_username TEXT,
    text TEXT NOT NULL DEFAULT '', media_type TEXT,
    sent_at TIMESTAMPTZ NOT NULL, edited_at TIMESTAMPTZ,
    reply_to_message_id BIGINT, bot_reaction TEXT,
    PRIMARY KEY(chat_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS chat_inbox_recent_idx ON chat_inbox_messages(chat_id, message_id DESC);`);
}
export function inboxMessage(message, chatId) {
  if (
    !message ||
    !chatId ||
    String(message.chat?.id) !== String(chatId) ||
    !["group", "supergroup"].includes(message.chat?.type)
  )
    return null;
  // Ignore service messages. Other bots' messages are not delivered by Telegram.
  const mediaType = [
    "photo",
    "animation",
    "video",
    "voice",
    "audio",
    "document",
    "sticker",
    "video_note",
    "poll",
    "location",
    "contact",
    "dice",
  ].find((key) => message[key]);
  if (!message.text && !message.caption && !mediaType) return null;
  const sender = message.sender_chat || message.from || {};
  return {
    chat_id: String(chatId),
    message_id: messageId(message.message_id),
    sender_name: (
      sender.title ||
      [sender.first_name, sender.last_name].filter(Boolean).join(" ") ||
      sender.username ||
      "Участник"
    ).slice(0, 256),
    sender_username: sender.username?.slice(0, 64) || null,
    text: String(message.text || message.caption || "").slice(0, 4096),
    media_type: mediaType || null,
    sent_at: new Date(message.date * 1000),
    edited_at: message.edit_date ? new Date(message.edit_date * 1000) : null,
    reply_to_message_id: message.reply_to_message?.message_id || null,
  };
}
export function createChatInboxRepository(q, { now = Date.now } = {}) {
  let nextPrune = 0;
  return {
    async record(message) {
      await q(
        `INSERT INTO chat_inbox_messages(chat_id,message_id,sender_name,sender_username,text,media_type,sent_at,edited_at,reply_to_message_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(chat_id,message_id) DO UPDATE SET sender_name=EXCLUDED.sender_name,
          sender_username=EXCLUDED.sender_username,text=EXCLUDED.text,media_type=EXCLUDED.media_type,
          edited_at=EXCLUDED.edited_at,reply_to_message_id=EXCLUDED.reply_to_message_id
        WHERE COALESCE(EXCLUDED.edited_at,EXCLUDED.sent_at) >= COALESCE(chat_inbox_messages.edited_at,chat_inbox_messages.sent_at)`,
        [
          message.chat_id,
          message.message_id,
          message.sender_name,
          message.sender_username,
          message.text,
          message.media_type,
          message.sent_at,
          message.edited_at,
          message.reply_to_message_id,
        ],
      );
      if (now() >= nextPrune) {
        await q(
          `DELETE FROM chat_inbox_messages WHERE sent_at < NOW() - INTERVAL '30 days'`,
        );
        nextPrune = now() + 60 * 60_000;
      }
    },
    async list(chatId, { before = null, limit = 20 } = {}) {
      const result = await q(
        `SELECT * FROM chat_inbox_messages WHERE chat_id=$1
        AND sent_at >= NOW() - INTERVAL '30 days' AND ($2::bigint IS NULL OR message_id<$2)
        ORDER BY message_id DESC LIMIT $3`,
        [chatId, before, limit + 1],
      );
      return {
        messages: result.rows.slice(0, limit),
        has_more: result.rows.length > limit,
      };
    },
    async get(chatId, id) {
      const result = await q(
        `SELECT * FROM chat_inbox_messages WHERE chat_id=$1 AND message_id=$2 AND sent_at >= NOW() - INTERVAL '30 days'`,
        [chatId, id],
      );
      if (!result.rows[0]) throw fail("reply_message_not_found", 404);
      return result.rows[0];
    },
    async setReaction(chatId, id, emoji) {
      await q(
        `UPDATE chat_inbox_messages SET bot_reaction=$3 WHERE chat_id=$1 AND message_id=$2`,
        [chatId, id, emoji || null],
      );
    },
  };
}
export function createChatInboxCapture({
  repository,
  getChatId,
  logger = console,
}) {
  return async (ctx, next) => {
    const message = ctx.update.message || ctx.update.edited_message;
    if (message && ["group", "supergroup"].includes(message.chat?.type)) {
      try {
        const entry = inboxMessage(message, await getChatId());
        if (entry) await repository.record(entry);
      } catch {
        logger.error("[chat inbox] failed to save group message");
      }
    }
    return next();
  };
}
export function createChatInboxRoutes({ repository, api, getChatId }) {
  const locks = new Set();
  const route = (fn) => async (req, res) => {
    try {
      const chatId = await getChatId();
      if (!chatId) throw fail("notify_chat_id_not_set");
      await fn(req, res, chatId);
    } catch (error) {
      res.status(error.status || (error.error_code ? 502 : 503)).json({
        ok: false,
        reason: error.status
          ? error.message
          : error.error_code
            ? "telegram_reaction_failed"
            : "chat_inbox_unavailable",
        ...(error.description
          ? { detail: String(error.description).slice(0, 240) }
          : {}),
      });
    }
  };
  return {
    list: route(async (req, res, chatId) => {
      const before =
        req.query.before == null ? null : messageId(req.query.before);
      const result = await repository.list(chatId, { before });
      res.json({ ok: true, ...result, reaction_choices: CHAT_REACTIONS });
    }),
    react: route(async (req, res, chatId) => {
      const id = messageId(req.params.messageId),
        emoji = req.body?.emoji;
      if (emoji !== "" && !CHAT_REACTIONS.includes(emoji))
        throw fail("bad_reaction");
      await repository.get(chatId, id);
      const key = `${chatId}:${id}`;
      if (locks.has(key)) throw fail("reaction_busy", 409);
      locks.add(key);
      try {
        await api.setMessageReaction(
          Number(chatId),
          id,
          emoji ? [{ type: "emoji", emoji }] : [],
          { is_big: false },
          AbortSignal.timeout(10_000),
        );
        await repository.setReaction(chatId, id, emoji);
        res.json({ ok: true, bot_reaction: emoji || null });
      } finally {
        locks.delete(key);
      }
    }),
  };
}
