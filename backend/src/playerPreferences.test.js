import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { createPlayerPreferencesHandler } from "./playerPreferences.js";

async function fixture(run) {
  const rows = new Map([
    [1, { rsvp_view: "list", display_name: "Иван", position: "D" }],
    [2, { rsvp_view: "chips", display_name: "Алексей", position: "F" }],
  ]);
  const queries = [];
  let fail = false;
  const app = express();
  app.use(express.json());
  app.patch(
    "/api/me/preferences",
    createPlayerPreferencesHandler({
      authenticate: async (req, res) => {
        if (req.header("x-test-auth") === "denied") {
          res.status(403).json({ ok: false, reason: "not_member" });
          return null;
        }
        const id = Number(req.header("x-test-auth"));
        if (!id) {
          res.status(401).json({ ok: false, reason: "no_init_data" });
          return null;
        }
        return { id };
      },
      q: async (sql, args) => {
        queries.push([sql, args]);
        if (fail) throw new Error("test database failure");
        const row = rows.get(args[0]);
        if (!row) return { rows: [] };
        row.rsvp_view = args[1];
        return { rows: [{ rsvp_view: row.rsvp_view }] };
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const patch = (body, auth) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/me/preferences`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { "x-test-auth": String(auth) } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    await run({
      rows,
      queries,
      patch,
      fail: () => {
        fail = true;
      },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("preference route authenticates and changes only the current player setting", () =>
  fixture(async ({ rows, queries, patch }) => {
    assert.equal((await patch({ rsvp_view: "chips" })).status, 401);
    assert.equal((await patch({ rsvp_view: "chips" }, "denied")).status, 403);
    assert.equal(queries.length, 0);
    const result = await patch({ rsvp_view: "chips" }, 1);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {
      ok: true,
      preferences: { rsvp_view: "chips" },
    });
    assert.deepEqual(rows.get(1), {
      rsvp_view: "chips",
      display_name: "Иван",
      position: "D",
    });
    assert.deepEqual(rows.get(2), {
      rsvp_view: "chips",
      display_name: "Алексей",
      position: "F",
    });
    assert.deepEqual(queries[0][1], [1, "chips"]);
    assert.equal((await patch({ rsvp_view: "list" }, 1)).status, 200);
    assert.equal(rows.get(1).rsvp_view, "list");
    assert.equal((await patch({ rsvp_view: "list" }, 999)).status, 404);
  }));

test("rejects invalid modes, other fields and spoofed account IDs before SQL", () =>
  fixture(async ({ patch, queries }) => {
    for (const body of [
      {},
      { rsvp_view: "grid" },
      { rsvp_view: null },
      { rsvp_view: "CHIPS" },
      [],
      null,
      { rsvp_view: "chips", userId: 2 },
      { rsvp_view: "chips", position: "G" },
    ])
      assert.equal((await patch(body, 1)).status, 400, JSON.stringify(body));
    assert.equal(queries.length, 0);
  }));

test("database failure returns a retryable error rather than pretending it saved", () =>
  fixture(async ({ patch, fail }) => {
    fail();
    const result = await patch({ rsvp_view: "chips" }, 1);
    assert.equal(result.status, 500);
    assert.deepEqual(await result.json(), {
      ok: false,
      reason: "server_error",
    });
  }));
