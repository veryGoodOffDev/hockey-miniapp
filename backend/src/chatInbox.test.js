import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import express from "express";
import { Api } from "grammy";
import pg from "pg";
import { createBot } from "./bot.js";
import {
  CHAT_REACTIONS,
  messageId,
  inboxMessage,
  ensureChatInboxSchema,
  createChatInboxRepository,
  createChatInboxCapture,
  createChatInboxRoutes,
} from "./chatInbox.js";
import { createCustomPostRoutes } from "./customPostUpload.js";
import { sendCustomBotPost } from "./customBotPost.js";
const group = { id: -10042, type: "supergroup", title: "Хоккей" };
const message = (id = 17) => ({
  message_id: id,
  date: Math.floor(Date.now() / 1000),
  chat: group,
  from: {
    id: 42,
    is_bot: false,
    first_name: "Иван",
    last_name: "Игрок",
    username: "ivan",
  },
  text: "Буду на тренировке",
});
const listen = async (app) => {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};
test("only the configured group is captured; media, captions, anonymous authors, edits and invalid IDs", () => {
  const m = message();
  assert.equal(inboxMessage(m, group.id).sender_name, "Иван Игрок");
  assert.equal(inboxMessage(m, -77), null);
  assert.equal(inboxMessage(m, null), null);
  assert.equal(
    inboxMessage({ ...m, chat: { ...group, type: "private" } }, group.id),
    null,
  );
  assert.equal(
    inboxMessage({ ...m, text: undefined, new_chat_members: [{}] }, group.id),
    null,
  );
  const media = inboxMessage(
    {
      ...m,
      text: undefined,
      caption: "Фото",
      photo: [{}],
      edit_date: m.date + 1,
      reply_to_message: { message_id: 10 },
      sender_chat: { title: "Админ" },
    },
    group.id,
  );
  assert.equal(media.media_type, "photo");
  assert.equal(media.text, "Фото");
  assert.equal(media.sender_name, "Админ");
  assert.equal(media.reply_to_message_id, 10);
  assert.ok(media.edited_at > media.sent_at);
  for (const value of [null, true, -1, 0, "1x", 1.5, {}, "2147483648"])
    assert.throws(() => messageId(value), /bad_message_id/);
});
test("real grammY middleware captures before private handlers and survives archive failure", async () => {
  const saved = [],
    errors = [];
  const capture = createChatInboxCapture({
    repository: { record: async (m) => saved.push(m) },
    getChatId: async () => group.id,
  });
  const originalToken = process.env.BOT_TOKEN;
  process.env.BOT_TOKEN = "123456:LOCAL_TEST";
  let bot;
  try {
    bot = createBot({ onGroupUpdate: capture });
  } finally {
    if (originalToken === undefined) delete process.env.BOT_TOKEN;
    else process.env.BOT_TOKEN = originalToken;
  }
  bot.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: "Test",
    username: "hockey_test_bot",
  };
  await bot.handleUpdate({ update_id: 1, message: message() });
  await bot.handleUpdate({
    update_id: 2,
    edited_message: {
      ...message(),
      text: "Изменено",
      edit_date: message().date + 1,
    },
  });
  await bot.handleUpdate({
    update_id: 3,
    message: { ...message(), chat: { ...group, id: -8 } },
  });
  assert.deepEqual(
    saved.map((m) => m.text),
    ["Буду на тренировке", "Изменено"],
  );
  let next = 0;
  await createChatInboxCapture({
    repository: {
      record: async () => {
        throw new Error("db down");
      },
    },
    getChatId: async () => group.id,
    logger: { error: (x) => errors.push(x) },
  })({ update: { message: message() } }, () => next++);
  assert.equal(next, 1);
  assert.equal(errors.length, 1);
});
test("text, photo and album replies carry strict reply parameters and history metadata", async () => {
  const calls = [];
  const api = Object.fromEntries(
    ["sendMessage", "sendPhoto", "sendMediaGroup"].map((method) => [
      method,
      async (...args) => {
        calls.push({ method, args });
        return method === "sendMediaGroup"
          ? [{ message_id: 3 }, { message_id: 4 }]
          : { message_id: 2 };
      },
    ]),
  );
  const photo = {
    buffer: Buffer.from([255, 216, 255, 0]),
    originalname: "p.jpg",
  };
  for (const files of [[], [photo], [photo, photo]]) {
    const result = await sendCustomBotPost({
      api,
      chatId: group.id,
      text: "Ответ",
      files,
      replyTo: 17,
      makeInputFile: (x) => x,
    });
    assert.deepEqual(calls.at(-1).args[2].reply_parameters, {
      message_id: 17,
      allow_sending_without_reply: false,
    });
    assert.ok(result.entries.every((e) => e.meta.reply_to_message_id === 17));
  }
});
test("HTTP + real grammY: inbox paging, reactions/removal, chat scoping, rejected/deleted targets, reply retries", async () => {
  const calls = [],
    saved = new Map([
      [17, { ...inboxMessage(message(), group.id), bot_reaction: null }],
    ]),
    logs = [];
  let failure = false;
  const telegram = express();
  telegram.use(express.json());
  telegram.post("/bot:token/:method", (req, res) => {
    calls.push({ method: req.params.method, body: req.body });
    if (failure)
      return res.status(400).json({
        ok: false,
        error_code: 400,
        description:
          failure === "deleted"
            ? "Bad Request: message to be replied not found"
            : "Bad Request: REACTION_INVALID",
      });
    res.json({
      ok: true,
      result:
        req.params.method === "setMessageReaction" ? true : { message_id: 101 },
    });
  });
  const tg = await listen(telegram),
    api = new Api("123456:LOCAL_TEST", { apiRoot: tg.url });
  const repository = {
    list: async (chat, opts) => {
      assert.equal(String(chat), String(group.id));
      return {
        messages: opts.before ? [] : [...saved.values()],
        has_more: !opts.before,
      };
    },
    get: async (chat, id) => {
      const row = String(chat) === String(group.id) && saved.get(id);
      if (!row)
        throw Object.assign(new Error("reply_message_not_found"), {
          status: 404,
        });
      return row;
    },
    setReaction: async (chat, id, emoji) => {
      saved.get(id).bot_reaction = emoji || null;
    },
  };
  const routes = createChatInboxRoutes({
    api,
    repository,
    getChatId: async () => group.id,
  });
  const posts = createCustomPostRoutes({
    api,
    getChatId: async () => group.id,
    resolveReply: repository.get,
    logMessage: async (m) => logs.push(m),
    logger: { error() {} },
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers.authorization !== "Bearer admin")
      return res.status(403).end();
    req.customPostUser = { id: 1 };
    next();
  });
  app.get("/inbox", routes.list);
  app.post("/inbox/:messageId/reaction", routes.react);
  app.post("/send", posts.send);
  const service = await listen(app);
  const request = async (path, body, authenticated = true) => {
    const response = await fetch(service.url + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        ...(authenticated ? { authorization: "Bearer admin" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      data: response.status === 403 ? null : await response.json(),
    };
  };
  try {
    assert.equal((await request("/inbox", null, false)).status, 403);
    assert.equal(
      (await request("/inbox/17/reaction", { emoji: "👍" }, false)).status,
      403,
    );
    assert.deepEqual(
      (await request("/inbox")).data.reaction_choices,
      CHAT_REACTIONS,
    );
    assert.equal((await request("/inbox?before=17")).data.messages.length, 0);
    assert.equal((await request("/inbox?before=NaN")).status, 400);
    assert.equal(
      (await request("/inbox/17/reaction", { emoji: "👍", chat_id: -99 }))
        .status,
      200,
    );
    assert.equal(calls.at(-1).body.chat_id, group.id);
    assert.deepEqual(calls.at(-1).body.reaction, [
      { type: "emoji", emoji: "👍" },
    ]);
    assert.equal(saved.get(17).bot_reaction, "👍");
    await request("/inbox/17/reaction", { emoji: "" });
    assert.deepEqual(calls.at(-1).body.reaction, []);
    assert.equal(saved.get(17).bot_reaction, null);
    const count = calls.length;
    assert.equal(
      (await request("/inbox/88/reaction", { emoji: "👍" })).status,
      404,
    );
    assert.equal(
      (await request("/inbox/17/reaction", { emoji: "invalid" })).status,
      400,
    );
    assert.equal(calls.length, count);
    failure = true;
    const failed = await request("/inbox/17/reaction", { emoji: "🔥" });
    assert.equal(failed.data.reason, "telegram_reaction_failed");
    assert.match(failed.data.detail, /REACTION_INVALID/);
    assert.equal(saved.get(17).bot_reaction, null);
    failure = false;
    assert.equal(
      (await request("/inbox/17/reaction", { emoji: "❤️" })).data.ok,
      true,
    );
    const body = {
      text: "Ответ",
      reply_to_message_id: 17,
      request_id: "r".repeat(32),
      chat_id: -99,
    };
    assert.equal((await request("/send", body)).data.ok, true);
    assert.deepEqual(calls.at(-1).body.reply_parameters, {
      message_id: 17,
      allow_sending_without_reply: false,
    });
    assert.equal(calls.at(-1).body.chat_id, group.id);
    const sentCount = calls.length;
    assert.equal((await request("/send", body)).data.ok, true);
    assert.equal(calls.length, sentCount);
    assert.equal(logs[0].meta.reply_to_message_id, 17);
    assert.equal(
      (await request("/send", { ...body, reply_to_message_id: 88 })).status,
      409,
    );
    assert.equal(
      (
        await request("/send", {
          ...body,
          request_id: "s".repeat(32),
          reply_to_message_id: 88,
        })
      ).status,
      404,
    );
    assert.equal(
      (await request("/send", { text: "Ответ", reply_to_message_id: -1 }))
        .status,
      400,
    );
    assert.equal(calls.length, sentCount);
    failure = "deleted";
    const deleted = await request("/send", {
      ...body,
      request_id: "d".repeat(32),
    });
    assert.equal(deleted.data.reason, "telegram_send_failed");
    assert.match(deleted.data.detail, /message to be replied not found/);
    assert.equal(logs.length, 1);
    assert.equal(
      calls.at(-1).body.reply_parameters.allow_sending_without_reply,
      false,
    );
  } finally {
    posts.close();
    await Promise.all([
      new Promise((r) => service.server.close(r)),
      new Promise((r) => tg.server.close(r)),
    ]);
  }
});
test(
  "PostgreSQL: repeatable schema, duplicate/out-of-order edits, reaction persistence, paging, chat isolation and retention",
  { skip: !process.env.RSVP_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.RSVP_TEST_DATABASE_URL);
    assert.equal(url.hostname, "localhost");
    assert.ok(url.pathname.endsWith("_checks"));
    const client = new pg.Client({ connectionString: url.href, ssl: false });
    await client.connect();
    let created = false;
    try {
      await client.query("CREATE SCHEMA chat_inbox_fixture");
      created = true;
      await client.query("SET search_path TO chat_inbox_fixture");
      const q = (sql, args) => client.query(sql, args);
      await ensureChatInboxSchema(q);
      await ensureChatInboxSchema(q);
      const repository = createChatInboxRepository(q);
      const entry = inboxMessage(message(), group.id);
      await repository.record(entry);
      await repository.record(entry);
      await repository.setReaction(group.id, 17, "👍");
      await repository.record({
        ...entry,
        text: "Изменено",
        edited_at: new Date(entry.sent_at.getTime() + 1000),
      });
      await repository.record(entry); // Delayed original update must not replace the edit.
      const edited = await repository.get(group.id, 17);
      assert.equal(edited.text, "Изменено");
      assert.equal(edited.bot_reaction, "👍");
      await repository.record(inboxMessage(message(18), group.id));
      await repository.record({ ...entry, chat_id: "-55" });
      const page = await repository.list(group.id, { limit: 1 });
      assert.equal(page.has_more, true);
      assert.equal(Number(page.messages[0].message_id), 18);
      const next = await repository.list(group.id, { before: 18 });
      assert.deepEqual(
        next.messages.map((m) => Number(m.message_id)),
        [17],
      );
      await assert.rejects(repository.get(-77, 17), /reply_message_not_found/);
      await q(
        "UPDATE chat_inbox_messages SET sent_at=NOW()-INTERVAL '31 days' WHERE message_id=17",
      );
      assert.equal((await repository.list(group.id)).messages.length, 1);
      await assert.rejects(
        repository.get(group.id, 17),
        /reply_message_not_found/,
      );
      await createChatInboxRepository(q).record(
        inboxMessage(message(19), group.id),
      );
      assert.equal(
        Number(
          (
            await q(
              "SELECT count(*) FROM chat_inbox_messages WHERE message_id=17",
            )
          ).rows[0].count,
        ),
        0,
      );
    } finally {
      if (created) await client.query("DROP SCHEMA chat_inbox_fixture CASCADE");
      await client.end();
    }
  },
);
