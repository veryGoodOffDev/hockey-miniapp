import test from "node:test";
import assert from "node:assert/strict";
import { createTeamPostService } from "./service.js";
const player = (tg_id, position) => ({
  tg_id,
  position,
  display_name: `Игрок ${tg_id}`,
  jersey_number: tg_id,
});
function fixture() {
  const context = {
    game: { id: 12, starts_at: "2026-10-25T04:45:00Z", location: "Арена" },
    chatId: -100,
    teamA: [player(1, "G"), player(2, "D")],
    teamB: [player(3, "G"), player(4, "D"), player(5, "F")],
    stale: false,
    removed: 0,
    added: 0,
  };
  const records = [],
    calls = [];
  let nextId = 1,
    nextMessage = 100,
    loadCount = 0;
  const repository = {
    context: async () => {
      loadCount++;
      return structuredClone(context);
    },
    find: async () =>
      records
        .filter((r) => !r.deleted)
        .toReversed()
        .map((r) => structuredClone(r)),
    insert: async (data) => {
      const row = {
        id: nextId++,
        chat_id: context.chatId,
        message_id: data.messageId,
        text: data.text,
        meta: structuredClone(data.meta),
      };
      records.push(row);
      return row;
    },
    update: async (old, data) => {
      Object.assign(
        records.find((r) => r.id === old.id),
        { text: data.text, meta: structuredClone(data.meta) },
      );
    },
    missing: async (old) => {
      records.find((r) => r.id === old.id).deleted = true;
    },
  };
  const telegram = {};
  let behavior = async () => {};
  for (const method of [
    "sendMessage",
    "sendPhoto",
    "editMessageText",
    "editMessageCaption",
  ])
    telegram[method] = async (...args) => {
      calls.push({ method, args });
      await behavior(method, args);
      return {
        message_id: nextMessage++,
        photo:
          method === "sendPhoto" ? [{ file_id: "cached-file" }] : undefined,
      };
    };
  const service = createTeamPostService({
    repository,
    telegram,
    formatWhen: () => "вс, 25.10, 07:45",
    getFrontendUrl: () => "https://app.example",
    getBotUsername: () => "HockeyBot",
  });
  return {
    context,
    records,
    calls,
    repository,
    service,
    setBehavior: (value) => {
      behavior = value;
    },
    loads: () => loadCount,
  };
}
test("two photo messages publish once; repeats verify existing posts; transfer updates both captions and record metadata", async () => {
  const f = fixture();
  const first = await f.service.publish(12, { format: "jerseys", sentBy: 1 });
  assert.equal(first.edited, false);
  assert.equal(first.message_ids.length, 2);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["sendPhoto", "sendPhoto"],
  );
  assert.equal(f.records[0].meta.media_type, "photo");
  assert.equal(f.records[0].meta.media_file_id, "cached-file");
  const second = await f.service.publish(12, { format: "jerseys" });
  assert.deepEqual(second.message_ids, first.message_ids);
  assert.equal(f.calls.length, 4);
  f.context.teamB.push(f.context.teamA.pop());
  await f.service.sync(12);
  assert.deepEqual(
    f.calls.slice(4).map((c) => c.method),
    ["editMessageCaption", "editMessageCaption"],
  );
  assert.ok(f.records.every((r) => r.text.includes("Составы изменены")));
  assert.equal(f.service.pendingCount, 0);
  await f.service.sync(12);
  assert.equal(f.calls.length, 6);
});
test("legacy single-message posts update in place; both published formats remain independently current", async () => {
  const f = fixture();
  f.records.push({
    id: 900,
    chat_id: -100,
    message_id: 80,
    text: "old table",
    meta: { game_id: 12 },
  });
  const result = await f.service.publish(12);
  assert.equal(result.edited, true);
  assert.equal(result.message_id, 80);
  assert.equal(f.calls[0].method, "editMessageText");
  await f.service.publish(12, { format: "jerseys" });
  f.context.teamB.push(f.context.teamA.pop());
  await f.service.sync(12);
  assert.equal(f.records.length, 3);
  assert.equal(f.calls.filter((c) => c.method === "sendPhoto").length, 2);
  assert.equal(f.calls.filter((c) => c.method === "sendMessage").length, 0);
  assert.equal(
    f.calls.filter((c) => c.method === "editMessageCaption").length,
    2,
  );
  assert.equal(f.calls.filter((c) => c.method === "editMessageText").length, 2);
});
test("partial photo failure is recoverable without reposting the already saved team", async () => {
  const f = fixture();
  f.setBehavior(async (method, args) => {
    if (method === "sendPhoto" && String(args[1]).includes("blue"))
      throw new Error("network failure");
  });
  await assert.rejects(
    f.service.publish(12, { format: "jerseys" }),
    (error) => error.partial_messages.length === 1,
  );
  assert.equal(f.records.length, 1);
  f.setBehavior(async () => {});
  await f.service.publish(12, { format: "jerseys" });
  assert.equal(f.records.length, 2);
  assert.equal(
    f.calls.filter(
      (c) => c.method === "sendPhoto" && String(c.args[1]).includes("white"),
    ).length,
    1,
  );
  assert.equal(f.service.pendingCount, 0);
});
test("automatic sync does not publish, and deleted messages are only restored on an explicit send", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.sync(12), []);
  assert.equal(f.calls.length, 0);
  await f.service.publish(12, { format: "jerseys" });
  const white = f.records[0].message_id;
  f.context.teamA[0].display_name = "Новое имя";
  f.setBehavior(async (method, args) => {
    if (method === "editMessageCaption" && args[1] === white)
      throw new Error("Bad Request: message to edit not found");
  });
  await f.service.sync(12);
  assert.equal(f.records[0].deleted, true);
  assert.equal(f.calls.filter((c) => c.method === "sendPhoto").length, 2);
  f.setBehavior(async () => {});
  await f.service.publish(12, { format: "jerseys" });
  assert.equal(f.calls.filter((c) => c.method === "sendPhoto").length, 3);
});
test("serialization prevents duplicate concurrent sends and releases its queue on success and failure", async () => {
  const f = fixture();
  let unblock;
  const held = new Promise((resolve) => {
    unblock = resolve;
  });
  let blocked = false;
  f.setBehavior(async (method) => {
    if (method === "sendPhoto" && !blocked) {
      blocked = true;
      await held;
    }
  });
  const a = f.service.publish(12, { format: "jerseys" }),
    b = f.service.publish(12, { format: "jerseys" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  unblock();
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(ra.message_ids, rb.message_ids);
  assert.equal(f.calls.filter((call) => call.method === "sendPhoto").length, 2);
  assert.equal(f.service.pendingCount, 0);
  f.context.teamA[0].display_name = "Изменён";
  f.setBehavior(async () => {
    throw new Error("temporary");
  });
  await assert.rejects(f.service.publish(12, { format: "jerseys" }));
  assert.equal(f.service.pendingCount, 0);
});
test("caption/format/stale validations happen before any Telegram send; forcing stale matches remains explicit", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.publish(12, { format: "bad" }),
    /bad_teams_format/,
  );
  assert.equal(f.loads(), 0);
  f.context.stale = true;
  f.context.removed = 1;
  await assert.rejects(
    f.service.publish(12),
    (error) => error.status === 409 && error.removed === 1,
  );
  assert.equal(f.calls.length, 0);
  f.context.stale = false;
  f.context.teamB = Array.from({ length: 30 }, (_, i) => ({
    ...player(100 + i, "F"),
    display_name: "Длинное имя ".repeat(12),
  }));
  await assert.rejects(
    f.service.publish(12, { format: "jerseys" }),
    /teams_caption_too_long/,
  );
  assert.equal(f.calls.length, 0);
  f.context.teamB = [player(2, "F")];
  f.context.stale = true;
  await f.service.publish(12, { force: true });
  assert.match(f.records[0].text, /Отметки менялись/);
});
test("Telegram not-modified is a success, while uneditable posts do not cause duplicate replacements", async () => {
  const f = fixture();
  await f.service.publish(12);
  f.context.game.location = "Новая арена";
  f.setBehavior(async () => {
    throw new Error("Bad Request: message is not modified");
  });
  await f.service.publish(12);
  assert.match(f.records[0].text, /Новая арена/);
  f.context.game.location = "Другая арена";
  f.setBehavior(async () => {
    throw new Error("Bad Request: message can't be edited");
  });
  await assert.rejects(f.service.publish(12), (error) => error.status === 409);
  assert.equal(f.calls.filter((c) => c.method === "sendMessage").length, 1);
});
test("auto-sync continues to the other team after an edit failure and retains independent updates", async () => {
  const f = fixture();
  await f.service.publish(12, { format: "jerseys" });
  f.context.game.location = "Новая арена";
  const first = f.records[0].message_id;
  f.setBehavior(async (method, args) => {
    if (method === "editMessageCaption" && args[1] === first)
      throw new Error("blocked temporary");
  });
  await assert.rejects(f.service.sync(12));
  assert.match(f.records[1].text, /Новая арена/);
  assert.equal(f.service.pendingCount, 0);
});

test("empty saved rosters clear old captions after the last OUT; manual empty publication stays rejected", async () => {
  const f = fixture();
  await f.service.publish(12, { format: "jerseys" });
  f.context.teamA = [];
  f.context.teamB = [];
  await f.service.sync(12);
  assert.ok(f.records.every((record) => record.text.includes("· 0")));
  assert.ok(f.records.every((record) => !record.text.includes("Игрок")));
  await assert.rejects(
    f.service.publish(12, { format: "jerseys" }),
    /no_teams/,
  );
});
test("an oversized auto-update for one team does not block the other published team", async () => {
  const f = fixture();
  await f.service.publish(12, { format: "jerseys" });
  f.context.teamA = Array.from({ length: 30 }, (_, i) => ({
    ...player(100 + i, "F"),
    display_name: "Длинное имя ".repeat(12),
  }));
  f.context.teamB[0].display_name = "Новое имя";
  await assert.rejects(f.service.sync(12), /teams_caption_too_long/);
  assert.match(f.records[1].text, /Новое имя/);
});

test("manual repeat verifies unchanged messages and restores a manually deleted one without a roster change", async () => {
  const f = fixture();
  await f.service.publish(12, { format: "jerseys" });
  const first = f.records[0].message_id;
  f.setBehavior(async (method, args) => {
    if (method === "editMessageCaption" && args[1] === first)
      throw new Error("Bad Request: message to edit not found");
  });
  await f.service.publish(12, { format: "jerseys" });
  assert.equal(f.records[0].deleted, true);
  assert.equal(f.calls.filter((c) => c.method === "sendPhoto").length, 3);
  assert.equal(f.records.filter((r) => !r.deleted).length, 2);
});
