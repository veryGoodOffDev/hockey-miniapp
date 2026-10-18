import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { getPreviousMatchAward } from "./previousMatchAward.js";

test(
  "PostgreSQL: trophy belongs only to the next actual match, never skips an unawarded match or jumps from the latest holder",
  { skip: !process.env.RSVP_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.RSVP_TEST_DATABASE_URL);
    assert.equal(url.hostname, "localhost");
    assert.ok(url.pathname.endsWith("_checks"));
    const client = new pg.Client({ connectionString: url.href, ssl: false });
    await client.connect();
    let created = false;
    try {
      await client.query("CREATE SCHEMA previous_award_fixture");
      created = true;
      await client.query("SET search_path TO previous_award_fixture");
      const q = (s, a) => client.query(s, a);
      await q(`CREATE TABLE players(tg_id BIGINT PRIMARY KEY, display_name TEXT,first_name TEXT,username TEXT);
      CREATE TABLE games(id INT PRIMARY KEY,starts_at TIMESTAMPTZ NOT NULL,status TEXT,best_player_tg_id BIGINT);
      INSERT INTO players VALUES(1,'Алиса','',NULL),(2,'','Борис',NULL);
      INSERT INTO games VALUES(10,NOW()-INTERVAL '14 days','scheduled',1),
        (20,NOW()-INTERVAL '7 days','scheduled',NULL),
        (30,NOW()+INTERVAL '7 days','scheduled',NULL),
        (40,NOW()+INTERVAL '14 days','scheduled',NULL)`);
      assert.equal(await getPreviousMatchAward(q, 10), null);
      assert.equal(await getPreviousMatchAward(q, 999), null);
      assert.equal((await getPreviousMatchAward(q, 20)).name, "Алиса");
      assert.equal(await getPreviousMatchAward(q, 30), null); // Do not reach past the unawarded game 20.
      await q("UPDATE games SET best_player_tg_id=2 WHERE id=20");
      assert.equal(Number((await getPreviousMatchAward(q, 30)).game_id), 20);
      assert.equal((await getPreviousMatchAward(q, 30)).name, "Борис");
      assert.equal(await getPreviousMatchAward(q, 40), null); // Only the immediate next game.
      await q("UPDATE games SET best_player_tg_id=1 WHERE id=30");
      assert.equal(await getPreviousMatchAward(q, 40), null); // Future predecessor cannot supply a trophy.
      await q(
        "INSERT INTO games VALUES(25,NOW()-INTERVAL '3 days','cancelled',1)",
      );
      assert.equal(Number((await getPreviousMatchAward(q, 30)).tg_id), 2);
      await q("UPDATE games SET status='cancelled' WHERE id=30");
      assert.equal(await getPreviousMatchAward(q, 30), null);
      await q("UPDATE games SET status='scheduled' WHERE id=30");
      await q(
        "INSERT INTO games VALUES(5,NOW()-INTERVAL '5 days','scheduled',1)",
      );
      assert.equal(Number((await getPreviousMatchAward(q, 30)).game_id), 5); // Dates, not insertion IDs.
      assert.equal(Number((await getPreviousMatchAward(q, 5)).game_id), 20);
      await q(
        "INSERT INTO games SELECT 6,starts_at,'scheduled',2 FROM games WHERE id=5",
      );
      assert.equal(Number((await getPreviousMatchAward(q, 6)).game_id), 5);
      assert.equal(Number((await getPreviousMatchAward(q, 30)).game_id), 6);
      await q("DELETE FROM players WHERE tg_id=2");
      assert.equal((await getPreviousMatchAward(q, 30)).name, "2");
      await q("UPDATE games SET best_player_tg_id=NULL WHERE id=6");
      assert.equal(await getPreviousMatchAward(q, 30), null); // Cancellation clears the reminder too.
    } finally {
      if (created)
        await client.query("DROP SCHEMA previous_award_fixture CASCADE");
      await client.end();
    }
  },
);
