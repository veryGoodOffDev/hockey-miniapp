import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDb, q } from "./db.js";
import { createBot } from "./bot.js";
import { verifyTelegramWebApp } from "./tgAuth.js";
import { makeTeams } from "./teamMaker.js";
import { ensureSchema } from "./schema.js";

const app = express();

app.use(express.json());

const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // В Telegram WebView origin иногда пустой/null — разрешаем
      if (!origin) return cb(null, true);

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

function adminIds() {
  return new Set(
    (process.env.ADMIN_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
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

function requireAdmin(req, res, user) {
  const admins = adminIds();
  if (!admins.has(String(user.id))) {
    res.status(403).json({ ok: false, reason: "not_admin" });
    return false;
  }
  return true;
}

async function ensurePlayer(user) {
  await q(
    `INSERT INTO players(tg_id, first_name, last_name, username)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(tg_id) DO UPDATE SET
       first_name=EXCLUDED.first_name,
       last_name=EXCLUDED.last_name,
       username=EXCLUDED.username,
       updated_at=NOW()`,
    [user.id, user.first_name || "", user.last_name || "", user.username || ""]
  );
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

/** ====== ME ====== */
app.get("/api/me", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  await ensurePlayer(user);

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);

  const is_admin = adminIds().has(String(user.id));
  res.json({ ok: true, player: pr.rows[0], is_admin });
});

app.post("/api/me", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  await ensurePlayer(user);
  const b = req.body || {};

  await q(
    `UPDATE players SET
      position=$2, skill=$3, skating=$4, iq=$5, stamina=$6, passing=$7, shooting=$8, notes=$9, updated_at=NOW()
     WHERE tg_id=$1`,
    [
      user.id,
      b.position || "F",
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
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  const days = Math.max(1, Math.min(180, Number(req.query.days || 35)));

  const gr = await q(
    `SELECT * FROM games
     WHERE starts_at >= NOW() - INTERVAL '1 day'
       AND starts_at <= NOW() + ($1::int || ' days')::interval
     ORDER BY starts_at ASC`,
    [days]
  );

  res.json({ ok: true, games: gr.rows });
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

  const rr = await q(
    `SELECT r.status, p.tg_id, p.first_name, p.username, p.position, p.skill
     FROM rsvps r
     JOIN players p ON p.tg_id = r.tg_id
     WHERE r.game_id = $1
     ORDER BY r.status ASC, p.skill DESC, p.first_name ASC`,
    [game.id]
  );

  const tr = await q(`SELECT team_a, team_b, meta, generated_at FROM teams WHERE game_id=$1`, [game.id]);
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
  if (!requireAdmin(req, res, user)) return;

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
     ON CONFLICT(game_id) DO UPDATE SET team_a=EXCLUDED.team_a, team_b=EXCLUDED.team_b, meta=EXCLUDED.meta, generated_at=NOW()`,
    [gid, JSON.stringify(teamA), JSON.stringify(teamB), JSON.stringify(meta)]
  );

  res.json({ ok: true, teamA, teamB, meta });
});

/** ====== ADMIN: games CRUD ====== */
app.post("/api/games", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!requireAdmin(req, res, user)) return;

  const { starts_at, location } = req.body || {};
  const d = new Date(starts_at);
  if (Number.isNaN(d.getTime())) return res.status(400).json({ ok: false, reason: "bad_starts_at" });

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
  if (!requireAdmin(req, res, user)) return;

  const id = Number(req.params.id);
  const b = req.body || {};

  const sets = [];
  const vals = [];
  let i = 1;

  if (b.starts_at) {
    const d = new Date(b.starts_at);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ ok: false, reason: "bad_starts_at" });
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

  const ur = await q(`UPDATE games SET ${sets.join(", ")} WHERE id=$${i} RETURNING *`, vals);
  res.json({ ok: true, game: ur.rows[0] });
});

app.post("/api/games/:id/cancel", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!requireAdmin(req, res, user)) return;

  const id = Number(req.params.id);
  const ur = await q(`UPDATE games SET status='cancelled', updated_at=NOW() WHERE id=$1 RETURNING *`, [id]);
  res.json({ ok: true, game: ur.rows[0] });
});

app.delete("/api/games/:id", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!requireAdmin(req, res, user)) return;

  const id = Number(req.params.id);
  await q(`DELETE FROM games WHERE id=$1`, [id]);
  res.json({ ok: true });
});

/** ====== ADMIN: players list + patch ====== */
app.get("/api/players", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!requireAdmin(req, res, user)) return;

  const pr = await q(
    `SELECT tg_id, first_name, last_name, username, position, skill, skating, iq, stamina, passing, shooting, notes, disabled, updated_at
     FROM players
     ORDER BY disabled ASC, skill DESC, updated_at DESC NULLS LAST, first_name ASC`
  );

  res.json({ ok: true, players: pr.rows });
});

app.patch("/api/players/:tg_id", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!requireAdmin(req, res, user)) return;

  const tgId = Number(req.params.tg_id);
  const p = req.body || {};

  await q(
    `UPDATE players SET
       first_name=$2,
       last_name=$3,
       username=$4,
       position=$5,
       skill=$6, skating=$7, iq=$8, stamina=$9, passing=$10, shooting=$11,
       notes=$12,
       disabled=$13,
       updated_at=NOW()
     WHERE tg_id=$1`,
    [
      tgId,
      String(p.first_name ?? ""),
      String(p.last_name ?? ""),
      String(p.username ?? ""),
      String(p.position ?? "F"),
      int(p.skill, 5),
      int(p.skating, 5),
      int(p.iq, 5),
      int(p.stamina, 5),
      int(p.passing, 5),
      int(p.shooting, 5),
      String(p.notes ?? "").slice(0, 500),
      Boolean(p.disabled ?? false),
    ]
  );

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [tgId]);
  res.json({ ok: true, player: pr.rows[0] });
});

function int(v, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(10, Math.round(n)));
}

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Backend listening on", port));
