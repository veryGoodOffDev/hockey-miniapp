import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { ensureSchema } from "./schema.js";
import { ensureRsvpAuditSchema } from "./rsvpAuditSchema.js";
import { createSupportRsvpWorker, formatSupportRsvp, formatSupportGameMenu } from "./supportRsvp.js";

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

test("game menu is limited to 12 and position changes are labelled", () => {
  const menu = formatSupportGameMenu(Array.from({ length: 14 }, (_, i) => ({ id:i+1,starts_at:"2026-10-12T12:00:00Z" })));
  assert.equal(menu.reply_markup.inline_keyboard.length, 13);
  assert.equal(menu.reply_markup.inline_keyboard[11][0].callback_data, "sr:game:12");
  const text = formatSupportRsvp({id:1,starts_at:"2026-10-12T12:00:00Z"}, [
    {tg_id:1,status:"yes",updated_at:"2026-10-10T10:00:00Z",last_interaction_at:"2026-10-10T12:00:00Z",last_interaction_kind:"position"},
  ], "2026-10-10T12:00:00Z");
  assert.ok(text.includes("15:00 (смена позиции)"));
});

test("PostgreSQL menu navigation, audit types, active-only delivery, restart and retry", {
  skip: !process.env.RSVP_TEST_DATABASE_URL,
}, async () => {
  const url = new URL(process.env.RSVP_TEST_DATABASE_URL);
  assert.equal(url.hostname, "localhost"); assert.ok(url.pathname.endsWith("_checks"));
  const pool = new pg.Pool({connectionString:url.href,ssl:false});
  const q = (sql,args) => pool.query(sql,args);
  const withTransaction = async work => {
    const c = await pool.connect();
    try { await c.query("BEGIN"); const r = await work((s,a)=>c.query(s,a)); await c.query("COMMIT"); return r; }
    catch(e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  };
  const gameIds = Array.from({length:13},(_,i)=>918271+i), playerIds = [918381,918382];
  const calls=[], updates=[]; let updateId=1, failEdit=false, duringEdit=null, deletedMenu=false;
  const edits=()=>calls.filter(c=>c.method==="editMessageText"), sends=()=>calls.filter(c=>c.method==="sendMessage");
  const call=async(method,payload)=>{
    if(method==="getMe")return{id:801,is_bot:true};
    if(method==="getUpdates")return updates.filter(u=>u.update_id>=payload.offset);
    calls.push({method,payload});
    if(method==="editMessageText"&&deletedMenu){deletedMenu=false;throw Object.assign(Error("deleted"),{error_code:400,description:"message to edit not found"});}
    if(method==="editMessageText"&&failEdit){failEdit=false;throw Object.assign(Error("limit"),{error_code:429,retry_after:1});}
    if(method==="editMessageText"&&duringEdit){const fn=duringEdit;duringEdit=null;await fn();}
    return {message_id:payload.message_id||100};
  };
  const worker=()=>createSupportRsvpWorker({withTransaction,call,chatId:"42",isAdmin:async()=>true,logger:{error(){}}});
  const callback=(data,from=42,chat=42,message=100)=>updates.push({update_id:updateId++,callback_query:{id:String(updateId),from:{id:from},data,message:{message_id:message,chat:{id:chat,type:"private"}}}});
  try {
    await ensureSchema(q);await ensureSchema(q);
    await q("INSERT INTO players(tg_id,display_name) VALUES($1,'Тест IN'),($2,'Автоматический')",playerIds);
    for(let i=0;i<gameIds.length;i++)await q("INSERT INTO games(id,starts_at,location) VALUES($1,NOW()+($2*INTERVAL '1 day'),'Арена')",[gameIds[i],i+1]);
    await assert.rejects(withTransaction(async query=>{await query("INSERT INTO rsvps(game_id,tg_id,status) VALUES($1,$2,'yes')",[gameIds[0],playerIds[0]]);throw Error("rollback");}));
    assert.equal((await q("SELECT * FROM rsvp_history WHERE game_id=$1",[gameIds[0]])).rowCount,0);
    await q("INSERT INTO rsvps(game_id,tg_id,status) SELECT id,$1,'yes' FROM games WHERE id=ANY($2::int[])",[playerIds[0],gameIds]);
    await q("INSERT INTO rsvps(game_id,tg_id,status,auto_no) VALUES($1,$2,'no',TRUE)",[gameIds[0],playerIds[1]]);
    const first=worker();await first.tick();
    assert.equal(sends().length,1,"one menu, not a message per game");
    assert.equal(sends()[0].payload.reply_markup.inline_keyboard[0][0].callback_data,"sr:list");
    callback("sr:list");await first.tick();
    assert.equal(edits().at(-1).payload.reply_markup.inline_keyboard.length,13);
    assert.equal(edits().at(-1).payload.message_id,"100");
    const beforeUnauthorized=edits().length;
    callback(`sr:game:${gameIds[0]}`,99);callback(`sr:game:${gameIds[0]}`,42,99);
    callback(`sr:game:${gameIds[0]}`,42,42,999);await first.tick();
    assert.equal(edits().length,beforeUnauthorized);
    callback(`sr:game:${gameIds[0]}`);await first.tick();
    assert.deepEqual(edits().at(-1).payload.reply_markup.inline_keyboard,[[{text:"← К играм",callback_data:"sr:list"}]]);
    assert.ok(edits().at(-1).payload.text.includes("IN — 1")&&!edits().at(-1).payload.text.includes("Автоматический"));
    const beforeInactive=edits().length;
    await q("UPDATE rsvps SET status='no',updated_at=NOW() WHERE game_id=$1 AND tg_id=$2",[gameIds[1],playerIds[0]]);
    await first.tick();assert.equal(edits().length,beforeInactive);
    const statusTime=(await q("SELECT status_changed_at FROM rsvps WHERE game_id=$1 AND tg_id=$2",[gameIds[0],playerIds[0]])).rows[0].status_changed_at;
    await q("UPDATE rsvps SET pos_override='G',updated_at=NOW() WHERE game_id=$1 AND tg_id=$2",[gameIds[0],playerIds[0]]);
    const position=(await q("SELECT * FROM rsvps WHERE game_id=$1 AND tg_id=$2",[gameIds[0],playerIds[0]])).rows[0];
    assert.equal(position.status_changed_at.getTime(),statusTime.getTime());assert.equal(position.last_interaction_kind,"position");
    await worker().tick();assert.ok(edits().at(-1).payload.text.includes("(смена позиции)"));
    await q("UPDATE rsvps SET status='no',updated_at=NOW() WHERE game_id=$1 AND tg_id=$2",[gameIds[0],playerIds[0]]);
    failEdit=true;await first.tick();const failedCount=edits().length;await first.tick();assert.equal(edits().length,failedCount,"honour rate limit backoff");
    await worker().tick();assert.ok(edits().at(-1).payload.text.includes("OUT — 1")&&!edits().at(-1).payload.text.includes("(смена позиции)"));
    await q("UPDATE rsvps SET status='yes',pos_override=NULL,updated_at=NOW() WHERE game_id=$1 AND tg_id=$2",[gameIds[0],playerIds[0]]);
    const restart=worker();duringEdit=()=>q("UPDATE rsvps SET status='no',updated_at=NOW() WHERE game_id=$1 AND tg_id=$2",[gameIds[0],playerIds[0]]);
    await restart.tick();await restart.tick();assert.ok(edits().at(-1).payload.text.includes("OUT — 1"));
    const history=(await q("SELECT from_status,to_status,interaction_kind FROM rsvp_history WHERE game_id=$1 AND tg_id=$2 ORDER BY id",[gameIds[0],playerIds[0]])).rows;
    assert.equal(history[1].interaction_kind,"position");assert.equal(history[1].from_status,history[1].to_status);
    assert.equal(history[2].interaction_kind,"status");assert.equal(history[2].to_status,"no");
    callback("sr:list");await restart.tick();callback(`sr:game:${gameIds[1]}`);await restart.tick();
    assert.ok(edits().at(-1).payload.text.includes(`· #${gameIds[1]}`)&&edits().at(-1).payload.text.includes("OUT — 1"));
    assert.equal(sends().length,1,"navigation and updates reuse the same message");
    await q("UPDATE players SET position='D' WHERE tg_id=$1",[playerIds[0]]);
    assert.equal((await q("SELECT last_interaction_kind FROM rsvps WHERE game_id=$1 AND tg_id=$2",[gameIds[2],playerIds[0]])).rows[0].last_interaction_kind,"position");
    await q("DELETE FROM rsvps WHERE game_id=$1 AND tg_id=$2",[gameIds[1],playerIds[0]]);await restart.tick();
    assert.ok(edits().at(-1).payload.text.includes("OUT — 0"));
    deletedMenu=true;
    updates.push({update_id:updateId++,message:{from:{id:42},chat:{id:42,type:"private"},text:"/games"}});
    await restart.tick();assert.equal(sends().length,2,"/games recreates a deleted menu");
  } finally {
    await q("DELETE FROM support_rsvp_views WHERE bot_id=801 AND chat_id=42");await q("DELETE FROM support_rsvp_offsets WHERE bot_id=801");
    await q("DELETE FROM games WHERE id=ANY($1::int[])",[gameIds]);await q("DELETE FROM players WHERE tg_id=ANY($1::bigint[])",[playerIds]);await pool.end();
  }
});

test("existing marks migrate without inventing position history or changing known status time", {
  skip: !process.env.RSVP_TEST_DATABASE_URL,
}, async () => {
  const url=new URL(process.env.RSVP_TEST_DATABASE_URL);
  assert.equal(url.hostname,"localhost");assert.ok(url.pathname.endsWith("_checks"));
  const client=new pg.Client({connectionString:url.href,ssl:false});await client.connect();
  let created=false;
  try {
    await client.query("CREATE SCHEMA support_legacy_fixture");created=true;
    await client.query("SET search_path TO support_legacy_fixture");
    await client.query(`CREATE TABLE games(id INT PRIMARY KEY,starts_at TIMESTAMPTZ,status TEXT,location TEXT);
      CREATE TABLE players(tg_id BIGINT PRIMARY KEY,position TEXT);
      CREATE TABLE rsvps(game_id INT,tg_id BIGINT,status TEXT,auto_no BOOLEAN DEFAULT FALSE,pos_override TEXT,updated_at TIMESTAMPTZ);
      CREATE TABLE rsvp_history(id BIGSERIAL PRIMARY KEY,game_id INT,tg_id BIGINT,from_status TEXT,to_status TEXT,automatic BOOLEAN,changed_at TIMESTAMPTZ);
      INSERT INTO games VALUES(1,'2026-10-20','scheduled','Арена'); INSERT INTO players VALUES(42,'F');
      INSERT INTO rsvps VALUES(1,42,'yes',FALSE,'G','2026-10-11T12:00:00Z');
      INSERT INTO rsvp_history(game_id,tg_id,from_status,to_status,automatic,changed_at)
        VALUES(1,42,NULL,'yes',FALSE,'2026-10-10T10:00:00Z'),(1,42,'yes','yes',FALSE,'2026-10-11T12:00:00Z')`);
    await ensureRsvpAuditSchema((s,a)=>client.query(s,a));
    await ensureRsvpAuditSchema((s,a)=>client.query(s,a));
    const row=(await client.query("SELECT * FROM rsvps")).rows[0];
    assert.equal(row.status_changed_at.toISOString(),"2026-10-10T10:00:00.000Z");
    assert.equal(row.last_interaction_at.toISOString(),"2026-10-11T12:00:00.000Z");
    const kinds=(await client.query("SELECT interaction_kind FROM rsvp_history ORDER BY id")).rows.map(r=>r.interaction_kind);
    assert.deepEqual(kinds,["status","legacy"]);
  } finally {
    if(created)await client.query("DROP SCHEMA support_legacy_fixture CASCADE");
    await client.end();
  }
});
