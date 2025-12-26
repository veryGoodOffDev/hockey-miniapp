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
      if (!origin) return cb(null, true); // Telegram WebView часто null
      if (allowed.length === 0) return cb(null, true);
      if (allowed.includes("*")) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    allowedHeaders: ["Content-Type", "x-telegram-init-data"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

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
  const chatIdRaw = await getSetting("notify_chat_id", null); // используем тот же чат
  if (!chatIdRaw) {
    res.status(403).json({ ok: false, reason: "access_chat_not_set" });
    return false;
  }

  const chatId = Number(chatIdRaw);

  try {
    const m = await bot.api.getChatMember(chatId, user.id);

    // статусы: creator | administrator | member | restricted | left | kicked
    if (m.status === "left" || m.status === "kicked") {
      res.status(403).json({ ok: false, reason: "not_member" });
      return false;
    }

    // В редких случаях restricted может быть is_member=false
    if (m.status === "restricted" && m.is_member === false) {
      res.status(403).json({ ok: false, reason: "not_member" });
      return false;
    }

    return true;
  } catch (e) {
    console.error("getChatMember failed:", e);
    // Частая причина: бот не в группе / нет прав / chat_id неверный
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
  return (
    s.includes("message is not modified") ||
    s.includes("message can't be edited")
  );
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

  const text =
`🏒 Напоминание: отметься на игру!

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

  return { ok: true, game_id: game.id };
}

async function ensurePlayer(user) {
  const rootAdmin = envAdminSet().has(String(user.id));

  await q(
    `INSERT INTO players(tg_id, first_name, last_name, username, is_admin)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(tg_id) DO UPDATE SET
       first_name=EXCLUDED.first_name,
       last_name=EXCLUDED.last_name,
       username=EXCLUDED.username,
       is_admin = players.is_admin OR EXCLUDED.is_admin,
       updated_at=NOW()`,
    [user.id, user.first_name || "", user.last_name || "", user.username || "", rootAdmin]
  );
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
    const teamChatId = await getSetting("notify_chat_id", null); // если хочешь привязку к команде

    // 1) Сохраняем в БД
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

    // 2) Шлём тебе в личку (support bot)
    const head =
      `🧾 <b>Обращение #${ticketId}</b>\n` +
      `👤 <b>${esc(tgName || user.id)}</b>${user.username ? ` (@${esc(user.username)})` : ""}\n` +
      `🆔 <code>${user.id}</code>\n` +
      (appVersion ? `📦 <code>${esc(appVersion)}</code>\n` : "") +
      (platform ? `📱 <code>${esc(platform)}</code>\n` : "") +
      `🏷️ <code>${esc(category)}</code>\n\n` +
      `${esc(message)}`;

    await supportSendMessage(head);

    // 3) Файлы (скрины)
    const files = req.files || [];
    for (const f of files) {
      const sent = await supportSendFile({
        caption: `📎 #${ticketId} · ${f.originalname || "file"}`,
        file: f,
      });

      // file_id и message_id полезно сохранить
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
  if (!(await requireGroupMember(req, res, user))) return;

  const scopeRaw = String(req.query.scope || "upcoming");
  const scope = ["upcoming", "past", "all"].includes(scopeRaw) ? scopeRaw : "upcoming";

  const defLimit = scope === "past" ? 10 : 50;
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || defLimit)));
  const offset = Math.max(0, Number(req.query.offset || 0));

  const from = req.query.from ? String(req.query.from) : null; // YYYY-MM-DD
  const to = req.query.to ? String(req.query.to) : null;       // YYYY-MM-DD

  const qText = String(req.query.q || "").trim();
  const search = qText ? `%${qText}%` : null;

  // Оставим совместимость: если days передан — доп.ограничение по окну
  const daysRaw = req.query.days;
  const days = daysRaw === undefined ? null : Number(daysRaw);
  const daysInt = Number.isFinite(days) && days > 0 ? Math.trunc(days) : null;

  const order = scope === "past" ? "DESC" : "ASC";

  const sql = `
    WITH base AS (
      SELECT g.*
      FROM games g
      WHERE 1=1

        -- scope: upcoming/past/all (past считается как "старше 3 часов", как у тебя на фронте)
        AND (
          CASE
            WHEN $1 = 'past' THEN g.starts_at < (NOW() - INTERVAL '3 hours')
            WHEN $1 = 'upcoming' THEN g.starts_at >= (NOW() - INTERVAL '3 hours')
            ELSE TRUE
          END
        )

        -- date range (инклюзивно)
        AND ($2::date IS NULL OR g.starts_at >= $2::date)
        AND ($3::date IS NULL OR g.starts_at < ($3::date + INTERVAL '1 day'))

        -- search by location
        AND ($4::text IS NULL OR COALESCE(g.location,'') ILIKE $4)

        -- optional window by days (backward compat)
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
      my.status AS my_status
    FROM page p
    CROSS JOIN total t
    LEFT JOIN counts c ON c.game_id = p.id
    LEFT JOIN rsvps my ON my.game_id = p.id AND my.tg_id = $7
    ORDER BY p.starts_at ${order};
  `;

  const r = await q(sql, [scope, from, to, search, limit, offset, user.id, daysInt]);

  const total = r.rows[0]?.total ?? 0;
  // total дублируется в каждой строке — уберём из объектов games
  const games = r.rows.map(({ total, ...rest }) => rest);

  res.json({ ok: true, games, total, limit, offset, scope });
});


/** ====== GAME DETAILS (supports game_id) ====== */
app.get("/api/game", async (req, res) => {
 const user = requireWebAppAuth(req, res);
if (!user) return;
if (!(await requireGroupMember(req, res, user))) return;

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

  const is_admin = await isAdminId(user.id);

let rr;
if (is_admin) {
  rr = await q(
    `SELECT
        COALESCE(r.status, 'maybe') AS status,
        p.tg_id, p.first_name, p.username, p.display_name, p.jersey_number,
        p.position, p.skill
     FROM players p
     LEFT JOIN rsvps r
       ON r.game_id=$1 AND r.tg_id=p.tg_id
     WHERE p.disabled=FALSE
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
        p.tg_id, p.first_name, p.username, p.display_name, p.jersey_number, p.position
     FROM players p
     LEFT JOIN rsvps r
       ON r.game_id=$1 AND r.tg_id=p.tg_id
     WHERE p.disabled=FALSE
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

  res.json({ ok: true, game, rsvps: rr.rows, teams });
});

/** ====== RSVP (requires game_id) ====== */
app.post("/api/rsvp", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  const gid = Number(req.body?.game_id);
  const status = String(req.body?.status || "").trim();

  if (!gid) return res.status(400).json({ ok: false, reason: "no_game_id" });
  if (!["yes", "no", "maybe"].includes(status)) {
    return res.status(400).json({ ok: false, reason: "bad_status" });
  }

  await ensurePlayer(user);

  // ✅ Закрываем прошедшие игры для обычных игроков
  const gr = await q(`SELECT starts_at FROM games WHERE id=$1`, [gid]);
  const startsAt = gr.rows[0]?.starts_at ? new Date(gr.rows[0].starts_at) : null;
  if (!startsAt) return res.status(404).json({ ok: false, reason: "game_not_found" });

  const is_admin = await isAdminId(user.id);
  if (!is_admin && startsAt < new Date()) {
    return res.status(403).json({ ok: false, reason: "game_closed" });
  }

  // ✅ maybe = "сбросить" → удаляем строку
  if (status === "maybe") {
    await q(`DELETE FROM rsvps WHERE game_id=$1 AND tg_id=$2`, [gid, user.id]);
    return res.json({ ok: true });
  }

  await q(
    `INSERT INTO rsvps(game_id, tg_id, status)
     VALUES($1,$2,$3)
     ON CONFLICT(game_id, tg_id)
     DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
    [gid, user.id, status]
  );

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
    `SELECT p.*
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
// ====== TEAMS MANUAL EDIT (admin) ======
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
    // простая, стабильная формула (можешь подстроить)
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

  const sum = (arr) =>
    arr.reduce((acc, p) => acc + Number(ensureRating(p).rating || 0), 0);

  function removeOne(arr, id) {
    const idx = arr.findIndex(x => idEq(x, id));
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
    const ia = A.findIndex(x => idEq(x, a_id));
    const ib = B.findIndex(x => idEq(x, b_id));
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

const { starts_at, location, video_url } = req.body || {};
const d = new Date(starts_at);
if (Number.isNaN(d.getTime())) return res.status(400).json({ ok: false, reason: "bad_starts_at" });

const vu = cleanUrl(video_url);
if (video_url && !vu) return res.status(400).json({ ok: false, reason: "bad_video_url" });

const ir = await q(
  `INSERT INTO games(starts_at, location, status, video_url)
   VALUES($1,$2,'scheduled',$3)
   RETURNING *`,
  [d.toISOString(), String(location || "").trim(), vu]
);

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
    if (Number.isNaN(d.getTime()))
      return res.status(400).json({ ok: false, reason: "bad_starts_at" });
    sets.push(`starts_at=$${i++}`); vals.push(d.toISOString());
  }
  if (b.location !== undefined) {
    sets.push(`location=$${i++}`); vals.push(String(b.location || "").trim());
  }
  if (b.status) {
    sets.push(`status=$${i++}`); vals.push(String(b.status));
  }
  if (b.video_url !== undefined) {
  const vu = cleanUrl(b.video_url);
  if (b.video_url && !vu) return res.status(400).json({ ok:false, reason:"bad_video_url" });
  sets.push(`video_url=$${i++}`); 
  vals.push(vu);
}
  sets.push(`updated_at=NOW()`);

  vals.push(id);

  const ur = await q(
    `UPDATE games SET ${sets.join(", ")} WHERE id=$${i} RETURNING *`,
    vals
  );
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

  const ur = await q(
    `UPDATE games SET status=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, status]
  );
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

/** ====== ADMIN: guests ====== */
// create guest (+ optional RSVP on game)
app.post("/api/admin/guests", async (req, res) => {
const user = requireWebAppAuth(req, res);
if (!user) return;
if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const b = req.body || {};
  const gameId = b.game_id ? Number(b.game_id) : null;
  const status = String(b.status || "yes");

  if (gameId) {
    const gr = await q(`SELECT id FROM games WHERE id=$1`, [gameId]);
    if (!gr.rows[0]) return res.status(400).json({ ok: false, reason: "bad_game_id" });
  }

  // tg_id for guest = negative sequence
  const idr = await q(`SELECT -nextval('guest_seq')::bigint AS tg_id`);
  const guestId = idr.rows[0].tg_id;

  const displayName = (b.display_name || "Гость").trim().slice(0, 60) || "Гость";

  await q(
    `INSERT INTO players(
      tg_id, display_name, jersey_number,
      is_guest, created_by,
      position, skill, skating, iq, stamina, passing, shooting,
      notes, disabled, is_admin
    ) VALUES($1,$2,$3, TRUE, $4, $5,$6,$7,$8,$9,$10,$11, $12, FALSE, FALSE)`,
    [
      guestId,
      displayName,
      jersey(b.jersey_number),
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

  if (gameId && ["yes","no","maybe"].includes(status)) {
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

// admin set RSVP for any player/guest
app.post("/api/admin/rsvp", async (req, res) => {
const user = requireWebAppAuth(req, res);
if (!user) return;
if (!(await requireGroupMember(req, res, user))) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const b = req.body || {};
  const gid = Number(b.game_id);
  const tgId = Number(b.tg_id);
  const status = String(b.status || "").trim();

  if (!gid || !tgId) return res.status(400).json({ ok:false, reason:"bad_params" });
  if (!["yes","no","maybe"].includes(status)) return res.status(400).json({ ok:false, reason:"bad_status" });

  const gr = await q(`SELECT id FROM games WHERE id=$1`, [gid]);
  if (!gr.rows[0]) return res.status(400).json({ ok:false, reason:"bad_game_id" });

  const pr = await q(`SELECT tg_id FROM players WHERE tg_id=$1`, [tgId]);
  if (!pr.rows[0]) return res.status(400).json({ ok:false, reason:"bad_player_id" });

  await q(
    `INSERT INTO rsvps(game_id, tg_id, status)
     VALUES($1,$2,$3)
     ON CONFLICT(game_id, tg_id) DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
    [gid, tgId, status]
  );

  res.json({ ok:true });
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
      is_guest, created_by,
      position, skill, skating, iq, stamina, passing, shooting,
      notes, disabled,
      is_admin, updated_at
     FROM players
     ORDER BY COALESCE(display_name, first_name, username, tg_id::text) ASC`
  );

  // чтобы env-админы точно отображались админами (если уже есть в БД)
  const env = envAdminSet();
  const players = r.rows.map(p => ({
    ...p,
    is_admin: p.is_admin || env.has(String(p.tg_id)),
    is_env_admin: env.has(String(p.tg_id))
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

  // не даём через этот endpoint менять is_admin — для этого отдельный endpoint ниже
  await q(
    `UPDATE players SET
      display_name=$2,
      jersey_number=$3,
      position=$4,
      skill=$5, skating=$6, iq=$7, stamina=$8, passing=$9, shooting=$10,
      notes=$11,
      disabled=$12,
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
    ]
  );

  const pr = await q(
    `SELECT
      tg_id, first_name, username, display_name, jersey_number,
      is_guest, created_by,
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
  const pr = await q(`SELECT tg_id, is_guest FROM players WHERE tg_id=$1`, [tgId]);
  if (!pr.rows[0]) return res.status(404).json({ ok: false, reason: "not_found" });

  // Удалять разрешаем только гостей (чтобы случайно не снести живого игрока)
  if (pr.rows[0].is_guest !== true) {
    return res.status(400).json({ ok: false, reason: "not_guest" });
  }

  await q(`DELETE FROM players WHERE tg_id=$1`, [tgId]); // rsvps удалятся каскадом
  res.json({ ok: true });
});

app.get("/api/players", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireGroupMember(req, res, user))) return;

  await ensurePlayer(user);

  const is_admin = await isAdminId(user.id);

  // для обычных — минимум, для админа — можно больше
  const sql = is_admin
    ? `SELECT tg_id, first_name, last_name, username, display_name, jersey_number, position,
              photo_url, notes, skill, skating, iq, stamina, passing, shooting, is_admin, disabled
       FROM players
       WHERE disabled=FALSE
       ORDER BY COALESCE(display_name, first_name, username, tg_id::text) ASC`
    : `SELECT tg_id, first_name, last_name, username, display_name, jersey_number, position,
              photo_url, notes
       FROM players
       WHERE disabled=FALSE
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
    : `SELECT tg_id, first_name, last_name, username, display_name, jersey_number, position, photo_url, notes
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
  const kind = String(req.query.kind || "").trim(); // "" | "custom" | "reminder"

  const params = [chat_id];
  const where = [`chat_id=$1`];

  if (kind) { params.push(kind); where.push(`kind=$${params.length}`); }
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
    // если уже удалили руками — пометим как удалённое и уберём из списка
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

  let checked = 0, missing = 0;

  for (const row of r.rows) {
    checked++;

    try {
      const opts = {
        disable_web_page_preview: !!row.disable_web_page_preview,
      };
      if (row.parse_mode) opts.parse_mode = row.parse_mode;
      if (row.reply_markup) opts.reply_markup = row.reply_markup;

      // “пинг” существования
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

      // другие ошибки (например, нет прав) — просто отметим checked_at
      console.error("sync probe failed:", e);
      await q(`UPDATE bot_messages SET checked_at=NOW() WHERE id=$1`, [row.id]);
    }
  }

  res.json({ ok: true, checked, missing });
});


app.get("/api/stats/attendance", async (req, res) => {
  try {
    // сколько дней назад смотреть (по умолчанию 365)
    let days = parseInt(String(req.query.days ?? "365"), 10);
    if (!Number.isFinite(days) || days < 0) days = 365;

    // days=0 или days очень большое -> считаем "за всё время"
    const useDays = days > 0 && days < 100000;

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

        SUM(CASE WHEN r.status = 'yes' THEN 1 ELSE 0 END)   AS yes,
        SUM(CASE WHEN r.status = 'maybe' THEN 1 ELSE 0 END) AS maybe,
        SUM(CASE WHEN r.status = 'no' THEN 1 ELSE 0 END)    AS no,
        COUNT(*) AS total

      FROM rsvps r
      JOIN games g   ON g.id = r.game_id
      JOIN players p ON p.tg_id = r.tg_id

      WHERE g.status <> 'cancelled'
        AND g.starts_at < NOW()
        ${useDays ? `AND g.starts_at >= NOW() - make_interval(days => $1::int)` : ""}
        AND p.disabled IS DISTINCT FROM TRUE

      GROUP BY p.tg_id, name, p.position, p.jersey_number, p.is_guest
      ORDER BY yes DESC, maybe DESC, total DESC, name ASC;
    `;

    const params = useDays ? [days] : [];
    const { rows } = await q(sql, params);

    res.json({ ok: true, days: useDays ? days : 0, rows });
  } catch (e) {
    console.error("attendance stats error:", e);
    res.status(500).json({ ok: false, error: "stats_error" });
  }
});

app.post("/api/rsvp/bulk", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  const status = String(req.body?.status || "").trim(); // yes | no | maybe
  if (!["yes", "no", "maybe"].includes(status)) {
    return res.status(400).json({ ok: false, reason: "bad_status" });
  }

  await ensurePlayer(user);

  // какие игры считаем будущими: scheduled и starts_at >= сейчас
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

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Backend listening on", port));
