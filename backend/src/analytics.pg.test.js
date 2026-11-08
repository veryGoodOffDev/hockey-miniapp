import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createEngagementHandler } from "./engagement.js";
import { createGameAttendanceHandler } from "./gameAttendanceStats.js";

const database = process.env.ANALYTICS_TEST_DATABASE_URL;
test(
  "PostgreSQL + HTTP: November/December visits, historical year, auth, Moscow bounds, real game counts and exclusions",
  { skip: !database },
  async () => {
    const url = new URL(database);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_checks"),
      "local isolated test DB required",
    );
    const client = new pg.Client({ connectionString: database });
    await client.connect();
    const schema = "analytics_" + randomUUID().replaceAll("-", "");
    let server;
    try {
      await client.query(
        `CREATE SCHEMA ${schema}; SET search_path TO ${schema}`,
      );
      await client.query(`CREATE TABLE players(tg_id bigint PRIMARY KEY, display_name text, first_name text, last_name text, username text, jersey_number int, disabled boolean DEFAULT false, player_kind text DEFAULT 'tg');
      CREATE TABLE app_daily_visits(visit_date date, tg_id bigint, PRIMARY KEY(visit_date,tg_id));
      CREATE TABLE games(id int PRIMARY KEY, starts_at timestamptz, location text DEFAULT 'Арена', status text DEFAULT 'scheduled');
      CREATE TABLE rsvps(game_id int, tg_id bigint, status text, PRIMARY KEY(game_id,tg_id));
      INSERT INTO players(tg_id,display_name) VALUES(1,'Иван'),(2,'Алексей');
      INSERT INTO app_daily_visits VALUES('2026-10-08',1),('2026-11-01',1),('2026-11-08',1),('2026-11-08',2),('2026-12-01',2),('2025-11-08',2);
      INSERT INTO games(id,starts_at,status) VALUES
        (1,'2019-12-31T21:30:00Z','scheduled'),(2,'2020-01-05T04:45:00Z','scheduled'),
        (3,'2020-01-12T04:45:00Z','cancelled'),(4,'2020-12-31T20:30:00Z','scheduled'),
        (5,'2020-12-31T21:00:00Z','scheduled'),(6,'2019-12-31T20:59:00Z','scheduled'),
        (7,NOW()+INTERVAL '1 day','scheduled'),(8,NOW()-INTERVAL '1 hour','scheduled'),(9,NOW()-INTERVAL '3 hours','scheduled');
      INSERT INTO rsvps VALUES(1,1,'yes'),(1,-11,'yes'),(1,2,'no'),(2,1,'yes'),(3,1,'yes'),(4,1,'maybe'),(5,1,'yes'),(6,1,'yes'),(7,1,'yes'),(8,1,'yes'),(9,1,'yes');`);
      const q = (sql, values) => client.query(sql, values);
      const auth =
        (admin = false) =>
        async (req, res) => {
          if (!req.header("x-test-user")) {
            res.status(401).json({ ok: false });
            return null;
          }
          if (admin && req.header("x-test-user") !== "admin") {
            res.status(403).json({ ok: false });
            return null;
          }
          return { id: 1 };
        };
      const app = express();
      app.get(
        "/engagement",
        createEngagementHandler({
          q,
          authenticate: auth(true),
          now: () => new Date("2026-11-08T09:00:00Z"),
        }),
      );
      app.get(
        "/attendance",
        createGameAttendanceHandler({ q, authenticate: auth() }),
      );
      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const get = async (path, user = "admin") => {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}` + path,
          { headers: user ? { "x-test-user": user } : {} },
        );
        return {
          status: response.status,
          data: await response.json(),
          cache: response.headers.get("cache-control"),
        };
      };
      assert.equal(
        (await get("/engagement?year=2026&month=11", null)).status,
        401,
      );
      assert.equal(
        (await get("/engagement?year=2026&month=11", "player")).status,
        403,
      );
      const november = await get("/engagement?year=2026&month=11");
      assert.equal(november.cache, "no-store");
      assert.deepEqual(november.data.by_day, {
        "2026-11-01": 1,
        "2026-11-08": 2,
      });
      assert.equal(november.data.users_by_day["2026-11-08"].length, 2);
      assert.equal(
        (await get("/engagement?year=2026&month=12")).data.by_day["2026-12-01"],
        1,
      );
      assert.equal(
        (await get("/engagement?year=2025&month=11")).data.by_day["2025-11-08"],
        1,
      );
      assert.equal((await get("/engagement?year=2026&month=13")).status, 400);
      assert.equal((await get("/attendance?year=2020", null)).status, 401);
      const attendance = await get("/attendance?year=2020", "player");
      assert.deepEqual(
        attendance.data.games.map((g) => [g.id, g.date, g.players]),
        [
          [1, "2020-01-01", 2],
          [2, "2020-01-05", 1],
          [4, "2020-12-31", 0],
        ],
      );
      assert.deepEqual(
        (await get("/attendance?from=2020-01-01&to=2020-01-01")).data.games.map(
          (g) => g.id,
        ),
        [1],
      );
      assert.equal(
        (await get("/attendance?from=2020-02-30&to=2020-03-01")).status,
        400,
      );
      const current = await get("/attendance");
      assert.ok(current.data.games.some((g) => g.id === 9));
      assert.ok(!current.data.games.some((g) => [7, 8].includes(g.id)));
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      await client.end();
    }
  },
);
