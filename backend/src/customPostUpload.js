import { InputFile } from "grammy";
import multer from "multer";
import { randomBytes, createHash } from "node:crypto";
import { validateCustomBotPost, sendCustomBotPost } from "./customBotPost.js";
const fail = (reason, status = 400) =>
  Object.assign(new Error(reason), { status });
export function createPostPhotoStore({
  now = Date.now,
  ttlMs = 10 * 60_000,
  maxBytes = 50 * 1024 * 1024,
} = {}) {
  const photos = new Map();
  let bytes = 0;
  const remove = (token) => {
    const photo = photos.get(token);
    if (photo) {
      bytes -= photo.file.buffer.length;
      photos.delete(token);
    }
  };
  const prune = () => {
    for (const [token, photo] of photos)
      if (photo.expires <= now()) remove(token);
  };
  return {
    prune,
    put(userId, file) {
      prune();
      validateCustomBotPost("", file);
      if (file.buffer.length > 900 * 1024) throw fail("prepare_image_required");
      if (
        photos.size >= 200 ||
        bytes + file.buffer.length > maxBytes ||
        [...photos.values()].filter((p) => p.userId === String(userId))
          .length >= 20
      )
        throw fail("photo_queue_full", 429);
      const token = randomBytes(24).toString("base64url");
      photos.set(token, {
        userId: String(userId),
        file: { buffer: file.buffer, originalname: file.originalname },
        expires: now() + ttlMs,
      });
      bytes += file.buffer.length;
      return token;
    },
    get(userId, tokens) {
      prune();
      if (
        !Array.isArray(tokens) ||
        !tokens.length ||
        tokens.length > 10 ||
        new Set(tokens).size !== tokens.length
      )
        throw fail("bad_photo_tokens");
      return tokens.map((token) => {
        const photo = photos.get(token);
        if (!photo || photo.userId !== String(userId))
          throw fail("photo_expired");
        return photo.file;
      });
    },
    removeAll(tokens) {
      tokens.forEach(remove);
    },
    clear() {
      photos.clear();
      bytes = 0;
    },
    get bytes() {
      return bytes;
    },
  };
}
export function createPostDeliveryCache({
  now = Date.now,
  ttlMs = 15 * 60_000,
} = {}) {
  const entries = new Map();
  const prune = () => {
    for (const [key, e] of entries)
      if (!e.pending && e.expires <= now()) entries.delete(key);
  };
  return {
    prune,
    run(userId, requestId, payload, work) {
      prune();
      if (!requestId) return work();
      if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))
        throw fail("bad_request_id");
      const key = `${userId}:${requestId}`,
        fingerprint = createHash("sha256").update(payload).digest("hex"),
        cached = entries.get(key);
      if (cached) {
        if (cached.fingerprint !== fingerprint) throw fail("post_changed", 409);
        return cached.promise;
      }
      if (entries.size >= 500) throw fail("post_queue_full", 429);
      const entry = { fingerprint, pending: true, expires: now() + ttlMs };
      entries.set(key, entry);
      entry.promise = Promise.resolve()
        .then(work)
        .catch((error) => {
          if (
            error.status === 400 ||
            [400, 403, 429].includes(error.error_code)
          )
            entries.delete(key);
          throw error;
        })
        .finally(() => {
          entry.pending = false;
          entry.expires = now() + ttlMs;
        });
      return entry.promise;
    },
    clear() {
      entries.clear();
    },
  };
}
export function createCustomPostRoutes({
  api,
  getChatId,
  logMessage,
  logger = console,
}) {
  const photos = createPostPhotoStore(),
    deliveries = createPostDeliveryCache();
  const timer = setInterval(() => {
    photos.prune();
    deliveries.prune();
  }, 60_000);
  timer.unref?.();
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: 900 * 1024, fieldSize: 16 * 1024 },
  }).single("photo");
  const parseLegacy = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: 10 * 1024 * 1024, fieldSize: 16 * 1024 },
  }).single("photo");
  const upload = (req, res) =>
    parse(req, res, (error) => {
      if (error)
        return res.status(400).json({
          ok: false,
          reason:
            error.code === "LIMIT_FILE_SIZE"
              ? "prepare_image_required"
              : "bad_attachment",
        });
      try {
        if (!req.file) throw fail("missing_image");
        const token = photos.put(req.customPostUser.id, req.file);
        res.json({ ok: true, token });
      } catch (e) {
        res
          .status(e.status || 500)
          .json({ ok: false, reason: e.status ? e.message : "upload_failed" });
      }
    });
  const send = (req, res) =>
    parseLegacy(req, res, async (error) => {
      if (error)
        return res.status(400).json({
          ok: false,
          reason:
            error.code === "LIMIT_FILE_SIZE"
              ? "image_too_large"
              : "bad_attachment",
        });
      try {
        const userId = req.customPostUser.id,
          text = String(req.body?.text || "").trim(),
          tokens = req.body?.photo_tokens || [];
        if (!Array.isArray(tokens)) throw fail("bad_photo_tokens");
        const payload = JSON.stringify({
          text,
          tokens,
          file: req.file
            ? createHash("sha256").update(req.file.buffer).digest("hex")
            : null,
        });
        const result = await deliveries.run(
          userId,
          req.body?.request_id,
          payload,
          async () => {
            const chatId = await getChatId();
            if (!chatId) throw fail("notify_chat_id_not_set");
            const files = tokens.length
              ? photos.get(userId, tokens)
              : req.file
                ? [req.file]
                : [];
            const controller = new AbortController(),
              timeout = setTimeout(() => controller.abort(), 80_000);
            let post;
            try {
              post = await sendCustomBotPost({
                api,
                chatId: Number(chatId),
                text,
                files,
                makeInputFile: (buffer, name) => new InputFile(buffer, name),
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timeout);
            }
            let historyWarning = false;
            for (const entry of post.entries) {
              try {
                await logMessage({
                  chat_id: Number(chatId),
                  message_id: entry.sent.message_id,
                  kind: "custom",
                  text: entry.text,
                  disable_web_page_preview: true,
                  meta: entry.meta,
                  sent_by_tg_id: userId,
                });
              } catch (e) {
                historyWarning = true;
                logger.error(
                  "[custom post] history failed for message",
                  entry.sent.message_id,
                );
              }
            }
            if (tokens.length) photos.removeAll(tokens);
            return {
              ok: true,
              message_id: post.sent.message_id,
              message_ids: post.messages.map((m) => m.message_id),
              history_warning: historyWarning,
            };
          },
        );
        res.json(result);
      } catch (e) {
        logger.error("[custom post] failed", {
          reason: e.status
            ? e.message
            : e.description || e.error_code || "telegram_network_error",
        });
        const reason = e.status
          ? e.message
          : e.error_code
            ? "telegram_send_failed"
            : "telegram_delivery_unknown";
        res
          .status(
            e.status || (e.error_code === 429 ? 429 : e.error_code ? 502 : 504),
          )
          .json({
            ok: false,
            reason,
            ...(e.description
              ? { detail: String(e.description).slice(0, 240) }
              : {}),
          });
      }
    });
  return {
    upload,
    send,
    close() {
      clearInterval(timer);
      photos.clear();
      deliveries.clear();
    },
  };
}
