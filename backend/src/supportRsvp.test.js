import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { ensureSchema } from "./schema.js";
import { createSupportRsvpWorker, formatSupportRsvp } from "./supportRsvp.js";

test("private RSVP table escapes names, shows local timestamps and excludes automatic/unmarked players", () => {
  const text = formatSupportRsvp({ id: 7, starts_at: "2026-10-12T12:00:00Z", location: "<Арена>" }, [
    { tg_id: 1, display_name: "<Иван & Игорь>", status: "yes", updated_at: "2026-10-10T12:30:00Z" },
    { tg_id: 2, display_name: "Пётр", status: "no", updated_at: "2026-10-10T13:30:00Z" },
    { tg_id: 3, display_name: "Автоматический", status: "no", auto_no: true },
    { tg_id: 4, display_name: "Без отметки", status: "maybe" },
  ], "2026-10-10T13:30:00Z");
  assert.ok(text.includes("IN — 1") && text.includes("OUT — 1"));
  assert.ok(text.includes("&lt;Иван &amp; Игорь&gt;") && text.includes("15:30"));
  assert.ok(text.includes("<pre>"));
  assert.ok(!text.includes("Автоматический") && !text.includes("Без отметки"));
});

test("large tables remain within Telegram's limit and disclose overflow", () => {
  const players = Array.from({ length: 300 }, (_, tg_id) => ({ tg_id, display_name: "<&>".repeat(20), status: "yes", updated_at: "2026-10-10T12:30:00Z" }));
  const text = formatSupportRsvp({ id: 7, starts_at: "2026-10-12T12:00:00Z" }, players, "2026-10-10T13:30:00Z");
  assert.ok(text.length < 4096);
  assert.ok(text.includes("Ещё"));
});

test("no Telegram calls are made for a group or an unauthorized private recipient", async () => {
  for (const chatId of ["-10042", "42"]) {
    const worker = createSupportRsvpWorker({ chatId, isAdmin: async () => false,
      call: async () => assert.fail("must not contact Telegram"), withTransaction: async () => assert.fail("must not query queue") });
    await worker.tick();
  }
});

test("PostgreSQL audit, rollback, bulk changes, persistent edits and delivery retries", {
  skip: !process.env.RSVP_TEST_DATABASE_URL,
}, async () => {
  const url = new URL(process.env.RSVP_TEST_DATABASE_URL);
  assert.equal(url.hostname, "localhost");
  assert.ok(url.pathname.endsWith("_checks"), "use a disposable local *_checks database");
  const pool = new pg.Pool({ connectionString: url.href, ssl: false });
  const q = (sql, args) => pool.query(sql, args);
  const withTransaction = async work => {
    const c = await pool.connect();
    try { await c.query("BEGIN"); const r = await work((s, a) => c.query(s, a)); await c.query("COMMIT"); return r; }
    catch (e) { await c.query("ROLLBACK"); throw e; }
    finally { c.release(); }
  };
  const gameIds = [918271, 918272], playerIds = [918281, 918282];
  const calls = [], logger = { error() {} };
  let failEdit = false, duringEdit = null;
  const call = async (method, payload) => {
    if (method === "getMe") return { id: 801, is_bot: true };
    calls.push({ method, payload });
    if (method === "editMessageText" && failEdit) { failEdit = false; throw Object.assign(Error("rate limit"), { error_code: 429, retry_after: 5 }); }
    if (method === "editMessageText" && duringEdit) { const change = duringEdit; duringEdit = null; await change(); }
    return { message_id: payload.message_id || 100 + calls.length };
  };
  const worker = () => createSupportRsvpWorker({ withTransaction, call, chatId: "42", isAdmin: async () => true, logger });
  try {
    await ensureSchema(q); await ensureSchema(q);
    await q("INSERT INTO players(tg_id,display_name) VALUES($1,'Тест IN'),($2,'Тест OUT')", playerIds);
    await q("INSERT INTO games(id,starts_at,location) VALUES($1,NOW()+INTERVAL '1 day','Арена'),($2,NOW()+INTERVAL '2 days','Арена')", gameIds);
    await assert.rejects(withTransaction(async query => {
      await query("INSERT INTO rsvps(game_id,tg_id,status) VALUES($1,$2,'yes')", [gameIds[0], playerIds[0]]);
      throw Error("rollback probe");
    }));
    assert.equal((await q("SELECT * FROM rsvp_history WHERE game_id=$1", [gameIds[0]])).rowCount, 0);
    await q("INSERT INTO rsvps(game_id,tg_id,status) SELECT id,$1,'yes' FROM games WHERE id=ANY($2::int[])", [playerIds[0], gameIds]);
    await q("INSERT INTO rsvps(game_id,tg_id,status,auto_no) VALUES($1,$2,'no',TRUE)", [gameIds[0], playerIds[1]]);
    const first = worker();
    await first.tick(); await first.tick();
    const sends = calls.filter(c => c.method === "sendMessage");
    assert.equal(sends.length, 2, "one initial message per marked game");
    assert.ok(sends.every(c => c.payload.chat_id === "42" && !c.payload.text.includes("Тест OUT")));
    const saved = (await q("SELECT * FROM support_rsvp_messages WHERE game_id=$1", [gameIds[0]])).rows[0];
    await q("UPDATE rsvps SET status='no',updated_at=NOW() WHERE game_id=$1 AND tg_id=$2", [gameIds[0], playerIds[0]]);
    await worker().tick(); // simulate a process restart: recover the message ID
    assert.equal(calls.at(-1).method, "editMessageText");
    assert.equal(Number(calls.at(-1).payload.message_id), Number(saved.message_id));
    assert.ok(calls.at(-1).payload.text.includes("OUT — 1"));
    await q("UPDATE rsvps SET status='yes',updated_at=NOW() WHERE game_id=$1 AND tg_id=$2", [gameIds[0], playerIds[0]]);
    failEdit = true; await first.tick();
    assert.equal((await q("SELECT attempts FROM support_rsvp_dirty WHERE game_id=$1", [gameIds[0]])).rows[0].attempts, 1);
    await q("UPDATE support_rsvp_dirty SET next_attempt_at=NOW() WHERE game_id=$1", [gameIds[0]]);
    await first.tick();
    assert.equal(calls.filter(c => c.method === "sendMessage").length, 2);
    const events = (await q("SELECT from_status,to_status FROM rsvp_history WHERE game_id=$1 AND tg_id=$2 ORDER BY id", [gameIds[0], playerIds[0]])).rows;
    assert.deepEqual(events, [{ from_status: null, to_status: "yes" }, { from_status: "yes", to_status: "no" }, { from_status: "no", to_status: "yes" }]);
    await q("UPDATE rsvps SET status='no',updated_at=NOW() WHERE game_id=$1 AND tg_id=$2", [gameIds[0], playerIds[0]]);
    duringEdit = () => q("UPDATE rsvps SET status='yes',updated_at=NOW() WHERE game_id=$1 AND tg_id=$2", [gameIds[0], playerIds[0]]);
    await first.tick();
    assert.equal((await q("SELECT * FROM support_rsvp_dirty WHERE game_id=$1", [gameIds[0]])).rowCount, 1, "a new mark during delivery must not block or be lost");
    await first.tick();
    assert.ok(calls.at(-1).payload.text.includes("IN — 1"));
    await q("DELETE FROM rsvps WHERE game_id=$1 AND tg_id=$2", [gameIds[0], playerIds[0]]);
    await first.tick();
    assert.ok(calls.at(-1).payload.text.includes("IN — 0"));
    assert.equal((await q("SELECT to_status FROM rsvp_history WHERE game_id=$1 AND tg_id=$2 ORDER BY id DESC LIMIT 1", [gameIds[0], playerIds[0]])).rows[0].to_status, null);
  } finally {
    await q("DELETE FROM games WHERE id=ANY($1::int[])", [gameIds]);
    await q("DELETE FROM players WHERE tg_id=ANY($1::bigint[])", [playerIds]);
    await pool.end();
  }
});
