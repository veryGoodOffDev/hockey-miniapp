import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDb, q } from "./db.js";
import { createBot } from "./bot.js";
import { verifyTelegramWebApp } from "./tgAuth.js";
import { makeTeams } from "./teamMaker.js";
import { ensureSchema } from "./schema.js";
import { InlineKeyboard } from "grammy";

const app = express();
app.use(express.json());

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

  await bot.api.sendMessage(chatId, text, {
    reply_markup: kb,
    disable_web_page_preview: true,
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

  await ensurePlayer(user);

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);
  const player = pr.rows[0];
  const admin = await isAdminId(user.id);

  res.json({ ok: true, player, is_admin: admin });
});

app.post("/api/me", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  await ensurePlayer(user);
  const b = req.body || {};

  await q(
    `UPDATE players SET
      display_name=$2,
      jersey_number=$3,
      position=$4,
      skill=$5, skating=$6, iq=$7, stamina=$8, passing=$9, shooting=$10,
      notes=$11,
      updated_at=NOW()
     WHERE tg_id=$1`,
    [
      user.id,
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
    ]
  );

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);
  res.json({ ok: true, player: pr.rows[0] });
});

/** ====== GAMES LIST ====== */
app.get("/api/games", async (req, res) => {
  const days = Number(req.query.days || 35);
  const r = await q(
    `
    SELECT g.*,
      COALESCE(SUM(CASE WHEN r.status='yes' THEN 1 ELSE 0 END),0) AS yes_count,
      COALESCE(SUM(CASE WHEN r.status='maybe' THEN 1 ELSE 0 END),0) AS maybe_count,
      COALESCE(SUM(CASE WHEN r.status='no' THEN 1 ELSE 0 END),0) AS no_count
    FROM games g
    LEFT JOIN rsvps r ON r.game_id = g.id
    WHERE g.starts_at >= NOW() - ($1::int || ' days')::interval
    GROUP BY g.id
    ORDER BY g.starts_at ASC
    `,
    [days]
  );
  res.json({ ok: true, games: r.rows });
});

/** ====== GAME DETAILS (supports game_id) ====== */
app.get("/api/game", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

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

  const rr = is_admin
    ? await q(
        `SELECT
           r.status,
           p.tg_id, p.first_name, p.username,
           p.display_name, p.jersey_number,
           p.position, p.skill,
           p.is_guest
         FROM rsvps r
         JOIN players p ON p.tg_id = r.tg_id
         WHERE r.game_id = $1
         ORDER BY r.status ASC, p.skill DESC, COALESCE(p.display_name,p.first_name,p.username,p.tg_id::text) ASC`,
        [game.id]
      )
    : await q(
        `SELECT
           r.status,
           p.tg_id, p.first_name, p.username,
           p.display_name, p.jersey_number,
           p.position,
           p.is_guest
         FROM rsvps r
         JOIN players p ON p.tg_id = r.tg_id
         WHERE r.game_id = $1
         ORDER BY r.status ASC, COALESCE(p.display_name,p.first_name,p.username,p.tg_id::text) ASC`,
        [game.id]
      );

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

  const status = req.body?.status;
  const gid = Number(req.body?.game_id);

  if (!gid) return res.status(400).json({ ok: false, reason: "no_game_id" });
  if (!["yes", "no", "maybe"].includes(status)) {
    return res.status(400).json({ ok: false, reason: "bad_status" });
  }

  await ensurePlayer(user);

  await q(
    `INSERT INTO rsvps(game_id, tg_id, status)
     VALUES($1,$2,$3)
     ON CONFLICT(game_id, tg_id) DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
    [gid, user.id, status]
  );

  res.json({ ok: true });
});

/** ====== TEAMS GENERATE (admin) ====== */
app.post("/api/teams/generate", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
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

/** ====== ADMIN: games CRUD ====== */
app.post("/api/games", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!(await requireAdminAsync(req, res, user))) return;

  const { starts_at, location } = req.body || {};
  const d = new Date(starts_at);
  if (Number.isNaN(d.getTime()))
    return res.status(400).json({ ok: false, reason: "bad_starts_at" });

  const ir = await q(
    `INSERT INTO games(starts_at, location, status)
     VALUES($1,$2,'scheduled')
     RETURNING *`,
    [d.toISOString(), String(location || "").trim()]
  );

  res.json({ ok: true, game: ir.rows[0] });
});

app.patch("/api/games/:id", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
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

  if (!isSuperAdmin(user.id)) {
    return res.status(403).json({ ok: false, reason: "not_super_admin" });
  }

  const tgId = Number(req.params.tg_id);
  const makeAdmin = !!req.body?.is_admin;

  await q(`UPDATE players SET is_admin=$2, updated_at=NOW() WHERE tg_id=$1`, [tgId, makeAdmin]);
  res.json({ ok: true });
});

/** ====== ADMIN: reminder ====== */
app.post("/api/admin/reminder/sendNow", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
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

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Backend listening on", port));
