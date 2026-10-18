import test from "node:test";
import assert from "node:assert/strict";
import {
  STANDARD_REACTIONS,
  createChatReactions,
  parseReaction,
} from "./chatReactions.js";
import {
  createChatInboxRoutes,
  isMissingTelegramMessage,
} from "./chatInbox.js";

test("chat settings: all standard reactions, explicit/disabled lists, custom labels, paid exclusion and cache expiry", async () => {
  let now = 0,
    calls = 0,
    allowed;
  const api = {
    getChat: async () => {
      calls++;
      return { available_reactions: allowed };
    },
    getCustomEmojiStickers: async (ids) =>
      ids.map((custom_emoji_id) => ({ custom_emoji_id, emoji: "🦄" })),
  };
  const catalog = createChatReactions(api, { now: () => now, ttlMs: 100 });
  const [a, b] = await Promise.all([catalog.get(-1), catalog.get(-1)]);
  assert.ok(a.length > 70);
  assert.equal(a.length, STANDARD_REACTIONS.length);
  assert.equal(calls, 1);
  assert.equal(a, b);
  allowed = [
    { type: "emoji", emoji: "🏆" },
    { type: "emoji", emoji: "❤️" },
    { type: "custom_emoji", custom_emoji_id: "123" },
    { type: "paid" },
  ];
  now = 101;
  const choices = await catalog.get(-1);
  assert.deepEqual(
    choices.map((r) => r.key),
    ["🏆", "❤", "custom:123"],
  );
  assert.equal(choices[2].label, "🦄");
  allowed = [];
  catalog.invalidate(-1);
  assert.deepEqual(await catalog.get(-1), []);
  assert.deepEqual(parseReaction({ emoji: "❤️" }), {
    type: "emoji",
    emoji: "❤",
  });
  assert.throws(
    () => parseReaction({ reaction: { type: "paid" } }),
    /bad_reaction/,
  );
  assert.throws(
    () =>
      parseReaction({
        reaction: { type: "custom_emoji", custom_emoji_id: "bad" },
      }),
    /bad_reaction/,
  );
});
test("catalog retries after network failure; absent custom preview keeps selectable ID", async () => {
  let calls = 0;
  const catalog = createChatReactions({
    getChat: async () => {
      if (!calls++) throw new Error("offline");
      return {
        available_reactions: [{ type: "custom_emoji", custom_emoji_id: "99" }],
      };
    },
    getCustomEmojiStickers: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(catalog.get(-1), /offline/);
  assert.equal((await catalog.get(-1))[0].key, "custom:99");
});
test("only explicit missing-message Telegram errors establish deletion", () => {
  for (const description of [
    "Bad Request: MESSAGE_ID_INVALID",
    "Bad Request: message to react not found",
    "Bad Request: message to be replied not found",
    "Bad Request: REPLY_MESSAGE_ID_INVALID",
  ])
    assert.equal(
      isMissingTelegramMessage({ error_code: 400, description }),
      true,
    );
  for (const error of [
    { error_code: 400, description: "Bad Request: REACTION_INVALID" },
    { error_code: 403, description: "Forbidden: MESSAGE_ID_INVALID" },
    { error_code: 400, description: "not enough rights" },
    new Error("message not found"),
  ])
    assert.equal(isMissingTelegramMessage(error), false);
});
test("routes enforce current chat choices, send custom types, persist missing messages, block both stale actions and tolerate catalog failure", async () => {
  let deleted = false,
    reactionError = null,
    failSettings = false,
    calls = 0,
    saved = null;
  const repository = {
    list: async () => ({
      messages: [{ message_id: 1, deleted_at: deleted ? "now" : null }],
      has_more: false,
    }),
    get: async () => {
      if (deleted)
        throw Object.assign(new Error("message_deleted"), { status: 410 });
      return {};
    },
    setReaction: async (chat, id, r) => {
      saved = r;
    },
    markDeleted: async () => {
      deleted = true;
    },
  };
  const api = {
    getChat: async () => {
      if (failSettings) throw new Error("offline");
      return {
        available_reactions: [
          { type: "emoji", emoji: "🏆" },
          { type: "custom_emoji", custom_emoji_id: "99" },
        ],
      };
    },
    getCustomEmojiStickers: async () => [],
    setMessageReaction: async (chat, id, reaction) => {
      calls++;
      assert.equal(chat, -9);
      if (reactionError) throw reactionError;
      api.last = reaction;
    },
  };
  const routes = createChatInboxRoutes({
    repository,
    api,
    getChatId: async () => -9,
  });
  const call = async (fn, body) => {
    const output = { status: 200 };
    await fn(
      { params: { messageId: "1" }, query: {}, body },
      {
        status(code) {
          output.status = code;
          return this;
        },
        json(data) {
          output.data = data;
        },
      },
    );
    return output;
  };
  assert.equal((await call(routes.list)).data.reactions.length, 2);
  assert.equal(
    (await call(routes.react, { emoji: "👍" })).data.reason,
    "reaction_not_allowed",
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await call(routes.react, {
        reaction: { type: "custom_emoji", custom_emoji_id: "99" },
      })
    ).status,
    200,
  );
  assert.deepEqual(api.last, [{ type: "custom_emoji", custom_emoji_id: "99" }]);
  assert.equal(saved, "custom:99");
  await call(routes.react, { reaction: null });
  assert.deepEqual(api.last, []);
  reactionError = {
    error_code: 400,
    description: "Bad Request: REACTION_INVALID",
  };
  assert.equal(
    (await call(routes.react, { emoji: "🏆" })).data.reason,
    "telegram_reaction_failed",
  );
  assert.equal(deleted, false);
  reactionError = {
    error_code: 400,
    description: "Bad Request: MESSAGE_ID_INVALID",
  };
  assert.equal((await call(routes.react, { emoji: "🏆" })).status, 410);
  assert.equal(deleted, true);
  const before = calls;
  assert.equal(
    (await call(routes.react, { reaction: null })).data.reason,
    "message_deleted",
  );
  assert.equal(calls, before);
  assert.ok((await call(routes.list)).data.messages[0].deleted_at);
  failSettings = true;
  const noSettings = createChatInboxRoutes({
    repository,
    api,
    getChatId: async () => -9,
  });
  const fallback = await call(noSettings.list);
  assert.equal(fallback.status, 200);
  assert.equal(fallback.data.reactions_error, true);
  assert.equal(fallback.data.messages.length, 1);
});
