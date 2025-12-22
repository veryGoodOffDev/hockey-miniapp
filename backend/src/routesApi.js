// backend/src/routesApi.js
import express from "express";
import { getTgId, isAdminTgId, requireAdmin } from "./admin.js";

function parseIsoToDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function buildApiRouter({ q, makeTeams }) {
  const r = express.Router();

r.get("/api/me", async (req, res) => {
  const u = req.tgUser || req.user || req.telegramUser; // как у тебя называется объект после проверки initData
  const tgId = u?.id || u?.tg_id;
  if (!tgId) return res.status(401).json({ ok: false, error: "no_user" });

  // создаём/обновляем игрока (чтобы Профиль всегда был доступен)
  await q(`
    INSERT INTO players(tg_id, first_name, username)
    VALUES($1,$2,$3)
    ON CONFLICT (tg_id) DO UPDATE SET
      first_name = COALESCE(EXCLUDED.first_name, players.first_name),
      username   = COALESCE(EXCLUDED.username, players.username),
      updated_at = NOW()
  `, [tgId, u.first_name || "", u.username || ""]);

  const pr = await q(`SELECT * FROM players WHERE tg_id=$1`, [tgId]);
  const player = pr.rows[0];

  const adminIds = (process.env.ADMIN_IDS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const is_admin = adminIds.includes(String(tgId));

  return res.json({ ok: true, player, is_admin });
});


  // ---- games list (next N days)
  r.get("/api/games", async (req, res) => {
    const days = Math.max(1, Math.min(120, Number(req.query.days || 35)));
    const gr = await q(
      `SELECT * FROM games
       WHERE starts_at >= NOW() - INTERVAL '1 day'
         AND starts_at <= NOW() + ($1::int || ' days')::interval
       ORDER BY starts_at ASC`,
      [days]
    );
    res.json({ ok: true, games: gr.rows });
  });

  // ---- one game + rsvps; by id or next scheduled
  r.get("/api/game", async (req, res) => {
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

    if (!game) return res.json({ ok: true, game: null, rsvps: [] });

    const rr = await q(
      `SELECT r.tg_id, r.status, p.first_name, p.username, p.position, p.skill
       FROM rsvps r
       JOIN players p ON p.tg_id = r.tg_id
       WHERE r.game_id=$1
       ORDER BY r.status ASC, p.skill DESC, p.first_name ASC`,
      [game.id]
    );

    const tr = await q(`SELECT team_a, team_b, meta, generated_at FROM teams WHERE game_id=$1`, [game.id]);
    const teams = tr.rows[0] || null;

    res.json({ ok: true, game, rsvps: rr.rows, teams });
  });

  // ---- create game (admin)
  r.post("/api/games", requireAdmin, async (req, res) => {
    const { starts_at, location } = req.body || {};
    const d = parseIsoToDate(starts_at);
    if (!d) return res.status(400).json({ ok: false, error: "bad_starts_at" });

    const loc = String(location || "").trim();
    const ir = await q(
      `INSERT INTO games(starts_at, location, status)
       VALUES($1,$2,'scheduled')
       RETURNING *`,
      [d, loc]
    );

    res.json({ ok: true, game: ir.rows[0] });
  });

  // ---- edit game (admin)
  r.patch("/api/games/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const patch = req.body || {};

    const sets = [];
    const vals = [];
    let i = 1;

    if (patch.starts_at) {
      const d = parseIsoToDate(patch.starts_at);
      if (!d) return res.status(400).json({ ok: false, error: "bad_starts_at" });
      sets.push(`starts_at=$${i++}`); vals.push(d);
    }
    if (patch.location !== undefined) {
      sets.push(`location=$${i++}`); vals.push(String(patch.location || "").trim());
    }
    if (patch.status) {
      sets.push(`status=$${i++}`); vals.push(String(patch.status));
    }

    sets.push(`updated_at=NOW()`);

    if (!sets.length) return res.json({ ok: true });

    vals.push(id);
    const ur = await q(
      `UPDATE games SET ${sets.join(", ")} WHERE id=$${i} RETURNING *`,
      vals
    );

    res.json({ ok: true, game: ur.rows[0] });
  });

  // ---- cancel game (admin)
  r.post("/api/games/:id/cancel", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const ur = await q(
      `UPDATE games SET status='cancelled', updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id]
    );
    res.json({ ok: true, game: ur.rows[0] });
  });

  // ---- delete game (admin, optional)
  r.delete("/api/games/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    await q(`DELETE FROM games WHERE id=$1`, [id]);
    res.json({ ok: true });
  });

  // ---- RSVP (user)
  r.post("/api/rsvp", async (req, res) => {
    const tgId = getTgId(req);
    if (!tgId) return res.status(401).json({ ok: false, error: "no_user" });

    const { game_id, status } = req.body || {};
    const gid = Number(game_id);
    if (!gid) return res.status(400).json({ ok: false, error: "no_game_id" });
    if (!["yes","maybe","no"].includes(status)) return res.status(400).json({ ok: false, error: "bad_status" });

    // ensure player exists
    await q(
      `INSERT INTO players(tg_id) VALUES($1)
       ON CONFLICT (tg_id) DO NOTHING`,
      [tgId]
    );

    await q(
      `INSERT INTO rsvps(game_id, tg_id, status)
       VALUES($1,$2,$3)
       ON CONFLICT (game_id, tg_id)
       DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`,
      [gid, tgId, status]
    );

    res.json({ ok: true });
  });

  // ---- players list (admin)
  r.get("/api/players", requireAdmin, async (req, res) => {
    const pr = await q(
      `SELECT tg_id, first_name, username, position, skill, skating, iq, stamina, passing, shooting, disabled, updated_at
       FROM players
       ORDER BY disabled ASC, skill DESC, updated_at DESC NULLS LAST, first_name ASC`
    );
    res.json({ ok: true, players: pr.rows });
  });

  // ---- update player (admin)
  r.patch("/api/players/:tg_id", requireAdmin, async (req, res) => {
    const tgId = Number(req.params.tg_id);
    const patch = req.body || {};

    const allowed = ["first_name","username","position","skill","skating","iq","stamina","passing","shooting","disabled"];
    const sets = [];
    const vals = [];
    let i = 1;

    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      sets.push(`${k}=$${i++}`);
      vals.push(patch[k]);
    }
    sets.push(`updated_at=NOW()`);

    if (!sets.length) return res.json({ ok: true });

    vals.push(tgId);
    const ur = await q(
      `UPDATE players SET ${sets.join(", ")} WHERE tg_id=$${i} RETURNING *`,
      vals
    );

    res.json({ ok: true, player: ur.rows[0] });
  });

  // ---- generate teams for selected game (admin)
  r.post("/api/teams/generate", requireAdmin, async (req, res) => {
    const { game_id } = req.body || {};
    const gid = Number(game_id);
    if (!gid) return res.status(400).json({ ok: false, error: "no_game_id" });

    const rr = await q(
      `SELECT p.*
       FROM rsvps r
       JOIN players p ON p.tg_id = r.tg_id
       WHERE r.game_id=$1 AND r.status='yes' AND p.disabled=FALSE`,
      [gid]
    );

    if (rr.rows.length < 2) return res.json({ ok: true, teamA: [], teamB: [], meta: { note: "not_enough_players" } });

    const { teamA, teamB, meta } = makeTeams(rr.rows);

    await q(
      `INSERT INTO teams(game_id, team_a, team_b, meta)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (game_id)
       DO UPDATE SET team_a=EXCLUDED.team_a, team_b=EXCLUDED.team_b, meta=EXCLUDED.meta, generated_at=NOW()`,
      [gid, JSON.stringify(teamA), JSON.stringify(teamB), JSON.stringify(meta)]
    );

    res.json({ ok: true, teamA, teamB, meta });
  });
// GET reminder settings (admin)
r.get("/api/admin/reminder", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!requireAdmin(req, res, user)) return;

  const cfg = {
    enabled: (await getSetting("remind_enabled", "1")) === "1",
    weekday: Number(await getSetting("remind_weekday", "2")), // 2 = Tuesday (Luxon: Mon=1..Sun=7)
    time: await getSetting("remind_time", "12:00"),
    tz: await getSetting("remind_tz", "Europe/Moscow"),
  };

  res.json({ ok: true, cfg });
});

// PATCH reminder settings (admin)
r.patch("/api/admin/reminder", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!requireAdmin(req, res, user)) return;

  const b = req.body || {};
  if (b.enabled !== undefined) await setSetting("remind_enabled", b.enabled ? "1" : "0");
  if (b.weekday) await setSetting("remind_weekday", String(Number(b.weekday)));
  if (b.time) await setSetting("remind_time", String(b.time));
  if (b.tz) await setSetting("remind_tz", String(b.tz));

  res.json({ ok: true });
});

// Send reminder now (admin)
r.post("/api/admin/reminder/sendNow", async (req, res) => {
  const user = requireWebAppAuth(req, res);
  if (!user) return;
  if (!requireAdmin(req, res, user)) return;

  const chatId = await getSetting("notify_chat_id", null);
  if (!chatId) return res.status(400).json({ ok: false, reason: "notify_chat_id_not_set" });

  const r = await sendRsvpReminder(chatId);
  res.json(r);
});
r.post("/cron/tick", async (req, res) => {
  const secret = req.header("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ ok: false, reason: "bad_cron_secret" });
  }

  const enabled = (await getSetting("remind_enabled", "1")) === "1";
  if (!enabled) return res.json({ ok: true, skipped: "disabled" });

  const weekday = Number(await getSetting("remind_weekday", "2"));
  const time = await getSetting("remind_time", "12:00"); // "HH:mm"
  const tz = await getSetting("remind_tz", "Europe/Moscow");
  const chatId = await getSetting("notify_chat_id", null);
  if (!chatId) return res.json({ ok: true, skipped: "no_chat" });

  const now = DateTime.now().setZone(tz);
  const [hh, mm] = String(time).split(":").map(Number);

  // “окно” 3 минуты, чтобы cron */5 не промахивался
  const target = now.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
  const diffMin = Math.abs(now.diff(target, "minutes").minutes);

  if (now.weekday !== weekday || diffMin > 3) {
    return res.json({ ok: true, skipped: "not_time" });
  }

  // анти-дубль: один раз в день
  const todayKey = `remind_sent_${now.toISODate()}`;
  const already = (await getSetting(todayKey, "0")) === "1";
  if (already) return res.json({ ok: true, skipped: "already_sent" });

  await sendRsvpReminder(chatId);
  await setSetting(todayKey, "1");

  res.json({ ok: true, sent: true });
});

  return r;
}
