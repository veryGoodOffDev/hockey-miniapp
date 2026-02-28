import "dotenv/config";
import nodemailer from "nodemailer";
import express from "express";
import cors from "cors";
import multer from "multer";
import { initDb, q } from "./db.js";
import { createBot } from "./bot.js";
import { verifyTelegramWebApp } from "./tgAuth.js";
import { makeTeams } from "./teamMaker.js";
import { ensureSchema } from "./schema.js";
import { InlineKeyboard } from "grammy";
import { performance } from "node:perf_hooks";
import { Resend } from "resend";
import crypto from "crypto";

const app = express();
app.use(express.json());


const LOG_HTTP = process.env.LOG_HTTP === "1";
const TEAM_TZ = process.env.TEAM_TZ || "UTC";
const REMINDER_HOUR = Number(process.env.REMINDER_HOUR ?? 15);
const REMINDER_MINUTE = Number(process.env.REMINDER_MINUTE ?? 0);

const INTERNAL_CRON_TOKEN = process.env.INTERNAL_CRON_TOKEN || "";

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || process.env.SESSION_SECRET || "change_me";
const AUTH_TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS || 1000 * 60 * 60 * 24 * 30);
const EMAIL_CODE_TTL_MS = Number(process.env.EMAIL_CODE_TTL_MS || 1000 * 60 * 10);
const EMAIL_VERIFY_TTL_MS = Number(process.env.EMAIL_VERIFY_TTL_MS || 1000 * 60 * 60 * 24);
const PUBLIC_WEBAPP_URL = (process.env.PUBLIC_WEBAPP_URL || "").replace(/\/+$/, "");
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || "";
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || "";
const MAILGUN_FROM = process.env.MAILGUN_FROM || process.env.MAILGUN_USER || "";


const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "";
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || "";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;


const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE =
  String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || process.env.SMTP_SECURE === "1";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "";

let smtpTransport = null;
function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;
  smtpTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE, // true для 465, false для 587
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return smtpTransport;
}


function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}
function signToken(obj) {
  const payload = b64url(JSON.stringify(obj));
  const sig = b64url(crypto.createHmac("sha256", DOWNLOAD_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}
function verifyToken(tok) {
  if (!tok || typeof tok !== "string") return null;
  const [payload, sig] = tok.split(".");
  if (!payload || !sig) return null;
  const sig2 = b64url(crypto.createHmac("sha256", DOWNLOAD_SECRET).update(payload).digest());

  if (sig !== sig2) return null;
  const obj = JSON.parse(b64urlDecode(payload));
  if (!obj?.exp || Date.now() > obj.exp) return null;
  return obj;
}
function apiBaseFromReq(req) {
  // лучше задать в env PUBLIC_API_BASE="https://api.apihockeyteamru.ru:8443"
  const base = process.env.PUBLIC_API_URL;
  if (base) return base.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken(bytes = 24) {
  return b64url(crypto.randomBytes(bytes));
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// async function sendEmail({ to, subject, html, text }) {
//   if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN || !MAILGUN_FROM) {
//     console.log("[email] Mailgun not configured, skipping send:", { to, subject, text });
//     return;
//   }

//   const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64");
//   const body = new URLSearchParams({
//     from: MAILGUN_FROM,
//     to,
//     subject,
//     text: text || "",
//     html: html || "",
//   });

//   const r = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
//     method: "POST",
//     headers: {
//       Authorization: `Basic ${auth}`,
//       "Content-Type": "application/x-www-form-urlencoded",
//     },
//     body,
//   });

//   if (!r.ok) {
//     const errText = await r.text();
//     console.error("[email] Mailgun failed:", r.status, errText);
//   }
// }
//SMTP nodemailer-----------------------------------------------------------------------------------
// async function sendEmail({ to, subject, html, text }) {
//   // 1) SMTP (твой вариант)
//   if (SMTP_HOST && SMTP_FROM && SMTP_USER && SMTP_PASS) {
//     try {
//       const tr = getSmtpTransport();
//       await tr.sendMail({
//         from: SMTP_FROM,
//         to,
//         subject,
//         text: text || "",
//         html: html || "",
//       });
//       return;
//     } catch (e) {
//       console.error("[email] SMTP failed:", e?.message || e);
//       // не return — попробуем fallback ниже (если вдруг решишь оставить Mailgun)
//     }
//   } else {
//     console.log("[email] SMTP not configured:", {
//       SMTP_HOST: !!SMTP_HOST,
//       SMTP_FROM: !!SMTP_FROM,
//       SMTP_USER: !!SMTP_USER,
//       SMTP_PASS: !!SMTP_PASS,
//     });
//   }

//   // 2) fallback Mailgun (можно оставить, можно удалить)
//   if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN || !MAILGUN_FROM) {
//     console.log("[email] No provider configured, skipping send:", { to, subject });
//     return;
//   }

//   const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64");
//   const body = new URLSearchParams({
//     from: MAILGUN_FROM,
//     to,
//     subject,
//     text: text || "",
//     html: html || "",
//   });

//   const r = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
//     method: "POST",
//     headers: {
//       Authorization: `Basic ${auth}`,
//       "Content-Type": "application/x-www-form-urlencoded",
//     },
//     body,
//   });

//   if (!r.ok) {
//     const errText = await r.text();
//     console.error("[email] Mailgun failed:", r.status, errText);
//   }
// }
//SMTP nodemailer-----------------------------------------------------------------------------------

async function sendEmail({ to, subject, html, text }) {
  if (!resend || !RESEND_FROM) {
    console.log("[email] Resend not configured, skipping send:", {
      to,
      subject,
      hasKey: !!RESEND_API_KEY,
      hasFrom: !!RESEND_FROM,
    });
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: RESEND_FROM,
      to, // string или string[] — оба варианта ок
      subject,
      html: html || undefined,
      text: text || undefined, // можно не передавать: Resend умеет сгенерить text из html
      replyTo: RESEND_REPLY_TO || undefined,
    });

    if (error) {
      console.error("[email] Resend failed:", error);
      return;
    }

    console.log("[email] Resend sent:", data?.id);
  } catch (e) {
    console.error("[email] Resend exception:", e?.message || e);
  }
}



function issueAuthToken(tgId) {
  return signToken({ uid: tgId, exp: Date.now() + AUTH_TOKEN_TTL_MS });
}



if (LOG_HTTP) {
  app.use((req, res, next) => {
    const t0 = performance.now();
    res.on("finish", () => {
      const ms = performance.now() - t0;
      console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });
}

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
    allowedHeaders: ["Content-Type", "x-telegram-init-data", "Authorization"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    optionsSuccessStatus: 204,
  })
);

app.options("*", cors());


app.use(async (req, res, next) => {
  if (req.method === "OPTIONS") return next();

  const authHeader = String(req.header("authorization") || "");
  const initData = req.header("x-telegram-init-data");
  if (!authHeader && !initData) return next();

  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  try {
    await q(`UPDATE players SET last_seen_at=NOW() WHERE tg_id=$1`, [user.id]);
    await q(
      `INSERT INTO app_daily_visits(visit_date, tg_id, source)
       VALUES((NOW() AT TIME ZONE 'Europe/Moscow')::date, $1, 'webapp')
       ON CONFLICT (visit_date, tg_id)
       DO UPDATE SET last_seen_at=NOW()`,
      [user.id]
    );
  } catch (e) {
    console.error("[last_seen] touch failed:", e?.message || e);
  }

  req.webappUser = user;
  return next();
});
// init + schema
await initDb();
await ensureSchema(q);

// Telegram bot (polling)
const bot = createBot();
await bot.init();

// чтобы ошибки бота были видны в systemd логах
bot.catch((err) => console.error("[bot] error:", err));

// чтобы можно было отправлять PM из API-роутов (admin/pm)
app.locals.bot = bot;

const isSmoke = process.env.SMOKE === "1";
if (!isSmoke) {
  bot.start({ drop_pending_updates: true }).catch((e) => {
    console.error("[bot] start failed:", e);
  });
  console.log("[bot] polling started");
} else {
  console.log("[bot] polling disabled (SMOKE=1)");
}

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

const postgameSyncTimers = new Map();

function schedulePostgameCounterSync(gameId) {
  const id = Number(gameId);
  if (!Number.isFinite(id)) return;

  if (postgameSyncTimers.has(id)) return;

  const t = setTimeout(async () => {
    postgameSyncTimers.delete(id);
    try {
      await syncPostgameCounter(id);
    } catch (e) {
      console.error("syncPostgameCounter failed:", e);
    }
  }, 600);

  postgameSyncTimers.set(id, t);
}

const syncTimers = new Map();

function scheduleDiscussSync(gameId) {
  const id = Number(gameId);
  if (!Number.isFinite(id)) return;

  if (syncTimers.has(id)) return;

  const t = setTimeout(async () => {
    syncTimers.delete(id);
    try {
      await syncDiscussCountersForGame(id);
    } catch (e) {
      console.log("[sync] failed", e?.message || e);
    }
  }, 1200);

  syncTimers.set(id, t);
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
  const authHeader = String(req.header("authorization") || "");
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (!payload?.uid) {
      res.status(401).json({ ok: false, reason: "invalid_token" });
      return null;
    }
    return { id: payload.uid, is_email_auth: true };
  }

  const initData = req.header("x-telegram-init-data");
  const v = verifyTelegramWebApp(initData, process.env.BOT_TOKEN);
  if (!v.ok) {
    res.status(401).json({ ok: false, reason: v.reason });
    return null;
  }
  return v.user;
}

async function requireGroupMember(req, res, user) {
  if (user?.is_email_auth) {
    const pr = await q(`SELECT tg_id, disabled FROM players WHERE tg_id=$1`, [user.id]);
    const row = pr.rows?.[0];
    if (!row) {
      res.status(403).json({ ok: false, reason: "player_deleted" });
      return false;
    }
    if (row.disabled) {
      res.status(403).json({ ok: false, reason: "profile_only" });
      return false;
    }
    return true;
  }
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


const AUTO_SCHEDULE_TZ = process.env.TZ_NAME || "Europe/Moscow";

function getZonedDateParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const get = (t) => Number(parts.find((x) => x.type === t)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function getTimeZoneOffsetMinutes(date, timeZone) {
  const p = getZonedDateParts(date, timeZone);
  const asUtcTs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtcTs - date.getTime()) / 60000;
}

function zonedTimeToUtc({ year, month, day, hour, minute, second = 0 }, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset * 60_000);
}

function getWeekdayInZone(date, timeZone) {
  const raw = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[raw] ?? 0;
}
const AUTO_SCHEDULE_DEFAULTS = {
  enabled: false,
  target_count: 12,
  weekday: 0, // 0=Sun..6=Sat
  time: "07:45",
  location: "",
  geo_lat: null,
  geo_lon: null,
};

async function getAutoScheduleConfig() {
  const raw = await getSetting("auto_schedule_config", "");
  if (!raw) return { ...AUTO_SCHEDULE_DEFAULTS };
  try {
    const parsed = JSON.parse(raw);
    return {
      ...AUTO_SCHEDULE_DEFAULTS,
      ...parsed,
      target_count: Math.max(1, Math.min(60, Number(parsed?.target_count ?? AUTO_SCHEDULE_DEFAULTS.target_count))),
      weekday: Math.max(0, Math.min(6, Number(parsed?.weekday ?? AUTO_SCHEDULE_DEFAULTS.weekday))),
      time: /^\d{2}:\d{2}$/.test(String(parsed?.time || "")) ? String(parsed.time) : AUTO_SCHEDULE_DEFAULTS.time,
      location: String(parsed?.location || "").trim(),
      geo_lat: parsed?.geo_lat === null || parsed?.geo_lat === "" ? null : Number(parsed?.geo_lat),
      geo_lon: parsed?.geo_lon === null || parsed?.geo_lon === "" ? null : Number(parsed?.geo_lon),
      enabled: !!parsed?.enabled,
    };
  } catch {
    return { ...AUTO_SCHEDULE_DEFAULTS };
  }
}

function nextTemplateDate(fromDate, weekday, hh, mm, timeZone = AUTO_SCHEDULE_TZ) {
  const local = getZonedDateParts(fromDate, timeZone);
  const fromWeekday = getWeekdayInZone(fromDate, timeZone);

  let dayShift = (weekday - fromWeekday + 7) % 7;

  let y = local.year;
  let m = local.month;
  let d = local.day;

  const addDays = (days) => {
    const tmp = new Date(Date.UTC(y, m - 1, d + days));
    y = tmp.getUTCFullYear();
    m = tmp.getUTCMonth() + 1;
    d = tmp.getUTCDate();
  };

  if (dayShift > 0) addDays(dayShift);

  let candidate = zonedTimeToUtc({ year: y, month: m, day: d, hour: hh, minute: mm, second: 0 }, timeZone);

  if (candidate <= fromDate) {
    addDays(7);
    candidate = zonedTimeToUtc({ year: y, month: m, day: d, hour: hh, minute: mm, second: 0 }, timeZone);
  }

  return candidate;
}

async function ensureAutoScheduledGames({ dryRun = false, ignoreEnabled = false } = {}) {
  const cfg = await getAutoScheduleConfig();
  const targetCount = Math.max(1, Math.min(60, Number(cfg.target_count || 12)));
  const upcoming = await q(
    `SELECT id, starts_at
       FROM games
      WHERE status='scheduled' AND starts_at >= NOW()
      ORDER BY starts_at ASC`
  );

  const upcomingCount = upcoming.rows.length;
  const result = { ok: true, enabled: !!cfg.enabled, target_count: targetCount, upcoming: upcomingCount, created: 0, created_games: [] };
  if (!ignoreEnabled && !cfg.enabled) return { ...result, skipped: "disabled", cfg };
  if (upcomingCount >= targetCount) return { ...result, skipped: "enough_games", cfg };

  const time = String(cfg.time || "07:45");
  const [hh, mm] = time.split(":").map((x) => Number(x));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return { ...result, ok: false, reason: "bad_time", cfg };
  }

  const lat = cfg.geo_lat === null ? null : Number(cfg.geo_lat);
  const lon = cfg.geo_lon === null ? null : Number(cfg.geo_lon);
  if ((lat === null) !== (lon === null)) return { ...result, ok: false, reason: "bad_geo_pair", cfg };
  if ((lat !== null && !Number.isFinite(lat)) || (lon !== null && !Number.isFinite(lon))) {
    return { ...result, ok: false, reason: "bad_geo", cfg };
  }

  const need = targetCount - upcomingCount;
  const existingStarts = new Set(upcoming.rows.map((g) => new Date(g.starts_at).toISOString()));
  let cursor = upcoming.rows.length
    ? new Date(upcoming.rows[upcoming.rows.length - 1].starts_at)
    : new Date();

  for (let i = 0; i < need; i++) {
    let candidate = nextTemplateDate(cursor, Number(cfg.weekday || 0), hh, mm, AUTO_SCHEDULE_TZ);
    let guard = 0;
    while (existingStarts.has(candidate.toISOString()) && guard < 120) {
      candidate = new Date(candidate.getTime() + 7 * 24 * 60 * 60 * 1000);
      guard++;
    }
    if (guard >= 120) break;

    cursor = candidate;
    existingStarts.add(candidate.toISOString());

    if (dryRun) {
      result.created += 1;
      result.created_games.push({ starts_at: candidate.toISOString(), location: String(cfg.location || "").trim(), geo_lat: lat, geo_lon: lon });
      continue;
    }

    const ins = await q(
      `INSERT INTO games(starts_at, location, status, geo_lat, geo_lon)
       VALUES($1,$2,'scheduled',$3,$4)
       RETURNING id, starts_at, location, geo_lat, geo_lon, status`,
      [candidate.toISOString(), String(cfg.location || "").trim(), lat, lon]
    );
    result.created += 1;
    result.created_games.push(ins.rows[0]);
  }

  return { ...result, cfg };
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

  // диагностика: r обязан быть объектом, r.rows — массив
  if (!r || !Array.isArray(r.rows)) {
    console.log("[getSetting] BAD RESULT", {
      key,
      type: typeof r,
      r,
    });
    return def;
  }

  return r.rows[0]?.value ?? def;
}


function makeToken() {
  // 32 байта => длинный безопасный токен
  return crypto.randomBytes(32).toString("base64url");
}

function publicBaseUrl() {

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

function isLocalRequest(req) {
  const ra = req.socket?.remoteAddress || "";
  return ra === "127.0.0.1" || ra === "::1" || ra.endsWith("127.0.0.1");
}

function fmtDtRu(dt) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: TEAM_TZ,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dt));
  } catch {
    return new Date(dt).toISOString();
  }
}

function requireOwner(req, res, user) {
  const owner = String(process.env.OWNER_TG_ID || "");
  if (!owner || String(user.id) !== owner) {
    res.status(403).json({ ok: false, reason: "not_owner" });
    return false;
  }
  return true;
}


async function computeDefaultRemindAt(starts_at) {
  // Пн 15:00 недели игры (для воскресенья — это понедельник ДО воскресенья)
  const r = await q(
    `
    SELECT (
      (date_trunc('week', $1::timestamptz AT TIME ZONE $2)
        + ($3::int || ' hours')::interval
        + ($4::int || ' minutes')::interval
      ) AT TIME ZONE $2
    ) AS remind_at
    `,
    [starts_at, TEAM_TZ, REMINDER_HOUR, REMINDER_MINUTE]
  );
  return r.rows?.[0]?.remind_at ?? null;
}

function buildReminderText(g) {
  const when = fmtDtRu(g.starts_at);
  let text = `🏒 Ближайшая игра: ${when}\n📍 ${g.location || "—"}`;

  if (process.env.WEB_APP_URL) {
    text += `\n\nОтметься в мини-приложении: ${process.env.WEB_APP_URL}`;
  }

  if (g.geo_lat && g.geo_lon) {
    text += `\n🗺️ Яндекс.Карты: https://yandex.ru/maps/?pt=${g.geo_lon},${g.geo_lat}&z=16&l=map`;
  }

  if (g.notice_text) text += `\n\n⚠️ ${String(g.notice_text).slice(0, 800)}`;
  if (g.info_text) text += `\n\nℹ️ ${String(g.info_text).slice(0, 2000)}`;

  return text;
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

// ===== Postgame discuss message helpers =====

function postgameStartParam(gameId) {
  // важно: фронт должен уметь распарсить и открыть comments
  return `game_${gameId}_comments`;
}

function buildDiscussDeepLink(gameId) {
  const botUsername = process.env.BOT_USERNAME || "HockeyLineupBot";
  return `https://t.me/${botUsername}?startapp=${encodeURIComponent(postgameStartParam(gameId))}`;
}

function buildDiscussKb(gameId, count) {
  const label = count > 0 ? `💬 Обсудить (${count})` : "💬 Обсудить";
  return new InlineKeyboard().url(label, buildDiscussDeepLink(gameId));
}

// function buildVideoKb(gameId, count, videoUrl) {
//   const kb = new InlineKeyboard().url("▶️ Смотреть видео", videoUrl);

//   // второй ряд — кнопка обсудить (счётчик)
//   const discussKb = buildDiscussKb(gameId, count);

//   // InlineKeyboard нельзя "вставить" как есть, поэтому повторяем url:
//   const label = count > 0 ? `💬 Обсудить (${count})` : "💬 Обсудить";
//   kb.row().url(label, buildDiscussDeepLink(gameId));

//   return kb;
// }

function buildVideoKb(gameId, count, videoUrl) {
  const label = count > 0 ? `💬 Обсудить (${count})` : "💬 Обсудить";
  const kb = new InlineKeyboard();

  // 1) Кнопка "скопировать" (если поддерживается)
  if (typeof kb.copyText === "function") {
    kb.copyText("📋 Скопировать ссылку", videoUrl).row();
  }

  // 2) Кнопка "смотреть"
  kb.url("▶️ Смотреть видео", videoUrl);

  // 3) Кнопка "обсудить" со счётчиком
  kb.url(label, buildDiscussDeepLink(gameId));

  return kb;
}


function buildPostgameText(g) {
  const when = formatWhenForGame(g.starts_at);
  return (
    `🏒 Игра прошла!\n\n` +
    `📅 ${when}\n` +
    `📍 ${g.location || "—"}\n\n` +
    `Можешь обсудить тактику, похвалить игроков или отметить важные моменты.`
  );
}

async function getGameCommentsCount(gameId) {
  const r = await q(`SELECT COUNT(*)::int AS cnt FROM game_comments WHERE game_id=$1`, [gameId]);
  return r.rows?.[0]?.cnt ?? 0;
}


async function sendPostgameMessageForGame(g, chat_id) {
  const cnt = await getGameCommentsCount(g.id);
  const text = buildPostgameText(g);
  const kb = buildDiscussKb(g.id, cnt);

  let sent;
  try {
    sent = await bot.api.sendMessage(chat_id, text, {
      reply_markup: kb,
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.log("[postgame] send failed:", tgErrText(e));
    return { ok: false, reason: "send_failed" };
  }

  // логируем как bot_message (как у reminder)
  try {
    await logBotMessage({
      chat_id,
      message_id: sent.message_id,
      kind: "postgame",
      text,
      reply_markup: replyMarkupToJson(kb),
      meta: { game_id: g.id, type: "postgame_discuss" },
    });
  } catch {}

  // сохраняем привязку для дальнейших обновлений счетчика
  await q(
    `UPDATE games
     SET postgame_sent_at=NOW(),
         postgame_message_id=$2,
         postgame_chat_id=$3,
         postgame_last_count=$4,
         updated_at=NOW()
     WHERE id=$1`,
    [g.id, sent.message_id, chat_id, cnt]
  );

  return { ok: true, message_id: sent.message_id, count: cnt };
}

async function syncDiscussCountersForGame(gameId) {
  const count = await getGameCommentsCount(gameId);

  // 1) обновляем postgame-сообщения
  const postRows = await q(
    `SELECT chat_id, message_id
     FROM bot_messages
     WHERE kind='postgame'
       AND (meta->>'game_id')::int = $1
     ORDER BY created_at DESC`,
    [gameId]
  );

  for (const r of postRows.rows || []) {
    const chatId = Number(r.chat_id);
    const msgId = Number(r.message_id);
    if (!Number.isFinite(chatId) || !Number.isFinite(msgId)) continue;

    const kb = buildDiscussKb(gameId, count);

    try {
      await bot.api.editMessageReplyMarkup(chatId, msgId, { reply_markup: kb });
    } catch (e) {
      // можно логнуть и продолжить
      console.log("[sync postgame] edit failed", e?.description || e?.message || e);
    }
  }

  // 2) обновляем video-сообщения
  const videoRows = await q(
    `SELECT chat_id, message_id, meta
     FROM bot_messages
     WHERE kind='video'
       AND (meta->>'game_id')::int = $1
     ORDER BY created_at DESC`,
    [gameId]
  );

  for (const r of videoRows.rows || []) {
    const chatId = Number(r.chat_id);
    const msgId = Number(r.message_id);
    const meta = r.meta || {};
    const videoUrl = String(meta.video_url || "").trim();

    if (!Number.isFinite(chatId) || !Number.isFinite(msgId) || !videoUrl) continue;

    const kb = buildVideoKb(gameId, count, videoUrl);

    try {
      await bot.api.editMessageReplyMarkup(chatId, msgId, { reply_markup: kb });
    } catch (e) {
      console.log("[sync video] edit failed", e?.description || e?.message || e);
    }
  }

  return { ok: true, count };
}


async function syncPostgameCounter(gameId) {
  const gr = await q(
    `SELECT id, postgame_message_id, postgame_chat_id, postgame_last_count
     FROM games
     WHERE id=$1`,
    [gameId]
  );
  const g = gr.rows?.[0];
  if (!g?.postgame_message_id) return { ok: true, skipped: true, reason: "no_postgame_message" };

  const chat_id = Number(g.postgame_chat_id);
  if (!Number.isFinite(chat_id)) return { ok: false, reason: "bad_chat_id" };

  const cnt = await getGameCommentsCount(gameId);

  // чтобы не долбить Telegram лишний раз
  if (g.postgame_last_count !== null && Number(g.postgame_last_count) === cnt) {
    return { ok: true, skipped: true, reason: "count_same" };
  }

  const kb = buildDiscussKb(gameId, cnt);

  try {
    await bot.api.editMessageReplyMarkup(chat_id, Number(g.postgame_message_id), {
      reply_markup: kb,
    });
  } catch (e) {
    if (tgMessageMissing(e)) {
      // сообщение удалили/недоступно — очищаем привязку, чтобы не пытаться снова
      await q(
        `UPDATE games
         SET postgame_message_id=NULL,
             postgame_chat_id=NULL,
             updated_at=NOW()
         WHERE id=$1`,
        [gameId]
      );
      return { ok: false, reason: "message_missing" };
    }
    console.log("[postgame] edit failed:", tgErrText(e));
    return { ok: false, reason: "edit_failed" };
  }

  await q(`UPDATE games SET postgame_last_count=$2, updated_at=NOW() WHERE id=$1`, [gameId, cnt]);
  return { ok: true, count: cnt };
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

function calcTeamPlayerRating(p) {
  const skill = Number(p?.skill ?? 5);
  const skating = Number(p?.skating ?? 5);
  const iq = Number(p?.iq ?? 5);
  const stamina = Number(p?.stamina ?? 5);
  const passing = Number(p?.passing ?? 5);
  const shooting = Number(p?.shooting ?? 5);
  return 0.35 * skill + 0.15 * skating + 0.15 * iq + 0.1 * stamina + 0.125 * passing + 0.125 * shooting;
}

function buildTeamsMeta(teamA, teamB) {
  const posA = { G: 0, D: 0, F: 0, U: 0 };
  const posB = { G: 0, D: 0, F: 0, U: 0 };

  const sumA = (teamA || []).reduce((acc, p) => {
    const pos = String(p?.position || "F").toUpperCase();
    if (posA[pos] === undefined) posA.U += 1;
    else posA[pos] += 1;
    return acc + Number(p?.rating ?? calcTeamPlayerRating(p));
  }, 0);

  const sumB = (teamB || []).reduce((acc, p) => {
    const pos = String(p?.position || "F").toUpperCase();
    if (posB[pos] === undefined) posB.U += 1;
    else posB[pos] += 1;
    return acc + Number(p?.rating ?? calcTeamPlayerRating(p));
  }, 0);

  return {
    sumA,
    sumB,
    diff: Math.abs(sumA - sumB),
    count: (teamA?.length || 0) + (teamB?.length || 0),
    countA: teamA?.length || 0,
    countB: teamB?.length || 0,
    posA,
    posB,
  };
}

async function syncTeamsAfterRsvpChange(gid, tgId) {
  if (!Number.isFinite(Number(gid)) || !Number.isFinite(Number(tgId))) return;

  const tr = await q(`SELECT team_a, team_b FROM teams WHERE game_id=$1`, [gid]);
  const row = tr.rows?.[0];
  if (!row) return;

  let teamA = Array.isArray(row.team_a) ? [...row.team_a] : [];
  let teamB = Array.isArray(row.team_b) ? [...row.team_b] : [];

  const id = String(tgId);
  const inA = teamA.some((p) => String(p?.tg_id ?? p) === id);
  const inB = teamB.some((p) => String(p?.tg_id ?? p) === id);

  teamA = teamA.filter((p) => String(p?.tg_id ?? p) !== id);
  teamB = teamB.filter((p) => String(p?.tg_id ?? p) !== id);

  const pr = await q(
    `SELECT
      p.*,
      COALESCE(r.pos_override, p.position) AS position
     FROM rsvps r
     JOIN players p ON p.tg_id = r.tg_id
     WHERE r.game_id=$1 AND r.tg_id=$2 AND r.status='yes' AND p.disabled=FALSE`,
    [gid, tgId]
  );

  const player = pr.rows?.[0] || null;
  let changed = inA || inB;

  if (player) {
    const hydrated = {
      ...player,
      rating: calcTeamPlayerRating(player),
      position: normalizePos(player.position),
    };

    if (inA) {
      teamA.push(hydrated);
    } else if (inB) {
      teamB.push(hydrated);
    } else {
      const sumA = teamA.reduce((acc, p) => acc + Number(p?.rating ?? calcTeamPlayerRating(p)), 0);
      const sumB = teamB.reduce((acc, p) => acc + Number(p?.rating ?? calcTeamPlayerRating(p)), 0);

      if (teamA.length < teamB.length) teamA.push(hydrated);
      else if (teamB.length < teamA.length) teamB.push(hydrated);
      else if (sumA <= sumB) teamA.push(hydrated);
      else teamB.push(hydrated);

      changed = true;
    }
  }

  if (!changed) return;

  const meta = buildTeamsMeta(teamA, teamB);
  await q(
    `UPDATE teams
     SET team_a=$2, team_b=$3, meta=$4, generated_at=NOW()
     WHERE game_id=$1`,
    [gid, JSON.stringify(teamA), JSON.stringify(teamB), JSON.stringify(meta)]
  );

  // best-effort: если составы уже были отправлены в чат — обновляем опубликованное сообщение
  try {
    await syncPostedTeamsMessageIfAny(gid);
  } catch (e) {
    console.error("syncPostedTeamsMessageIfAny failed:", e?.description || e?.message || e);
  }
}

async function syncPostedTeamsMessageIfAny(game_id) {
  const gid = Number(game_id);
  if (!Number.isFinite(gid) || gid <= 0) return;

  const chatIdRaw = await getSetting("notify_chat_id", null);
  const chatId = chatIdRaw ? Number(String(chatIdRaw).trim()) : null;
  if (!Number.isFinite(chatId)) return;

  const prevTeamsMsgR = await q(
    `SELECT id, chat_id, message_id
     FROM bot_messages
     WHERE kind='teams'
       AND deleted_at IS NULL
       AND chat_id=$1
       AND COALESCE(meta->>'game_id', '') = $2
     ORDER BY id DESC
     LIMIT 1`,
    [chatId, String(gid)]
  );
  const prevTeamsMsg = prevTeamsMsgR.rows?.[0] || null;
  if (!prevTeamsMsg) return; // если составы не публиковались — ничего не делаем

  const gr = await q(
    `SELECT
      g.id, g.starts_at, g.location, g.status,
      t.team_a, t.team_b
     FROM games g
     LEFT JOIN teams t ON t.game_id = g.id
     WHERE g.id=$1`,
    [gid]
  );
  const row = gr.rows?.[0];
  if (!row || row.status === "cancelled") return;

  const teamAIds = parseTeamIds(row.team_a);
  const teamBIds = parseTeamIds(row.team_b);
  if (!teamAIds.length && !teamBIds.length) return;

  const allIds = Array.from(new Set([...teamAIds, ...teamBIds]));
  const pr = await q(
    `SELECT
       p.tg_id, p.display_name, p.first_name, p.username, p.jersey_number,
       COALESCE(r.pos_override, p.position) AS position
     FROM players p
     LEFT JOIN rsvps r
       ON r.game_id=$2 AND r.tg_id=p.tg_id AND r.status='yes'
     WHERE p.tg_id = ANY($1::bigint[])`,
    [allIds, gid]
  );
  const map = new Map(pr.rows.map((p) => [String(p.tg_id), p]));

  const teamAPlayers = teamAIds.map((id) => map.get(String(id)) || { tg_id: id, display_name: String(id), position: "F" });
  const teamBPlayers = teamBIds.map((id) => map.get(String(id)) || { tg_id: id, display_name: String(id), position: "F" });

  const when = formatGameWhen(row.starts_at);
  const header =
    `<b>🏒 Составы на игру</b>\n` +
    `⏱ <code>${escapeHtml(when)}</code>\n` +
    `📍 <b>${escapeHtml(row.location || "—")}</b>` +
    `\n\n<b>⚠️ После первого формирования составы были изменены, будь внимателен.</b>`;

  const table = renderTeamsTwoColsHtml(teamAPlayers, teamBPlayers);
  const body = `${header}\n\n${table}`;

  const botUsername = String(process.env.BOT_USERNAME || "").trim();
  const deepLinkTeams = botUsername
    ? `https://t.me/${botUsername}?startapp=${encodeURIComponent(`teams_${gid}`)}`
    : null;

  const kb = new InlineKeyboard();
  if (deepLinkTeams) kb.url("📋 Открыть составы", deepLinkTeams);

  try {
    await bot.api.editMessageText(Number(prevTeamsMsg.chat_id), Number(prevTeamsMsg.message_id), body, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: kb,
    });

    await q(
      `UPDATE bot_messages
       SET text=$2,
           parse_mode='HTML',
           disable_web_page_preview=TRUE,
           reply_markup=$3::jsonb,
           meta=$4::jsonb,
           checked_at=NOW()
       WHERE id=$1`,
      [
        prevTeamsMsg.id,
        body,
        JSON.stringify(replyMarkupToJson(kb)),
        JSON.stringify({ game_id: gid, auto_updated: true }),
      ]
    );
  } catch (e) {
    if (tgMessageMissing(e)) {
      await q(
        `UPDATE bot_messages
         SET deleted_at=NOW(), delete_reason='missing_in_chat', checked_at=NOW()
         WHERE id=$1`,
        [prevTeamsMsg.id]
      );
      return;
    }
    if (tgMessageExistsButNotEditable(e)) return;
    throw e;
  }
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
  if (user?.is_email_auth) {
    const ex = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);
    if (ex.rows?.[0]) {
      const touch = await q(
        `UPDATE players
         SET last_seen_at = NOW()
         WHERE tg_id=$1
         RETURNING *`,
        [user.id]
      );
      return touch.rows?.[0] || ex.rows[0];
    }

    const ins = await q(
      `INSERT INTO players(tg_id, display_name, player_kind, is_guest, last_seen_at)
       VALUES($1,$2,'web',FALSE,NOW())
       RETURNING *`,
      [user.id, null]
    );
    return ins.rows[0];
  }

  const r = await q(
    `INSERT INTO players(tg_id, first_name, last_name, username, is_admin, player_kind, is_guest, last_seen_at)
     VALUES($1,$2,$3,$4, FALSE, 'tg', FALSE, NOW())
     ON CONFLICT(tg_id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name  = EXCLUDED.last_name,
       username   = EXCLUDED.username,
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [
      user.id,
      (user.first_name || "").slice(0, 80),
      (user.last_name || "").slice(0, 80),
      (user.username || "").slice(0, 80),
    ]
  );

  return r.rows[0];
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

const settingsCache = new Map();
const SETTINGS_TTL_MS = 60_000;

async function getSettingCached(key) {
  const now = Date.now();
  const hit = settingsCache.get(key);
  if (hit && now - hit.at < SETTINGS_TTL_MS) return hit.value;

  const r = await q(`SELECT value FROM settings WHERE key=$1`, [key]);
  const value = r.rows[0]?.value ?? null;

  settingsCache.set(key, { value, at: now });
  return value;
}

function checkInternalToken(req) {
  const need =
    process.env.INTERNAL_CRON_TOKEN ||
    process.env.INTERNAL_REMINDERS_TOKEN ||
    "";

  if (!need) return false;

  const cron = String(req.headers["x-cron-token"] || "");
  if (cron) return cron === need;

  const xin = String(req.headers["x-internal-token"] || "");
  if (xin) return xin === need;

  const h = String(req.headers["authorization"] || "");
  if (h.startsWith("Bearer ")) return h.slice(7).trim() === need;

  const qtok = String(req.query?.token || "");
  if (qtok) return qtok === need;

  return false;
}

function formatWhenForGame(starts_at) {
  const tz = process.env.TZ_NAME || "Europe/Moscow";
  if (!starts_at) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(starts_at));
}

function fmtGameLine(g) {
  const when = g?.starts_at
    ? new Date(g.starts_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    : "—";
  const loc = g?.location || "—";
  return `🏒 Игра: ${when}\n📍 ${loc}`;
}


const ALLOWED_REACTIONS = new Set(["❤️","🔥","👍","😂","👏","😡","🤔"]);

function commentExcerpt(body, maxLen = 90) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

async function sendBotPmSafe({ toTgId, text, meta = null, sentByTgId = null, reply_markup = null }) {
  try {
    const to = Number(toTgId);
    if (!Number.isFinite(to) || to <= 0) return { ok: false, reason: "bad_tg_id" };

    if (!bot) return { ok: false, reason: "bot_not_ready" };
    const sent = await bot.api.sendMessage(to, String(text || ""), { disable_web_page_preview: true, reply_markup, });

    await q(
      `INSERT INTO bot_messages(chat_id, message_id, kind, text, sent_by_tg_id, meta)
       VALUES($1,$2,'pm',$3,$4,$5)`,
      [to, sent.message_id, String(text || ""), sentByTgId ? Number(sentByTgId) : null, JSON.stringify(meta || { type: "pm" })]
    ).catch(() => {});

    return { ok: true };
  } catch (e) {
    console.error("sendBotPmSafe failed:", { toTgId, err: tgErrText(e) });
    return { ok: false, reason: "tg_send_failed" };
  }
}

async function notifyCommentCreated({
  gameId,
  commentId,
  text,
  authorTgId,
  mentionIds,
  replyToComment,
}) {
  const link = buildDiscussDeepLink(gameId, commentId);
  const preview = commentExcerpt(text, 120);

  const recipients = new Map();

  // mentions
  for (const toId of (mentionIds || [])) {
    if (String(toId) === String(authorTgId)) continue; // self-skip
    recipients.set(String(toId), {
      toTgId: toId,
      meta: { type: "comment_mention", game_id: gameId, comment_id: commentId },
    });
  }

  // reply
  if (
    replyToComment?.author_tg_id &&
    String(replyToComment.author_tg_id) !== String(authorTgId)
  ) {
    recipients.set(String(replyToComment.author_tg_id), {
      toTgId: replyToComment.author_tg_id,
      meta: {
        type: "comment_reply",
        game_id: gameId,
        comment_id: commentId,
        reply_to_comment_id: replyToComment.id,
      },
    });
  }

  const kb = new InlineKeyboard().url("💬 Открыть комментарий", link);

  for (const row of recipients.values()) {
    const isReply = row?.meta?.type === "comment_reply";

    const msg =
      (isReply
        ? "Вам ответили на комментарий к игре."
        : "Вас упомянули в комментарии к игре.") +
      `\n\n💬 ${preview}\n\nНажмите кнопку ниже 👇`;

    await sendBotPmSafe({
      toTgId: row.toTgId,
      text: msg,
      meta: row.meta,
      reply_markup: kb,
    });
  }
}

async function loadGameComments(gameId, viewerTgId, baseUrl) {
  const r = await q(
    `
    SELECT
      c.id,
      c.game_id,
      c.author_tg_id,
      c.reply_to_comment_id,
      c.body,
      c.created_at,
      c.updated_at,

      p.tg_id           AS p_tg_id,
      p.display_name    AS p_display_name,
      p.first_name      AS p_first_name,
      p.username        AS p_username,
      p.photo_url       AS p_photo_url,
      p.avatar_file_id  AS p_avatar_file_id,
      p.updated_at      AS p_updated_at,

      rp.id             AS reply_id,
      rp.body           AS reply_body,
      rp.author_tg_id   AS reply_author_tg_id,
      rpp.display_name  AS reply_author_display_name,
      rpp.first_name    AS reply_author_first_name,
      rpp.username      AS reply_author_username,

      (g.pinned_comment_id = c.id) AS is_pinned,

      COALESCE(rx.reactions, '[]'::jsonb) AS reactions

    FROM game_comments c
    JOIN games g ON g.id = c.game_id
    LEFT JOIN players p ON p.tg_id = c.author_tg_id
    LEFT JOIN game_comments rp ON rp.id = c.reply_to_comment_id
    LEFT JOIN players rpp ON rpp.tg_id = rp.author_tg_id

    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'emoji', t.reaction,
          'count', t.cnt,
          'my',    t.my
        )
        ORDER BY t.reaction
      ) AS reactions
      FROM (
        SELECT
          r.reaction,
          COUNT(*)::int AS cnt,
          BOOL_OR(r.user_tg_id = $2) AS my
        FROM game_comment_reactions r
        WHERE r.comment_id = c.id
        GROUP BY r.reaction
      ) t
    ) rx ON TRUE

    WHERE c.game_id = $1
    ORDER BY (g.pinned_comment_id = c.id) DESC, c.created_at DESC
    `,
    [gameId, viewerTgId]
  );

  return (r.rows || []).map((row) => {
    const rawPlayer = {
      tg_id: row.p_tg_id ?? row.author_tg_id,
      display_name: row.p_display_name || "",
      first_name: row.p_first_name || "",
      username: row.p_username || "",
      photo_url: row.p_photo_url || "",
      avatar_file_id: row.p_avatar_file_id || null,
      updated_at: row.p_updated_at || null,
    };

    const replyAuthorName =
      row.reply_author_display_name ||
      row.reply_author_first_name ||
      (row.reply_author_username ? `@${row.reply_author_username}` : String(row.reply_author_tg_id || ""));

    const author = presentPlayer(rawPlayer, baseUrl);

    return {
      id: row.id,
      game_id: row.game_id,
      author_tg_id: row.author_tg_id,
      reply_to_comment_id: row.reply_to_comment_id,
      body: row.body,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_pinned: !!row.is_pinned,
      reply_to_preview: row.reply_id
        ? {
            author_name: replyAuthorName,
            excerpt: commentExcerpt(row.reply_body, 90),
          }
        : null,
      author,
      reactions: row.reactions || [],
    };
  });
}


function buildOtpEmailHtml({
  brand = "Mighty Sheep",
  code,
  ttlMinutes = 10,
  preheader = "",
  logoUrl = "",
  ctaUrl = "",
  bgImageUrl = "",
}) {
  const esc = (s) =>
    String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));

  const toRgba = (hex, a) => {
    const h = String(hex).replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  // Brand palette (под лого)
  const C = {
    bg: "#070B14",
    card: "#0E1630",
    border: "rgba(255,255,255,.12)",
    text: "#F4F7FF",
    muted: "rgba(244,247,255,.78)",
    blue: "#123BFF",
    orange: "#FF8A00",
    yellow: "#FFD34D",
  };

  const c = String(code || "").trim();
  const pre = esc(preheader || `Ваш код: ${c}. Действует ${ttlMinutes} минут.`);

  // Header bg: либо картинка, либо бренд-градиент
  const headerBg = bgImageUrl
    ? `background-image:url('${esc(bgImageUrl)}');background-size:cover;background-position:center;`
    : `background:${C.card};background-image:linear-gradient(135deg, ${toRgba(C.blue, 0.55)} 0%, ${toRgba(C.orange, 0.38)} 55%, ${toRgba(C.yellow, 0.14)} 100%);`;

  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" width="36" height="36" alt="${esc(brand)}"
            style="display:block;border-radius:10px;object-fit:cover;border:1px solid rgba(255,255,255,.16);" />`
    : "";

  const ctaHtml = ctaUrl
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
        <tr>
          <td bgcolor="${C.orange}" style="border-radius:12px;">
            <a href="${esc(ctaUrl)}"
               style="display:inline-block;padding:12px 16px;font-family:Arial,Helvetica,sans-serif;
                      font-size:14px;font-weight:800;color:#111318;text-decoration:none;border-radius:12px;">
              Открыть страницу входа
            </a>
          </td>
        </tr>
      </table>
    `
    : "";

  return `
  <!-- Preheader -->
  <div style="display:none;font-size:1px;color:${C.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${pre}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <div style="background:${C.bg};padding:26px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%"
           style="max-width:560px;margin:0 auto;table-layout:fixed;">
      <tr>
        <td style="padding:0 16px;">

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="background:${C.card};border:1px solid ${C.border};border-radius:18px;overflow:hidden;">
            <!-- Header -->
            <tr>
              <td style="padding:14px 16px;${headerBg}">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td width="44" valign="middle">
                      ${logoHtml}
                    </td>
                    <td valign="middle" style="padding-left:10px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.14em;
                                  text-transform:uppercase;color:${C.text};opacity:.92;">
                        ${esc(brand)}
                      </div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${C.text};opacity:.75;margin-top:2px;">
                        Код входа • действует ${esc(ttlMinutes)} минут
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Brand stripe -->
            <tr>
              <td style="height:6px;background:linear-gradient(90deg, ${C.blue} 0%, ${C.orange} 50%, ${C.blue} 100%);"></td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:18px 18px 16px 18px;font-family:Arial,Helvetica,sans-serif;color:${C.text};">
                <div style="font-size:20px;font-weight:900;margin:0 0 10px;">
                  Ваш код входа
                </div>

                <div style="font-size:14px;line-height:1.5;opacity:.9;margin:0 0 14px;color:${C.muted};">
                  Введите этот код в приложении, чтобы войти.
                </div>

                <!-- Code block -->
                <div style="background:${toRgba(C.blue, 0.10)};border:1px solid ${toRgba(C.orange, 0.35)};
                            border-radius:14px;padding:14px 14px;text-align:center;">
                  <div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
                              font-size:36px;font-weight:900;letter-spacing:.16em;color:${C.text};">
                    ${esc(c)}
                  </div>
                </div>

                ${ctaHtml}

                <div style="font-size:12px;line-height:1.5;opacity:.68;margin-top:14px;color:${C.muted};">
                  Никому не сообщайте этот код. Если вы не запрашивали код — просто проигнорируйте письмо.
                </div>
              </td>
            </tr>
          </table>

          <!-- footer hint -->
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;opacity:.58;color:${C.muted};padding:10px 2px 0;">
            Подсказка: код — <span style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace;">${esc(c)}</span>
          </div>

        </td>
      </tr>
    </table>
  </div>`;
}


const PUBLIC_API_URL = process.env.PUBLIC_API_URL || "";
const PUBLIC_WEBAPP_AFTER_CONFIRM_PATH = process.env.PUBLIC_WEBAPP_AFTER_CONFIRM_PATH || "/?email_verified=1";
const EMAIL_BRAND = process.env.EMAIL_BRAND || "Mighty Sheep";


// Если за nginx/прокси — полезно:
// app.set("trust proxy", 1);



function buildConfirmEmailHtml({ brand, logoUrl, link, preheader }) {
  const esc = (s) =>
    String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));

  const toRgba = (hex, a) => {
    const h = String(hex).replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  const C = {
    bg: "#070B14",
    card: "#0E1630",
    border: "rgba(255,255,255,.12)",
    text: "#F4F7FF",
    muted: "rgba(244,247,255,.78)",
    blue: "#123BFF",
    orange: "#FF8A00",
    yellow: "#FFD34D",
  };

  const safeLink = esc(link);
  const pre = esc(preheader || "Подтвердите почту и входите через браузер по email.");

  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" width="36" height="36" alt="${esc(brand)}"
            style="display:block;border-radius:10px;object-fit:cover;border:1px solid rgba(255,255,255,.16);" />`
    : "";

  return `
  <div style="display:none;font-size:1px;color:${C.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${pre}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <div style="background:${C.bg};padding:24px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%"
           style="max-width:560px;margin:0 auto;table-layout:fixed;">
      <tr>
        <td style="padding:0 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="background:${C.card};border:1px solid ${C.border};border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:14px 16px;background:${C.card};background-image:linear-gradient(135deg, ${toRgba(C.blue, 0.55)} 0%, ${toRgba(C.orange, 0.38)} 55%, ${toRgba(C.yellow, 0.14)} 100%);">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td width="44" valign="middle">${logoHtml}</td>
                    <td valign="middle" style="padding-left:10px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.14em;
                                  text-transform:uppercase;color:${C.text};opacity:.92;">
                        ${esc(brand)}
                      </div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${C.text};opacity:.75;margin-top:2px;">
                        Подтверждение почты
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="height:6px;background:linear-gradient(90deg, ${C.blue} 0%, ${C.orange} 50%, ${C.blue} 100%);"></td>
            </tr>

            <tr>
              <td style="padding:18px 18px 16px 18px;font-family:Arial,Helvetica,sans-serif;color:${C.text};">
                <div style="font-size:20px;font-weight:900;margin:0 0 10px;">
                  Подтвердите email
                </div>

                <div style="font-size:14px;line-height:1.5;opacity:.9;margin:0 0 14px;color:${C.muted};">
                  Нажмите кнопку ниже, чтобы подтвердить почту. После этого вы сможете входить в приложение через браузер по email.
                </div>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
                  <tr>
                    <td bgcolor="${C.orange}" style="border-radius:12px;">
                      <a href="${safeLink}"
                         style="display:inline-block;padding:12px 16px;font-family:Arial,Helvetica,sans-serif;
                                font-size:14px;font-weight:900;color:#111318;text-decoration:none;border-radius:12px;">
                        Подтвердить почту
                      </a>
                    </td>
                  </tr>
                </table>

                <div style="font-size:12px;line-height:1.5;opacity:.68;margin-top:14px;color:${C.muted};">
                  Если кнопка не работает, нажмите сюда:
                  <a href="${safeLink}" style="color:${C.yellow};text-decoration:underline;">открыть подтверждение</a>
                </div>

                <div style="font-size:12px;opacity:.55;margin-top:12px;color:${C.muted};">
                  Если это были не вы — просто проигнорируйте письмо.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`;
}



function renderEmailConfirmedHtml({ brand, logoUrl, nextUrl }) {
  const esc = (s) =>
    String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));

  const C = {
    bg: "#070B14",
    card: "#0E1630",
    border: "rgba(255,255,255,.12)",
    text: "#F4F7FF",
    muted: "rgba(244,247,255,.78)",
    blue: "#123BFF",
    orange: "#FF8A00",
    yellow: "#FFD34D",
  };

  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" width="44" height="44" alt="${esc(brand)}"
            style="display:block;border-radius:14px;object-fit:cover;border:1px solid rgba(255,255,255,.16)" />`
    : "";

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Почта подтверждена</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;background:${C.bg};color:${C.text}}
    .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{max-width:560px;width:100%;background:${C.card};border:1px solid ${C.border};
      border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.35)}
    .head{padding:16px 18px;background:${C.card};
      background-image:linear-gradient(135deg, rgba(18,59,255,.55) 0%, rgba(255,138,0,.35) 58%, rgba(255,211,77,.14) 100%);
      display:flex;gap:12px;align-items:center}
    .stripe{height:6px;background:linear-gradient(90deg, ${C.blue} 0%, ${C.orange} 50%, ${C.blue} 100%)}
    .brand{font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.92}
    .sub{font-size:12px;opacity:.75;margin-top:2px}
    .body{padding:18px}
    h1{margin:0 0 10px;font-size:22px}
    p{margin:10px 0;line-height:1.5;color:${C.muted}}
    .btn{display:inline-block;margin-top:14px;background:${C.orange};color:#111318;text-decoration:none;
      padding:12px 16px;border-radius:12px;font-weight:900}
    .muted{margin-top:14px;font-size:13px;color:rgba(244,247,255,.62)}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        ${logo}
        <div>
          <div class="brand">${esc(brand)}</div>
          <div class="sub">Подтверждение почты</div>
        </div>
      </div>
      <div class="stripe"></div>
      <div class="body">
        <h1>Почта подтверждена ✅</h1>
        <p>Теперь можно входить в приложение через браузер по этой почте (не только через Telegram).</p>
        <a class="btn" href="${esc(nextUrl)}">Открыть приложение</a>
        <div class="muted">Автопереход через пару секунд…</div>
      </div>
    </div>
  </div>

  <script>
    setTimeout(function(){ window.location.href = ${JSON.stringify(nextUrl)}; }, 2200);
  </script>
</body>
</html>`;
}






/** ===================== ROUTES ===================== */

app.get("/api/health", (req, res) => res.json({ ok: true }));

/** ====== AUTH: EMAIL OTP ====== */

const BRAND = (process.env.EMAIL_BRAND || "Mighty Sheep").replace(/^"|"$/g, "");
const EMAIL_LOGO_URL = (process.env.EMAIL_LOGO_URL || "").replace(/^"|"$/g, "");

function getWebBase() {
  const raw = (process.env.PUBLIC_WEBAPP_URL || process.env.WEB_APP_URL || "https://mightysheep.ru")
    .replace(/^"|"$/g, "")
    .trim();
  return raw.replace(/\/$/, "");
}

function getApiBase(req) {
  const raw = (process.env.PUBLIC_API_URL || "").replace(/^"|"$/g, "").trim();
  if (raw) return raw.replace(/\/$/, "");
  return apiBaseFromReq(req).replace(/\/$/, "");
}

app.post("/api/me/email/start", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const email = normalizeEmail(req.body?.email);
    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, reason: "bad_email" });
    }

    const currentPlayer = await q(`SELECT email FROM players WHERE tg_id=$1`, [user.id]);
    if (!currentPlayer.rows?.[0]) {
      return res.status(403).json({ ok: false, reason: "player_deleted" });
    }
    const activeEmail = normalizeEmail(currentPlayer.rows?.[0]?.email || null);

    if (activeEmail && activeEmail.toLowerCase() === email.toLowerCase()) {
      return res.status(400).json({ ok: false, reason: "same_as_current" });
    }

    const existing = await q(`SELECT tg_id FROM players WHERE LOWER(email)=LOWER($1)`, [email]);
    if (existing.rows?.[0] && Number(existing.rows[0].tg_id) !== Number(user.id)) {
      return res.status(400).json({ ok: false, reason: "email_in_use" });
    }

    await q(
      `UPDATE players
         SET pending_email=$2,
             pending_email_requested_at=NOW()
       WHERE tg_id=$1`,
      [user.id, email]
    );

    const ttlMs = Number(process.env.EMAIL_VERIFY_TTL_MS) || (24 * 60 * 60 * 1000);
    const token = signToken({ uid: user.id, email, exp: Date.now() + ttlMs });

    const apiBase = getApiBase(req);

    const link = `${apiBase}/api/auth/email/confirm?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: email,
      subject: `${BRAND} — подтверждение почты`,
      text: `Чтобы подтвердить почту, откройте ссылку: ${link}`,
      html: buildConfirmEmailHtml({
        brand: BRAND,
        logoUrl: EMAIL_LOGO_URL,
        link,
        preheader: "Подтвердите новую почту для входа через браузер по email.",
      }),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/me/email/start failed:", e?.stack || e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});






app.post("/api/auth/email/verify", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();
    if (!email || !code) return res.status(400).json({ ok: false, reason: "bad_payload" });

    const codeHash = hashToken(code);
    const r = await q(
      `SELECT id, expires_at FROM email_login_codes WHERE email=$1 AND code_hash=$2 ORDER BY id DESC LIMIT 1`,
      [email, codeHash]
    );
    const row = r.rows?.[0];
    if (!row) return res.status(400).json({ ok: false, reason: "invalid_code" });
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ ok: false, reason: "code_expired" });
    }

    await q(`DELETE FROM email_login_codes WHERE id=$1`, [row.id]);

    const pr = await q(`SELECT * FROM players WHERE LOWER(email)=LOWER($1)`, [email]);
    const player = pr.rows?.[0];
    if (player) {
      if (!player.email_verified) {
        await q(
          `UPDATE players SET email_verified=TRUE, email_verified_at=NOW() WHERE tg_id=$1`,
          [player.tg_id]
        );
      }
      const token = issueAuthToken(player.tg_id);
      return res.json({ ok: true, status: "approved", token });
    }

    const ar = await q(`SELECT * FROM team_applications WHERE LOWER(email)=LOWER($1) ORDER BY id DESC LIMIT 1`, [email]);
    const appRow = ar.rows?.[0];

    if (appRow?.status === "approved" && appRow.player_tg_id) {
      const linked = await q(`SELECT tg_id FROM players WHERE tg_id=$1`, [appRow.player_tg_id]);
      if (!linked.rows?.[0]) {
        return res.status(403).json({ ok: false, reason: "player_deleted" });
      }
      const token = issueAuthToken(appRow.player_tg_id);
      return res.json({ ok: true, status: "approved", token });
    }

    if (!appRow || appRow.status !== "pending") {
      await q(`INSERT INTO team_applications(email, status) VALUES ($1,'pending')`, [email]);
    }

    return res.json({ ok: true, status: "pending" });
  } catch (e) {
    console.error("POST /api/auth/email/verify failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.get("/api/auth/email/confirm", async (req, res) => {
  try {
    const token = String(req.query?.token || "");

    let payload = null;
    try {
      payload = verifyToken(token);
    } catch (err) {
      return res.status(400).send("bad_token");
    }

    if (!payload?.uid || !payload?.email) {
      return res.status(400).send("bad_token");
    }

    const pr = await q(`SELECT tg_id FROM players WHERE tg_id=$1`, [payload.uid]);
    if (!pr.rows?.[0]) return res.status(404).send("not_found");

    const playerRow = await q(
      `SELECT email, pending_email FROM players WHERE tg_id=$1`,
      [payload.uid]
    );
    const player = playerRow.rows?.[0];
    if (!player) return res.status(404).send("not_found");

    const pendingEmail = normalizeEmail(player.pending_email || null);
    const tokenEmail = normalizeEmail(payload.email || null);

    if (!tokenEmail || !pendingEmail || tokenEmail.toLowerCase() !== pendingEmail.toLowerCase()) {
      return res.status(400).send("stale_token");
    }

    const existing = await q(`SELECT tg_id FROM players WHERE LOWER(email)=LOWER($1)`, [tokenEmail]);
    if (existing.rows?.[0] && Number(existing.rows[0].tg_id) !== Number(payload.uid)) {
      return res.status(400).send("email_in_use");
    }

    await q(
      `UPDATE players
          SET email=$2,
              email_verified=TRUE,
              email_verified_at=NOW(),
              pending_email=NULL,
              pending_email_requested_at=NULL
        WHERE tg_id=$1`,
      [payload.uid, tokenEmail]
    );

    const apiBase = getApiBase(req);
    return res.redirect(`${apiBase}/auth/email/confirmed`);
  } catch (e) {
    console.error("GET /api/auth/email/confirm failed:", e?.stack || e);
    return res.status(500).send("server_error");
  }
});



app.get("/auth/email/confirmed", (req, res) => {
  const next = `${getWebBase()}/?email_verified=1`;

  res.status(200).type("html").send(
    renderEmailConfirmedHtml({
      brand: BRAND,
      logoUrl: EMAIL_LOGO_URL,
      nextUrl: next,
    })
  );
});

// OTP: отправка 6-значного кода на почту (вход через email)
const WEBAPP_LOGIN_URL = (process.env.WEB_APP_URL || "https://mightysheep.ru")
  .replace(/^"|"$/g, "")
  .replace(/\/$/, "");

app.post("/api/auth/email/start", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, reason: "bad_email" });
    }

    // ВАЖНО: ttlMs с дефолтом
    const ttlMs = Number(process.env.EMAIL_CODE_TTL_MS) || (10 * 60 * 1000);
    const ttlMinutes = Math.round(ttlMs / 60000);

    const code = generateCode();
    const codeHash = hashToken(code);
    const expiresAt = new Date(Date.now() + ttlMs);

    await q(
      `INSERT INTO email_login_codes(email, code_hash, expires_at)
       VALUES ($1,$2,$3)`,
      // лучше передавать Date напрямую, pg нормально съест timestamp
      [email, codeHash, expiresAt]
    );

    await sendEmail({
      to: email,
      subject: `${BRAND} — код входа`,
      text:
        `Ваш код входа: ${code}\n` +
        `Код действует ${ttlMinutes} минут.\n\n` +
        `Если вы не запрашивали код — просто проигнорируйте письмо.`,
      html: buildOtpEmailHtml({
        brand: BRAND,
        code,
        ttlMinutes,
        preheader: `Ваш код: ${code}. Действует ${ttlMinutes} минут.`,
        logoUrl: EMAIL_LOGO_URL,
        ctaUrl: WEBAPP_LOGIN_URL, // главная страница
      }),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/auth/email/start failed:", e?.stack || e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

/** ====== ME ====== */
app.get("/api/me", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  // 1) сначала выясняем админа
  const admin = await isAdminId(user.id);

  // 2) членство проверяем только если НЕ админ
  if (!admin && !user?.is_email_auth) {
    if (!(await requireGroupMember(req, res, user))) return;
  }

  if (user?.is_email_auth) {
    const ex = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);
    const player = ex.rows?.[0] ?? null;
    if (!player) return res.status(403).json({ ok: false, reason: "player_deleted" });
    return res.json({ ok: true, player, is_admin: admin });
  }

  await ensurePlayer(user);

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);
  const player = pr.rows?.[0] ?? null;

  res.json({ ok: true, player, is_admin: admin });
});

app.post("/api/me", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const admin = await isAdminId(user.id);
  if (!admin && !user?.is_email_auth) {
    if (!(await requireGroupMember(req, res, user))) return;
  }

  if (user?.is_email_auth) {
    const ex = await q(`SELECT tg_id FROM players WHERE tg_id=$1`, [user.id]);
    if (!ex.rows?.[0]) return res.status(403).json({ ok: false, reason: "player_deleted" });
  } else {
    await ensurePlayer(user);
  }
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
  res.json({ ok: true, player: pr.rows?.[0] ?? null, is_admin: admin });
});

/** ===================== JERSEY ORDERS (PLAYER) ===================== */

// const JERSEY_ALLOWED_COLORS = new Set(["white", "blue", "black"]);

// function uniq(arr) {
//   const out = [];
//   const seen = new Set();
//   for (const x of arr || []) {
//     const s = String(x || "").trim();
//     if (!s || seen.has(s)) continue;
//     seen.add(s);
//     out.push(s);
//   }
//   return out;
// }

// function cleanColors(v) {
//   const a = Array.isArray(v) ? v : [];
//   return uniq(a)
//     .map((x) => x.toLowerCase())
//     .filter((x) => JERSEY_ALLOWED_COLORS.has(x))
//     .slice(0, 3);
// }

// function cleanText(v, max = 40) {
//   return String(v ?? "").trim().slice(0, max);
// }

// function cleanSocksSize(v) {
//   const s = String(v ?? "").trim().toLowerCase();
//   return s === "junior" ? "junior" : "adult";
// }

// async function authUserForApp(req, res) {
//   const user = req.webappUser || requireWebAppAuth(req, res);
//   if (!user) return null;

//   const admin = await isAdminId(user.id);
//   if (!admin) {
//     if (!(await requireGroupMember(req, res, user))) return null;
//   }

//   await ensurePlayer(user);
//   return { user, admin };
// }

// async function getOpenJerseyBatch() {
//   const r = await q(
//     `SELECT id, status, title, opened_at, announced_at
//      FROM jersey_batches
//      WHERE status='open'
//      ORDER BY id DESC
//      LIMIT 1`
//   );
//   return r.rows?.[0] ?? null;
// }

// GET current batch + my draft + whether already sent in this batch
app.get("/api/jersey/draft", async (req, res) => {
  const auth = await authUserForApp(req, res);
  if (!auth) return;

  const batch = await getOpenJerseyBatch();

  const dr = await q(
    `SELECT name_on_jersey, jersey_colors, jersey_number, jersey_size, socks_needed, socks_colors, socks_size, updated_at
     FROM jersey_drafts
     WHERE tg_id=$1`,
    [auth.user.id]
  );

  const draft = dr.rows?.[0] ?? null;

  let sent_at = null;
  if (batch?.id) {
    const or = await q(
      `SELECT updated_at
       FROM jersey_orders
       WHERE batch_id=$1 AND tg_id=$2`,
      [batch.id, auth.user.id]
    );
    sent_at = or.rows?.[0]?.updated_at ?? null;
  }

  return res.json({ ok: true, batch, draft, sent_at });
});

// save draft (allowed always)
app.post("/api/jersey/draft", async (req, res) => {
  const auth = await authUserForApp(req, res);
  if (!auth) return;

  const b = req.body || {};

  const name_on_jersey = cleanText(b.name_on_jersey, 24);
  const jersey_colors = cleanColors(b.jersey_colors);
  const jersey_number = jersey(b.jersey_number);
  const jersey_size = cleanText(b.jersey_size, 20);

  const socks_needed = b.socks_needed === true;
  const socks_colors = socks_needed ? cleanColors(b.socks_colors) : [];
  const socks_size = socks_needed ? cleanSocksSize(b.socks_size) : "adult";

  await q(
    `INSERT INTO jersey_drafts (
      tg_id, name_on_jersey, jersey_colors, jersey_number, jersey_size,
      socks_needed, socks_colors, socks_size, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
    ON CONFLICT (tg_id) DO UPDATE SET
      name_on_jersey=EXCLUDED.name_on_jersey,
      jersey_colors=EXCLUDED.jersey_colors,
      jersey_number=EXCLUDED.jersey_number,
      jersey_size=EXCLUDED.jersey_size,
      socks_needed=EXCLUDED.socks_needed,
      socks_colors=EXCLUDED.socks_colors,
      socks_size=EXCLUDED.socks_size,
      updated_at=NOW()
    RETURNING name_on_jersey, jersey_colors, jersey_number, jersey_size, socks_needed, socks_colors, socks_size, updated_at`,
    [
      auth.user.id,
      name_on_jersey,
      jersey_colors,
      jersey_number,
      jersey_size,
      socks_needed,
      socks_colors,
      socks_size,
    ]
  );

  const out = await q(
    `SELECT name_on_jersey, jersey_colors, jersey_number, jersey_size, socks_needed, socks_colors, socks_size, updated_at
     FROM jersey_drafts
     WHERE tg_id=$1`,
    [auth.user.id]
  );

  return res.json({ ok: true, draft: out.rows?.[0] ?? null });
});

// send order (ONLY when batch is open)
app.post("/api/jersey/send", async (req, res) => {
  const auth = await authUserForApp(req, res);
  if (!auth) return;

  const batch = await getOpenJerseyBatch();
  if (!batch?.id) return res.status(400).json({ ok: false, reason: "collection_closed" });

  const b = req.body || {};

  const name_on_jersey = cleanText(b.name_on_jersey, 24);
  const jersey_colors = cleanColors(b.jersey_colors);
  const jersey_number = jersey(b.jersey_number);
  const jersey_size = cleanText(b.jersey_size, 20);

  const socks_needed = b.socks_needed === true;
  const socks_colors = socks_needed ? cleanColors(b.socks_colors) : [];
  const socks_size = socks_needed ? cleanSocksSize(b.socks_size) : "adult";

  // минимальная валидация
  if (!name_on_jersey) return res.status(400).json({ ok: false, reason: "name_required" });
  if (!jersey_size) return res.status(400).json({ ok: false, reason: "size_required" });
  if (jersey_colors.length === 0) return res.status(400).json({ ok: false, reason: "colors_required" });

  // upsert order in this batch
  const ins = await q(
    `INSERT INTO jersey_orders (
      batch_id, tg_id,
      name_on_jersey, jersey_colors, jersey_number, jersey_size,
      socks_needed, socks_colors, socks_size,
      created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW(), NOW())
    ON CONFLICT (batch_id, tg_id) DO UPDATE SET
      name_on_jersey=EXCLUDED.name_on_jersey,
      jersey_colors=EXCLUDED.jersey_colors,
      jersey_number=EXCLUDED.jersey_number,
      jersey_size=EXCLUDED.jersey_size,
      socks_needed=EXCLUDED.socks_needed,
      socks_colors=EXCLUDED.socks_colors,
      socks_size=EXCLUDED.socks_size,
      updated_at=NOW()
    RETURNING id, batch_id, tg_id, updated_at`,
    [
      batch.id,
      auth.user.id,
      name_on_jersey,
      jersey_colors,
      jersey_number,
      jersey_size,
      socks_needed,
      socks_colors,
      socks_size,
    ]
  );

  // sync draft too (so “висит в профиле” актуально)
  await q(
    `INSERT INTO jersey_drafts (
      tg_id, name_on_jersey, jersey_colors, jersey_number, jersey_size,
      socks_needed, socks_colors, socks_size, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
    ON CONFLICT (tg_id) DO UPDATE SET
      name_on_jersey=EXCLUDED.name_on_jersey,
      jersey_colors=EXCLUDED.jersey_colors,
      jersey_number=EXCLUDED.jersey_number,
      jersey_size=EXCLUDED.jersey_size,
      socks_needed=EXCLUDED.socks_needed,
      socks_colors=EXCLUDED.socks_colors,
      socks_size=EXCLUDED.socks_size,
      updated_at=NOW()`,
    [
      auth.user.id,
      name_on_jersey,
      jersey_colors,
      jersey_number,
      jersey_size,
      socks_needed,
      socks_colors,
      socks_size,
    ]
  );

  return res.json({ ok: true, batch, sent_at: ins.rows?.[0]?.updated_at ?? null });
});


/** ===================== JERSEY (BATCHES + MULTI REQUESTS) ===================== */

const JERSEY_COLORS_SET = new Set(["white", "blue", "black"]);
const SOCKS_SIZE_SET = new Set(["adult", "junior"]);

function cleanText(v, max = 64) {
  return String(v || "").trim().slice(0, max);
}
function cleanColors(arr) {
  const a = Array.isArray(arr) ? arr : [];
  const out = [];
  for (const x of a) {
    const c = String(x || "").trim();
    if (JERSEY_COLORS_SET.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}
function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getOpenJerseyBatchRow() {
  const r = await q(
    `SELECT id, title, status, opened_at, closed_at
     FROM jersey_batches
     WHERE status='open'
     ORDER BY id DESC
     LIMIT 1`
  );
  return r.rows?.[0] ?? null;
}

/** ---- PLAYER: list my requests ---- */
app.get("/api/jersey/requests", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const admin = await isAdminId(user.id);
    if (!admin) {
      if (!(await requireGroupMember(req, res, user))) return;
    }

    await ensurePlayer(user);

    const open = await getOpenJerseyBatchRow();

    let requests = [];
    if (open?.id) {
      const rr = await q(
        `SELECT *
         FROM jersey_requests
         WHERE tg_id=$1
           AND (
             status='draft'
             OR (status='sent' AND batch_id=$2)
           )
         ORDER BY id DESC`,
        [user.id, open.id]
      );
      requests = rr.rows || [];
    } else {
      const rr = await q(
        `SELECT *
         FROM jersey_requests
         WHERE tg_id=$1 AND status='draft'
         ORDER BY id DESC`,
        [user.id]
      );
      requests = rr.rows || [];
    }

    // история (sent) по прошлым сборам
    const hr = await q(
      `SELECT
         b.id AS batch_id, b.title,
         r.*
       FROM jersey_requests r
       JOIN jersey_batches b ON b.id = r.batch_id
       WHERE r.tg_id=$1 AND r.status='sent'
       ORDER BY b.id DESC, r.sent_at DESC, r.id DESC`,
      [user.id]
    );

    // группировка
    const map = new Map();
    for (const row of hr.rows || []) {
      const bid = row.batch_id;
      if (!map.has(bid)) {
        map.set(bid, { batch_id: bid, title: row.title || "", items: [] });
      }
      map.get(bid).items.push(row);
    }

    return res.json({
      ok: true,
      batch: open,
      requests,
      history: Array.from(map.values()),
    });
  } catch (e) {
    console.error("GET /api/jersey/requests failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

/** ---- PLAYER: create draft request (allowed even if collection is closed) ---- */
app.post("/api/jersey/requests", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const admin = await isAdminId(user.id);
    if (!admin) {
      if (!(await requireGroupMember(req, res, user))) return;
    }
    await ensurePlayer(user);

    const open = await getOpenJerseyBatchRow();

    const b = req.body || {};
    const payload = {
      name_on_jersey: cleanText(b.name_on_jersey, 40),
      jersey_colors: cleanColors(b.jersey_colors),
      jersey_number: numOrNull(b.jersey_number),
      jersey_size: cleanText(b.jersey_size, 24),
      socks_needed: !!b.socks_needed,
      socks_colors: cleanColors(b.socks_colors),
      socks_size: SOCKS_SIZE_SET.has(String(b.socks_size)) ? String(b.socks_size) : "adult",
    };

    const ins = await q(
      `INSERT INTO jersey_requests
        (batch_id, tg_id, status, name_on_jersey, jersey_colors, jersey_number, jersey_size,
         socks_needed, socks_colors, socks_size, created_at, updated_at)
       VALUES
        ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
       RETURNING *`,
      [
        open?.id ?? null,
        user.id,
        payload.name_on_jersey,
        payload.jersey_colors,
        payload.jersey_number,
        payload.jersey_size,
        payload.socks_needed,
        payload.socks_colors,
        payload.socks_size,
      ]
    );

    return res.json({ ok: true, request: ins.rows?.[0] || null });
  } catch (e) {
    console.error("POST /api/jersey/requests failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

/** ---- PLAYER: update draft (and allow sent->draft edit when batch is open) ---- */
app.patch("/api/jersey/requests/:id", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const admin = await isAdminId(user.id);
    if (!admin) {
      if (!(await requireGroupMember(req, res, user))) return;
    }
    await ensurePlayer(user);

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const open = await getOpenJerseyBatchRow();

    const cur = await q(
      `SELECT * FROM jersey_requests WHERE id=$1 AND tg_id=$2`,
      [id, user.id]
    );
    const row = cur.rows?.[0];
    if (!row) return res.status(404).json({ ok: false, reason: "not_found" });
    if (row.status === "sent") {
      if (!open?.id) return res.status(400).json({ ok: false, reason: "collection_closed" });
      if (Number(row.batch_id) !== Number(open.id)) {
        return res.status(400).json({ ok: false, reason: "batch_closed" });
      }
    } else if (row.status !== "draft") {
      return res.status(400).json({ ok: false, reason: "already_sent" });
    }

    const b = req.body || {};
    const payload = {
      name_on_jersey: cleanText(b.name_on_jersey, 40),
      jersey_colors: cleanColors(b.jersey_colors),
      jersey_number: numOrNull(b.jersey_number),
      jersey_size: cleanText(b.jersey_size, 24),
      socks_needed: !!b.socks_needed,
      socks_colors: cleanColors(b.socks_colors),
      socks_size: SOCKS_SIZE_SET.has(String(b.socks_size)) ? String(b.socks_size) : "adult",
    };

    const nextStatus = row.status === "sent" ? "draft" : row.status;
    const sentAt = row.status === "sent" ? null : row.sent_at;

    const upd = await q(
      `UPDATE jersey_requests SET
        name_on_jersey=$2,
        jersey_colors=$3,
        jersey_number=$4,
        jersey_size=$5,
        socks_needed=$6,
        socks_colors=$7,
        socks_size=$8,
        status=$9,
        sent_at=$10,
        updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [
        id,
        payload.name_on_jersey,
        payload.jersey_colors,
        payload.jersey_number,
        payload.jersey_size,
        payload.socks_needed,
        payload.socks_colors,
        payload.socks_size,
        nextStatus,
        sentAt,
      ]
    );

    return res.json({ ok: true, request: upd.rows?.[0] || null });
  } catch (e) {
    console.error("PATCH /api/jersey/requests/:id failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

/** ---- PLAYER: delete draft ---- */
app.delete("/api/jersey/requests/:id", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const admin = await isAdminId(user.id);
    if (!admin) {
      if (!(await requireGroupMember(req, res, user))) return;
    }
    await ensurePlayer(user);

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const cur = await q(
      `SELECT * FROM jersey_requests WHERE id=$1 AND tg_id=$2`,
      [id, user.id]
    );
    const row = cur.rows?.[0];
    if (!row) return res.status(404).json({ ok: false, reason: "not_found" });
    if (row.status !== "draft") return res.status(400).json({ ok: false, reason: "already_sent" });

    await q(`DELETE FROM jersey_requests WHERE id=$1`, [id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/jersey/requests/:id failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

/** ---- PLAYER: send request ---- */
app.post("/api/jersey/requests/:id/send", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const admin = await isAdminId(user.id);
    if (!admin) {
      if (!(await requireGroupMember(req, res, user))) return;
    }
    await ensurePlayer(user);

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const open = await getOpenJerseyBatchRow();
    if (!open?.id) return res.status(400).json({ ok: false, reason: "collection_closed" });

    const cur = await q(
      `SELECT * FROM jersey_requests WHERE id=$1 AND tg_id=$2`,
      [id, user.id]
    );
    const row = cur.rows?.[0];
    if (!row) return res.status(404).json({ ok: false, reason: "not_found" });
    if (row.status !== "draft") return res.status(400).json({ ok: false, reason: "already_sent" });
    // запрет отправки пустого
    const name = String(row.name_on_jersey || "").trim();
    const size = String(row.jersey_size || "").trim();
    const colors = Array.isArray(row.jersey_colors) ? row.jersey_colors : [];
    const wantsJersey = !!name || !!size || colors.length > 0;

    if (!wantsJersey && !row.socks_needed) {
      return res.status(400).json({ ok: false, reason: "jersey_or_socks_required" });
    }

    if (wantsJersey) {
      if (!name) return res.status(400).json({ ok: false, reason: "name_required" });
      if (!size) return res.status(400).json({ ok: false, reason: "size_required" });
      if (colors.length === 0) return res.status(400).json({ ok: false, reason: "colors_required" });
    }

    if (row.socks_needed) {
      const sc = Array.isArray(row.socks_colors) ? row.socks_colors : [];
      if (sc.length === 0) return res.status(400).json({ ok: false, reason: "socks_colors_required" });
    }

    const nameToSave = wantsJersey ? name : "нет";
    const sizeToSave = wantsJersey ? size : "нет";
    const colorsToSave = wantsJersey ? colors : [];

    const upd = await q(
      `UPDATE jersey_requests SET
        status='sent',
        sent_at=NOW(),
        batch_id=$2,
        name_on_jersey=$3,
        jersey_size=$4,
        jersey_colors=$5,
        updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, open.id, nameToSave, sizeToSave, colorsToSave]
    );

    return res.json({ ok: true, request: upd.rows?.[0] || null });
  } catch (e) {
    console.error("POST /api/jersey/requests/:id/send failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

/** ---- ADMIN: batches list ---- */
app.get("/api/admin/jersey/batches", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const r = await q(
      `SELECT
         b.*,
         (SELECT COUNT(*)::int FROM jersey_requests r WHERE r.batch_id=b.id AND r.status='sent') AS orders_count
       FROM jersey_batches b
       ORDER BY b.id DESC`
    );

    return res.json({ ok: true, batches: r.rows || [] });
  } catch (e) {
    console.error("GET /api/admin/jersey/batches failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});




app.post("/api/admin/jersey/batches/:id/announce", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const br = await q(`SELECT * FROM jersey_batches WHERE id=$1`, [id]);
    const batch = br.rows?.[0];
    if (!batch) return res.status(404).json({ ok: false, reason: "not_found" });

    const chatIdRaw = await getSetting("notify_chat_id", null);
    if (!chatIdRaw) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

    const chat_id = Number(chatIdRaw);

    const title = batch.title ? `«${batch.title}»` : `#${batch.id}`;
    const text =
      `👕 Открыт сбор командной формы ${title}\n\n` +
      `Заполни заявку в профиле игрока и нажми «Отправить».\n` +
      `Сбор открыт, пока админ не закроет его.`;

    const sent = await bot.api.sendMessage(chat_id, text, { disable_web_page_preview: true });

    // опционально: логировать как bot_message
    try {
      await logBotMessage({
        chat_id,
        message_id: sent.message_id,
        kind: "jersey_batch",
        text,
        meta: { batch_id: batch.id, type: "jersey_batch_announce" },
        sent_by_tg_id: user.id,
      });
    } catch {}

    return res.json({ ok: true, message_id: sent.message_id });
  } catch (e) {
    console.error("POST /api/admin/jersey/batches/:id/announce failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.get("/api/admin/jersey/batches/:id/orders", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const r = await q(
      `SELECT
         r.*,
         p.display_name, p.first_name, p.username, p.tg_id
       FROM jersey_requests r
       JOIN players p ON p.tg_id = r.tg_id
       WHERE r.batch_id=$1 AND r.status='sent'
       ORDER BY p.display_name NULLS LAST, r.id ASC`,
      [id]
    );

    return res.json({ ok: true, orders: r.rows || [] });
  } catch (e) {
    console.error("GET /api/admin/jersey/batches/:id/orders failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});






app.get("/api/admin/jersey/batches/:id/export.csv", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).send("bad_id");

    const tok = verifyToken(req.query.token);
    if (!tok) return res.status(403).send("bad_token");

    if (Number(tok.bid) !== id) return res.status(403).send("bad_token_scope");

    // доп.страховка: пользователь из токена всё ещё админ
    const stillAdmin = await isAdminId(tok.uid);
    if (!stillAdmin) return res.status(403).send("admin_only");

    const br = await q(`SELECT * FROM jersey_batches WHERE id=$1`, [id]);
    const batch = br.rows?.[0];
    if (!batch) return res.status(404).send("not_found");

    const r = await q(
      `SELECT * FROM jersey_requests WHERE batch_id=$1 AND status='sent' ORDER BY id ASC`,
      [id]
    );

    const rows = [];
    rows.push(["sep=;"]); // помогает Excel/Numbers на мобиле
    rows.push(["№", "Надпись", "Номер", "Размер", "Цвет", "Гамаши", "Цена"]);

    let i = 1;
    for (const o of r.rows || []) {
      const title = o.name_on_jersey?.trim() ? o.name_on_jersey.trim() : "без надписи";
      const num = o.jersey_number == null ? "без номера" : String(o.jersey_number);
      const size = o.jersey_size || "";
      const color = ruJoin(o.jersey_colors, "jersey");

      let socks = "";
      if (o.socks_needed) {
        socks = ruJoin(o.socks_colors, "socks");
        if (String(o.socks_size) === "junior") socks = (socks ? socks + " " : "") + "jr";
      }

      rows.push([String(i++), title, num, size, color, socks, ""]);
    }

    const esc = (cell) => {
      const s = String(cell ?? "");
      return (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r"))
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const csv = "\uFEFF" + rows.map((r) => r.map(esc).join(";")).join("\r\n");

    const safeTitle = (batch.title || `batch_${id}`)
      .replace(/[^\w\-а-яА-Я ]+/g, "")
      .trim()
      .replace(/\s+/g, "_");
    const filename = `jersey_${safeTitle || id}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(csv);
  } catch (e) {
    console.error("GET /export.csv failed:", e);
    return res.status(500).send("server_error");
  }
});


app.get("/api/admin/jersey/batches/:id/export-link", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    // токен на 60 секунд
    const token = signToken({
      uid: user.id,
      bid: id,
      exp: Date.now() + 60_000,
      jti: b64url(require("crypto").randomBytes(8)),
    });

    const base = apiBaseFromReq(req);
    const url = `${base}/api/admin/jersey/batches/${id}/export.csv?token=${encodeURIComponent(token)}`;

    return res.json({ ok: true, url });
  } catch (e) {
    console.error("GET /export-link failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.delete("/api/admin/jersey/requests/:id", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const del = await q(`DELETE FROM jersey_requests WHERE id=$1 RETURNING id, batch_id, tg_id, status`, [id]);
    const row = del.rows?.[0];
    if (!row) return res.status(404).json({ ok: false, reason: "not_found" });

    return res.json({ ok: true, deleted: row });
  } catch (e) {
    console.error("DELETE /api/admin/jersey/requests/:id failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});



      /** ====== FUN (profile jokes) ====== */
/** ====== FUN (profile jokes) ====== */
app.get("/api/fun/status", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    await ensurePlayer(user);

    // премиум: lifetime || until > now
    const pr = await q(
      `SELECT joke_premium, joke_premium_until
       FROM players
       WHERE tg_id=$1`,
      [user.id]
    );

    const lifetime = pr.rows[0]?.joke_premium === true;
    const until = pr.rows[0]?.joke_premium_until || null;
    const timed = !!(until && new Date(until).getTime() > Date.now());

    const premium = lifetime || timed;

    // totals
    const r = await q(
      `SELECT action, COUNT(*)::int AS total
       FROM fun_actions_log
       WHERE user_id=$1
       GROUP BY action`,
      [user.id]
    );

    const map = new Map(r.rows.map((x) => [x.action, x.total]));

    return res.json({
      ok: true,
      thanks_total: map.get("thanks") || 0,
      donate_total: map.get("donate") || 0,
      premium,
      premium_until: until,          // 👈 добавили
      premium_lifetime: lifetime,    // 👈 добавили
    });
  } catch (e) {
    console.error("GET /api/fun/status failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.post("/api/admin/players/:tg_id/joke-premium", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  // лучше так, если у тебя есть супер-админ логика:
  // const is_super = await isSuperAdminId(user.id);
  // if (!is_super) return res.status(403).json({ ok:false, reason:"super_admin_only" });

  const is_admin = await isAdminId(user.id);
  if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

  const tgId = Number(req.params.tg_id);
  const op = String(req.body?.op || "").trim();

  if (!Number.isFinite(tgId)) return res.status(400).json({ ok: false, reason: "bad_tg_id" });

  if (op === "grant_days") {
    const days = Number(req.body?.days);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return res.status(400).json({ ok: false, reason: "bad_days" });
    }

    // продляем от max(now, текущий until)
    await q(
      `
      UPDATE players
      SET joke_premium_until =
          GREATEST(COALESCE(joke_premium_until, NOW()), NOW())
          + ($2::int || ' days')::interval,
          updated_at = NOW()
      WHERE tg_id=$1
      `,
      [tgId, days]
    );
  } else if (op === "revoke_all") {
    // снять и срок, и пожизненный
    await q(
      `UPDATE players
       SET joke_premium_until=NULL,
           joke_premium=FALSE,
           updated_at=NOW()
       WHERE tg_id=$1`,
      [tgId]
    );
  } else if (op === "set_lifetime") {
    const on = !!req.body?.on;
    await q(
      `UPDATE players
       SET joke_premium=$2,
           updated_at=NOW()
       WHERE tg_id=$1`,
      [tgId, on]
    );
  } else if (op === "set_until") {
    // если захочешь вручную конкретную дату (не обязательно)
    const untilIso = String(req.body?.until || "").trim();
    const d = new Date(untilIso);
    if (!untilIso || !Number.isFinite(d.getTime())) {
      return res.status(400).json({ ok: false, reason: "bad_until" });
    }
    await q(
      `UPDATE players
       SET joke_premium_until=$2,
           updated_at=NOW()
       WHERE tg_id=$1`,
      [tgId, d.toISOString()]
    );
  } else {
    return res.status(400).json({ ok: false, reason: "bad_op" });
  }

  // отдаём новое состояние
  const pr = await q(
    `SELECT joke_premium, joke_premium_until
     FROM players WHERE tg_id=$1`,
    [tgId]
  );

  const lifetime = pr.rows[0]?.joke_premium === true;
  const until = pr.rows[0]?.joke_premium_until || null;
  const timed = !!(until && new Date(until).getTime() > Date.now());

  return res.json({
    ok: true,
    premium: lifetime || timed,
    premium_until: until,
    premium_lifetime: lifetime,
  });
});



app.post("/api/fun/thanks", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
    const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
    ),
    comment_counts AS (
      SELECT
        c.game_id,
        COUNT(*)::int AS comments_count
      FROM game_comments c
      WHERE c.game_id IN (SELECT id FROM page)
      GROUP BY c.game_id
    )
    SELECT
      t.total,
      p.*,
      COALESCE(c.yes_count,0)   AS yes_count,
      COALESCE(c.maybe_count,0) AS maybe_count,
      COALESCE(c.no_count,0)    AS no_count,
      COALESCE(cc.comments_count,0) AS comments_count,
      my.status AS my_status,
      ${sqlPlayerName("bp")} AS best_player_name
      FROM page p
      CROSS JOIN total t
      LEFT JOIN counts c ON c.game_id = p.id
      LEFT JOIN comment_counts cc ON cc.game_id = p.id
      LEFT JOIN rsvps my ON my.game_id = p.id AND my.tg_id = $7
      LEFT JOIN players bp ON bp.tg_id = p.best_player_tg_id
      ORDER BY p.starts_at ${order};
  `;

const [r, holderR] = await Promise.all([
  q(sql, [scope, from, to, search, limit, offset, user.id, daysInt]),
  q(`
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
  `),
]);

const talisman_holder = holderR.rows[0] || null;

  
  const total = r.rows[0]?.total ?? 0;
  const games = r.rows.map(({ total, ...rest }) => rest);

 res.json({ ok: true, games, total, limit, offset, scope, talisman_holder });
});

/** ====== GAME DETAILS (supports game_id) ====== */
app.get("/api/game", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const is_admin = await isAdminId(user.id);

  if (!is_admin) {
    if (!(await requireGroupMember(req, res, user))) return;
  }

  const gameId = req.query.game_id ? Number(req.query.game_id) : null;

  let game = null;

  if (gameId) {
    const gr = await q(
      `SELECT g.*, ${sqlPlayerName("bp")} AS best_player_name
       FROM games g
       LEFT JOIN players bp ON bp.tg_id = g.best_player_tg_id
       WHERE g.id=$1`,
      [gameId]
    );
    game = gr.rows[0] || null;
  } else {
    const gr = await q(
      `SELECT g.*, ${sqlPlayerName("bp")} AS best_player_name
       FROM games g
       LEFT JOIN players bp ON bp.tg_id = g.best_player_tg_id
       WHERE g.status='scheduled' AND g.starts_at >= NOW() - INTERVAL '6 hours'
       ORDER BY g.starts_at ASC
       LIMIT 1`
    );
    game = gr.rows[0] || null;
  }

  if (!game) return res.json({ ok: true, game: null, rsvps: [], teams: null });


  // ===== Окно голосования (пример: 36 часов после начала игры) =====
const VOTE_HOURS = 36;
const startsMs = game?.starts_at ? new Date(game.starts_at).getTime() : 0;
const nowMs = Date.now();
const vote_open = !!startsMs && startsMs < nowMs && nowMs < (startsMs + VOTE_HOURS * 3600 * 1000);

  
  // ✅ ВАЖНО: показываем roster (tg+manual+web) + гостей, которые реально отмечены на ЭТУ игру
  const rrPromise = is_admin
    ? q(
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
            p.player_kind IN ('tg','manual','web')
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
      )
    : q(
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
            p.player_kind IN ('tg','manual','web')
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

  const teamsPromise = q(
    `SELECT team_a, team_b, meta, generated_at FROM teams WHERE game_id=$1`,
    [game.id]
  );

  const [rr, tr] = await Promise.all([rrPromise, teamsPromise]);
  const teams = tr.rows[0] || null;


// ===== Мой голос (анонимно: не показываем другим, но храним чтобы 1 человек = 1 голос) =====
let my_vote = null;
let vote_results = [];
let vote_winner = null;

try {
  const [mv, vr] = await Promise.all([
    q(
      `SELECT candidate_tg_id
       FROM best_player_votes
       WHERE game_id=$1 AND voter_tg_id=$2`,
      [game.id, user.id]
    ),
    q(
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
    ),
  ]);

  my_vote = mv.rows[0]?.candidate_tg_id ?? null;
  vote_results = vr.rows || [];
  vote_winner = vote_results[0] || null;
} catch (e) {
  console.error("best_player votes query failed:", e?.message || e);
}


// отдаём расширенный game
res.json({
  ok: true,
  game,
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
    await syncTeamsAfterRsvpChange(gid, user.id);
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

  await syncTeamsAfterRsvpChange(gid, user.id);

  res.json({ ok: true });
});

/** ====== TEAMS GENERATE (admin) ====== */
app.post("/api/teams/generate", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

 const { starts_at, location, video_url, geo_lat, geo_lon, info_text, notice_text } = req.body || {};


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

  const it = String(info_text ?? "").replace(/\r\n/g, "\n").trim();
const nt = String(notice_text ?? "").replace(/\r\n/g, "\n").trim();

const infoVal = it ? it : null;
const noticeVal = nt ? nt : null;

if (noticeVal && noticeVal.length > 240) {
  return res.status(400).json({ ok: false, reason: "notice_too_long" });
}



const ir = await q(
  `INSERT INTO games(starts_at, location, status, video_url, geo_lat, geo_lon, info_text, notice_text)
   VALUES($1,$2,'scheduled',$3,$4,$5,$6,$7)
   RETURNING id, starts_at, location, status, video_url, geo_lat, geo_lon, info_text, notice_text`,
  [d.toISOString(), String(location || "").trim(), vu, lat, lon, infoVal, noticeVal]
);

 

  const chk = await q(`SELECT geo_lat, geo_lon FROM games WHERE id=$1`, [ir.rows[0].id]);


  res.json({ ok: true, game: ir.rows[0] });
});




app.patch("/api/games/:id", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
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
    // ✅ info_text (длинный блок)
  if (b.info_text !== undefined) {
    const t = String(b.info_text ?? "").replace(/\r\n/g, "\n");
    const v = t.trim();
    sets.push(`info_text=$${i++}`);
    vals.push(v ? v : null); // пустое -> null (очистка)
  }

  // ✅ notice_text (короткий блок "Важно!")
  if (b.notice_text !== undefined) {
    const t = String(b.notice_text ?? "").replace(/\r\n/g, "\n");
    const v = t.trim();

    if (v && v.length > 240) {
      return res.status(400).json({ ok: false, reason: "notice_too_long" });
    }

    sets.push(`notice_text=$${i++}`);
    vals.push(v ? v : null); // пустое -> null (очистка)
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
    await syncTeamsAfterRsvpChange(gid, tgId);
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

  await syncTeamsAfterRsvpChange(gid, tgId);

  res.json({ ok: true });
});


/** ====== ADMIN: players list + patch ====== */

app.get("/api/admin/engagement", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const y = int(req.query.year, Number.NaN);
  const m = int(req.query.month, Number.NaN);

  const nowMsk = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  const reqYear = Number.isFinite(y) && y >= 2000 && y <= 2200 ? y : nowMsk.getFullYear();
  const reqMonth = Number.isFinite(m) && m >= 1 && m <= 12 ? m : nowMsk.getMonth() + 1;

  const monthKey = `${reqYear}-${String(reqMonth).padStart(2, "0")}-01`;

  const stats = await q(
    `SELECT to_char(visit_date, 'YYYY-MM-DD') AS day_key, COUNT(*)::int AS visitors
     FROM app_daily_visits
     WHERE visit_date >= DATE_TRUNC('month', $1::date)::date
       AND visit_date < (DATE_TRUNC('month', $1::date) + INTERVAL '1 month')::date
     GROUP BY visit_date
     ORDER BY visit_date ASC`,
    [monthKey]
  );

  const visitors = await q(
    `SELECT
       to_char(v.visit_date, 'YYYY-MM-DD') AS day_key,
       v.tg_id,
       p.display_name,
       p.first_name,
       p.last_name,
       p.username,
       p.jersey_number
     FROM app_daily_visits v
     JOIN players p ON p.tg_id = v.tg_id
     WHERE v.visit_date >= DATE_TRUNC('month', $1::date)::date
       AND v.visit_date < (DATE_TRUNC('month', $1::date) + INTERVAL '1 month')::date
     ORDER BY v.visit_date ASC, COALESCE(NULLIF(BTRIM(p.display_name), ''), NULLIF(BTRIM(p.first_name), ''), NULLIF(BTRIM(p.username), ''), p.tg_id::text) ASC`,
    [monthKey]
  );

  const playersCountRes = await q(
    `SELECT COUNT(*)::int AS total
     FROM players
     WHERE disabled = FALSE
       AND player_kind IN ('tg', 'manual')`
  );

  const byDay = {};
  for (const row of stats.rows) {
    byDay[row.day_key] = Number(row.visitors) || 0;
  }

  const usersByDay = {};
  for (const row of visitors.rows) {
    if (!usersByDay[row.day_key]) usersByDay[row.day_key] = [];
    usersByDay[row.day_key].push({
      tg_id: Number(row.tg_id),
      display_name: row.display_name || "",
      first_name: row.first_name || "",
      last_name: row.last_name || "",
      username: row.username || "",
      jersey_number: row.jersey_number,
    });
  }

  res.json({
    ok: true,
    year: reqYear,
    month: reqMonth,
    team_size: Number(playersCountRes.rows?.[0]?.total || 0),
    by_day: byDay,
    users_by_day: usersByDay,
  });
});

app.get("/api/admin/players", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

const r = await q(
  `SELECT
    tg_id, first_name, last_name, username,
    display_name, jersey_number,
    photo_url,
    is_guest, player_kind, created_by,
    position, skill, skating, iq, stamina, passing, shooting,
    notes, disabled,
    is_admin, updated_at, last_seen_at,
    email, email_verified, email_verified_at,

    joke_premium,
    joke_premium_until,
    (joke_premium = TRUE OR (joke_premium_until IS NOT NULL AND joke_premium_until > NOW())) AS joke_premium_active

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
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const tgId = Number(req.params.tg_id);
  const b = req.body || {};

  // ✅ разрешаем менять player_kind (guest -> manual), но не даём трогать is_admin тут
  const kindRaw = b.player_kind ? String(b.player_kind).toLowerCase().trim() : null;
  const kind = ["tg", "manual", "guest"].includes(kindRaw) ? kindRaw : null;

  const emailProvided = b.email !== undefined;
  const emailValue = emailProvided ? normalizeEmail(b.email) || null : null;
  const emailVerifiedProvided = b.email_verified !== undefined;
  const emailVerifiedValue = emailVerifiedProvided ? Boolean(b.email_verified) : null;

  await q(
    `UPDATE players SET
      display_name=$2,
      jersey_number=$3,
      position=$4,
      skill=$5, skating=$6, iq=$7, stamina=$8, passing=$9, shooting=$10,
      notes=$11,
      disabled=$12,
      player_kind=COALESCE($13, player_kind),
      email=CASE WHEN $14 THEN $15 ELSE email END,
      email_verified=CASE WHEN $16 THEN $17 ELSE email_verified END,
      email_verified_at=CASE WHEN $16 = TRUE AND $17 = TRUE THEN COALESCE(email_verified_at, NOW()) ELSE email_verified_at END,
      photo_url=$18,
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
      emailProvided,
      emailValue,
      emailVerifiedProvided,
      emailVerifiedValue,
      (b.photo_url || "").trim().slice(0, 500) || "",
    ]
  );

    const pr = await q(
      `SELECT
        tg_id, first_name, last_name, username,
        display_name, jersey_number,
        photo_url,
        is_guest, player_kind, created_by,
        position, skill, skating, iq, stamina, passing, shooting,
        notes, disabled, is_admin, updated_at,
        email, email_verified, email_verified_at,

        joke_premium,
        joke_premium_until,
        (joke_premium = TRUE OR (joke_premium_until IS NOT NULL AND joke_premium_until > NOW())) AS joke_premium_active
      FROM players
      WHERE tg_id=$1`,
      [tgId]
    );


  res.json({ ok: true, player: pr.rows[0] });
});

app.post("/api/admin/players/:tg_id/admin", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const tgId = Number(req.params.tg_id);
  const pr = await q(`SELECT tg_id, player_kind FROM players WHERE tg_id=$1`, [tgId]);
  if (!pr.rows[0]) return res.status(404).json({ ok: false, reason: "not_found" });

  const kind = String(pr.rows[0].player_kind || "").toLowerCase();
  // веб/ручных/гостей можно удалять из приложения полностью.
  // tg не удаляем, чтобы не ломать telegram-профили — для них используйте disabled.
  if (!["guest", "web", "manual"].includes(kind)) {
    return res.status(400).json({ ok: false, reason: "delete_not_allowed" });
  }

  await q(`DELETE FROM players WHERE tg_id=$1`, [tgId]);
  res.json({ ok: true });
});

/** ====== ADMIN: team applications ====== */
app.get("/api/admin/team-applications", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;
    if (!(await requireAdminAsync(req, res, user))) return;

    const r = await q(
      `SELECT *
       FROM team_applications
       WHERE status='pending'
       ORDER BY created_at ASC`
    );
    return res.json({ ok: true, applications: r.rows || [] });
  } catch (e) {
    console.error("GET /api/admin/team-applications failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.post("/api/admin/team-applications/:id/approve", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;
    if (!(await requireAdminAsync(req, res, user))) return;

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const ar = await q(`SELECT * FROM team_applications WHERE id=$1`, [id]);
    const appRow = ar.rows?.[0];
    if (!appRow) return res.status(404).json({ ok: false, reason: "not_found" });
    if (appRow.status === "approved") return res.json({ ok: true, application: appRow });

    const email = normalizeEmail(appRow.email);
    const existing = await q(`SELECT tg_id FROM players WHERE LOWER(email)=LOWER($1)`, [email]);
    let tgId = existing.rows?.[0]?.tg_id ?? null;

    if (!tgId) {
      const seq = await q(`SELECT nextval('guest_seq') AS v`);
      tgId = -Number(seq.rows?.[0]?.v || 0);
      const displayName = email.split("@")[0] || null;
      await q(
        `INSERT INTO players(tg_id, display_name, email, email_verified, email_verified_at, player_kind, is_guest, disabled)
         VALUES($1,$2,$3,TRUE,NOW(),'web',FALSE,TRUE)`,
        [tgId, displayName, email]
      );
    } else {
      await q(
        `UPDATE players
            SET email_verified=TRUE,
                email_verified_at=NOW(),
                disabled=TRUE
          WHERE tg_id=$1`,
        [tgId]
      );
    }

    const upd = await q(
      `UPDATE team_applications
       SET status='approved', decided_at=NOW(), decided_by=$2, player_tg_id=$3
       WHERE id=$1
       RETURNING *`,
      [id, user.id, tgId]
    );

    return res.json({ ok: true, application: upd.rows?.[0] || null });
  } catch (e) {
    console.error("POST /api/admin/team-applications/:id/approve failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.post("/api/admin/team-applications/:id/reject", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;
    if (!(await requireAdminAsync(req, res, user))) return;

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const upd = await q(
      `UPDATE team_applications
       SET status='rejected', decided_at=NOW(), decided_by=$2
       WHERE id=$1
       RETURNING *`,
      [id, user.id]
    );
    if (!upd.rows?.[0]) return res.status(404).json({ ok: false, reason: "not_found" });
    return res.json({ ok: true, application: upd.rows[0] });
  } catch (e) {
    console.error("POST /api/admin/team-applications/:id/reject failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});


/** ===================== ADMIN: JERSEY ORDERS ===================== */

function csvCell(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(";") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}







app.post("/api/admin/jersey/batches/:id/announce", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_batch_id" });

  const br = await q(
    `SELECT id, status, title, opened_at, announced_at
     FROM jersey_batches
     WHERE id=$1`,
    [id]
  );
  const batch = br.rows?.[0];
  if (!batch) return res.status(404).json({ ok: false, reason: "batch_not_found" });
  if (batch.status !== "open") return res.status(400).json({ ok: false, reason: "batch_not_open" });

  const chatIdRaw = await getSetting("notify_chat_id", null);
  if (!chatIdRaw) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  const chat_id = Number(chatIdRaw);
  if (!Number.isFinite(chat_id)) return res.status(400).json({ ok: false, reason: "notify_chat_id_bad" });

  const botUsername = process.env.BOT_USERNAME || "HockeyLineupBot";
  const appLink = `https://t.me/${botUsername}?startapp=jersey`;

  const text =
    `👕 <b>Открыт сбор заявок на командную форму</b>\n` +
    (batch.title ? `📝 <i>${escapeHtml(batch.title)}</i>\n` : "") +
    `\nОткрой мини-приложение → <b>Профиль</b> → <b>Заявка на форму</b>.\n` +
    `Заполни и нажми <b>Отправить заявку</b>.`;

  const kb = new InlineKeyboard().url("👕 Оставить заявку", appLink);

  try {
    const sent = await bot.api.sendMessage(chat_id, text, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: kb,
    });

    await q(`UPDATE jersey_batches SET announced_at=NOW() WHERE id=$1`, [batch.id]);

    // лог в bot_messages (как custom)
    await logBotMessage({
      chat_id,
      message_id: sent.message_id,
      kind: "custom",
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkupToJson(kb),
      meta: { type: "jersey_announce", batch_id: batch.id },
      sent_by_tg_id: user.id,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("jersey announce failed:", e);
    return res.status(500).json({ ok: false, reason: "send_failed", error: tgErrText(e) });
  }
});




/** ====== PLAYERS (admin messages) ====== */

app.post("/api/admin/pm", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!requireOwner(req, res, user)) return;

  const b = req.body || {};
  const toId = Number(b.tg_id);
  const text = String(b.text || "").trim();

  if (!Number.isFinite(toId) || toId <= 0 || !text) {
    return res.status(400).json({ ok: false, reason: "bad_payload" });
  }

  // проверка: человек нажимал Start у бота
  const r = await q(`SELECT pm_started FROM players WHERE tg_id=$1`, [toId]);
  if (!r.rows?.[0]?.pm_started) {
    return res.status(400).json({ ok: false, reason: "user_not_started_bot" });
  }

  const bot = req.app.locals.bot;
  if (!bot) return res.status(500).json({ ok: false, reason: "bot_not_ready" });

  try {
    const sent = await bot.api.sendMessage(toId, text, { disable_web_page_preview: true });

    // опционально: лог в bot_messages (у тебя таблица уже есть)
    await q(
      `INSERT INTO bot_messages(chat_id, message_id, kind, text, sent_by_tg_id, meta)
       VALUES($1,$2,'pm',$3,$4,$5)`,
      [toId, sent.message_id, text, user.id, JSON.stringify({ to_tg_id: toId, type: "pm" })]
    ).catch(() => {});

    return res.json({ ok: true, message_id: sent.message_id });
  } catch (e) {
    return res.status(502).json({ ok: false, reason: "tg_send_failed" });
  }
});

app.post("/api/admin/pm/delete", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!requireOwner(req, res, user)) return;

  const b = req.body || {};
  const toId = Number(b.tg_id);
  const messageId = Number(b.message_id);

  if (!Number.isFinite(toId) || toId <= 0 || !Number.isFinite(messageId)) {
    return res.status(400).json({ ok: false, reason: "bad_payload" });
  }

  const bot = req.app.locals.bot;
  if (!bot) return res.status(500).json({ ok: false, reason: "bot_not_ready" });

  try {
    // лимит 48 часов — Telegram сам вернёт ошибку, если поздно :contentReference[oaicite:1]{index=1}
    await bot.api.deleteMessage(toId, messageId);

    await q(
      `UPDATE bot_messages
       SET deleted_at=NOW(), delete_reason='admin_pm_delete'
       WHERE chat_id=$1 AND message_id=$2`,
      [toId, messageId]
    ).catch(() => {});

    return res.json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, reason: "tg_delete_failed" });
  }
});

app.get("/api/admin/pm/history", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!requireOwner(req, res, user)) return;

  const toId = Number(req.query.tg_id);
  if (!Number.isFinite(toId) || toId <= 0) {
    return res.status(400).json({ ok: false, reason: "bad_tg_id" });
  }

  const r = await q(
    `
    SELECT message_id, text, created_at, deleted_at, delete_reason
    FROM bot_messages
    WHERE chat_id=$1 AND kind='pm'
    ORDER BY created_at DESC
    LIMIT 25
    `,
    [toId]
  );

  res.json({ ok: true, items: r.rows });
});

/** ====== PLAYERS (roster) ====== */
app.get("/api/players", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);

  const is_admin = await isAdminId(user.id);

  // ✅ показываем активных игроков: tg + manual + web
const sql = is_admin
  ? `SELECT tg_id, first_name, last_name, username, display_name, jersey_number, position,
            photo_url, avatar_file_id, updated_at, last_seen_at,
            notes, skill, skating, iq, stamina, passing, shooting, is_admin, disabled,
            player_kind
     FROM players
     WHERE disabled=FALSE
       AND player_kind IN ('tg','manual','web')
     ORDER BY COALESCE(display_name, first_name, username, tg_id::text) ASC`
  : `SELECT tg_id, first_name, last_name, username, display_name, jersey_number, position,
            photo_url, avatar_file_id, updated_at,
            notes,
            player_kind
     FROM players
     WHERE disabled=FALSE
       AND player_kind IN ('tg','manual','web')
     ORDER BY COALESCE(display_name, first_name, username, tg_id::text) ASC`;

const r = await q(sql);
const baseUrl = getPublicBaseUrl(req);
res.json({ ok: true, players: r.rows.map((p) => presentPlayer(p, baseUrl)) });

});

app.get("/api/players/:tg_id", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  const tgId = Number(req.params.tg_id);
  const is_admin = await isAdminId(user.id);

const sql = is_admin
  ? `SELECT * FROM players WHERE tg_id=$1`
  : `SELECT tg_id, first_name, last_name, username, display_name, jersey_number, position,
            photo_url, avatar_file_id, updated_at,
            notes, player_kind
     FROM players WHERE tg_id=$1`;

const r = await q(sql, [tgId]);
const baseUrl = getPublicBaseUrl(req);
res.json({ ok: true, player: r.rows[0] ? presentPlayer(r.rows[0], baseUrl) : null });

});

// import { Readable } from "node:stream";

// GET /api/players/:tg_id/avatar
function mimeFromFilePath(filePath = "") {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg"; // safe default для Telegram photo
}

app.get("/api/players/:tg_id/avatar", async (req, res) => {
  const tgId = Number(req.params.tg_id);
  const r = await q(`SELECT avatar_file_id FROM players WHERE tg_id=$1`, [tgId]);
  const fileId = r.rows?.[0]?.avatar_file_id;

  console.log("[avatar]", { tgId, hasFileId: !!fileId });

  if (!fileId) return res.status(404).end();

  try {
    const file = await bot.api.getFile(fileId);
    const filePath = file?.file_path;
    if (!filePath) return res.status(502).end();

    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.log("[avatar] tg file fetch failed", resp.status);
      return res.status(502).end();
    }

    res.setHeader("Content-Type", mimeFromFilePath(filePath));
    res.setHeader("Cache-Control", "public, max-age=3600");

    const buf = Buffer.from(await resp.arrayBuffer());
    res.end(buf);
  } catch (e) {
    console.log("[avatar] getFile failed:", e?.description || e?.message || e);
    res.status(502).end();
  }
});


function getPublicBaseUrl(req) {
  const envBase = (process.env.PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  if (envBase) return envBase;

  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "")
    .split(",")[0]
    .trim();

  return `${proto}://${host}`;
}
 
function photoUrlForPlayerRow(p, baseUrl) {
  if (p.avatar_file_id) {
    const v = p.updated_at ? `?v=${encodeURIComponent(new Date(p.updated_at).getTime())}` : "";
    return `${baseUrl}/api/players/${p.tg_id}/avatar${v}`;
  }

  const u = (p.photo_url || "").trim();
  if (!u) return "";

  // если вдруг там относительная ссылка — тоже сделаем абсолютной
  if (u.startsWith("/")) return `${baseUrl}${u}`;
  return u;
}

function presentPlayer(p, baseUrl) {
  const out = { ...p };
  out.photo_url = photoUrlForPlayerRow(p, baseUrl);
  delete out.avatar_file_id;
  delete out.updated_at;
  return out;
}


/** ====== ADMIN: reminder ====== */
app.post("/api/admin/reminder/sendNow", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
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

/** ====== ADMIN: postgame discuss sendNow ====== */
app.post("/api/admin/games/:id/postgame/sendNow", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const gameId = Number(req.params.id);
  if (!Number.isFinite(gameId)) return res.status(400).json({ ok: false, reason: "bad_game_id" });

  const force = req.body?.force === true;

  const chatIdRaw = await getSetting("notify_chat_id", null);
  if (!chatIdRaw) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  const chat_id = Number(chatIdRaw);
  if (!Number.isFinite(chat_id)) return res.status(400).json({ ok: false, reason: "notify_chat_id_bad" });

  const gr = await q(`SELECT * FROM games WHERE id=$1`, [gameId]);
  const g = gr.rows?.[0];
  if (!g) return res.status(404).json({ ok: false, reason: "game_not_found" });
  if (g.status === "cancelled") return res.status(400).json({ ok: false, reason: "game_cancelled" });

  if (!force && g.postgame_message_id) {
    const s = await syncPostgameCounter(gameId);
    return res.json({ ok: true, already_sent: true, message_id: g.postgame_message_id, synced: s });
  }

  const r = await sendPostgameMessageForGame(g, chat_id);
  return res.json(r);
});


app.get("/api/admin/bot-messages", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  if (!isSuperAdmin(user.id)) {
    return res.status(403).json({ ok: false, reason: "not_super_admin" });
  }

  const chatIdRaw = await getSetting("notify_chat_id", null);
  if (!chatIdRaw) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  const chat_id = Number(chatIdRaw);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const includeDeleted = String(req.query.include_deleted || "0") === "1";
  const kind = String(req.query.kind || "").trim();

  const params = [chat_id];
  const where = [`chat_id=$1`];

  if (kind) {
    params.push(kind);
    where.push(`kind=$${params.length}`);
  }
  if (!includeDeleted) where.push(`deleted_at IS NULL`);

  params.push(limit + 1);
  params.push(offset);

  const r = await q(
    `SELECT id, chat_id, message_id, kind, text, created_at, checked_at, deleted_at, delete_reason, sent_by_tg_id
     FROM bot_messages
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  const hasMore = r.rows.length > limit;
  const messages = hasMore ? r.rows.slice(0, limit) : r.rows;

  res.json({ ok: true, messages, has_more: hasMore, next_offset: offset + messages.length });
});

app.post("/api/admin/bot-messages/send", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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

app.patch("/api/admin/games/:id/reminder", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const admin = await isAdminId(user.id);
  if (!admin) return res.status(403).json({ ok: false, reason: "not_admin" });

  const gameId = Number(req.params.id);
  if (!Number.isFinite(gameId)) return res.status(400).json({ ok: false, reason: "bad_game_id" });

  const b = req.body || {};

  const enabled = !!b.reminder_enabled;
  const pin = b.reminder_pin === undefined ? true : !!b.reminder_pin;

  // reminder_at можно прислать как ISO строку
  let reminderAt = null;
  if (b.reminder_at) {
    const d = new Date(String(b.reminder_at));
    if (!Number.isFinite(d.getTime())) {
      return res.status(400).json({ ok: false, reason: "bad_reminder_at" });
    }
    reminderAt = d.toISOString();
  }

  if (enabled && !reminderAt) {
    return res.status(400).json({ ok: false, reason: "reminder_at_required" });
  }

  // ВАЖНО: если ты меняешь время — можно сбросить sent_at, чтобы напоминание снова отправилось
  // (иначе ты включишь и поставишь время, но оно “уже отправлено” и не отправится)
  const resetSent = b.reset_sent === true;

  await q(
    `
    UPDATE games SET
      reminder_enabled=$2,
      reminder_at=$3,
      reminder_pin=$4,
      reminder_sent_at = CASE WHEN $5::bool THEN NULL ELSE reminder_sent_at END,
      reminder_message_id = CASE WHEN $5::bool THEN NULL ELSE reminder_message_id END,
      updated_at=NOW()
    WHERE id=$1
    `,
    [gameId, enabled, reminderAt, pin, resetSent]
  );

  const gr = await q(`SELECT * FROM games WHERE id=$1`, [gameId]);
  res.json({ ok: true, game: gr.rows?.[0] ?? null });
});

app.post("/api/internal/reminders/run", async (req, res) => {
  if (!checkInternalToken(req)) {
    return res.status(401).json({ ok: false, reason: "bad_token" });
  }

  let locked = false;

  try {
    const lockRes = await q(`SELECT pg_try_advisory_lock($1) AS got`, [777001]);
    locked = !!lockRes.rows?.[0]?.got;
    if (!locked) {
      return res.json({ ok: true, checked: 0, sent: 0, reason: "already_running" });
    }

    const chatIdRaw = await getSetting("notify_chat_id", null);
    if (!chatIdRaw) {
      return res.json({ ok: true, checked: 0, sent: 0, reason: "notify_chat_id_not_set" });
    }

    const chat_id = Number(chatIdRaw);
    if (!Number.isFinite(chat_id)) {
      return res.json({ ok: false, reason: "notify_chat_id_bad" });
    }

    const dueRes = await q(`
      SELECT
        r.id AS reminder_id,
        r.game_id,
        r.enabled,
        r.remind_at,
        r.pin,
        r.sent_at,
        r.message_id,
        r.attempts,
        r.last_error,
        g.starts_at,
        g.location,
        g.status
      FROM game_reminders r
      JOIN games g ON g.id = r.game_id
      WHERE g.status IS DISTINCT FROM 'cancelled'
        AND r.enabled = TRUE
        AND r.remind_at <= NOW()
        AND r.sent_at IS NULL
      ORDER BY r.remind_at ASC
      LIMIT 5
    `);


    const postDueRes = await q(`
      SELECT g.*
      FROM games g
      WHERE g.status IS DISTINCT FROM 'cancelled'
        AND g.starts_at IS NOT NULL
        AND g.postgame_message_id IS NULL
        AND (g.starts_at + interval '3 hours') <= NOW()
      ORDER BY g.starts_at ASC
      LIMIT 5
    `);
    
    const due = dueRes.rows || [];
    const checked = due.length;

    const postDue = postDueRes.rows || [];
    const postgame_checked = postDue.length;

    if (!checked && !postgame_checked) {
      return res.json({ ok: true, checked: 0, sent: 0, postgame_checked: 0, postgame_sent: 0 });
    }

    const botUsername = process.env.BOT_USERNAME || "HockeyLineupBot";
    let sentCount = 0;

    for (const row of due) {
      const when = formatWhenForGame(row.starts_at);

      const text = `🏒 Напоминание: отметься на игру!

📅 ${when}
📍 ${row.location || "—"}

Открыть мини-приложение для отметок:`;

      const deepLink = `https://t.me/${botUsername}?startapp=${encodeURIComponent(String(row.game_id))}`;
      const kb = new InlineKeyboard().url("Открыть мини-приложение", deepLink);

      let sent;
      try {
        sent = await bot.api.sendMessage(chat_id, text, {
          reply_markup: kb,
          disable_web_page_preview: true,
        });
      } catch (e) {
        const err = tgErrText?.(e) || String(e);
        console.log("[reminders] send failed:", err);

        await q(
          `UPDATE game_reminders
           SET attempts=attempts+1, last_error=$2, updated_at=NOW()
           WHERE id=$1`,
          [row.reminder_id, clip(err, 800)]
        );

        continue;
      }

      // логируем в bot_messages
      try {
        await logBotMessage({
          chat_id,
          message_id: sent.message_id,
          kind: "reminder",
          text,
          parse_mode: null,
          disable_web_page_preview: true,
          reply_markup: typeof replyMarkupToJson === "function" ? replyMarkupToJson(kb) : null,
          meta: { game_id: row.game_id, reminder_id: row.reminder_id, type: "scheduled_game_reminder" },
          sent_by_tg_id: null,
        });
      } catch {}

      // закрепляем при включённом флаге
      if (row.pin) {
        try {
          await bot.api.pinChatMessage(chat_id, sent.message_id, { disable_notification: true });
        } catch (e) {
          console.log("[reminders] pin failed:", tgErrText?.(e) || e);
        }
      }

      // помечаем как отправленное
      await q(
        `UPDATE game_reminders
         SET sent_at=NOW(), message_id=$2, attempts=attempts+1, last_error=NULL, updated_at=NOW()
         WHERE id=$1`,
        [row.reminder_id, sent.message_id]
      );

      sentCount += 1;
    }


    let postgame_sent = 0;
    const postgame_game_ids = [];

    for (const g of postDue) {
      // перестраховка
      if (g?.status === "cancelled") continue;
      if (g?.postgame_message_id) continue;

      try {
        const r = await sendPostgameMessageForGame(g, chat_id);
        if (r?.ok) {
          postgame_sent += 1;
          postgame_game_ids.push(g.id);
        }
      } catch (e) {
        console.log("[postgame] send failed:", tgErrText?.(e) || String(e));
      }
    }
    
    return res.json({
      ok: true,
      checked,
      sent: sentCount,
      reminder_ids: due.map((x) => x.reminder_id),

      postgame_checked,
      postgame_sent,
      postgame_game_ids,
    });
  } catch (e) {
    console.error("reminders.run failed:", e);
    return res.status(500).json({ ok: false, reason: "internal_error" });
  } finally {
    if (locked) {
      try {
        await q(`SELECT pg_advisory_unlock($1)`, [777001]);
      } catch {}
    }
  }
});
// app.post("/api/internal/reminders/run", async (req, res) => {
//   if (!checkInternalToken(req)) {
//     return res.status(401).json({ ok: false, reason: "bad_token" });
//   }

//   let locked = false;

//   try {
//     const lockRes = await q(`SELECT pg_try_advisory_lock($1) AS got`, [777001]);
//     locked = !!lockRes.rows?.[0]?.got;
//     if (!locked) {
//       return res.json({ ok: true, checked: 0, sent: 0, reason: "already_running" });
//     }

//     const chatIdRaw = await getSetting("notify_chat_id", null);
//     if (!chatIdRaw) {
//       return res.json({ ok: true, checked: 0, sent: 0, reason: "notify_chat_id_not_set" });
//     }

//     const chat_id = Number(chatIdRaw);
//     if (!Number.isFinite(chat_id)) {
//       return res.json({ ok: false, reason: "notify_chat_id_bad" });
//     }

//     const dueRes = await q(`
//       SELECT
//         r.id AS reminder_id,
//         r.game_id,
//         r.enabled,
//         r.remind_at,
//         r.pin,
//         r.sent_at,
//         r.message_id,
//         r.attempts,
//         r.last_error,
//         g.starts_at,
//         g.location,
//         g.status
//       FROM game_reminders r
//       JOIN games g ON g.id = r.game_id
//       WHERE g.status IS DISTINCT FROM 'cancelled'
//         AND r.enabled = TRUE
//         AND r.remind_at <= NOW()
//         AND r.sent_at IS NULL
//       ORDER BY r.remind_at ASC
//       LIMIT 5
//     `);

//     const due = dueRes.rows || [];
//     const checked = due.length;

//     if (!checked) {
//       return res.json({ ok: true, checked: 0, sent: 0 });
//     }

//     const botUsername = process.env.BOT_USERNAME || "HockeyLineupBot";
//     let sentCount = 0;

//     for (const row of due) {
//       const when = formatWhenForGame(row.starts_at);

//       const text = `🏒 Напоминание: отметься на игру!

// 📅 ${when}
// 📍 ${row.location || "—"}

// Открыть мини-приложение для отметок:`;

//       const deepLink = `https://t.me/${botUsername}?startapp=${encodeURIComponent(String(row.game_id))}`;
//       const kb = new InlineKeyboard().url("Открыть мини-приложение", deepLink);

//       let sent;
//       try {
//         sent = await bot.api.sendMessage(chat_id, text, {
//           reply_markup: kb,
//           disable_web_page_preview: true,
//         });
//       } catch (e) {
//         const err = tgErrText?.(e) || String(e);
//         console.log("[reminders] send failed:", err);

//         await q(
//           `UPDATE game_reminders
//            SET attempts=attempts+1, last_error=$2, updated_at=NOW()
//            WHERE id=$1`,
//           [row.reminder_id, clip(err, 800)]
//         );

//         continue;
//       }

//       // логируем в bot_messages
//       try {
//         await logBotMessage({
//           chat_id,
//           message_id: sent.message_id,
//           kind: "reminder",
//           text,
//           parse_mode: null,
//           disable_web_page_preview: true,
//           reply_markup: typeof replyMarkupToJson === "function" ? replyMarkupToJson(kb) : null,
//           meta: { game_id: row.game_id, reminder_id: row.reminder_id, type: "scheduled_game_reminder" },
//           sent_by_tg_id: null,
//         });
//       } catch {}

//       // закрепляем при включённом флаге
//       if (row.pin) {
//         try {
//           await bot.api.pinChatMessage(chat_id, sent.message_id, { disable_notification: true });
//         } catch (e) {
//           console.log("[reminders] pin failed:", tgErrText?.(e) || e);
//         }
//       }

//       // помечаем как отправленное
//       await q(
//         `UPDATE game_reminders
//          SET sent_at=NOW(), message_id=$2, attempts=attempts+1, last_error=NULL, updated_at=NOW()
//          WHERE id=$1`,
//         [row.reminder_id, sent.message_id]
//       );

//       sentCount += 1;
//     }

//     return res.json({
//       ok: true,
//       checked,
//       sent: sentCount,
//       reminder_ids: due.map((x) => x.reminder_id),
//     });
//   } catch (e) {
//     console.error("reminders.run failed:", e);
//     return res.status(500).json({ ok: false, reason: "internal_error" });
//   } finally {
//     if (locked) {
//       try {
//         await q(`SELECT pg_advisory_unlock($1)`, [777001]);
//       } catch {}
//     }
//   }
// });


app.post("/api/internal/postgame/send", async (req, res) => {
  if (!checkInternalToken(req)) {
    return res.status(401).json({ ok: false, reason: "bad_token" });
  }

  const gameId = Number(req.query.game_id || req.body?.game_id);
  if (!Number.isFinite(gameId)) return res.status(400).json({ ok: false, reason: "bad_game_id" });

  const chatIdRaw = await getSetting("notify_chat_id", null);
  if (!chatIdRaw) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  const chat_id = Number(chatIdRaw);
  if (!Number.isFinite(chat_id)) return res.status(400).json({ ok: false, reason: "notify_chat_id_bad" });

  const gr = await q(`SELECT * FROM games WHERE id=$1`, [gameId]);
  const g = gr.rows?.[0];
  if (!g) return res.status(404).json({ ok: false, reason: "game_not_found" });

  const force = String(req.query.force || "") === "1" || req.body?.force === true;

  if (!force && g.postgame_message_id) {
    const s = await syncPostgameCounter(gameId);
    return res.json({ ok: true, already_sent: true, message_id: g.postgame_message_id, synced: s });
  }

  const r = await sendPostgameMessageForGame(g, chat_id);
  return res.json(r);
});


app.post("/api/internal/postgame/run", async (req, res) => {
  if (!checkInternalToken(req)) {
    return res.status(401).json({ ok: false, reason: "bad_token" });
  }

  let locked = false;
  try {
    const lockRes = await q(`SELECT pg_try_advisory_lock($1) AS got`, [777002]);
    locked = !!lockRes.rows?.[0]?.got;
    if (!locked) return res.json({ ok: true, checked: 0, sent: 0, reason: "already_running" });

    const chatIdRaw = await getSetting("notify_chat_id", null);
    if (!chatIdRaw) return res.json({ ok: true, checked: 0, sent: 0, reason: "notify_chat_id_not_set" });

    const chat_id = Number(chatIdRaw);
    if (!Number.isFinite(chat_id)) return res.json({ ok: false, reason: "notify_chat_id_bad" });

    const dueRes = await q(`
      SELECT *
      FROM games
      WHERE status IS DISTINCT FROM 'cancelled'
        AND starts_at <= NOW() - INTERVAL '2 hours'
        AND postgame_sent_at IS NULL
        AND starts_at >= NOW() - INTERVAL '14 days'
      ORDER BY starts_at DESC
      LIMIT 5
    `);

    const due = dueRes.rows || [];
    let sent = 0;
    const sent_ids = [];

    for (const g of due) {
      const r = await sendPostgameMessageForGame(g, chat_id);
      if (r.ok) { sent += 1; sent_ids.push(g.id); }
    }

    return res.json({ ok: true, checked: due.length, sent, due_ids: due.map(x => x.id), sent_ids });
  } catch (e) {
    console.error("postgame.run failed:", e);
    return res.status(500).json({ ok: false, reason: "internal_error" });
  } finally {
    if (locked) {
      try { await q(`SELECT pg_advisory_unlock($1)`, [777002]); } catch {}
    }
  }
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
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const status = String(req.body?.status || "").trim();
  if (!["yes", "no", "maybe"].includes(status)) {
    return res.status(400).json({ ok: false, reason: "bad_status" });
  }

  await ensurePlayer(user);

  if (status === "maybe") {
    const rr = await q(
      `DELETE FROM rsvps
       WHERE tg_id=$1 AND game_id IN (
         SELECT id FROM games WHERE status='scheduled' AND starts_at >= NOW()
       )
       RETURNING game_id`,
      [user.id]
    );

    for (const row of rr.rows || []) {
      await syncTeamsAfterRsvpChange(row.game_id, user.id);
    }

    return res.json({ ok: true });
  }

  const rr = await q(
    `INSERT INTO rsvps(game_id, tg_id, status)
     SELECT g.id, $1, $2
     FROM games g
     WHERE g.status='scheduled' AND g.starts_at >= NOW()
     ON CONFLICT(game_id, tg_id)
     DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()
     RETURNING game_id`,
    [user.id, status]
  );

  for (const row of rr.rows || []) {
    await syncTeamsAfterRsvpChange(row.game_id, user.id);
  }

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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const tg_id = Number(req.params.tg_id);
  if (!tg_id) return res.status(400).json({ ok: false, reason: "bad_tg_id" });

  const pr = await q(`SELECT tg_id, player_kind FROM players WHERE tg_id=$1`, [tg_id]);
  const player = pr.rows?.[0];
  if (!player) return res.status(404).json({ ok: false, reason: "not_found" });
  if (String(player.player_kind || "").toLowerCase() !== "guest") {
    return res.status(400).json({ ok: false, reason: "not_guest" });
  }

  const emailRaw = req.body?.email;
  const emailProvided = emailRaw !== undefined && emailRaw !== null && String(emailRaw).trim() !== "";
  const email = emailProvided ? normalizeEmail(emailRaw) : null;

  if (emailProvided && (!email || !email.includes("@"))) {
    return res.status(400).json({ ok: false, reason: "bad_email" });
  }

  if (email) {
    const existing = await q(`SELECT tg_id FROM players WHERE LOWER(email)=LOWER($1)`, [email]);
    if (existing.rows?.[0] && Number(existing.rows[0].tg_id) !== Number(tg_id)) {
      return res.status(400).json({ ok: false, reason: "email_in_use" });
    }
  }

  const upd = await q(
    `UPDATE players
        SET player_kind='manual',
            is_guest=FALSE,
            email=CASE WHEN $2::boolean THEN $3 ELSE email END,
            email_verified=CASE WHEN $2::boolean THEN FALSE ELSE email_verified END,
            email_verified_at=CASE WHEN $2::boolean THEN NULL ELSE email_verified_at END,
            updated_at=NOW()
      WHERE tg_id=$1
      RETURNING *`,
    [tg_id, emailProvided, email]
  );

  res.json({ ok: true, player: upd.rows?.[0] || null });
});

app.post("/api/admin/teams/send", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
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

    const prevTeamsMsgR = await q(
      `SELECT id, chat_id, message_id, text
       FROM bot_messages
       WHERE kind='teams'
         AND deleted_at IS NULL
         AND chat_id=$1
         AND COALESCE(meta->>'game_id', '') = $2
       ORDER BY id DESC
       LIMIT 1`,
      [chatId, String(game_id)]
    );
    const prevTeamsMsg = prevTeamsMsgR.rows?.[0] || null;

    const header =
      `<b>🏒 Составы на игру</b>\n` +
      `⏱ <code>${escapeHtml(when)}</code>\n` +
      `📍 <b>${escapeHtml(row.location || "—")}</b>` +
      (prevTeamsMsg ? `\n\n<b>⚠️ После первого формирования составы были изменены, будь внимателен.</b>` : "") +
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
    
    // 6) если уже отправляли составы на эту игру — редактируем прежнее сообщение
    if (prevTeamsMsg) {
      try {
        await bot.api.editMessageText(Number(prevTeamsMsg.chat_id), Number(prevTeamsMsg.message_id), body, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: kb,
        });

        await q(
          `UPDATE bot_messages
           SET text=$2,
               parse_mode='HTML',
               disable_web_page_preview=TRUE,
               reply_markup=$3::jsonb,
               meta=$4::jsonb,
               sent_by_tg_id=$5,
               checked_at=NOW()
           WHERE id=$1`,
          [
            prevTeamsMsg.id,
            body,
            JSON.stringify(replyMarkupToJson(kb)),
            JSON.stringify({ game_id, stale, removed, added, updated: true }),
            user.id,
          ]
        );

        return res.json({ ok: true, message_id: Number(prevTeamsMsg.message_id), stale, removed, added, edited: true });
      } catch (eEdit) {
        // сообщение могли удалить руками в Telegram — тогда просто шлём новое ниже
        if (tgMessageMissing(eEdit)) {
          await q(
            `UPDATE bot_messages
             SET deleted_at=NOW(), delete_reason='missing_in_chat', checked_at=NOW()
             WHERE id=$1`,
            [prevTeamsMsg.id]
          );
        } else if (!tgMessageExistsButNotEditable(eEdit)) {
          throw eEdit;
        }
      }
    }

    // 7) отправляем новое сообщение (первый пост или старое удалено вручную)
    const sent = await bot.api.sendMessage(chatId, body, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: kb,
    });

    // 8) пишем в историю
    await q(
      `INSERT INTO bot_messages(chat_id, message_id, kind, text, parse_mode, disable_web_page_preview, reply_markup, meta, sent_by_tg_id)
       VALUES($1,$2,'teams',$3,'HTML',TRUE,$4::jsonb,$5::jsonb,$6)`,
      [chatId, sent.message_id, body, JSON.stringify(replyMarkupToJson(kb)), JSON.stringify({ game_id, stale, removed, added }), user.id]
    );

    return res.json({ ok: true, message_id: sent.message_id, stale, removed, added, edited: false });
  } catch (e) {
    console.error("teams/send failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

// POST /api/admin/games/video/send
app.post("/api/admin/games/video/send", async (req, res) => {
  const silent = !!req.body?.silent;
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const admin = await requireAdminAsync(req, res, user);
  if (!admin) return;

  const game_id = Number(req.body?.game_id);
  if (!Number.isFinite(game_id) || game_id <= 0) {
    return res.status(400).json({ ok: false, reason: "bad_game_id" });
  }

  // командный чат
  const chatIdRaw = await getSetting("notify_chat_id", null);
  const chatId = chatIdRaw ? Number(String(chatIdRaw).trim()) : null;
  if (!Number.isFinite(chatId)) {
    return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });
  }

  // игра
  const gr = await q(`SELECT id, starts_at, location, video_url FROM games WHERE id=$1 LIMIT 1`, [game_id]);
  const g = gr.rows?.[0];
  if (!g) return res.status(404).json({ ok: false, reason: "game_not_found" });

  // видео берём либо из body (если админ ещё не сохранил), либо из БД
  const videoUrl = String(req.body?.video_url || g.video_url || "").trim();
  if (!videoUrl) return res.status(400).json({ ok: false, reason: "video_url_empty" });

  // кол-во комментариев
  const cr = await q(`SELECT COUNT(*)::int AS cnt FROM game_comments WHERE game_id=$1`, [game_id]);
  const cnt = Number(cr.rows?.[0]?.cnt ?? 0);

  // username бота (лучше брать из getMe, чтобы не зависеть от env)
  let botUsername = String(process.env.BOT_USERNAME || "").trim();
  if (!botUsername) {
    try {
      const meBot = await bot.api.getMe();
      botUsername = meBot.username || "";
    } catch {}
  }

  const appLink = botUsername
    ? `https://t.me/${botUsername}?startapp=${encodeURIComponent(`game_${game_id}`)}`
    : null;

  const discussLink = botUsername
    ? `https://t.me/${botUsername}?startapp=${encodeURIComponent(`game_${game_id}_comments`)}`
    : null;

  const when = formatWhenForGame(g.starts_at);

  const text =
    `<b>🎬 Добавлено видео к игре</b>\n` +
    `📅 <code>${escapeHtml(when)}</code>\n` +
    `📍 <b>${escapeHtml(g.location || "—")}</b>\n\n` +
    `Ссылка на видео:\n<pre><code>${escapeHtml(videoUrl)}</code></pre>`;


    const kb = new InlineKeyboard();

    // Если твоя версия grammY поддерживает copyText — будет прям кнопка копирования
    if (typeof kb.copyText === "function") {
      kb.copyText("📋 Скопировать ссылку", videoUrl).row();
    }

    kb.url("▶️ Смотреть игру", videoUrl);

    if (discussLink) {
      kb.url(cnt > 0 ? `💬 Обсудить (${cnt})` : "💬 Обсудить", discussLink);
    } else if (appLink) {
      kb.url("🏒 Открыть игру", appLink);
    }

  const sent = await bot.api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: silent,
    reply_markup: kb,
  });

  try {
    await logBotMessage({
      chat_id: chatId,
      message_id: sent.message_id,
      kind: "video",
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: typeof replyMarkupToJson === "function" ? replyMarkupToJson(kb) : null,
      meta: { game_id, video_url: videoUrl, comments_count: cnt },
      sent_by_tg_id: user.id,
    });
  } catch {}

  return res.json({ ok: true, message_id: sent.message_id });
});

// POST /api/admin/announce/bot-profile
app.post("/api/admin/announce/bot-profile", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  // ВАЖНО: чтобы другие админы не могли — делаем DEV-only
  const devIds = (process.env.DEV_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!devIds.includes(String(user.id))) {
    return res.status(403).json({ ok: false, reason: "not_dev" });
  }

  const r = await q(`SELECT value FROM settings WHERE key='notify_chat_id' LIMIT 1`);
  const chatIdStr = r.rows?.[0]?.value;
  if (!chatIdStr) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  const chat_id = Number(chatIdStr);
  if (!Number.isFinite(chat_id)) return res.status(400).json({ ok: false, reason: "bad_chat_id" });

  // username бота
  const me = await bot.api.getMe();
  const botUsername = me.username;

  const text =
    `🔥 Обновление!\n\n` +
    `Теперь профиль можно менять через бота:\n` +
    `• 📸 установить/удалить аватар\n` +
    `• ✏️ изменить отображаемое имя\n\n` +
    `Нажми кнопку ниже и нажми Start 👇`;

  const botLink = `https://t.me/${botUsername}?start=profile`;
  const appLink = `https://t.me/${botUsername}?startapp=home`;

  const kb = new InlineKeyboard()
    .url("👤 Открыть бота (Start)", botLink)
    .row()
    .url("🏒 Открыть мини-приложение", appLink);

  try {
    await bot.api.sendMessage(chat_id, text, { reply_markup: kb, disable_web_page_preview: true });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(400).json({ ok: false, reason: "send_failed", details: e?.description || String(e) });
  }
});

/** ====== ADMIN: game reminders (list CRUD) ====== */
app.get("/api/admin/games/:id/reminders", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const admin = await isAdminId(user.id);
  if (!admin) return res.status(403).json({ ok: false, reason: "not_admin" });

  const gameId = Number(req.params.id);
  if (!Number.isFinite(gameId)) return res.status(400).json({ ok: false, reason: "bad_game_id" });

  const r = await q(
    `SELECT id, game_id, enabled, remind_at, pin, sent_at, message_id, attempts, last_error, created_at, updated_at
     FROM game_reminders
     WHERE game_id=$1
     ORDER BY remind_at ASC`,
    [gameId]
  );

  res.json({ ok: true, reminders: r.rows || [] });
});

app.post("/api/admin/games/:id/reminders", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const admin = await isAdminId(user.id);
  if (!admin) return res.status(403).json({ ok: false, reason: "not_admin" });

  const gameId = Number(req.params.id);
  if (!Number.isFinite(gameId)) return res.status(400).json({ ok: false, reason: "bad_game_id" });

  const b = req.body || {};
  const enabled = b.enabled === undefined ? true : !!b.enabled;
  const pin = b.pin === undefined ? true : !!b.pin;

  if (!b.remind_at) return res.status(400).json({ ok: false, reason: "remind_at_required" });

  const d = new Date(String(b.remind_at));
  if (!Number.isFinite(d.getTime())) return res.status(400).json({ ok: false, reason: "bad_remind_at" });

  const remindAt = d.toISOString();

  // если включили — remind_at обязателен (и у нас он всегда есть)
  const ins = await q(
    `INSERT INTO game_reminders (game_id, enabled, remind_at, pin, created_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     RETURNING id, game_id, enabled, remind_at, pin, sent_at, message_id, attempts, last_error, created_at, updated_at`,
    [gameId, enabled, remindAt, pin, user.id]
  );

  res.json({ ok: true, reminder: ins.rows?.[0] ?? null });
});

app.patch("/api/admin/reminders/:rid", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const admin = await isAdminId(user.id);
  if (!admin) return res.status(403).json({ ok: false, reason: "not_admin" });

  const rid = Number(req.params.rid);
  if (!Number.isFinite(rid)) return res.status(400).json({ ok: false, reason: "bad_reminder_id" });

  const curR = await q(
    `SELECT id, enabled, remind_at, pin, sent_at
     FROM game_reminders
     WHERE id=$1`,
    [rid]
  );
  const cur = curR.rows?.[0];
  if (!cur) return res.status(404).json({ ok: false, reason: "reminder_not_found" });

  const b = req.body || {};

  // вычисляем "следующее" состояние для валидации enabled+remind_at
  const nextEnabled = b.enabled === undefined ? !!cur.enabled : !!b.enabled;

  let nextRemindAt = cur.remind_at;
  if ("remind_at" in b) {
    if (!b.remind_at) nextRemindAt = null;
    else {
      const d = new Date(String(b.remind_at));
      if (!Number.isFinite(d.getTime())) return res.status(400).json({ ok: false, reason: "bad_remind_at" });
      nextRemindAt = d.toISOString();
    }
  }

  if (nextEnabled && !nextRemindAt) {
    return res.status(400).json({ ok: false, reason: "remind_at_required" });
  }

  const resetSent = b.reset_sent === true;

  const sets = [];
  const params = [rid];

  const add = (col, val) => {
    params.push(val);
    sets.push(`${col}=$${params.length}`);
  };

  if (b.enabled !== undefined) add("enabled", !!b.enabled);
  if (b.pin !== undefined) add("pin", !!b.pin);
  if ("remind_at" in b) add("remind_at", nextRemindAt);

  if (resetSent) {
    sets.push(`sent_at=NULL`);
    sets.push(`message_id=NULL`);
    sets.push(`last_error=NULL`);
  }

  sets.push(`updated_at=NOW()`);

  if (!sets.length) return res.json({ ok: true, reminder: cur });

  const upd = await q(
    `UPDATE game_reminders
     SET ${sets.join(", ")}
     WHERE id=$1
     RETURNING id, game_id, enabled, remind_at, pin, sent_at, message_id, attempts, last_error, created_at, updated_at`,
    params
  );

  res.json({ ok: true, reminder: upd.rows?.[0] ?? null });
});

app.delete("/api/admin/reminders/:rid", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const admin = await isAdminId(user.id);
  if (!admin) return res.status(403).json({ ok: false, reason: "not_admin" });

  const rid = Number(req.params.rid);
  if (!Number.isFinite(rid)) return res.status(400).json({ ok: false, reason: "bad_reminder_id" });

  await q(`DELETE FROM game_reminders WHERE id=$1`, [rid]);
  res.json({ ok: true });
});

/** ====== ADMIN: SET GAME REMINDER ====== */
app.patch("/api/admin/games/reminder", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const admin = await isAdminId(user.id);
  if (!admin) return res.status(403).json({ ok: false, reason: "not_admin" });

  const game_id = Number(req.body?.game_id);
  if (!Number.isFinite(game_id)) return res.status(400).json({ ok: false, reason: "bad_game_id" });

  const remind_enabled = !!req.body?.remind_enabled;

  // ожидаем ISO строку или null/пусто
  const remind_at_raw = req.body?.remind_at;
  let remind_at = null;

  if (remind_at_raw) {
    const d = new Date(String(remind_at_raw));
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ ok: false, reason: "bad_remind_at" });
    }
    remind_at = d.toISOString(); // нормализуем
  }

  // если включили, но время не задано — ошибка
  if (remind_enabled && !remind_at) {
    return res.status(400).json({ ok: false, reason: "remind_at_required" });
  }

  await q(
    `UPDATE games SET
      remind_enabled=$2,
      remind_at=$3,
      remind_sent_at=NULL,
      remind_last_error=NULL,
      updated_at=NOW()
     WHERE id=$1`,
    [game_id, remind_enabled, remind_at]
  );

  const gr = await q(`SELECT * FROM games WHERE id=$1`, [game_id]);
  const game = gr.rows?.[0] ?? null;

  res.json({ ok: true, game });
});

app.get("/api/admin/games/auto-schedule", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const cfg = await getAutoScheduleConfig();
  const upcomingR = await q(`SELECT COUNT(*)::int AS cnt FROM games WHERE status='scheduled' AND starts_at >= NOW()`);
  res.json({ ok: true, cfg, upcoming_count: Number(upcomingR.rows?.[0]?.cnt || 0) });
});

app.patch("/api/admin/games/auto-schedule", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const cur = await getAutoScheduleConfig();
  const b = req.body || {};
  const next = {
    ...cur,
    ...(b.enabled !== undefined ? { enabled: !!b.enabled } : {}),
    ...(b.target_count !== undefined ? { target_count: Number(b.target_count) } : {}),
    ...(b.weekday !== undefined ? { weekday: Number(b.weekday) } : {}),
    ...(b.time !== undefined ? { time: String(b.time || "") } : {}),
    ...(b.location !== undefined ? { location: String(b.location || "") } : {}),
    ...(Object.prototype.hasOwnProperty.call(b, "geo_lat") ? { geo_lat: b.geo_lat === "" ? null : b.geo_lat } : {}),
    ...(Object.prototype.hasOwnProperty.call(b, "geo_lon") ? { geo_lon: b.geo_lon === "" ? null : b.geo_lon } : {}),
  };

  if (!Number.isFinite(next.target_count) || next.target_count < 1 || next.target_count > 60) {
    return res.status(400).json({ ok: false, reason: "bad_target_count" });
  }
  if (!Number.isFinite(next.weekday) || next.weekday < 0 || next.weekday > 6) {
    return res.status(400).json({ ok: false, reason: "bad_weekday" });
  }
  if (!/^\d{2}:\d{2}$/.test(String(next.time || ""))) {
    return res.status(400).json({ ok: false, reason: "bad_time" });
  }
  const [hh, mm] = String(next.time).split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return res.status(400).json({ ok: false, reason: "bad_time" });
  }

  const lat = next.geo_lat === null ? null : Number(next.geo_lat);
  const lon = next.geo_lon === null ? null : Number(next.geo_lon);
  if ((lat === null) !== (lon === null)) return res.status(400).json({ ok: false, reason: "bad_geo_pair" });
  if ((lat !== null && !Number.isFinite(lat)) || (lon !== null && !Number.isFinite(lon))) {
    return res.status(400).json({ ok: false, reason: "bad_geo" });
  }

  const cfg = {
    enabled: !!next.enabled,
    target_count: Math.round(next.target_count),
    weekday: Math.round(next.weekday),
    time: String(next.time),
    location: String(next.location || "").trim(),
    geo_lat: lat,
    geo_lon: lon,
  };

  await setSetting("auto_schedule_config", JSON.stringify(cfg));
  const ensure = await ensureAutoScheduledGames();
  res.json({ ok: true, cfg, ensure });
});

app.post("/api/admin/games/auto-schedule/ensure", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const force = req.body?.force === true || String(req.query?.force || "") === "1";
  const result = await ensureAutoScheduledGames({ ignoreEnabled: force });
  res.json(result);
});

app.post("/api/internal/auto-schedule/tick", async (req, res) => {
  if (!checkInternalToken(req)) {
    return res.status(403).json({ ok: false, reason: "forbidden" });
  }
  const dryRun = String(req.query?.dry_run || "") === "1";
  const result = await ensureAutoScheduledGames({ dryRun });
  res.json(result);
});


app.post("/api/best-player/vote", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
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
  const user = req.webappUser || requireWebAppAuth(req, res);
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


/* ------- comments ------------------ */
app.get("/api/game-comments", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) {
      if (!(await requireGroupMember(req, res, user))) return;
    }

    const gameId = req.query.game_id ? Number(req.query.game_id) : null;
    if (!Number.isFinite(gameId)) return res.status(400).json({ ok: false, reason: "bad_game_id" });

    const baseUrl = getPublicBaseUrl(req);
    const comments = await loadGameComments(gameId, user.id, baseUrl);
    return res.json({ ok: true, comments });
  } catch (e) {
    console.error("GET /api/game-comments failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});



app.post("/api/game-comments", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const is_admin = await isAdminId(user.id);
  if (!is_admin) {
    if (!(await requireGroupMember(req, res, user))) return;
  }

  const gameId = Number(req.body?.game_id);
  const text = String(req.body?.body ?? "").replace(/\r\n/g, "\n").trim();
  const replyToCommentId = req.body?.reply_to_comment_id == null ? null : Number(req.body?.reply_to_comment_id);
  const mentionIdsRaw = Array.isArray(req.body?.mention_ids) ? req.body.mention_ids : [];
  const mentionIds = Array.from(new Set(mentionIdsRaw.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0))).slice(0, 10);

  if (!Number.isFinite(gameId)) return res.status(400).json({ ok: false, reason: "bad_game_id" });
  if (!text) return res.status(400).json({ ok: false, reason: "empty_body" });
  if (text.length > 800) return res.status(400).json({ ok: false, reason: "too_long" });
  if (mentionIdsRaw.length > 10) return res.status(400).json({ ok: false, reason: "too_many_mentions" });
  if (replyToCommentId != null && !Number.isFinite(replyToCommentId)) {
    return res.status(400).json({ ok: false, reason: "bad_reply_to_comment_id" });
  }

  let replyRow = null;
  if (replyToCommentId != null) {
    const rr = await q(`SELECT id, game_id, author_tg_id, body FROM game_comments WHERE id=$1`, [replyToCommentId]);
    replyRow = rr.rows?.[0] || null;
    if (!replyRow || Number(replyRow.game_id) !== gameId) {
      return res.status(400).json({ ok: false, reason: "reply_must_be_same_game" });
    }
  }

  const ins = await q(
    `INSERT INTO game_comments(game_id, author_tg_id, reply_to_comment_id, body)
     VALUES($1,$2,$3,$4)
     RETURNING id`,
    [gameId, user.id, replyToCommentId, text]
  );
  const createdCommentId = ins.rows?.[0]?.id;

  if (mentionIds.length && createdCommentId) {
    await q(
      `INSERT INTO comment_mentions(comment_id, mentioned_player_id)
       SELECT $1, x::bigint FROM unnest($2::bigint[]) x
       ON CONFLICT (comment_id, mentioned_player_id) DO NOTHING`,
      [createdCommentId, mentionIds]
    );
  }

  await notifyCommentCreated({
    gameId,
    commentId: createdCommentId,
    text,
    authorTgId: user.id,
    mentionIds,
    replyToComment: replyRow,
  }).catch((e) => console.error("notifyCommentCreated failed:", e));

  const baseUrl = getPublicBaseUrl(req);
  const comments = await loadGameComments(gameId, user.id, baseUrl);
  schedulePostgameCounterSync(gameId);
  scheduleDiscussSync(gameId);

  res.json({ ok: true, comments });
});

app.patch("/api/game-comments/:id", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) {
      if (!(await requireGroupMember(req, res, user))) return;
    }

    const id = Number(req.params.id);
    const text = String(req.body?.body ?? "").replace(/\r\n/g, "\n").trim();

    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });
    if (!text) return res.status(400).json({ ok: false, reason: "empty_body" });
    if (text.length > 800) return res.status(400).json({ ok: false, reason: "too_long" });

    const cr = await q(`SELECT game_id, author_tg_id FROM game_comments WHERE id=$1`, [id]);
    const row = cr.rows[0];
    if (!row) return res.status(404).json({ ok: false, reason: "not_found" });

    if (!is_admin && String(row.author_tg_id) !== String(user.id)) {
      return res.status(403).json({ ok: false, reason: "not_owner" });
    }

    await q(`UPDATE game_comments SET body=$1, updated_at=NOW() WHERE id=$2`, [text, id]);

    const gameId = Number(row.game_id);              // ✅ ВАЖНО
    const baseUrl = getPublicBaseUrl(req);
    const comments = await loadGameComments(gameId, user.id, baseUrl);
    return res.json({ ok: true, comments });
  } catch (e) {
    console.error("PATCH /api/game-comments/:id failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});



app.delete("/api/game-comments/:id", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) {
      if (!(await requireGroupMember(req, res, user))) return;
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const cr = await q(`SELECT game_id, author_tg_id FROM game_comments WHERE id=$1`, [id]);
    const row = cr.rows[0];
    if (!row) return res.json({ ok: true, comments: [] });

    if (!is_admin && String(row.author_tg_id) !== String(user.id)) {
      return res.status(403).json({ ok: false, reason: "not_owner" });
    }

    const gameId = Number(row.game_id);              // ✅ ВАЖНО

    await q(`DELETE FROM game_comments WHERE id=$1`, [id]);

    schedulePostgameCounterSync(gameId);
    scheduleDiscussSync(gameId);

    const baseUrl = getPublicBaseUrl(req);
    const comments = await loadGameComments(gameId, user.id, baseUrl);
    return res.json({ ok: true, comments });
  } catch (e) {
    console.error("DELETE /api/game-comments/:id failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});



app.post("/api/game-comments/:id/react", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const is_admin = await isAdminId(user.id);
  if (!is_admin) {
    if (!(await requireGroupMember(req, res, user))) return;
  }

  const id = Number(req.params.id);
  const emoji = String(req.body?.emoji ?? "").trim();
  const on = !!req.body?.on;

  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });
  if (!ALLOWED_REACTIONS.has(emoji)) return res.status(400).json({ ok: false, reason: "bad_reaction" });

  const cr = await q(`SELECT game_id FROM game_comments WHERE id=$1`, [id]);
  const row = cr.rows[0];
  if (!row) return res.status(404).json({ ok: false, reason: "not_found" });

  const gameId = Number(row.game_id); // ✅ ВОТ ЭТОГО НЕ ХВАТАЛО

  if (on) {
    await q(
      `INSERT INTO game_comment_reactions(comment_id, user_tg_id, reaction)
       VALUES($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [id, user.id, emoji]
    );
  } else {
    await q(
      `DELETE FROM game_comment_reactions
       WHERE comment_id=$1 AND user_tg_id=$2 AND reaction=$3`,
      [id, user.id, emoji]
    );
  }

  // ✅ ВОЗВРАЩАЕМ ОБНОВЛЕННЫЕ КОММЕНТЫ
  // если loadGameComments у тебя 2 аргумента — оставь так:
  // const comments = await loadGameComments(gameId, user.id);


  const baseUrl = getPublicBaseUrl(req);
  const comments = await loadGameComments(gameId, user.id, baseUrl);

  return res.json({ ok: true, comments });
});


app.post("/api/game-comments/:id/pin", async (req, res) => {
  const user = req.webappUser || requireWebAppAuth(req, res);
  if (!user) return;

  const is_admin = await isAdminId(user.id);
  if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

  const id = Number(req.params.id);
  const on = !!req.body?.on;
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

  const cr = await q(`SELECT game_id FROM game_comments WHERE id=$1`, [id]);
  const row = cr.rows[0];
  if (!row) return res.status(404).json({ ok: false, reason: "not_found" });

  const gameId = Number(row.game_id);

  if (on) {
    await q(
      `UPDATE games
       SET pinned_comment_id=$1
       WHERE id=$2
         AND EXISTS (SELECT 1 FROM game_comments WHERE id=$1 AND game_id=$2)`,
      [id, gameId]
    );
  } else {
    await q(
      `UPDATE games
       SET pinned_comment_id=NULL
       WHERE id=$1 AND pinned_comment_id=$2`,
      [gameId, id]
    );
  }

 const baseUrl = getPublicBaseUrl(req);
  const comments = await loadGameComments(gameId, user.id, baseUrl);
  return res.json({ ok: true, comments });
});

app.get("/api/game-comments/:id/reactors", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) {
      if (!(await requireGroupMember(req, res, user))) return;
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const cr = await q(`SELECT game_id FROM game_comments WHERE id=$1`, [id]);
    const row = cr.rows[0];
    if (!row) return res.status(404).json({ ok: false, reason: "not_found" });

    // ✅ премиум из players
    const pr = await q(
      `SELECT
        (joke_premium = TRUE OR (joke_premium_until IS NOT NULL AND joke_premium_until > NOW())) AS premium
      FROM players
      WHERE tg_id=$1`,
      [user.id]
    );
    const premium = pr.rows[0]?.premium === true;

    // ✅ правило: видеть список могут админы ИЛИ premium
    const can_view = is_admin || premium;

    if (!can_view) {
      return res.json({ ok: true, can_view: false, reactors: [] });
    }

    const baseUrl = getPublicBaseUrl(req);

    const rr = await q(
      `
      SELECT
        u.user_tg_id AS tg_id,
        array_agg(u.reaction ORDER BY u.reaction) AS emojis,

        p.tg_id           AS p_tg_id,
        p.display_name    AS p_display_name,
        p.first_name      AS p_first_name,
        p.username        AS p_username,
        p.photo_url       AS p_photo_url,
        p.avatar_file_id  AS p_avatar_file_id,
        p.updated_at      AS p_updated_at

      FROM (
        SELECT DISTINCT user_tg_id, reaction
        FROM game_comment_reactions
        WHERE comment_id = $1
      ) u
      LEFT JOIN players p ON p.tg_id = u.user_tg_id
      GROUP BY
        u.user_tg_id,
        p.tg_id, p.display_name, p.first_name, p.username, p.photo_url, p.avatar_file_id, p.updated_at
      ORDER BY COALESCE(p.display_name, p.first_name, p.username, u.user_tg_id::text) ASC
      `,
      [id]
    );

    const reactors = (rr.rows || []).map((x) => {
      const rawPlayer = {
        tg_id: x.p_tg_id ?? x.tg_id,
        display_name: x.p_display_name || "",
        first_name: x.p_first_name || "",
        username: x.p_username || "",
        photo_url: x.p_photo_url || "",
        avatar_file_id: x.p_avatar_file_id || null,
        updated_at: x.p_updated_at || null,
      };

      return {
        user: presentPlayer(rawPlayer, baseUrl),
        emojis: x.emojis || [],
      };
    });

    return res.json({ ok: true, can_view: true, reactors });
  } catch (e) {
    console.error("GET /api/game-comments/:id/reactors failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});


// ===================== JERSEY: batches + export (BACK AS BEFORE) =====================

function ruJoin(colors, kind) {
  const mapJ = { white: "Белый", blue: "Синий", black: "Чёрный" };
  const mapS = { white: "Белые", blue: "Синие", black: "Чёрные" };
  const map = kind === "socks" ? mapS : mapJ;
  return (colors || []).map((c) => map[c] || c).join(" + ");
}

async function getOpenJerseyBatch() {
  const r = await q(`SELECT * FROM jersey_batches WHERE status='open' ORDER BY opened_at DESC LIMIT 1`);
  return r.rows?.[0] || null;
}

// список батчей (НЕ пропадает после close)
app.get("/api/admin/jersey/batches", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const r = await q(`
      SELECT
        b.*,
        COALESCE(s.sent_count, 0)::int AS sent_count
      FROM jersey_batches b
      LEFT JOIN (
        SELECT batch_id, COUNT(*)::int AS sent_count
        FROM jersey_requests
        WHERE status='sent'
        GROUP BY batch_id
      ) s ON s.batch_id = b.id
      ORDER BY b.opened_at DESC
      LIMIT 200
    `);

    const batches = r.rows || [];
    const open_batch = batches.find((x) => x.status === "open") || null;

    return res.json({ ok: true, open_batch, batches });
  } catch (e) {
    console.error("GET /api/admin/jersey/batches failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.post("/api/admin/jersey/batches/open", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const title = String(req.body?.title || "").trim();

    const open = await getOpenJerseyBatch();
    if (open) {
      return res.json({ ok: true, batch: open, already_open: true });
    }

    const ins = await q(
      `INSERT INTO jersey_batches(title, status, opened_by, opened_at)
       VALUES($1,'open',$2,NOW())
       RETURNING *`,
      [title, user.id]
    );

    return res.json({ ok: true, batch: ins.rows?.[0] || null });
  } catch (e) {
    console.error("POST /api/admin/jersey/batches/open failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.post("/api/admin/jersey/batches/:id/close", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const up = await q(
      `UPDATE jersey_batches
       SET status='closed', closed_at=NOW(), closed_by=$2
       WHERE id=$1 AND status='open'
       RETURNING *`,
      [id, user.id]
    );

    if (!up.rows?.[0]) {
      const ex = await q(`SELECT * FROM jersey_batches WHERE id=$1`, [id]);
      const batch = ex.rows?.[0];
      if (!batch) return res.status(404).json({ ok: false, reason: "not_found" });
      return res.json({ ok: true, batch, already_closed: true });
    }

    return res.json({ ok: true, batch: up.rows[0] });
  } catch (e) {
    console.error("POST /api/admin/jersey/batches/:id/close failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.post("/api/admin/jersey/batches/:id/reopen", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const open = await getOpenJerseyBatch();
    if (open && Number(open.id) !== Number(id)) {
      return res.status(400).json({ ok: false, reason: "another_batch_open" });
    }

    const up = await q(
      `UPDATE jersey_batches
       SET status='open', opened_at=NOW(), closed_at=NULL, closed_by=NULL
       WHERE id=$1
       RETURNING *`,
      [id]
    );

    const batch = up.rows?.[0];
    if (!batch) return res.status(404).json({ ok: false, reason: "not_found" });

    return res.json({ ok: true, batch });
  } catch (e) {
    console.error("POST /api/admin/jersey/batches/:id/reopen failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.delete("/api/admin/jersey/batches/:id", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    await q(`DELETE FROM jersey_requests WHERE batch_id=$1`, [id]);
    const del = await q(`DELETE FROM jersey_batches WHERE id=$1 RETURNING *`, [id]);
    const batch = del.rows?.[0];
    if (!batch) return res.status(404).json({ ok: false, reason: "not_found" });

    return res.json({ ok: true, batch });
  } catch (e) {
    console.error("DELETE /api/admin/jersey/batches/:id failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

// (если кнопка есть в UI — пусть просто помечает announced_at; отправку в чат ты можешь делать отдельным роутом позже)
app.post("/api/admin/jersey/batches/:id/announce", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const up = await q(
      `UPDATE jersey_batches
       SET announced_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id]
    );

    const batch = up.rows?.[0];
    if (!batch) return res.status(404).json({ ok: false, reason: "not_found" });

    return res.json({ ok: true, batch });
  } catch (e) {
    console.error("POST /api/admin/jersey/batches/:id/announce failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

app.get("/api/admin/jersey/batches/:id/orders", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const r = await q(
      `SELECT
         r.*,
         p.display_name, p.first_name, p.username, p.tg_id
       FROM jersey_requests r
       JOIN players p ON p.tg_id = r.tg_id
       WHERE r.batch_id=$1 AND r.status='sent'
       ORDER BY p.display_name NULLS LAST, r.id ASC`,
      [id]
    );

    return res.json({ ok: true, orders: r.rows || [] });
  } catch (e) {
    console.error("GET /api/admin/jersey/batches/:id/orders failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

// EXPORT (как раньше): JSON { filename, csv }
app.get("/api/admin/jersey/batches/:id/export", async (req, res) => {
  try {
    const user = req.webappUser || requireWebAppAuth(req, res);
    if (!user) return;
    if (!(await requireGroupMember(req, res, user))) return;

    const is_admin = await isAdminId(user.id);
    if (!is_admin) return res.status(403).json({ ok: false, reason: "admin_only" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: "bad_id" });

    const br = await q(`SELECT * FROM jersey_batches WHERE id=$1`, [id]);
    const batch = br.rows?.[0];
    if (!batch) return res.status(404).json({ ok: false, reason: "not_found" });

    const r = await q(
      `SELECT *
       FROM jersey_requests
       WHERE batch_id=$1 AND status='sent'
       ORDER BY id ASC`,
      [id]
    );

    const rows = [];
    rows.push(["№", "Надпись", "Номер", "Размер", "Цвет", "Гамаши", "Цена"]);

    let i = 1;
    for (const o of r.rows || []) {
      const title = o.name_on_jersey?.trim() ? o.name_on_jersey.trim() : "без надписи";
      const num = o.jersey_number == null ? "без номера" : String(o.jersey_number);
      const size = o.jersey_size || "";
      const color = ruJoin(o.jersey_colors, "jersey");

      let socks = "";
      if (o.socks_needed) {
        socks = ruJoin(o.socks_colors, "socks");
        if (String(o.socks_size) === "junior") socks = (socks ? socks + " " : "") + "jr";
      }

      rows.push([String(i++), title, num, size, color, socks, ""]);
    }

    const csv =
      "\uFEFF" +
      rows
        .map((r) =>
          r
            .map((cell) => {
              const s = String(cell ?? "");
              const escaped =
                s.includes(";") || s.includes('"') || s.includes("\n")
                  ? `"${s.replace(/"/g, '""')}"`
                  : s;
              return escaped;
            })
            .join(";")
        )
        .join("\n");

    const safeTitle = (batch.title || `batch_${id}`)
      .replace(/[^\w\-а-яА-Я ]+/g, "")
      .trim()
      .replace(/\s+/g, "_");
    const filename = `jersey_${safeTitle || id}.csv`;

    return res.json({ ok: true, filename, csv });
  } catch (e) {
    console.error("GET /api/admin/jersey/batches/:id/export failed:", e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});



const port = process.env.PORT || 10000;
console.log(`[BOOT] hockey-backend starting... ${new Date().toISOString()} commit=${process.env.GIT_COMMIT || "n/a"}`);
console.log('куку все ок играем в хоккей')

app.listen(port, () => console.log("Backend listening on", port));
