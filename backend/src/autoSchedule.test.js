import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  createAutoScheduleService,
  startAutoScheduleWorker,
} from "./autoSchedule.js";
const databaseUrl = process.env.RSVP_TEST_DATABASE_URL;
test(
  "schedule counts live games, replaces finished games, respects toggle and avoids concurrent duplicates",
  { skip: !databaseUrl },
  async () => {
    const url = new URL(databaseUrl);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_checks"),
    );
    const schema = `auto_schedule_test_${process.pid}`;
    const admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
    });
    const q = (sql, params) => pool.query(sql, params);
    const withTransaction = async (work) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await work((sql, p) => c.query(sql, p));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    };
    try {
      await q(
        "CREATE TABLE settings(key text PRIMARY KEY,value text); CREATE TABLE games(id serial PRIMARY KEY,starts_at timestamptz,location text,status text,geo_lat float8,geo_lon float8)",
      );
      const cfg = {
        enabled: true,
        target_count: 3,
        weekday: 0,
        time: "07:45",
        location: "Арена",
        geo_lat: 60,
        geo_lon: 30,
      };
      const save = () =>
        q(
          "INSERT INTO settings VALUES('auto_schedule_config',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          [JSON.stringify(cfg)],
        );
      await save();
      await q(
        "INSERT INTO games(starts_at,status) VALUES(NOW()-INTERVAL '1 hour','scheduled'),(NOW()+INTERVAL '7 days','scheduled'),(NOW()+INTERVAL '14 days','scheduled'),(NOW()+INTERVAL '21 days','cancelled')",
      );
      const service = createAutoScheduleService({ q, withTransaction });
      const ensure = service.ensureAutoScheduledGames;
      assert.equal((await ensure()).created, 0);
      await q(
        "UPDATE games SET starts_at=NOW()-INTERVAL '2 hours 1 second' WHERE id=1",
      );
      const result = await ensure();
      assert.equal(result.created, 1);
      const game = result.created_games[0];
      assert.equal(game.location, "Арена");
      assert.equal(game.geo_lat, 60);
      assert.equal(game.geo_lon, 30);
      assert.equal(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "Europe/Moscow",
          weekday: "short",
        }).format(new Date(game.starts_at)),
        "Sun",
      );
      assert.equal(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Moscow",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(game.starts_at)),
        "07:45",
      );
      assert.equal((await ensure()).created, 0);
      cfg.enabled = false;
      await save();
      await q("DELETE FROM games WHERE id=$1", [game.id]);
      assert.equal((await ensure()).skipped, "disabled");
      assert.equal((await ensure({ ignoreEnabled: true })).created, 1);
      cfg.enabled = true;
      cfg.target_count = 6;
      await save();
      const results = await Promise.all(
        Array.from({ length: 4 }, () => ensure()),
      );
      assert.equal(
        results.reduce((n, r) => n + r.created, 0),
        3,
      );
      cfg.target_count = 7;
      await save();
      assert.equal((await ensure({ dryRun: true })).created, 1);
      assert.equal((await ensure()).created, 1);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
test("worker checks on startup, retries errors and stops", async () => {
  let calls = 0;
  const errors = [];
  const stop = startAutoScheduleWorker({
    intervalMs: 10,
    ensure: async () => {
      calls++;
      if (calls === 1) throw new Error("temporary");
      return { ok: true, created: 0 };
    },
    logger: { error: (...a) => errors.push(a), info: () => {} },
  });
  try {
    assert.equal(calls, 1);
    await new Promise((r) => setTimeout(r, 45));
    assert.ok(calls >= 2);
    assert.equal(errors.length, 1);
  } finally {
    stop();
  }
  const last = calls;
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(calls, last);
});
