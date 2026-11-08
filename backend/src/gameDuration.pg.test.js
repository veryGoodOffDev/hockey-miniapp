import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { ensureGameDurationSchema } from "./gameDuration.js";
import { createMatchAwardHandler } from "./matchAward.js";
import { getPreviousMatchAward } from "./previousMatchAward.js";
import { createGameAttendanceHandler } from "./gameAttendanceStats.js";

const database = process.env.DURATION_TEST_DATABASE_URL;
test(
  "PostgreSQL: backfill/default/idempotence/constraints, authoritative award timing, reassignment/removal and duration-aware analytics/trophy",
  { skip: !database },
  async () => {
    const url = new URL(database);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_checks"),
    );
    const schema = "duration_" + randomUUID().replaceAll("-", "");
    const admin = new pg.Client({ connectionString: database });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: database,
      options: `-c search_path=${schema}`,
    });
    const q = (sql, p) => pool.query(sql, p);
    const withTransaction = async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn((sql, p) => client.query(sql, p));
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    };
    let server;
    try {
      await q(`CREATE TABLE games(id serial PRIMARY KEY,starts_at timestamptz,status text DEFAULT 'scheduled',location text DEFAULT '',updated_at timestamptz DEFAULT NOW(),best_player_tg_id bigint,best_player_set_by bigint,best_player_set_at timestamptz,best_player_source text);
      CREATE TABLE players(tg_id bigint PRIMARY KEY,display_name text,first_name text,username text,disabled boolean DEFAULT false);
      CREATE TABLE rsvps(game_id int,tg_id bigint,status text,PRIMARY KEY(game_id,tg_id));
      INSERT INTO games(id,starts_at) VALUES(1,NOW()-INTERVAL '1 day'),(2,NOW()+INTERVAL '7 days');
      INSERT INTO players(tg_id,display_name,disabled) VALUES(1,'Иван',false),(2,'Алексей',false),(3,'Отключён',true),(-12,'Гость',false)`);
      await ensureGameDurationSchema(q);
      assert.deepEqual(
        (await q("SELECT duration_minutes FROM games ORDER BY id")).rows.map(
          (r) => r.duration_minutes,
        ),
        [75, 75],
      );
      await q("UPDATE games SET duration_minutes=90 WHERE id=2");
      await ensureGameDurationSchema(q);
      assert.equal(
        (await q("SELECT duration_minutes FROM games WHERE id=2")).rows[0]
          .duration_minutes,
        90,
      );
      await q(
        "INSERT INTO games(id,starts_at) VALUES(3,NOW()-INTERVAL '1 day')",
      );
      assert.equal(
        (await q("SELECT duration_minutes FROM games WHERE id=3")).rows[0]
          .duration_minutes,
        75,
      );
      for (const value of [0, 1441])
        await assert.rejects(
          q("UPDATE games SET duration_minutes=$1 WHERE id=1", [value]),
          (e) => e.code === "23514",
        );
      const app = express();
      app.use(express.json());
      app.post(
        "/award/:id",
        createMatchAwardHandler({
          withTransaction,
          authenticate: (req, res) => {
            if (!req.header("x-test-user")) {
              res.status(401).json({ ok: false });
              return null;
            }
            if (req.header("x-test-user") !== "admin") {
              res.status(403).json({ ok: false });
              return null;
            }
            return { id: 1 };
          },
        }),
      );
      app.get(
        "/stats",
        createGameAttendanceHandler({ q, authenticate: () => ({ id: 1 }) }),
      );
      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${server.address().port}`;
      const award = async (id, player, user = "admin") => {
        const res = await fetch(base + `/award/${id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(user ? { "x-test-user": user } : {}),
          },
          body: JSON.stringify({ best_player_tg_id: player }),
        });
        return { status: res.status, data: await res.json() };
      };
      assert.equal((await award(1, 1, null)).status, 401);
      assert.equal((await award(1, 1, "player")).status, 403);
      await q(
        "UPDATE games SET starts_at=NOW()-INTERVAL '74 minutes',duration_minutes=75 WHERE id=1",
      );
      assert.equal((await award(1, 1)).data.reason, "game_not_finished");
      assert.equal(
        (await q("SELECT best_player_tg_id FROM games WHERE id=1")).rows[0]
          .best_player_tg_id,
        null,
      );
      await q(
        "UPDATE games SET starts_at=NOW()-INTERVAL '75 minutes 1 second' WHERE id=1",
      );
      assert.equal((await award(1, 1)).status, 200);
      assert.equal((await award(1, 2)).data.game.best_player_tg_id, "2");
      assert.equal((await award(1, null)).data.game.best_player_tg_id, null);
      assert.equal((await award(1, 3)).data.reason, "bad_player");
      assert.equal((await award(1, -12)).status, 200);
      await q("UPDATE games SET duration_minutes=90 WHERE id=1");
      assert.equal((await award(1, 2)).status, 409);
      await q(
        "UPDATE games SET starts_at=NOW()-INTERVAL '91 minutes' WHERE id=1",
      );
      const concurrent = await Promise.all([award(1, 1), award(1, 2)]);
      assert.ok(concurrent.every((r) => r.status === 200));
      assert.ok(
        ["1", "2"].includes(
          (await q("SELECT best_player_tg_id FROM games WHERE id=1")).rows[0]
            .best_player_tg_id,
        ),
      );
      assert.equal((await award(999, 1)).status, 404);
      assert.equal((await award(1, {})).status, 400);
      await q("UPDATE games SET status='cancelled' WHERE id=1");
      assert.equal((await award(1, 1)).data.reason, "game_cancelled");
      await q(`INSERT INTO games(id,starts_at,duration_minutes,best_player_tg_id) VALUES
      (10,NOW()-INTERVAL '80 minutes',90,1),(11,NOW()+INTERVAL '1 day',75,NULL)`);
      assert.equal(await getPreviousMatchAward(q, 11), null);
      await q("UPDATE games SET duration_minutes=75 WHERE id=10");
      assert.equal(Number((await getPreviousMatchAward(q, 11)).game_id), 10);
      await q(
        `INSERT INTO games(id,starts_at,duration_minutes) VALUES(20,NOW()-INTERVAL '80 minutes',75),(21,NOW()-INTERVAL '80 minutes',90)`,
      );
      const year = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Moscow",
        year: "numeric",
      }).format(new Date());
      const stats = await (await fetch(base + `/stats?year=${year}`)).json();
      assert.ok(stats.games.some((g) => g.id === 20));
      assert.ok(!stats.games.some((g) => g.id === 21));
    } finally {
      if (server) await new Promise((r) => server.close(r));
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
