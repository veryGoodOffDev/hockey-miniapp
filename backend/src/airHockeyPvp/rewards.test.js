import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { ensurePvpSchema } from "./schema.js";
import { createPvpRepository } from "./rewards.js";
const db = process.env.RSVP_TEST_DATABASE_URL;
test(
  "PostgreSQL sessions and rewards: exactly once, minimum duration, technical wins, pair/day caps and restart recovery",
  { skip: !db },
  async () => {
    const url = new URL(db);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_checks"),
    );
    const schema = `pvp_test_${process.pid}`,
      admin = new pg.Pool({ connectionString: db });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: db,
      options: `-c search_path=${schema}`,
    });
    const q = (sql, params) => pool.query(sql, params);
    const withTransaction = async (work) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const result = await work((sql, p) => c.query(sql, p));
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    };
    try {
      await q(
        `CREATE TABLE players(tg_id bigint PRIMARY KEY);INSERT INTO players SELECT generate_series(1,30);CREATE TABLE user_game_profiles(user_id bigint PRIMARY KEY REFERENCES players(tg_id),sheep_coins int DEFAULT 0,total_sheep_coins_earned int DEFAULT 0,wins int DEFAULT 0,losses int DEFAULT 0,total_games int DEFAULT 0,updated_at timestamptz DEFAULT NOW());CREATE TABLE sheep_coin_transactions(id bigserial PRIMARY KEY,user_id bigint,amount int,type text,source text);`,
      );
      await ensurePvpSchema(q);
      await ensurePvpSchema(q);
      const repo = createPvpRepository({ q, withTransaction });
      const make = async (a = 1, b = 2, override = {}) => {
        const room = {
          matchId: randomUUID(),
          code: "4831",
          players: [{ id: String(a) }, { id: String(b) }],
          status: "finished",
          score: [7, 4],
          winner: 0,
          finishReason: "goals",
          activeMs: 60001,
          ...override,
        };
        await repo.create(room);
        await repo.join(room);
        await repo.start(room);
        return room;
      };
      const first = await make();
      const results = await Promise.all([
        repo.finish(first),
        repo.finish(first),
      ]);
      assert.deepEqual(results[0].rewards, [25, 3]);
      assert.deepEqual(results[1].rewards, [25, 3]);
      assert.equal(
        (await q("SELECT sheep_coins FROM user_game_profiles WHERE user_id=1"))
          .rows[0].sheep_coins,
        25,
      );
      assert.equal(
        (
          await q(
            "SELECT COUNT(*)::int n FROM sheep_coin_transactions WHERE pvp_match_id=$1",
            [first.matchId],
          )
        ).rows[0].n,
        2,
      );
      for (let i = 0; i < 2; i++)
        assert.deepEqual((await repo.finish(await make())).rewards, [25, 3]);
      const capped = await repo.finish(await make());
      assert.deepEqual(capped.rewards, [0, 0]);
      assert.deepEqual(capped.reasons, ["pair_limit", "pair_limit"]);
      const short = await repo.finish(await make(11, 12, { activeMs: 59999 }));
      assert.deepEqual(short.rewards, [0, 0]);
      assert.deepEqual(short.reasons, ["too_short", "too_short"]);
      assert.deepEqual(
        (
          await repo.finish(
            await make(11, 12, {
              activeMs: 5000,
              finishReason: "disconnect",
              score: [0, 0],
            }),
          )
        ).rewards,
        [0, 0],
      );
      assert.deepEqual(
        (
          await repo.finish(
            await make(11, 12, {
              activeMs: 120001,
              finishReason: "disconnect",
              score: [2, 1],
            }),
          )
        ).rewards,
        [25, 0],
      );
      assert.deepEqual(
        (
          await repo.finish(
            await make(13, 14, {
              activeMs: 120001,
              finishReason: "disconnect",
              score: [0, 0],
            }),
          )
        ).rewards,
        [0, 0],
      );
      for (let other = 3; other <= 9; other++)
        assert.equal((await repo.finish(await make(1, other))).rewards[0], 25);
      const daily = await repo.finish(await make(1, 10));
      assert.equal(daily.rewards[0], 0);
      assert.equal(daily.reasons[0], "daily_limit");
      assert.equal(daily.rewards[1], 3);
      const previous = await make(20, 21);
      await repo.finish(previous);
      await q(
        "UPDATE air_hockey_pvp_matches SET finished_at=NOW()-INTERVAL '2 days' WHERE id=$1",
        [previous.matchId],
      );
      assert.equal((await repo.finish(await make(20, 21))).rewards[0], 25);
      const pending = await make(22, 23);
      await repo.recover();
      const cancelled = (
        await q(
          "SELECT status,reward_processed,reward_a FROM air_hockey_pvp_matches WHERE id=$1",
          [pending.matchId],
        )
      ).rows[0];
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.reward_processed, true);
      assert.equal(cancelled.reward_a, 0);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
