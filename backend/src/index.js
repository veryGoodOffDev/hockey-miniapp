import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDb, q } from "./db.js";
import { createBot } from "./bot.js";
import { verifyTelegramWebApp } from "./tgAuth.js";
import { makeTeams } from "./teamMaker.js";
import { ensureSchema } from "./schema.js";
import { buildApiRouter } from "./routesApi.js";

const app = express();
app.use(express.json());
// ВАЖНО: перед роутами
await ensureSchema(q);

// Подключаем API
app.use(buildApiRouter({ q, makeTeams }));
const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // В Telegram WebView origin иногда бывает пустым/null — разрешаем
    if (!origin) return cb(null, true);

    if (allowed.includes("*") || allowed.includes(origin)) return cb(null, true);

    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  allowedHeaders: ["Content-Type", "x-telegram-init-data"],
  methods: ["GET", "POST", "OPTIONS"]
}));

app.use(express.json());

await initDb();

const bot = createBot();
await bot.init(); // <-- важно для webhook режима
// --- Telegram webhook endpoint (после деплоя выставишь setWebhook на этот URL)
app.post("/bot", async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error("handleUpdate failed:", e);
  }
  res.sendStatus(200);
});


function requireWebAppAuth(req, res) {
  const initData = req.header("x-telegram-init-data");
  const v = verifyTelegramWebApp(initData, process.env.BOT_TOKEN);
  if (!v.ok) {
    res.status(401).json({ ok: false, reason: v.reason });
    return null;
  }
  return v.user;
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

// текущая (последняя) игра
app.get("/api/game", async (req, res) => {
  const gr = await q(`SELECT id, starts_at, location FROM games ORDER BY starts_at DESC LIMIT 1`);
  const game = gr.rows[0] || null;
  if (!game) return res.json({ game: null, rsvps: [] });

  const rr = await q(`
    SELECT r.status, p.tg_id, p.first_name, p.username, p.position, p.skill, p.skating, p.iq, p.stamina
    FROM rsvps r
    JOIN players p ON p.tg_id = r.tg_id
    WHERE r.game_id = $1
    ORDER BY p.first_name ASC
  `, [game.id]);

  res.json({ game, rsvps: rr.rows });
});

app.get("/api/me", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  await ensurePlayer(user);
  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);
  res.json({ ok: true, player: pr.rows[0] });
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
      (b.notes || "").slice(0, 500)
    ]
  );

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [user.id]);
  res.json({ ok: true, player: pr.rows[0] });
});

app.post("/api/rsvp", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  const status = req.body?.status;
  if (!["yes","no","maybe"].includes(status)) {
    return res.status(400).json({ ok:false, reason:"bad_status" });
  }

  const gr = await q(`SELECT id FROM games ORDER BY starts_at DESC LIMIT 1`);
  const game = gr.rows[0];
  if (!game) return res.status(400).json({ ok:false, reason:"no_game" });

  await ensurePlayer(user);

  await q(
    `INSERT INTO rsvps(game_id, tg_id, status)
     VALUES($1,$2,$3)
     ON CONFLICT(game_id, tg_id) DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
    [game.id, user.id, status]
  );

  res.json({ ok: true });
});

app.post("/api/teams/generate", async (req, res) => {
  // простой “админский” доступ: только ADMIN_IDS
  const user = requireWebAppAuth(req, res);
  if (!user) return;

  const adminIds = new Set((process.env.ADMIN_IDS || "").split(",").map(s=>s.trim()).filter(Boolean));
  if (!adminIds.has(String(user.id))) return res.status(403).json({ ok:false, reason:"not_admin" });

  const gr = await q(`SELECT id FROM games ORDER BY starts_at DESC LIMIT 1`);
  const game = gr.rows[0];
  if (!game) return res.status(400).json({ ok:false, reason:"no_game" });

  const pr = await q(`
    SELECT p.*
    FROM rsvps r
    JOIN players p ON p.tg_id = r.tg_id
    WHERE r.game_id = $1 AND r.status = 'yes'
  `, [game.id]);

  const players = pr.rows;
  const { teamA, teamB, meta } = makeTeams(players);

  await q(
    `INSERT INTO teams(game_id, team_a, team_b, meta)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(game_id) DO UPDATE SET team_a=EXCLUDED.team_a, team_b=EXCLUDED.team_b, meta=EXCLUDED.meta, generated_at=NOW()`,
    [game.id, JSON.stringify(teamA), JSON.stringify(teamB), JSON.stringify(meta)]
  );

  res.json({ ok: true, teamA, teamB, meta });
});

function int(v, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(10, Math.round(n)));
}

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Backend listening on", port));
