import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { initDb, q } from "./db.js";
import { createBot } from "./bot.js";
import { verifyTelegramWebApp } from "./tgAuth.js";
import { makeTeams } from "./teamMaker.js";
import { ensureSchema } from "./schema.js";
import { InlineKeyboard } from "grammy";
import crypto from "crypto";

const app = express();
app.use(express.json());
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 5, fileSize: 10 * 1024 * 1024 }, // 5 файлов по 10MB
});
const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || origin === "null") return cb(null, true); // <-- добавил "null"
      if (allowed.length === 0) return cb(null, true);
      if (allowed.includes("*")) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      return cb(null, false); // <-- лучше так, чем Error(…) => иногда превращается в 500
    },
    allowedHeaders: ["Content-Type", "x-telegram-init-data"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    optionsSuccessStatus: 204,
  })
);

app.options("*", cors());
// init + schema
await initDb();
await ensureSchema(q);

// Telegram bot webhook
const bot = createBot();
await bot.init();

app.post("/bot", async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error("handleUpdate failed:", e);
  }
  res.sendStatus(200);
});

/** ===================== HELPERS ===================== */

let funStatsTimer = null;
let funStatsDirty = false;

function scheduleFunStatsUpdate() {
  funStatsDirty = true;
  if (funStatsTimer) return;

  funStatsTimer = setTimeout(async () => {
    funStatsTimer = null;
    if (!funStatsDirty) return;
    funStatsDirty = false;
    try {
      await upsertPinnedFunStats();
    } catch (e) {
      console.error("upsertPinnedFunStats failed:", e?.message || e);
    }
  }, 1500); // 1.5 сек — норм
}

function formatGameWhen(startsAtIso) {
  const tz = process.env.TZ_NAME || "Europe/Moscow";
  const dt = startsAtIso ? new Date(startsAtIso) : null;
  if (!dt) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}
function padRight(s, n) {
  const x = String(s ?? "");
  return x + " ".repeat(Math.max(0, n - x.length));
}

function clip(s, max) {
  const x = String(s ?? "");
  if (x.length <= max) return x;
  return x.slice(0, Math.max(0, max - 1)) + "…";
}
// --- визуальная ширина (приближенно под Telegram) ---
function isCombining(cp) {
  // combining marks (0 width)
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  );
}

function isWide(cp) {
  // emoji + wide east asian (2 cells)
  if (
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji blocks
    (cp >= 0x2600 && cp <= 0x27bf) ||   // misc symbols
    (cp >= 0x1100 && cp <= 0x115f) ||   // hangul jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) ||   // cjk
    (cp >= 0xac00 && cp <= 0xd7a3) ||   // hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||   // cjk compat
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  ) return true;
  return false;
}

function strWidth(s) {
  const x = String(s ?? "");
  let w = 0;
  for (const ch of x) {
    const cp = ch.codePointAt(0);
    if (!cp) continue;
    if (isCombining(cp)) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function clipW(s, maxCells) {
  const x = String(s ?? "");
  if (strWidth(x) <= maxCells) return x;

  const ell = "…";
  const target = Math.max(0, maxCells - 1); // "…" считаем за 1 ячейку
  let w = 0;
  let out = "";

  for (const ch of x) {
    const cp = ch.codePointAt(0);
    if (!cp) continue;
    const cw = isCombining(cp) ? 0 : (isWide(cp) ? 2 : 1);
    if (w + cw > target) break;
    out += ch;
    w += cw;
  }
  return out + ell;
}

function padRightW(s, targetCells) {
  const x = String(s ?? "");
  const w = strWidth(x);
  return x + " ".repeat(Math.max(0, targetCells - w));
}

function playerLineNoBullets(p) {
  const name = displayPlayerNameRow(p);
  const num =
    p?.jersey_number === null || p?.jersey_number === undefined || p?.jersey_number === ""
      ? ""
      : ` №${p.jersey_number}`;
  return `${name}${num}`;
}

function teamColumnLines(teamTitle, players) {
  const g = groupPlayersForMessage(players); // {G:[], D:[], F:[]} уже сортированные

  const lines = [];
  lines.push(teamTitle);
  lines.push("");

  const pushGroup = (title, arr) => {
    // без разделителей, просто заголовок и список
    lines.push(title);
    if (!arr.length) {
      lines.push("—");
      lines.push("");
      return;
    }
    for (const p of arr) lines.push(playerLineNoBullets(p));
    lines.push("");
  };

  pushGroup("🥅 Вратари", g.G);
  pushGroup("🛡 Защитники", g.D);
  pushGroup("🏒 Нападающие", g.F);

  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function renderTeamsTwoColsHtml(teamAPlayers, teamBPlayers) {
  const left = teamColumnLines("⬜ Белые", teamAPlayers || []);
  const right = teamColumnLines("🟦 Синие", teamBPlayers || []);

  const rows = Math.max(left.length, right.length);
  while (left.length < rows) left.push("");
  while (right.length < rows) right.push("");

  // Чем меньше MAX_TOTAL — тем меньше шанс переноса на мобилках с крупным шрифтом
  const MAX_TOTAL = 42; // попробуй 42..46 по вкусу
  const GAP = 2;        // пробелы между колонками
  const MIN_LEFT = 14;
  const MAX_LEFT = 20;  // ограничиваем левую колонку

  const leftWanted = Math.max(MIN_LEFT, ...left.map((x) => strWidth(x)));
  const leftW = Math.min(MAX_LEFT, leftWanted);

  const rightW = Math.max(10, MAX_TOTAL - leftW - GAP);

  const out = [];
  for (let i = 0; i < rows; i++) {
    const l = clipW(left[i] || "", leftW);
    const r = clipW(right[i] || "", rightW);

    const line = padRightW(l, leftW) + " ".repeat(GAP) + r;
    out.push(escapeHtml(line).trimEnd());
  }

  return `<pre>${out.join("\n")}</pre>`;
}


function envAdminSet() {
  return new Set(
    (process.env.ADMIN_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}
const SUPPORT_TOKEN = process.env.SUPPORT_BOT_TOKEN;
const SUPPORT_CHAT_ID = process.env.SUPPORT_CHAT_ID;

async function supportTgCall(method, payload) {
  if (!SUPPORT_TOKEN || !SUPPORT_CHAT_ID) {
    throw new Error("SUPPORT_BOT_TOKEN / SUPPORT_CHAT_ID not set");
  }

  const url = `https://api.telegram.org/bot${SUPPORT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: payload instanceof FormData ? undefined : { "content-type": "application/json" },
    body: payload instanceof FormData ? payload : JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Support bot ${method} failed: ${data.description || "unknown"}`);
  return data.result;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function supportSendMessage(html) {
  return supportTgCall("sendMessage", {
    chat_id: Number(SUPPORT_CHAT_ID),
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function supportSendFile({ caption, file }) {
  // file = multer file: { buffer, mimetype, originalname, size }
  const fd = new FormData();
  fd.append("chat_id", String(SUPPORT_CHAT_ID));
  if (caption) fd.append("caption", caption);

  const blob = new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" });

  // если картинка — приятнее photo, иначе document
  if ((file.mimetype || "").startsWith("image/")) {
    fd.append("photo", blob, file.originalname || "image");
    return supportTgCall("sendPhoto", fd);
  }

  fd.append("document", blob, file.originalname || "file");
  return supportTgCall("sendDocument", fd);
}

async function supportEditMessage(messageId, html) {
  return supportTgCall("editMessageText", {
    chat_id: Number(SUPPORT_CHAT_ID),
    message_id: Number(messageId),
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function supportPinMessage(messageId) {
  return supportTgCall("pinChatMessage", {
    chat_id: Number(SUPPORT_CHAT_ID),
    message_id: Number(messageId),
    disable_notification: true,
  });
}

async function supportDeleteMessage(messageId) {
  return supportTgCall("deleteMessage", {
    chat_id: Number(SUPPORT_CHAT_ID),
    message_id: Number(messageId),
  });
}


// супер-админ: только из ENV
function isSuperAdmin(tgId) {
  return envAdminSet().has(String(tgId));
}

async function isAdminId(tgId) {
  // ENV всегда имеет приоритет
  if (envAdminSet().has(String(tgId))) return true;

  const r = await q(`SELECT is_admin FROM players WHERE tg_id=$1`, [tgId]);
  return r.rows[0]?.is_admin === true;
}

async function requireAdminAsync(req, res, user) {
  const ok = await isAdminId(user.id);
  if (!ok) {
    res.status(403).json({ ok: false, reason: "not_admin" });
    return false;
  }
  return true;
}

function requireWebAppAuth(req, res) {
  const initData = req.header("x-telegram-init-data");
  const v = verifyTelegramWebApp(initData, process.env.BOT_TOKEN);
  if (!v.ok) {
    res.status(401).json({ ok: false, reason: v.reason });
    return null;
  }
  return v.user;
}

async function requireGroupMember(req, res, user) {
  const chatIdRaw = await getSetting("notify_chat_id", null);
  if (!chatIdRaw) {
    res.status(403).json({ ok: false, reason: "access_chat_not_set" });
    return false;
  }

  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) {
    res.status(403).json({ ok: false, reason: "access_chat_invalid" });
    return false;
  }

  // ✅ если хочешь — разрешай админам проходить даже если TG API умер
  try {
    const is_admin = await isAdminId(user.id);
    if (is_admin) return true;
  } catch (e) {
    console.error("isAdminId failed:", e);
  }

  try {
    const m = await bot.api.getChatMember(chatId, user.id);

    if (m.status === "left" || m.status === "kicked") {
      res.status(403).json({ ok: false, reason: "not_member" });
      return false;
    }

    if (m.status === "restricted" && m.is_member === false) {
      res.status(403).json({ ok: false, reason: "not_member" });
      return false;
    }

    return true;
  } catch (e) {
    console.error("getChatMember failed:", e);

    const desc = String(e?.description || e?.message || "");
    const code = e?.error_code;
    const errCode = e?.error?.code; // node-fetch
    const errNo = e?.error?.errno;

    if (errCode === "ETIMEDOUT" || errNo === "ETIMEDOUT" || desc.includes("Network request")) {
      res.status(503).json({ ok: false, reason: "telegram_unavailable" });
      return false;
    }

    if (code === 400) {
      res.status(403).json({ ok: false, reason: "access_chat_invalid" });
      return false;
    }
    if (code === 403) {
      res.status(403).json({ ok: false, reason: "bot_forbidden" });
      return false;
    }

    res.status(403).json({ ok: false, reason: "member_check_failed" });
    return false;
  }
}

function int(v, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function jersey(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const x = Math.trunc(n);
  if (x < 0 || x > 99) return null;
  return x;
}

function cleanUrl(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function setSetting(key, value) {
  await q(
    `INSERT INTO settings(key, value) VALUES($1,$2)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [key, String(value)]
  );
}

async function getSetting(key, def = null) {
  const r = await q(`SELECT value FROM settings WHERE key=$1`, [key]);
  return r.rows[0]?.value ?? def;
}

function makeToken() {
  // 32 байта => длинный безопасный токен
  return crypto.randomBytes(32).toString("base64url");
}

function publicBaseUrl() {
  // куда ведёт ссылка (для внешнего браузера)
  // выстави PUBLIC_WEB_URL = https://your-frontend-domain
  // fallback: WEB_APP_URL (если он уже указывает на https фронта)
  const a = String(process.env.PUBLIC_WEB_URL || "").trim();
  if (a) return a.replace(/\/+$/, "");
  const b = String(process.env.WEB_APP_URL || "").trim();
  if (b) return b.replace(/\/+$/, "");
  return ""; // если пусто — просто вернём токен, а ссылку соберёшь руками
}

async function getTokenRowForUpdate(token) {
  // token row + game + player, под транзакцией (FOR UPDATE на token)
  const r = await q(
    `
    SELECT
      t.*,
      g.starts_at, g.location, g.status AS game_status,
      p.display_name, p.first_name, p.username, p.disabled, p.player_kind
    FROM rsvp_tokens t
    JOIN games g ON g.id = t.game_id
    JOIN players p ON p.tg_id = t.tg_id
    WHERE t.token = $1
    FOR UPDATE
    `,
    [token]
  );
  return r.rows[0] || null;
}

function displayPlayerName(p) {
  const dn = String(p?.display_name || "").trim();
  if (dn) return dn;
  const fn = String(p?.first_name || "").trim();
  if (fn) return fn;
  const un = String(p?.username || "").trim();
  if (un) return "@" + un;
  return String(p?.tg_id || "");
}

function replyMarkupToJson(markup) {
  if (!markup) return null;
  try {
    if (typeof markup.toJSON === "function") return markup.toJSON();
    return markup;
  } catch {
    return null;
  }
}

async function logBotMessage({
  chat_id,
  message_id,
  kind = "custom",
  text,
  parse_mode = null,
  disable_web_page_preview = true,
  reply_markup = null,
  meta = null,
  sent_by_tg_id = null,
}) {
  await q(
    `INSERT INTO bot_messages(
       chat_id, message_id, kind, text,
       parse_mode, disable_web_page_preview,
       reply_markup, meta, sent_by_tg_id
     )
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
    [
      Number(chat_id),
      Number(message_id),
      String(kind),
      String(text || ""),
      parse_mode ? String(parse_mode) : null,
      Boolean(disable_web_page_preview),
      reply_markup ? JSON.stringify(reply_markup) : null,
      meta ? JSON.stringify(meta) : null,
      sent_by_tg_id ? Number(sent_by_tg_id) : null,
    ]
  );
}

function tgErrText(e) {
  return String(e?.description || e?.message || e || "");
}

function tgMessageMissing(e) {
  const s = tgErrText(e).toLowerCase();
  return (
    s.includes("message to delete not found") ||
    s.includes("message to edit not found") ||
    s.includes("message_id_invalid") ||
    s.includes("message not found")
  );
}

function tgMessageExistsButNotEditable(e) {
  const s = tgErrText(e).toLowerCase();
  return s.includes("message is not modified") || s.includes("message can't be edited");
}

async function getNextScheduledGame() {
  const gr = await q(
    `SELECT * FROM games
     WHERE status='scheduled' AND starts_at >= NOW() - INTERVAL '6 hours'
     ORDER BY starts_at ASC
     LIMIT 1`
  );
  return gr.rows[0] || null;
}

async function sendRsvpReminder(chatId) {
  const webAppUrl = process.env.WEB_APP_URL;
  if (!webAppUrl) throw new Error("WEB_APP_URL is not set");

  const game = await getNextScheduledGame();
  if (!game) {
    await bot.api.sendMessage(chatId, "🏒 Напоминание: ближайшей игры пока нет (не найдено scheduled).");
    return { ok: true, reason: "no_game" };
  }

  const tz = process.env.TZ_NAME || "Europe/Moscow";
  const when = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(game.starts_at));

  const text = `🏒 Напоминание: отметься на игру!

📅 ${when}
📍 ${game.location || "—"}

Открыть мини-приложение для отметок:`;

  const botUsername = process.env.BOT_USERNAME || "HockeyLineupBot";
  const deepLink = `https://t.me/${botUsername}?startapp=${encodeURIComponent(String(game.id))}`;
  const kb = new InlineKeyboard().url("Открыть мини-приложение", deepLink);

  const sent = await bot.api.sendMessage(chatId, text, {
    reply_markup: kb,
    disable_web_page_preview: true,
  });

  // ✅ НОВОЕ: закрепляем сразу после отправки
  try {
    await bot.api.pinChatMessage(Number(chatId), sent.message_id, {
      disable_notification: true, // чтобы не было лишнего уведомления "Pinned message"
    });
  } catch (e) {
    console.error("pinChatMessage failed:", e?.description || e?.message || e);
  }

  await logBotMessage({
    chat_id: chatId,
    message_id: sent.message_id,
    kind: "reminder",
    text,
    parse_mode: null,
    disable_web_page_preview: true,
    reply_markup: replyMarkupToJson(kb),
    meta: { game_id: game.id, type: "auto_reminder" },
  });

  return { ok: true, game_id: game.id, pinned: true };
}


function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function displayPlayerNameRow(row) {
  const dn = (row?.display_name || "").trim();
  if (dn) return dn;
  const fn = (row?.first_name || "").trim();
  if (fn) return fn;
  if (row?.username) return `@${row.username}`;
  return String(row?.tg_id ?? "—");
}

function normalizePos(pos) {
  const p = String(pos || "F").toUpperCase();
  if (p === "G" || p === "D") return p;
  return "F"; // всё остальное считаем нападающим
}

function normalizePosOverride(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  if (s === "F" || s === "D" || s === "G") return s;
  return null; // можно сделать 400, но лучше мягко: null
}


function parseTeamIds(teamJson) {
  const arr = Array.isArray(teamJson) ? teamJson : [];
  const ids = [];
  for (const it of arr) {
    if (typeof it === "number" || typeof it === "string") {
      const n = Number(it);
      if (Number.isFinite(n)) ids.push(n);
    } else if (it && typeof it === "object") {
      const n = Number(it.tg_id);
      if (Number.isFinite(n)) ids.push(n);
    }
  }
  // unique
  return Array.from(new Set(ids));
}

function groupPlayersForMessage(list) {
  const g = { G: [], D: [], F: [] };
  for (const p of list) g[normalizePos(p.position)].push(p);

  const byName = (a, b) => displayPlayerNameRow(a).localeCompare(displayPlayerNameRow(b), "ru");
  g.G.sort(byName);
  g.D.sort(byName);
  g.F.sort(byName);

  return g;
}

function renderLines(list) {
  if (!list.length) return "<i>—</i>";
  return list
    .map((p) => {
      const name = escapeHtml(displayPlayerNameRow(p));
      const num =
        p?.jersey_number === null || p?.jersey_number === undefined || p?.jersey_number === ""
          ? ""
          : ` №${escapeHtml(p.jersey_number)}`;
      return `• ${name}${num}`;
    })
    .join("\n"); // ✅ вместо <br/>
}

function renderTeamHtml(title, players) {
  const g = groupPlayersForMessage(players);

  return (
    `<b>${escapeHtml(title)}</b>\n` +
    `🥅 <b>Вратари</b>\n${renderLines(g.G)}\n\n` +
    `🛡 <b>Защитники</b>\n${renderLines(g.D)}\n\n` +
    `🏒 <b>Нападающие</b>\n${renderLines(g.F)}`
  );
}


async function getSettingValue(q, key) {
  const r = await q(`SELECT value FROM settings WHERE key=$1`, [key]);
  return r.rows?.[0]?.value ?? null;
}

async function getTeamChatId(q) {
  const v = await getSettingValue(q, "team_chat_id"); // должно совпасть с /setchat
  const id = v ? Number(v) : null;
  return Number.isFinite(id) ? id : null;
}


async function ensurePlayer(user) {
  const rootAdmin = envAdminSet().has(String(user.id));

  // ✅ player_kind для tg-игрока фиксируем как tg (но не ломаем старые записи)
  await q(
    `INSERT INTO players(tg_id, first_name, last_name, username, is_admin, player_kind, is_guest)
     VALUES($1,$2,$3,$4,$5,'tg', FALSE)
     ON CONFLICT(tg_id) DO UPDATE SET
       first_name=EXCLUDED.first_name,
       last_name=EXCLUDED.last_name,
       username=EXCLUDED.username,
       is_admin = players.is_admin OR EXCLUDED.is_admin,
       player_kind = CASE
         WHEN players.player_kind IS NULL OR BTRIM(players.player_kind) = '' THEN 'tg'
         ELSE players.player_kind
       END,
       updated_at=NOW()`,
    [user.id, user.first_name || "", user.last_name || "", user.username || "", rootAdmin]
  );
}

    function sqlPlayerName(alias = "p") {
      return `
        COALESCE(
          NULLIF(BTRIM(${alias}.display_name), ''),
          NULLIF(BTRIM(${alias}.first_name), ''),
          CASE WHEN BTRIM(${alias}.username) <> '' THEN '@' || BTRIM(${alias}.username) ELSE NULL END,
          ${alias}.tg_id::text
        )
      `;
    }

async function getFunStatsRows(limit = 60) {
  const r = await q(
    `
    SELECT
      p.tg_id,
      ${sqlPlayerName("p")} AS name,

      SUM((l.action='thanks')::int)::int AS thanks,
      SUM((l.action='donate')::int)::int AS donate,

      SUM((l.action='donate' AND l.value='highfive')::int)::int AS highfive,
      SUM((l.action='donate' AND l.value='hug')::int)::int      AS hug,
      SUM((l.action='donate' AND l.value='sz')::int)::int       AS sz

    FROM fun_actions_log l
    JOIN players p ON p.tg_id = l.user_id
    WHERE p.disabled IS DISTINCT FROM TRUE
    GROUP BY p.tg_id, p.display_name, p.first_name, p.username
    ORDER BY donate DESC, thanks DESC, name ASC
    LIMIT $1
    `,
    [limit]
  );
  return r.rows || [];
}

async function getFunTotals() {
  const r = await q(`
    SELECT
      COUNT(*) FILTER (WHERE action='thanks')::int AS thanks_total,
      COUNT(*) FILTER (WHERE action='donate')::int AS donate_total,
      COUNT(*) FILTER (WHERE action='donate' AND value='highfive')::int AS highfive_total,
      COUNT(*) FILTER (WHERE action='donate' AND value='hug')::int      AS hug_total,
      COUNT(*) FILTER (WHERE action='donate' AND value='sz')::int       AS sz_total
    FROM fun_actions_log
  `);
  return r.rows[0] || null;
}

function renderFunStatsTable(rows) {
  // колонки: Имя | Спасибо | Донат | 🤝 | 🫂 | 🍀
  const nameW = 18; // можно 16..22
  const nW = 6;

  const lines = [];
  lines.push(
    padRightW("Имя", nameW) +
      " " +
      padRightW("Спасибо", nW) +
      " " +
      padRightW("Донат", nW) +
      " " +
      padRightW("🤝", 3) +
      " " +
      padRightW("🫂", 3) +
      " " +
      padRightW("🍀", 3)
  );

  lines.push("-".repeat(Math.min(42, nameW + nW + nW + 3 + 3 + 3 + 5)));

  for (const r of rows) {
    const name = clipW(String(r.name || r.tg_id), nameW);
    lines.push(
      padRightW(name, nameW) +
        " " +
        padRightW(String(r.thanks ?? 0), nW) +
        " " +
        padRightW(String(r.donate ?? 0), nW) +
        " " +
        padRightW(String(r.highfive ?? 0), 3) +
        " " +
        padRightW(String(r.hug ?? 0), 3) +
        " " +
        padRightW(String(r.sz ?? 0), 3)
    );
  }

  return lines.join("\n");
}

async function buildFunStatsHtml() {
  const tz = process.env.TZ_NAME || "Europe/Moscow";
  const updated = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const totals = await getFunTotals();
  const rows = await getFunStatsRows(80);

  const head =
    `📊 <b>Благодарности / Донаты</b>\n` +
    `🕒 <code>${escapeHtml(updated)}</code>\n\n` +
    `Всего: спасибо <b>${totals?.thanks_total ?? 0}</b>, донатов <b>${totals?.donate_total ?? 0}</b>\n` +
    `🤝 ${totals?.highfive_total ?? 0}  🫂 ${totals?.hug_total ?? 0}  🍀 ${totals?.sz_total ?? 0}\n\n`;

  const table = renderFunStatsTable(rows);

  // HTML-safe
  return head + `<pre>${escapeHtml(table)}</pre>`;
}

async function upsertPinnedFunStats() {
  if (!SUPPORT_TOKEN || !SUPPORT_CHAT_ID) return;

  const html = await buildFunStatsHtml();
  const key = "fun_stats_message_id";

  const oldId = await getSetting(key, null);

  if (oldId) {
    try {
      await supportEditMessage(oldId, html);
      // закреп уже останется, но на всякий случай можно перепинить
      await supportPinMessage(oldId);
      return;
    } catch (e) {
      // если сообщение удалено/недоступно — создадим новое
      console.error("supportEditMessage failed:", e?.message || e);
      try { await supportDeleteMessage(oldId); } catch {}
    }
  }

  // создать новое + закрепить + сохранить id
  const sent = await supportTgCall("sendMessage", {
    chat_id: Number(SUPPORT_CHAT_ID),
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });

  await supportPinMessage(sent.message_id);
  await setSetting(key, String(sent.message_id));
}



/** ===================== ROUTES ===================== */

app.get("/api/health", (req, res) => res.json({ ok: true }));

/** ====== ME ====== */
app.get("/api/me", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);
  const player = pr.rows[0];
  const admin = await isAdminId(user.id);

  res.json({ ok: true, player, is_admin: admin });
});

app.post("/api/me", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);
  const b = req.body || {};

  await q(
    `UPDATE players SET
      display_name=$2,
      jersey_number=$3,
      position=$4, skill=$5, skating=$6, iq=$7, stamina=$8, passing=$9, shooting=$10, notes=$11,
      photo_url=$12,
      updated_at=NOW()
     WHERE tg_id=$1`,
    [
      user.id,
      (b.display_name || "").trim().slice(0, 40) || null,
      jersey(b.jersey_number),
      b.position || "F",
      int(b.skill, 5),
      int(b.skating, 5),
      int(b.iq, 5),
      int(b.stamina, 5),
      int(b.passing, 5),
      int(b.shooting, 5),
      (b.notes || "").slice(0, 500),
      (b.photo_url || "").trim().slice(0, 500) || "",
    ]
  );

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);
  res.json({ ok: true, player: pr.rows[0] });
});

      /** ====== FUN (profile jokes) ====== */
app.get("/api/fun/status", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);

  const pr = await q(`SELECT joke_premium FROM players WHERE tg_id=$1`, [user.id]);
  const premium = pr.rows[0]?.joke_premium === true;

  const r = await q(
    `SELECT action, COUNT(*)::int AS total
     FROM fun_actions_log
     WHERE user_id=$1
     GROUP BY action`,
    [user.id]
  );

  const map = new Map(r.rows.map(x => [x.action, x.total]));
  res.json({
    ok: true,
    thanks_total: map.get("thanks") || 0,
    donate_total: map.get("donate") || 0,
    premium
  });
});


app.post("/api/fun/thanks", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);

  // лог — всегда
  await q(`INSERT INTO fun_actions_log(user_id, action, value) VALUES($1,'thanks',NULL)`, [user.id]);
  scheduleFunStatsUpdate();

  // totals
  const tr = await q(
    `SELECT COUNT(*)::int AS total
     FROM fun_actions_log
     WHERE user_id=$1 AND action='thanks'`,
    [user.id]
  );

  res.json({ ok: true, thanks_total: tr.rows[0].total });
});


const DONATE_PREMIUM_AT = Number(process.env.DONATE_PREMIUM_AT || 9);

app.post("/api/fun/donate", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);

  const value = String(req.body?.value || "").trim();
  const allowed = new Set(["highfive", "hug", "sz"]);
  if (!allowed.has(value)) {
    return res.status(400).json({ ok: false, reason: "bad_value" });
  }

  await q(`INSERT INTO fun_actions_log(user_id, action, value) VALUES($1,'donate',$2)`, [user.id, value]);
scheduleFunStatsUpdate();
  const tr = await q(
    `SELECT COUNT(*)::int AS total
     FROM fun_actions_log
     WHERE user_id=$1 AND action='donate'`,
    [user.id]
  );
  const donate_total = tr.rows[0].total;

  // премиум: выдаём один раз при достижении порога
  const pr = await q(`SELECT joke_premium FROM players WHERE tg_id=$1`, [user.id]);
  const already = pr.rows[0]?.joke_premium === true;

  let unlocked = false;
  if (!already && donate_total >= DONATE_PREMIUM_AT) {
    await q(`UPDATE players SET joke_premium=TRUE, updated_at=NOW() WHERE tg_id=$1`, [user.id]);
    unlocked = true;
  }

  res.json({ ok: true, donate_total, premium: already || unlocked, unlocked, threshold: DONATE_PREMIUM_AT });
});



app.post("/api/feedback", upload.array("files", 5), async (req, res) => {
  try {
    const user = requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    await ensurePlayer(user);

    const category = String(req.body?.category || "bug").slice(0, 24);
    const message = String(req.body?.message || "").trim();
    const appVersion = String(req.body?.app_version || "").slice(0, 64);
    const platform = String(req.body?.platform || "").slice(0, 24);

    if (!message) return res.status(400).json({ ok: false, reason: "empty_message" });

    const tgName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    const teamChatId = await getSetting("notify_chat_id", null);

    const ins = await q(
      `INSERT INTO feedback(team_chat_id, tg_user_id, tg_username, tg_name, category, message, app_version, platform)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, created_at`,
      [
        teamChatId ? Number(teamChatId) : null,
        user.id,
        user.username || "",
        tgName,
        category,
        message,
        appVersion,
        platform,
      ]
    );

    const ticketId = ins.rows[0].id;

    const head =
      `🧾 <b>Обращение #${ticketId}</b>\n` +
      `👤 <b>${esc(tgName || user.id)}</b>${user.username ? ` (@${esc(user.username)})` : ""}\n` +
      `🆔 <code>${user.id}</code>\n` +
      (appVersion ? `📦 <code>${esc(appVersion)}</code>\n` : "") +
      (platform ? `📱 <code>${esc(platform)}</code>\n` : "") +
      `🏷️ <code>${esc(category)}</code>\n\n` +
      `${esc(message)}`;

    await supportSendMessage(head);

    const files = req.files || [];
    for (const f of files) {
      const sent = await supportSendFile({
        caption: `📎 #${ticketId} · ${f.originalname || "file"}`,
        file: f,
      });

      const msgId = sent?.message_id ?? null;
      const fileId =
        sent?.photo?.[sent.photo.length - 1]?.file_id ||
        sent?.document?.file_id ||
        "";

      await q(
        `INSERT INTO feedback_files(feedback_id, original_name, mime, size_bytes, tg_file_id, tg_message_id)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [ticketId, f.originalname || "", f.mimetype || "", f.size || 0, fileId, msgId]
      );
    }

    res.json({ ok: true, id: ticketId });
  } catch (e) {
    console.error("feedback failed:", e);
    res.status(500).json({ ok: false, reason: "feedback_failed" });
  }
});

/** ====== GAMES LIST (paged + filters) ====== */
app.get("/api/games", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  const is_admin = await isAdminId(user.id);

  if (!is_admin) {
    if (!(await requireGroupMember(req, res, user))) return;
  }

  const scopeRaw = String(req.query.scope || "upcoming");
  const scope = ["upcoming", "past", "all"].includes(scopeRaw) ? scopeRaw : "upcoming";

  const defLimit = scope === "past" ? 10 : 50;
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || defLimit)));
  const offset = Math.max(0, Number(req.query.offset || 0));

  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;

  const qText = String(req.query.q || "").trim();
  const search = qText ? `%${qText}%` : null;

  const daysRaw = req.query.days;
  const days = daysRaw === undefined ? null : Number(daysRaw);
  const daysInt = Number.isFinite(days) && days > 0 ? Math.trunc(days) : null;

  const order = scope === "past" ? "DESC" : "ASC";

  const sql = `
    WITH base AS (
      SELECT g.*
      FROM games g
      WHERE 1=1
        AND (
          CASE
            WHEN $1 = 'past' THEN g.starts_at < (NOW() - INTERVAL '3 hours')
            WHEN $1 = 'upcoming' THEN g.starts_at >= (NOW() - INTERVAL '3 hours')
            ELSE TRUE
          END
        )
        AND ($2::date IS NULL OR g.starts_at >= $2::date)
        AND ($3::date IS NULL OR g.starts_at < ($3::date + INTERVAL '1 day'))
        AND ($4::text IS NULL OR COALESCE(g.location,'') ILIKE $4)
        AND ($8::int IS NULL OR g.starts_at >= NOW() - ($8::int || ' days')::interval)
    ),
    total AS (
      SELECT COUNT(*)::int AS total FROM base
    ),
    page AS (
      SELECT *
      FROM base
      ORDER BY starts_at ${order}
      LIMIT $5 OFFSET $6
    ),
    counts AS (
      SELECT
        game_id,
        SUM((status='yes')::int)   AS yes_count,
        SUM((status='maybe')::int) AS maybe_count,
        SUM((status='no')::int)    AS no_count
      FROM rsvps
      GROUP BY game_id
    )
    SELECT
      t.total,
      p.*,
      COALESCE(c.yes_count,0)   AS yes_count,
      COALESCE(c.maybe_count,0) AS maybe_count,
      COALESCE(c.no_count,0)    AS no_count,
      my.status AS my_status,
      ${sqlPlayerName("bp")} AS best_player_name
    FROM page p
    CROSS JOIN total t
    LEFT JOIN counts c ON c.game_id = p.id
    LEFT JOIN rsvps my ON my.game_id = p.id AND my.tg_id = $7
    LEFT JOIN players bp ON bp.tg_id = p.best_player_tg_id
    ORDER BY p.starts_at ${order};
  `;

  const r = await q(sql, [scope, from, to, search, limit, offset, user.id, daysInt]);

  const holderR = await q(`
  SELECT
    g.id AS game_id,
    g.starts_at,
    g.best_player_tg_id AS tg_id,
    ${sqlPlayerName("p")} AS name
  FROM games g
  LEFT JOIN players p ON p.tg_id = g.best_player_tg_id
  WHERE g.status <> 'cancelled'
    AND g.best_player_tg_id IS NOT NULL
    AND g.starts_at < (NOW() - INTERVAL '3 hours')
  ORDER BY g.starts_at DESC
  LIMIT 1
`);

const talisman_holder = holderR.rows[0] || null;

  
  const total = r.rows[0]?.total ?? 0;
  const games = r.rows.map(({ total, ...rest }) => rest);

 res.json({ ok: true, games, total, limit, offset, scope, talisman_holder });
});

/** ====== GAME DETAILS (supports game_id) ====== */
app.get("/api/game", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  const is_admin = await isAdminId(user.id);

  if (!is_admin) {
    if (!(await requireGroupMember(req, res, user))) return;
  }

  const gameId = req.query.game_id ? Number(req.query.game_id) : null;

  let game = null;

  if (gameId) {
    const gr = await q(`SELECT * FROM games WHERE id=$1`, [gameId]);
    game = gr.rows[0] || null;
  } else {
    const gr = await q(
      `SELECT * FROM games
       WHERE status='scheduled' AND starts_at >= NOW() - INTERVAL '6 hours'
       ORDER BY starts_at ASC
       LIMIT 1`
    );
    game = gr.rows[0] || null;
  }

  if (!game) return res.json({ ok: true, game: null, rsvps: [], teams: null });
  
  let best_player_name = null;
  if (game?.best_player_tg_id) {
    const br = await q(
      `SELECT ${sqlPlayerName("p")} AS name FROM players p WHERE p.tg_id=$1`,
      [game.best_player_tg_id]
    );
    best_player_name = br.rows[0]?.name || null;
  }

  // ===== Окно голосования (пример: 36 часов после начала игры) =====
const VOTE_HOURS = 36;
const startsMs = game?.starts_at ? new Date(game.starts_at).getTime() : 0;
const nowMs = Date.now();
const vote_open = !!startsMs && startsMs < nowMs && nowMs < (startsMs + VOTE_HOURS * 3600 * 1000);

  
  // ✅ ВАЖНО: показываем roster (tg+manual) + гостей, которые реально отмечены на ЭТУ игру
  let rr;
  if (is_admin) {
    rr = await q(
      `SELECT
        COALESCE(r.status, 'maybe') AS status,
        p.tg_id, p.first_name, p.username, p.display_name, p.jersey_number,
      
        p.position AS profile_position,
        r.pos_override,
        CASE
          WHEN COALESCE(r.status,'maybe') = 'yes'
            THEN COALESCE(r.pos_override, p.position)
          ELSE p.position
        END AS position,
      
        p.skill,
        p.player_kind
      FROM players p
      LEFT JOIN rsvps r
        ON r.game_id=$1 AND r.tg_id=p.tg_id
       WHERE p.disabled=FALSE
         AND (
           p.player_kind IN ('tg','manual')
           OR r.game_id IS NOT NULL
         )
       ORDER BY
         CASE COALESCE(r.status,'maybe')
           WHEN 'yes' THEN 1
           WHEN 'maybe' THEN 2
           WHEN 'no' THEN 3
           ELSE 9
         END,
         p.skill DESC,
         COALESCE(p.display_name, p.first_name, p.username, p.tg_id::text) ASC`,
      [game.id]
    );
  } else {
    rr = await q(
      `SELECT
        COALESCE(r.status, 'maybe') AS status,
        p.tg_id, p.first_name, p.username, p.display_name, p.jersey_number,
      
        p.position AS profile_position,
        r.pos_override,
        CASE
          WHEN COALESCE(r.status,'maybe') = 'yes'
            THEN COALESCE(r.pos_override, p.position)
          ELSE p.position
        END AS position,
      
        p.player_kind
      FROM players p
      LEFT JOIN rsvps r
        ON r.game_id=$1 AND r.tg_id=p.tg_id
       WHERE p.disabled=FALSE
         AND (
           p.player_kind IN ('tg','manual')
           OR r.game_id IS NOT NULL
         )
       ORDER BY
         CASE COALESCE(r.status,'maybe')
           WHEN 'yes' THEN 1
           WHEN 'maybe' THEN 2
           WHEN 'no' THEN 3
           ELSE 9
         END,
         COALESCE(p.display_name, p.first_name, p.username, p.tg_id::text) ASC`,
      [game.id]
    );
  }


  const tr = await q(
    `SELECT team_a, team_b, meta, generated_at FROM teams WHERE game_id=$1`,
    [game.id]
  );
const teams = tr.rows[0] || null;

// ===== Мой голос (анонимно: не показываем другим, но храним чтобы 1 человек = 1 голос) =====
let my_vote = null;
let vote_results = [];
let vote_winner = null;

try {
  const mv = await q(
    `SELECT candidate_tg_id
     FROM best_player_votes
     WHERE game_id=$1 AND voter_tg_id=$2`,
    [game.id, user.id]
  );
  my_vote = mv.rows[0]?.candidate_tg_id ?? null;

  const vr = await q(
    `
    SELECT
      v.candidate_tg_id,
      COUNT(*)::int AS votes,
      COALESCE(
        NULLIF(BTRIM(p.display_name), ''),
        NULLIF(BTRIM(p.first_name), ''),
        CASE WHEN BTRIM(p.username) <> '' THEN '@' || BTRIM(p.username) ELSE NULL END,
        p.tg_id::text
      ) AS name
    FROM best_player_votes v
    JOIN players p ON p.tg_id = v.candidate_tg_id
    WHERE v.game_id=$1
    GROUP BY v.candidate_tg_id, p.display_name, p.first_name, p.username, p.tg_id
    ORDER BY votes DESC, name ASC
    `,
    [game.id]
  );

  vote_results = vr.rows || [];
  vote_winner = vote_results[0] || null;
} catch (e) {
  // если миграции ещё не применились/таблица не создана — не валим /api/game
  console.error("best_player votes query failed:", e?.message || e);
}

// отдаём расширенный game
res.json({
  ok: true,
  game: {
    ...game,
    best_player_name,
  },
  rsvps: rr.rows,
  teams,
  vote_open,
  my_vote,
  vote_results,
  vote_winner,
});

});

/** ====== RSVP (requires game_id) ====== */
app.post("/api/rsvp", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);

  const b = req.body || {};
  const gid = Number(b.game_id);
  const status = String(b.status || "").trim();

  // pos_override может быть: "F"|"D"|"G"|null
  const hasPos = Object.prototype.hasOwnProperty.call(b, "pos_override");
  const pos_override = hasPos ? normalizePosOverride(b.pos_override) : undefined;

  if (!Number.isFinite(gid) || gid <= 0) {
    return res.status(400).json({ ok: false, reason: "no_game_id" });
  }
  if (!["yes", "no", "maybe"].includes(status)) {
    return res.status(400).json({ ok: false, reason: "bad_status" });
  }

  const gr = await q(`SELECT starts_at FROM games WHERE id=$1`, [gid]);
  const startsAt = gr.rows[0]?.starts_at ? new Date(gr.rows[0].starts_at) : null;
  if (!startsAt) return res.status(404).json({ ok: false, reason: "game_not_found" });

  const is_admin = await isAdminId(user.id);
  if (!is_admin && startsAt < new Date()) {
    return res.status(403).json({ ok: false, reason: "game_closed" });
  }

  // maybe = снять отметку (как у тебя задумано)
  if (status === "maybe") {
    await q(`DELETE FROM rsvps WHERE game_id=$1 AND tg_id=$2`, [gid, user.id]);
    return res.json({ ok: true });
  }

  // ✅ оверрайд позиции храним только для yes
  // - если hasPos=false -> позицию не трогаем
  // - если status!='yes' и hasPos=true -> сброс (null)
  const finalPos =
    status === "yes"
      ? (hasPos ? pos_override : undefined)
      : (hasPos ? null : undefined);

  if (finalPos !== undefined) {
    await q(
      `INSERT INTO rsvps(game_id, tg_id, status, pos_override)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(game_id, tg_id)
       DO UPDATE SET status=EXCLUDED.status, pos_override=EXCLUDED.pos_override, updated_at=NOW()`,
      [gid, user.id, status, finalPos]
    );
  } else {
    await q(
      `INSERT INTO rsvps(game_id, tg_id, status)
       VALUES($1,$2,$3)
       ON CONFLICT(game_id, tg_id)
       DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
      [gid, user.id, status]
    );
  }

  res.json({ ok: true });
});

/** ====== TEAMS GENERATE (admin) ====== */
app.post("/api/teams/generate", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const gid = Number(req.body?.game_id);
  if (!gid) return res.status(400).json({ ok: false, reason: "no_game_id" });

  const pr = await q(
    `SELECT
      p.*,
      COALESCE(r.pos_override, p.position) AS position
     FROM rsvps r
     JOIN players p ON p.tg_id = r.tg_id
     WHERE r.game_id = $1 AND r.status = 'yes' AND p.disabled=FALSE`,
    [gid]
  );

  const players = pr.rows;
  const { teamA, teamB, meta } = makeTeams(players);

  await q(
    `INSERT INTO teams(game_id, team_a, team_b, meta)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(game_id) DO UPDATE SET
       team_a=EXCLUDED.team_a,
       team_b=EXCLUDED.team_b,
       meta=EXCLUDED.meta,
       generated_at=NOW()`,
    [gid, JSON.stringify(teamA), JSON.stringify(teamB), JSON.stringify(meta)]
  );

  res.json({ ok: true, teamA, teamB, meta });
});

/** ====== TEAMS MANUAL EDIT (admin) ====== */
app.post("/api/teams/manual", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const { game_id, op, from, tg_id, a_id, b_id } = req.body || {};
  const gid = Number(game_id);
  if (!gid) return res.status(400).json({ ok: false, reason: "no_game_id" });

  const tr = await q(`SELECT team_a, team_b, meta FROM teams WHERE game_id=$1`, [gid]);
  const row = tr.rows[0];
  if (!row) return res.status(400).json({ ok: false, reason: "no_teams" });

  const A = Array.isArray(row.team_a) ? row.team_a : [];
  const B = Array.isArray(row.team_b) ? row.team_b : [];

  const idEq = (x, id) => String(x?.tg_id) === String(id);

  const calcRating = (p) => {
    const skill = Number(p?.skill ?? 5);
    const skating = Number(p?.skating ?? 5);
    const iq = Number(p?.iq ?? 5);
    const stamina = Number(p?.stamina ?? 5);
    const passing = Number(p?.passing ?? 5);
    const shooting = Number(p?.shooting ?? 5);
    const r =
      skill * 0.45 +
      skating * 0.15 +
      iq * 0.15 +
      stamina * 0.1 +
      passing * 0.075 +
      shooting * 0.075;
    return Math.round(r * 10) / 10;
  };

  const ensureRating = (p) => {
    const r = Number(p?.rating);
    return Number.isFinite(r) ? { ...p, rating: r } : { ...p, rating: calcRating(p) };
  };

  const sum = (arr) => arr.reduce((acc, p) => acc + Number(ensureRating(p).rating || 0), 0);

  function removeOne(arr, id) {
    const idx = arr.findIndex((x) => idEq(x, id));
    if (idx < 0) return { item: null, idx: -1 };
    const item = arr[idx];
    arr.splice(idx, 1);
    return { item, idx };
  }

  if (op === "move") {
    if (!tg_id || !from) return res.status(400).json({ ok: false, reason: "bad_args" });
    const src = from === "A" ? A : B;
    const dst = from === "A" ? B : A;

    const { item } = removeOne(src, tg_id);
    if (!item) return res.status(404).json({ ok: false, reason: "player_not_found" });

    dst.push(ensureRating(item));
  } else if (op === "swap") {
    if (!a_id || !b_id) return res.status(400).json({ ok: false, reason: "bad_args" });
    const ia = A.findIndex((x) => idEq(x, a_id));
    const ib = B.findIndex((x) => idEq(x, b_id));
    if (ia < 0 || ib < 0) return res.status(404).json({ ok: false, reason: "player_not_found" });

    const tmp = ensureRating(A[ia]);
    A[ia] = ensureRating(B[ib]);
    B[ib] = tmp;
  } else {
    return res.status(400).json({ ok: false, reason: "bad_op" });
  }

  const sumA = sum(A);
  const sumB = sum(B);
  const meta = { sumA, sumB, diff: Math.abs(sumA - sumB) };

  await q(
    `UPDATE teams
     SET team_a=$2, team_b=$3, meta=$4, generated_at=NOW()
     WHERE game_id=$1`,
    [gid, JSON.stringify(A), JSON.stringify(B), JSON.stringify(meta)]
  );

  res.json({ ok: true, teamA: A, teamB: B, meta });
});

/** ====== ADMIN: games CRUD ====== */
app.post("/api/games", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const { starts_at, location, video_url, geo_lat, geo_lon } = req.body || {};

  const d = new Date(starts_at);
  if (Number.isNaN(d.getTime())) return res.status(400).json({ ok: false, reason: "bad_starts_at" });

  const vu = cleanUrl(video_url);
  if (video_url && !vu) return res.status(400).json({ ok: false, reason: "bad_video_url" });

  const lat = geo_lat === null || geo_lat === "" ? null : Number(geo_lat);
  const lon = geo_lon === null || geo_lon === "" ? null : Number(geo_lon);

  if ((lat !== null && !Number.isFinite(lat)) || (lon !== null && !Number.isFinite(lon))) {
    return res.status(400).json({ ok: false, reason: "bad_geo" });
  }
  if ((lat === null) !== (lon === null)) {
    return res.status(400).json({ ok: false, reason: "bad_geo_pair" });
  }

  const ir = await q(
    `INSERT INTO games(starts_at, location, status, video_url, geo_lat, geo_lon)
     VALUES($1,$2,'scheduled',$3,$4,$5)
     RETURNING *`,
    [d.toISOString(), String(location || "").trim(), vu, lat, lon]
  );
  console.log("POST /api/games body:", req.body);
  console.log("parsed:", { lat, lon });
  res.json({ ok: true, game: ir.rows[0] });
});




app.patch("/api/games/:id", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const id = Number(req.params.id);
  const b = req.body || {};

  const sets = [];
  const vals = [];
  let i = 1;

  if (b.starts_at) {
    const d = new Date(b.starts_at);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ ok: false, reason: "bad_starts_at" });
    sets.push(`starts_at=$${i++}`);
    vals.push(d.toISOString());
  }
  if (b.location !== undefined) {
    sets.push(`location=$${i++}`);
    vals.push(String(b.location || "").trim());
  }
  if (b.status) {
    sets.push(`status=$${i++}`);
    vals.push(String(b.status));
  }
  if (b.video_url !== undefined) {
    const vu = cleanUrl(b.video_url);
    if (b.video_url && !vu) return res.status(400).json({ ok: false, reason: "bad_video_url" });
    sets.push(`video_url=$${i++}`);
    vals.push(vu);
  }

  // ✅ geo pair
const hasLat = Object.prototype.hasOwnProperty.call(b, "geo_lat");
const hasLon = Object.prototype.hasOwnProperty.call(b, "geo_lon");
if (hasLat || hasLon) {
  const lat = b.geo_lat === null || b.geo_lat === "" ? null : Number(b.geo_lat);
  const lon = b.geo_lon === null || b.geo_lon === "" ? null : Number(b.geo_lon);

  if ((lat !== null && !Number.isFinite(lat)) || (lon !== null && !Number.isFinite(lon))) {
    return res.status(400).json({ ok: false, reason: "bad_geo" });
  }
  if ((lat === null) !== (lon === null)) {
    return res.status(400).json({ ok: false, reason: "bad_geo_pair" });
  }

  sets.push(`geo_lat=$${i++}`);
  vals.push(lat);

  sets.push(`geo_lon=$${i++}`);
  vals.push(lon);
}


  sets.push(`updated_at=NOW()`);

  vals.push(id);

  const ur = await q(`UPDATE games SET ${sets.join(", ")} WHERE id=$${i} RETURNING *`, vals);
  res.json({ ok: true, game: ur.rows[0] });
});

app.post("/api/games/:id/status", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const id = Number(req.params.id);
  const status = String(req.body?.status || "").trim();

  if (!["scheduled", "cancelled"].includes(status)) {
    return res.status(400).json({ ok: false, reason: "bad_status" });
  }

  const ur = await q(`UPDATE games SET status=$2, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, status]);
  res.json({ ok: true, game: ur.rows[0] });
});

app.delete("/api/games/:id", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const id = Number(req.params.id);
  await q(`DELETE FROM games WHERE id=$1`, [id]);
  res.json({ ok: true });
});

/** ====== ADMIN: guests/manual players ====== */
// create guest OR manual (+ optional RSVP on game)
app.post("/api/admin/guests", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const b = req.body || {};
  const gameId = b.game_id ? Number(b.game_id) : null;
  const status = String(b.status || "yes");

  // ✅ НОВОЕ: kind = guest | manual
  const kindRaw = String(b.kind || "guest").toLowerCase();
  const playerKind = kindRaw === "manual" ? "manual" : "guest";

  if (gameId) {
    const gr = await q(`SELECT id FROM games WHERE id=$1`, [gameId]);
    if (!gr.rows[0]) return res.status(400).json({ ok: false, reason: "bad_game_id" });
  }

  const idr = await q(`SELECT -nextval('guest_seq')::bigint AS tg_id`);
  const guestId = idr.rows[0].tg_id;

  const displayName = (b.display_name || (playerKind === "manual" ? "Игрок" : "Гость"))
    .trim()
    .slice(0, 60) || (playerKind === "manual" ? "Игрок" : "Гость");

  await q(
    `INSERT INTO players(
      tg_id, display_name, jersey_number,
      is_guest, player_kind, created_by,
      position, skill, skating, iq, stamina, passing, shooting,
      notes, disabled, is_admin
    ) VALUES($1,$2,$3, TRUE, $4, $5, $6,$7,$8,$9,$10,$11,$12, $13, FALSE, FALSE)`,
    [
      guestId,
      displayName,
      jersey(b.jersey_number),
      playerKind,
      user.id,
      (b.position || "F").toUpperCase(),
      int(b.skill, 5),
      int(b.skating, 5),
      int(b.iq, 5),
      int(b.stamina, 5),
      int(b.passing, 5),
      int(b.shooting, 5),
      (b.notes || "").slice(0, 500),
    ]
  );

  if (gameId && ["yes", "no", "maybe"].includes(status)) {
    await q(
      `INSERT INTO rsvps(game_id, tg_id, status)
       VALUES($1,$2,$3)
       ON CONFLICT(game_id, tg_id) DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
      [gameId, guestId, status]
    );
  }

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [guestId]);
  res.json({ ok: true, guest: pr.rows[0] });
});

// admin set RSVP for any player/guest (+ optional pos_override)
app.post("/api/admin/rsvp", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const b = req.body || {};
  const gid = Number(b.game_id);
  const tgId = Number(b.tg_id);
  const status = String(b.status || "").trim();

  // ✅ ВОТ ЭТОГО у тебя не хватало:
  const hasPos = Object.prototype.hasOwnProperty.call(b, "pos_override");
  const pos_override = hasPos ? normalizePosOverride(b.pos_override) : undefined;

  if (!Number.isFinite(gid) || gid <= 0 || !Number.isFinite(tgId)) {
    return res.status(400).json({ ok: false, reason: "bad_params" });
  }
  if (!["yes", "no", "maybe"].includes(status)) {
    return res.status(400).json({ ok: false, reason: "bad_status" });
  }

  const gr = await q(`SELECT id FROM games WHERE id=$1`, [gid]);
  if (!gr.rows[0]) return res.status(400).json({ ok: false, reason: "bad_game_id" });

  const pr = await q(`SELECT tg_id FROM players WHERE tg_id=$1`, [tgId]);
  if (!pr.rows[0]) return res.status(400).json({ ok: false, reason: "bad_player_id" });

  // ✅ делаем поведение как у обычного /api/rsvp: maybe = удалить запись
  if (status === "maybe") {
    await q(`DELETE FROM rsvps WHERE game_id=$1 AND tg_id=$2`, [gid, tgId]);
    return res.json({ ok: true });
  }

  const finalPos =
    status === "yes"
      ? (hasPos ? pos_override : undefined)
      : (hasPos ? null : undefined);

  if (finalPos !== undefined) {
    await q(
      `INSERT INTO rsvps(game_id, tg_id, status, pos_override)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(game_id, tg_id)
       DO UPDATE SET status=EXCLUDED.status, pos_override=EXCLUDED.pos_override, updated_at=NOW()`,
      [gid, tgId, status, finalPos]
    );
  } else {
    await q(
      `INSERT INTO rsvps(game_id, tg_id, status)
       VALUES($1,$2,$3)
       ON CONFLICT(game_id, tg_id)
       DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
      [gid, tgId, status]
    );
  }

  res.json({ ok: true });
});


/** ====== ADMIN: players list + patch ====== */
app.get("/api/admin/players", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const r = await q(
    `SELECT
      tg_id, first_name, last_name, username,
      display_name, jersey_number,
      is_guest, player_kind, created_by,
      position, skill, skating, iq, stamina, passing, shooting,
      notes, disabled,
      is_admin, updated_at
     FROM players
     ORDER BY COALESCE(display_name, first_name, username, tg_id::text) ASC`
  );

  const env = envAdminSet();
  const players = r.rows.map((p) => ({
    ...p,
    is_admin: p.is_admin || env.has(String(p.tg_id)),
    is_env_admin: env.has(String(p.tg_id)),
  }));

  res.json({ ok: true, players, is_super_admin: isSuperAdmin(user.id) });
});

app.patch("/api/admin/players/:tg_id", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const tgId = Number(req.params.tg_id);
  const b = req.body || {};

  // ✅ разрешаем менять player_kind (guest -> manual), но не даём трогать is_admin тут
  const kindRaw = b.player_kind ? String(b.player_kind).toLowerCase().trim() : null;
  const kind = ["tg", "manual", "guest"].includes(kindRaw) ? kindRaw : null;

  await q(
    `UPDATE players SET
      display_name=$2,
      jersey_number=$3,
      position=$4,
      skill=$5, skating=$6, iq=$7, stamina=$8, passing=$9, shooting=$10,
      notes=$11,
      disabled=$12,
      player_kind=COALESCE($13, player_kind),
      updated_at=NOW()
     WHERE tg_id=$1`,
    [
      tgId,
      (b.display_name || "").trim().slice(0, 40) || null,
      jersey(b.jersey_number),
      (b.position || "F").toUpperCase(),
      int(b.skill, 5),
      int(b.skating, 5),
      int(b.iq, 5),
      int(b.stamina, 5),
      int(b.passing, 5),
      int(b.shooting, 5),
      (b.notes || "").slice(0, 500),
      Boolean(b.disabled),
      kind,
    ]
  );

  const pr = await q(
    `SELECT
      tg_id, first_name, username, display_name, jersey_number,
      is_guest, player_kind, created_by,
      position, skill, skating, iq, stamina, passing, shooting,
      notes, disabled, is_admin
     FROM players WHERE tg_id=$1`,
    [tgId]
  );

  res.json({ ok: true, player: pr.rows[0] });
});

app.post("/api/admin/players/:tg_id/admin", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  if (!isSuperAdmin(user.id)) {
    return res.status(403).json({ ok: false, reason: "not_super_admin" });
  }

  const tgId = Number(req.params.tg_id);
  const makeAdmin = !!req.body?.is_admin;

  await q(`UPDATE players SET is_admin=$2, updated_at=NOW() WHERE tg_id=$1`, [tgId, makeAdmin]);
  res.json({ ok: true });
});

app.delete("/api/admin/players/:tg_id", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const tgId = Number(req.params.tg_id);
  const pr = await q(`SELECT tg_id, player_kind FROM players WHERE tg_id=$1`, [tgId]);
  if (!pr.rows[0]) return res.status(404).json({ ok: false, reason: "not_found" });

  // ✅ удаляем только "разовых" гостей
  if (pr.rows[0].player_kind !== "guest") {
    return res.status(400).json({ ok: false, reason: "not_guest" });
  }

  await q(`DELETE FROM players WHERE tg_id=$1`, [tgId]);
  res.json({ ok: true });
});

/** ====== PLAYERS (roster) ====== */
app.get("/api/players", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);

  const is_admin = await isAdminId(user.id);

  // ✅ показываем только постоянных: tg + manual
  const sql = is_admin
    ? `SELECT tg_id, first_name, last_name, username, display_name, jersey_number, position,
              photo_url, notes, skill, skating, iq, stamina, passing, shooting, is_admin, disabled,
              player_kind
       FROM players
       WHERE disabled=FALSE
         AND player_kind IN ('tg','manual')
       ORDER BY COALESCE(display_name, first_name, username, tg_id::text) ASC`
    : `SELECT tg_id, first_name, last_name, username, display_name, jersey_number, position,
              photo_url, notes,
              player_kind
       FROM players
       WHERE disabled=FALSE
         AND player_kind IN ('tg','manual')
       ORDER BY COALESCE(display_name, first_name, username, tg_id::text) ASC`;

  const r = await q(sql);
  res.json({ ok: true, players: r.rows });
});

app.get("/api/players/:tg_id", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  const tgId = Number(req.params.tg_id);
  const is_admin = await isAdminId(user.id);

  const sql = is_admin
    ? `SELECT * FROM players WHERE tg_id=$1`
    : `SELECT tg_id, first_name, last_name, username, display_name, jersey_number, position, photo_url, notes, player_kind
       FROM players WHERE tg_id=$1`;

  const r = await q(sql, [tgId]);
  res.json({ ok: true, player: r.rows[0] || null });
});

/** ====== ADMIN: reminder ====== */
app.post("/api/admin/reminder/sendNow", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const chatId = await getSetting("notify_chat_id", null);
  if (!chatId) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  try {
    const r = await sendRsvpReminder(Number(chatId));
    res.json(r);
  } catch (e) {
    console.error("sendNow failed:", e);
    res.status(500).json({ ok: false, reason: "send_failed" });
  }
});

app.get("/api/admin/bot-messages", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  if (!isSuperAdmin(user.id)) {
    return res.status(403).json({ ok: false, reason: "not_super_admin" });
  }

  const chatIdRaw = await getSetting("notify_chat_id", null);
  if (!chatIdRaw) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  const chat_id = Number(chatIdRaw);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const includeDeleted = String(req.query.include_deleted || "0") === "1";
  const kind = String(req.query.kind || "").trim();

  const params = [chat_id];
  const where = [`chat_id=$1`];

  if (kind) {
    params.push(kind);
    where.push(`kind=$${params.length}`);
  }
  if (!includeDeleted) where.push(`deleted_at IS NULL`);

  params.push(limit);

  const r = await q(
    `SELECT id, chat_id, message_id, kind, text, created_at, checked_at, deleted_at, delete_reason, sent_by_tg_id
     FROM bot_messages
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );

  res.json({ ok: true, messages: r.rows });
});

app.post("/api/admin/bot-messages/send", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  if (!isSuperAdmin(user.id)) {
    return res.status(403).json({ ok: false, reason: "not_super_admin" });
  }

  const chatIdRaw = await getSetting("notify_chat_id", null);
  if (!chatIdRaw) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  const chat_id = Number(chatIdRaw);
  const text = String(req.body?.text || "").trim();

  if (!text) return res.status(400).json({ ok: false, reason: "empty_text" });
  if (text.length > 3500) return res.status(400).json({ ok: false, reason: "too_long" });

  try {
    const sent = await bot.api.sendMessage(chat_id, text, {
      disable_web_page_preview: true,
    });

    await logBotMessage({
      chat_id,
      message_id: sent.message_id,
      kind: "custom",
      text,
      disable_web_page_preview: true,
      meta: { type: "custom_from_admin" },
      sent_by_tg_id: user.id,
    });

    res.json({ ok: true, message_id: sent.message_id });
  } catch (e) {
    console.error("custom send failed:", e);
    res.status(500).json({ ok: false, reason: "send_failed", error: tgErrText(e) });
  }
});

app.post("/api/admin/bot-messages/:id/delete", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  if (!isSuperAdmin(user.id)) {
    return res.status(403).json({ ok: false, reason: "not_super_admin" });
  }

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, reason: "bad_id" });

  const row = await q(
    `SELECT id, chat_id, message_id, deleted_at
     FROM bot_messages
     WHERE id=$1`,
    [id]
  );
  const m = row.rows[0];
  if (!m) return res.status(404).json({ ok: false, reason: "not_found" });

  if (m.deleted_at) return res.json({ ok: true, already_deleted: true });

  try {
    await bot.api.deleteMessage(Number(m.chat_id), Number(m.message_id));
    await q(`UPDATE bot_messages SET deleted_at=NOW(), delete_reason=$2 WHERE id=$1`, [id, "deleted_by_webapp"]);
    res.json({ ok: true });
  } catch (e) {
    if (tgMessageMissing(e)) {
      await q(`UPDATE bot_messages SET deleted_at=NOW(), delete_reason=$2 WHERE id=$1`, [id, "missing_in_chat"]);
      return res.json({ ok: true, already_missing: true });
    }

    console.error("delete message failed:", e);
    res.status(500).json({ ok: false, reason: "delete_failed", error: tgErrText(e) });
  }
});

app.post("/api/admin/bot-messages/sync", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  if (!isSuperAdmin(user.id)) {
    return res.status(403).json({ ok: false, reason: "not_super_admin" });
  }

  const chatIdRaw = await getSetting("notify_chat_id", null);
  if (!chatIdRaw) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  const chat_id = Number(chatIdRaw);
  const limit = Math.max(1, Math.min(80, Number(req.body?.limit || 30)));

  const r = await q(
    `SELECT id, chat_id, message_id, text, parse_mode, disable_web_page_preview, reply_markup
     FROM bot_messages
     WHERE chat_id=$1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2`,
    [chat_id, limit]
  );

  let checked = 0,
    missing = 0;

  for (const row of r.rows) {
    checked++;

    try {
      const opts = {
        disable_web_page_preview: !!row.disable_web_page_preview,
      };
      if (row.parse_mode) opts.parse_mode = row.parse_mode;
      if (row.reply_markup) opts.reply_markup = row.reply_markup;

      await bot.api.editMessageText(Number(row.chat_id), Number(row.message_id), row.text, opts);

      await q(`UPDATE bot_messages SET checked_at=NOW() WHERE id=$1`, [row.id]);
    } catch (e) {
      if (tgMessageExistsButNotEditable(e)) {
        await q(`UPDATE bot_messages SET checked_at=NOW() WHERE id=$1`, [row.id]);
        continue;
      }

      if (tgMessageMissing(e)) {
        missing++;
        await q(
          `UPDATE bot_messages
           SET checked_at=NOW(), deleted_at=NOW(), delete_reason=$2
           WHERE id=$1`,
          [row.id, "missing_in_chat"]
        );
        continue;
      }

      console.error("sync probe failed:", e);
      await q(`UPDATE bot_messages SET checked_at=NOW() WHERE id=$1`, [row.id]);
    }
  }

  res.json({ ok: true, checked, missing });
});

app.get("/api/stats/attendance", async (req, res) => {
  try {
    const isoDateOrNull = (v) => {
      const s = String(v || "").trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    };

    // ✅ новые параметры
    const from = isoDateOrNull(req.query.from);
    const to = isoDateOrNull(req.query.to);

    // ✅ старый режим (days) остаётся
    let days = parseInt(String(req.query.days ?? "0"), 10);
    if (!Number.isFinite(days) || days < 0) days = 0;

    // если задан диапазон — days игнорируем
    const useRange = !!(from || to);
    const useDays = !useRange && days > 0 && days < 100000;

    const sql = `
      SELECT
        p.tg_id,
        COALESCE(
          NULLIF(BTRIM(p.display_name), ''),
          NULLIF(BTRIM(p.first_name), ''),
          CASE WHEN BTRIM(p.username) <> '' THEN '@' || BTRIM(p.username) ELSE NULL END,
          p.tg_id::text
        ) AS name,
        p.position,
        p.jersey_number,
        p.is_guest,
        p.player_kind,

        SUM(CASE WHEN r.status = 'yes' THEN 1 ELSE 0 END)   AS yes,
        SUM(CASE WHEN r.status = 'maybe' THEN 1 ELSE 0 END) AS maybe,
        SUM(CASE WHEN r.status = 'no' THEN 1 ELSE 0 END)    AS no,
        COUNT(*) AS total

      FROM rsvps r
      JOIN games g   ON g.id = r.game_id
      JOIN players p ON p.tg_id = r.tg_id

      WHERE g.status <> 'cancelled'
        AND g.starts_at < NOW()

        -- ✅ диапазон дат (включительно по дням)
        AND ($1::date IS NULL OR g.starts_at >= $1::date)
        AND ($2::date IS NULL OR g.starts_at < ($2::date + INTERVAL '1 day'))

        -- ✅ последние N дней (если нет диапазона)
        ${useDays ? `AND g.starts_at >= NOW() - make_interval(days => $3::int)` : ""}

        AND p.disabled IS DISTINCT FROM TRUE

      GROUP BY p.tg_id, name, p.position, p.jersey_number, p.is_guest, p.player_kind
      ORDER BY yes DESC, maybe DESC, total DESC, name ASC;
    `;

    const params = [
      useRange ? from : null,
      useRange ? to : null,
      useDays ? days : null,
    ];

    const { rows } = await q(sql, params);

    res.json({
      ok: true,
      filter: useRange ? { mode: "range", from, to } : { mode: useDays ? "days" : "all", days: useDays ? days : 0 },
      rows,
    });
  } catch (e) {
    console.error("attendance stats error:", e);
    res.status(500).json({ ok: false, error: "stats_error" });
  }
});


app.post("/api/rsvp/bulk", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  const status = String(req.body?.status || "").trim();
  if (!["yes", "no", "maybe"].includes(status)) {
    return res.status(400).json({ ok: false, reason: "bad_status" });
  }

  await ensurePlayer(user);

  if (status === "maybe") {
    await q(
      `DELETE FROM rsvps
       WHERE tg_id=$1 AND game_id IN (
         SELECT id FROM games WHERE status='scheduled' AND starts_at >= NOW()
       )`,
      [user.id]
    );
    return res.json({ ok: true });
  }

  await q(
    `INSERT INTO rsvps(game_id, tg_id, status)
     SELECT g.id, $1, $2
     FROM games g
     WHERE g.status='scheduled' AND g.starts_at >= NOW()
     ON CONFLICT(game_id, tg_id)
     DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
    [user.id, status]
  );

  res.json({ ok: true });
});

app.get("/api/public/rsvp/info", async (req, res) => {
  const token = String(req.query.token || req.query.t || "").trim();
  if (!token) return res.status(400).json({ ok: false, reason: "no_token" });

  try {
    const r = await q(
      `
      SELECT
        t.id, t.token, t.game_id, t.tg_id,
        t.expires_at, t.max_uses, t.used_count, t.created_at,

        g.starts_at, g.location, g.status AS game_status, g.video_url,

        p.display_name, p.first_name, p.username, p.position, p.jersey_number,
        p.disabled, p.player_kind,

        rsvp.status AS current_status
      FROM rsvp_tokens t
      JOIN games g ON g.id = t.game_id
      JOIN players p ON p.tg_id = t.tg_id
      LEFT JOIN rsvps rsvp ON rsvp.game_id = t.game_id AND rsvp.tg_id = t.tg_id
      WHERE t.token=$1
      `,
      [token]
    );

    const row = r.rows[0];
    if (!row) return res.status(404).json({ ok: false, reason: "token_not_found" });

    const now = Date.now();
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
      return res.status(410).json({ ok: false, reason: "token_expired" });
    }
    if (row.max_uses > 0 && row.used_count >= row.max_uses) {
      return res.status(429).json({ ok: false, reason: "token_used_up" });
    }
    if (row.disabled) {
      return res.status(410).json({ ok: false, reason: "player_disabled" });
    }
    if (row.game_status === "cancelled") {
      return res.status(403).json({ ok: false, reason: "game_cancelled" });
    }

    res.json({
      ok: true,
      token: row.token,
      game: {
        id: row.game_id,
        starts_at: row.starts_at,
        location: row.location,
        status: row.game_status,
        video_url: row.video_url || null,
      },
      player: {
        tg_id: row.tg_id,
        name: displayPlayerName(row),
        position: row.position,
        jersey_number: row.jersey_number,
        player_kind: row.player_kind,
      },
      current_status: row.current_status || "maybe",
      limits: {
        expires_at: row.expires_at,
        max_uses: row.max_uses,
        used_count: row.used_count,
      },
    });
  } catch (e) {
    console.error("public rsvp info failed:", e);
    res.status(500).json({ ok: false, reason: "server_error" });
  }
});


app.post("/api/public/rsvp", async (req, res) => {
  const b = req.body || {};
  const token = String(b.token || b.t || "").trim();
  const status = String(b.status || "").trim(); // yes|no|maybe

  if (!token) return res.status(400).json({ ok: false, reason: "no_token" });
  if (!["yes", "no", "maybe"].includes(status)) {
    return res.status(400).json({ ok: false, reason: "bad_status" });
  }

  try {
    await q("BEGIN");

    const row = await getTokenRowForUpdate(token);
    if (!row) {
      await q("ROLLBACK");
      return res.status(404).json({ ok: false, reason: "token_not_found" });
    }

    const now = Date.now();
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
      await q("ROLLBACK");
      return res.status(410).json({ ok: false, reason: "token_expired" });
    }
    if (row.max_uses > 0 && row.used_count >= row.max_uses) {
      await q("ROLLBACK");
      return res.status(429).json({ ok: false, reason: "token_used_up" });
    }
    if (row.disabled) {
      await q("ROLLBACK");
      return res.status(410).json({ ok: false, reason: "player_disabled" });
    }
    if (row.game_status === "cancelled") {
      await q("ROLLBACK");
      return res.status(403).json({ ok: false, reason: "game_cancelled" });
    }

    // закрываем после начала игры (как у обычных игроков)
    const startsAt = row.starts_at ? new Date(row.starts_at) : null;
    if (!startsAt) {
      await q("ROLLBACK");
      return res.status(404).json({ ok: false, reason: "game_not_found" });
    }
    if (startsAt < new Date()) {
      await q("ROLLBACK");
      return res.status(403).json({ ok: false, reason: "game_closed" });
    }

    // maybe = сбросить
    if (status === "maybe") {
      await q(`DELETE FROM rsvps WHERE game_id=$1 AND tg_id=$2`, [row.game_id, row.tg_id]);
    } else {
      await q(
        `INSERT INTO rsvps(game_id, tg_id, status)
         VALUES($1,$2,$3)
         ON CONFLICT(game_id, tg_id)
         DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
        [row.game_id, row.tg_id, status]
      );
    }

    // учитываем использование токена
    await q(
      `UPDATE rsvp_tokens
       SET used_count = used_count + 1,
           last_used_at = NOW()
       WHERE token=$1`,
      [token]
    );

    await q("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try {
      await q("ROLLBACK");
    } catch {}
    console.error("public rsvp failed:", e);
    res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.post("/api/admin/rsvp-tokens", async (req, res) => {
  try {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const b = req.body || {};
  const game_id = Number(b.game_id);
  const tg_id = Number(b.tg_id);

  const max_uses = Number.isFinite(Number(b.max_uses)) ? Math.max(0, Math.trunc(Number(b.max_uses))) : 0; // 0=unlimited
  const expires_hours = Number.isFinite(Number(b.expires_hours)) ? Math.max(1, Math.trunc(Number(b.expires_hours))) : 168; // 7 дней

  if (!game_id || !tg_id) return res.status(400).json({ ok: false, reason: "bad_params" });

  const gr = await q(`SELECT id FROM games WHERE id=$1`, [game_id]);
  if (!gr.rows[0]) return res.status(400).json({ ok: false, reason: "bad_game_id" });

  const pr = await q(`SELECT tg_id FROM players WHERE tg_id=$1`, [tg_id]);
  if (!pr.rows[0]) return res.status(400).json({ ok: false, reason: "bad_player_id" });

  const token = makeToken();
  const expires_at = new Date(Date.now() + expires_hours * 3600 * 1000).toISOString();
  await q(
    `UPDATE rsvp_tokens
     SET expires_at = NOW() - INTERVAL '1 minute'
     WHERE game_id=$1 AND tg_id=$2
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [game_id, tg_id]
  );
  const ins = await q(
    `INSERT INTO rsvp_tokens(token, game_id, tg_id, created_by, expires_at, max_uses)
     VALUES($1,$2,$3,$4,$5,$6)
     RETURNING id, token, expires_at, max_uses, used_count`,
    [token, game_id, tg_id, user.id, expires_at, max_uses]
  );

  const base = publicBaseUrl();
  const url = base ? `${base}/rsvp?t=${encodeURIComponent(token)}` : null;

  res.json({ ok: true, token: ins.rows[0], url });
    } catch (e) {
    console.error("rsvp-tokens failed:", e);
    res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.get("/api/admin/rsvp-tokens", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const game_id = req.query.game_id ? Number(req.query.game_id) : null;

  const params = [];
  const where = [];
  if (game_id) {
    params.push(game_id);
    where.push(`t.game_id=$${params.length}`);
  }

  const r = await q(
    `
    SELECT
      t.id, t.token, t.game_id, t.tg_id, t.created_at, t.expires_at, t.max_uses, t.used_count, t.last_used_at,
      g.starts_at, g.location,
      p.display_name, p.first_name, p.username, p.player_kind
    FROM rsvp_tokens t
    JOIN games g ON g.id=t.game_id
    JOIN players p ON p.tg_id=t.tg_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY t.created_at DESC
    LIMIT 200
    `,
    params
  );

  const base = publicBaseUrl();
  const tokens = r.rows.map((x) => ({
    ...x,
    url: base ? `${base}/rsvp?t=${encodeURIComponent(x.token)}` : null,
    player_name: displayPlayerName(x),
  }));

  res.json({ ok: true, tokens });
});

app.post("/api/admin/rsvp-tokens/revoke", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ ok: false, reason: "no_token" });

  await q(
    `UPDATE rsvp_tokens
     SET expires_at = NOW() - INTERVAL '1 minute'
     WHERE token=$1`,
    [token]
  );
  res.json({ ok: true });
});

app.post("/api/admin/players/:tg_id/promote", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const tg_id = Number(req.params.tg_id);
  if (!tg_id) return res.status(400).json({ ok: false, reason: "bad_tg_id" });

  await q(
    `UPDATE players
     SET player_kind='manual',
         is_guest=FALSE,
         updated_at=NOW()
     WHERE tg_id=$1`,
    [tg_id]
  );

  res.json({ ok: true });
});

app.post("/api/admin/teams/send", async (req, res) => {
  try {
    const user = requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;
    if (!(await requireAdminAsync(req, res, user))) return;

    const game_id = Number(req.body?.game_id);
    const force = !!req.body?.force;
    if (!game_id) return res.status(400).json({ ok: false, reason: "bad_game_id" });

    // 1) игра + составы
    const r = await q(
      `
      SELECT
        g.id, g.starts_at, g.location, g.status,
        t.team_a, t.team_b, t.meta, t.generated_at
      FROM games g
      LEFT JOIN teams t ON t.game_id = g.id
      WHERE g.id=$1
      `,
      [game_id]
    );

    const row = r.rows?.[0];
    if (!row) return res.status(404).json({ ok: false, reason: "game_not_found" });
    if (row.status === "cancelled") return res.status(403).json({ ok: false, reason: "game_cancelled" });

    const teamAIds = parseTeamIds(row.team_a);
    const teamBIds = parseTeamIds(row.team_b);

    if (!teamAIds.length && !teamBIds.length) {
      return res.status(400).json({ ok: false, reason: "no_teams" });
    }

    // 2) защита “составы устарели” (✅ yes vs ids в составах)
    const yesR = await q(`SELECT tg_id FROM rsvps WHERE game_id=$1 AND status='yes'`, [game_id]);
    const yesIds = new Set((yesR.rows || []).map((x) => String(x.tg_id)));

    const teamIds = new Set([...teamAIds, ...teamBIds].map((x) => String(x)));

    let removed = 0; // есть в составах, но уже не ✅ yes
    for (const id of teamIds) if (!yesIds.has(id)) removed++;

    let added = 0; // ✅ yes, но нет в составах
    for (const id of yesIds) if (!teamIds.has(id)) added++;

    const stale = removed > 0 || added > 0;
    if (stale && !force) {
      return res.status(409).json({ ok: false, reason: "teams_stale", removed, added });
    }

    // 3) подтягиваем игроков из БД (имя/номер/позиция)
    const allIds = Array.from(new Set([...teamAIds, ...teamBIds]));
    const pr = await q(
      `SELECT
         p.tg_id, p.display_name, p.first_name, p.username, p.jersey_number,
         COALESCE(r.pos_override, p.position) AS position
       FROM players p
       LEFT JOIN rsvps r
         ON r.game_id=$2 AND r.tg_id=p.tg_id AND r.status='yes'
       WHERE p.tg_id = ANY($1::bigint[])`,
      [allIds, game_id]
    );
    const map = new Map(pr.rows.map((p) => [String(p.tg_id), p]));

    const teamAPlayers = teamAIds.map((id) => map.get(String(id)) || { tg_id: id, display_name: String(id), position: "F" });
    const teamBPlayers = teamBIds.map((id) => map.get(String(id)) || { tg_id: id, display_name: String(id), position: "F" });

      // 4) получаем командный чат (используем тот же ключ, что /setchat)
      const chatIdRaw = await getSetting("notify_chat_id", null);
      const chatId = chatIdRaw ? Number(String(chatIdRaw).trim()) : null;
      
      if (!Number.isFinite(chatId)) {
        return res.status(400).json({ ok: false, reason: "chat_not_set" });
      }

    // 5) формируем HTML
    const dt = row.starts_at ? new Date(row.starts_at) : null;
   const when = formatGameWhen(row.starts_at); // ✅ твой хелпер с timeZone

    const header =
      `<b>🏒 Составы на игру</b>\n` +
      `⏱ <code>${escapeHtml(when)}</code>\n` +
      `📍 <b>${escapeHtml(row.location || "—")}</b>` +
      (stale ? `\n\n<b>⚠️</b> Отметки менялись после формирования.` : "");
    
    const table = renderTeamsTwoColsHtml(teamAPlayers, teamBPlayers);
    
    const body = `${header}\n\n${table}`;
    const botUsername = String(process.env.BOT_USERNAME || "").trim();

    // start_param будет teams_<gameId>
    const deepLinkTeams = botUsername
      ? `https://t.me/${botUsername}?startapp=${encodeURIComponent(`teams_${game_id}`)}`
      : null;
    
    const kb = new InlineKeyboard();
    if (deepLinkTeams) kb.url("📋 Открыть составы", deepLinkTeams);
    
    // 6) отправляем
    const sent = await bot.api.sendMessage(chatId, body, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: kb,
    });
    // 7) пишем в историю (у тебя уже есть bot_messages)
    await q(
      `INSERT INTO bot_messages(chat_id, message_id, kind, text, parse_mode, disable_web_page_preview, meta, sent_by_tg_id)
       VALUES($1,$2,'teams',$3,'HTML',TRUE,$4,$5)`,
      [chatId, sent.message_id, body, JSON.stringify({ game_id, stale, removed, added }), user.id]
    );

    return res.json({ ok: true, message_id: sent.message_id, stale, removed, added });
  } catch (e) {
    console.error("teams/send failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.post("/api/best-player/vote", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);

  const game_id = Number(req.body?.game_id);
  const candidate_tg_id = Number(req.body?.candidate_tg_id);

  if (!game_id || !candidate_tg_id) {
    return res.status(400).json({ ok: false, reason: "bad_params" });
  }

  const gr = await q(`SELECT id, starts_at, status FROM games WHERE id=$1`, [game_id]);
  const game = gr.rows[0];
  if (!game) return res.status(404).json({ ok: false, reason: "game_not_found" });
  if (game.status === "cancelled") return res.status(403).json({ ok: false, reason: "game_cancelled" });

  const starts = new Date(game.starts_at).getTime();
  const now = Date.now();
  const VOTE_HOURS = 36;
  const vote_open = starts < now && now < starts + VOTE_HOURS * 3600 * 1000;
  if (!vote_open) return res.status(403).json({ ok: false, reason: "vote_closed" });

  const pr = await q(`SELECT tg_id, disabled FROM players WHERE tg_id=$1`, [candidate_tg_id]);
  const cand = pr.rows[0];
  if (!cand || cand.disabled) return res.status(400).json({ ok: false, reason: "bad_candidate" });

  await q(
    `INSERT INTO best_player_votes(game_id, voter_tg_id, candidate_tg_id)
     VALUES($1,$2,$3)
     ON CONFLICT(game_id, voter_tg_id)
     DO UPDATE SET candidate_tg_id=EXCLUDED.candidate_tg_id, updated_at=NOW()`,
    [game_id, user.id, candidate_tg_id]
  );

  res.json({ ok: true });
});

app.post("/api/admin/games/:id/best-player", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const game_id = Number(req.params.id);
  const best_player_tg_id = req.body?.best_player_tg_id === null ? null : Number(req.body?.best_player_tg_id);

  if (!game_id) return res.status(400).json({ ok: false, reason: "bad_game_id" });

  if (best_player_tg_id !== null) {
    const pr = await q(`SELECT tg_id, disabled FROM players WHERE tg_id=$1`, [best_player_tg_id]);
    const p = pr.rows[0];
    if (!p || p.disabled) return res.status(400).json({ ok: false, reason: "bad_player" });
  }

  const ur = await q(
    `UPDATE games
     SET best_player_tg_id=$2,
         best_player_set_by=$3,
         best_player_set_at=NOW(),
         best_player_source='manual',
         updated_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [game_id, best_player_tg_id, user.id]
  );

  res.json({ ok: true, game: ur.rows[0] });
});


const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Backend listening on", port));
