import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { ensureSchema } from "../schema.js";
import { createTeamPostRepository } from "./repository.js";
import { createTeamPostService } from "./service.js";

test(
  "PostgreSQL: legacy and photo publications persist per game/part, survive restart, and honor current positions/RSVPs",
  { skip: !process.env.RSVP_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.RSVP_TEST_DATABASE_URL);
    assert.equal(url.hostname, "localhost");
    assert.ok(url.pathname.endsWith("_checks"));
    const client = new pg.Client({ connectionString: url.href, ssl: false });
    await client.connect();
    let created = false;
    try {
      await client.query("CREATE SCHEMA team_posts_fixture");
      created = true;
      await client.query("SET search_path TO team_posts_fixture");
      const q = (sql, args) => client.query(sql, args);
      await ensureSchema(q);
      await q(
        "INSERT INTO games(id,starts_at,location) VALUES(12,NOW()+INTERVAL '1 day','Арена'),(13,NOW()+INTERVAL '2 days','Другая арена')",
      );
      await q(
        "INSERT INTO players(tg_id,display_name,jersey_number,position) VALUES(1,'Иван',50,'G'),(2,'Алексей',15,'D'),(3,'Борис',92,'F'),(4,'Новый',20,'F')",
      );
      await q(
        "INSERT INTO rsvps(game_id,tg_id,status,pos_override) VALUES(12,1,'yes',NULL),(12,2,'yes','F'),(12,3,'yes',NULL),(13,1,'yes',NULL)",
      );
      await q(
        "INSERT INTO teams(game_id,team_a,team_b) VALUES(12,'[1,2]','[3]'),(13,'[1]','[]')",
      );
      await q(
        `INSERT INTO bot_messages(chat_id,message_id,kind,text,meta) VALUES(-100,88,'teams','old table','{"game_id":12}')`,
      );
      const calls = [];
      let next = 100,
        chatId = -100;
      const telegram = {};
      for (const method of [
        "sendMessage",
        "sendPhoto",
        "editMessageText",
        "editMessageCaption",
      ])
        telegram[method] = async (...args) => {
          calls.push({ method, args });
          return { message_id: next++, photo: [{ file_id: "saved-file" }] };
        };
      const parseTeamIds = (list) => [
        ...new Set(
          list.map((item) =>
            Number(typeof item === "object" ? item.tg_id : item),
          ),
        ),
      ];
      const repository = createTeamPostRepository(q, {
        getChatId: async () => chatId,
        parseTeamIds,
      });
      const makeService = () =>
        createTeamPostService({
          repository,
          telegram,
          formatWhen: () => "25.10 07:45",
          getFrontendUrl: () => "https://app.example",
          getBotUsername: () => "HockeyBot",
        });
      let service = makeService();
      const context = await repository.context(12);
      assert.equal(context.teamA[1].position, "F");
      assert.equal(context.stale, false);
      await service.publish(12, { sentBy: 1 });
      assert.equal(calls[0].method, "editMessageText");
      assert.equal(calls[0].args[1], 88);
      await service.publish(12, { format: "jerseys", sentBy: 1 });
      let rows = await repository.find(12, -100);
      assert.equal(rows.length, 3);
      assert.equal(
        rows.filter((row) => row.meta.media_type === "photo").length,
        2,
      );
      assert.ok(
        rows
          .filter((row) => row.meta.media_type === "photo")
          .every((row) => row.meta.media_file_id === "saved-file"),
      );
      await q("UPDATE teams SET team_a='[1]',team_b='[2,3]' WHERE game_id=12");
      await service.sync(12);
      rows = await repository.find(12, -100);
      assert.equal(
        rows
          .find((row) => row.meta.teams_part === "white")
          .text.includes("Алексей"),
        false,
      );
      assert.equal(
        rows
          .find((row) => row.meta.teams_part === "blue")
          .text.includes("Алексей"),
        true,
      );
      const sends = calls.filter((call) =>
        call.method.startsWith("send"),
      ).length;
      service = makeService();
      await service.publish(12, { format: "jerseys" });
      assert.equal(
        calls.filter((call) => call.method.startsWith("send")).length,
        sends,
      );
      const before = calls.length;
      await service.sync(13);
      assert.equal(calls.length, before);
      const white = rows.find((row) => row.meta.teams_part === "white");
      await repository.missing(white);
      assert.equal((await repository.find(12, -100)).length, 2);
      await q("UPDATE rsvps SET status='no' WHERE game_id=12 AND tg_id=3");
      await q("INSERT INTO rsvps(game_id,tg_id,status) VALUES(12,4,'yes')");
      await assert.rejects(
        service.publish(12),
        (error) =>
          error.message === "teams_stale" &&
          error.removed === 1 &&
          error.added === 1,
      );
      await service.publish(12, { force: true });
      chatId = -200;
      const checkpoint = calls.length;
      await service.sync(12);
      assert.equal(calls.length, checkpoint);
      await assert.rejects(repository.context(999), /game_not_found/);
      await q("UPDATE games SET status='cancelled' WHERE id=12");
      await assert.rejects(repository.context(12), /game_cancelled/);
    } finally {
      if (created) await client.query("DROP SCHEMA team_posts_fixture CASCADE");
      await client.end();
    }
  },
);
