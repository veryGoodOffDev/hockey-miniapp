import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { ensureSchema } from "./schema.js";
import { createPlayerPreferencesHandler } from "./playerPreferences.js";

test(
  "PostgreSQL: upgrade existing profiles, keep defaults/constraints, persist independently and preserve profile fields",
  { skip: !process.env.RSVP_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.RSVP_TEST_DATABASE_URL);
    assert.equal(url.hostname, "localhost");
    assert.ok(url.pathname.endsWith("_checks"));
    const client = new pg.Client({ connectionString: url.href, ssl: false });
    await client.connect();
    let created = false;
    try {
      await client.query("CREATE SCHEMA rsvp_view_fixture");
      created = true;
      await client.query("SET search_path TO rsvp_view_fixture");
      const q = (sql, args) => client.query(sql, args);
      await ensureSchema(q);
      await q("ALTER TABLE players DROP COLUMN rsvp_view"); // Simulate a deployed profile before this change.
      await q(
        "INSERT INTO players(tg_id,display_name,position,jersey_number) VALUES(1,'Иван','D',15),(2,'Алексей','F',92)",
      );
      await ensureSchema(q);
      assert.deepEqual(
        (await q("SELECT rsvp_view FROM players ORDER BY tg_id")).rows,
        [{ rsvp_view: "list" }, { rsvp_view: "list" }],
      );
      const handler = createPlayerPreferencesHandler({
        authenticate: async () => ({ id: 1 }),
        q,
      });
      let output;
      const res = {
        status() {
          return this;
        },
        json(value) {
          output = value;
          return this;
        },
      };
      await handler({ body: { rsvp_view: "chips" } }, res);
      assert.deepEqual(output, {
        ok: true,
        preferences: { rsvp_view: "chips" },
      });
      assert.deepEqual(
        (
          await q(
            "SELECT tg_id::text,display_name,position,jersey_number,rsvp_view FROM players ORDER BY tg_id",
          )
        ).rows,
        [
          {
            tg_id: "1",
            display_name: "Иван",
            position: "D",
            jersey_number: 15,
            rsvp_view: "chips",
          },
          {
            tg_id: "2",
            display_name: "Алексей",
            position: "F",
            jersey_number: 92,
            rsvp_view: "list",
          },
        ],
      );
      await ensureSchema(q); // Restart does not reset preferences.
      assert.equal(
        (await q("SELECT rsvp_view FROM players WHERE tg_id=1")).rows[0]
          .rsvp_view,
        "chips",
      );
      await assert.rejects(
        q("UPDATE players SET rsvp_view='grid' WHERE tg_id=1"),
        { code: "23514" },
      );
      await assert.rejects(
        q("UPDATE players SET rsvp_view=NULL WHERE tg_id=1"),
        { code: "23502" },
      );
    } finally {
      if (created) await client.query("DROP SCHEMA rsvp_view_fixture CASCADE");
      await client.end();
    }
  },
);
