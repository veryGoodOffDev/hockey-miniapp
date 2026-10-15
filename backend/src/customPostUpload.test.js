import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import express from "express";
import multer from "multer";
import { Api } from "grammy";
import {
  createPostPhotoStore,
  createPostDeliveryCache,
  createCustomPostRoutes,
} from "./customPostUpload.js";
const jpeg = {
  buffer: Buffer.from([255, 216, 255, 224, 0, 1]),
  originalname: "photo.jpg",
};
const listen = async (app) => {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};
test("staged photos are bounded, private, expire and validate formats", () => {
  let now = 0;
  const store = createPostPhotoStore({
    now: () => now,
    ttlMs: 100,
    maxBytes: 16,
  });
  const token = store.put(1, jpeg);
  assert.equal(store.get(1, [token])[0].originalname, "photo.jpg");
  assert.throws(() => store.get(2, [token]), /photo_expired/);
  assert.throws(() => store.get(1, [token, token]), /bad_photo_tokens/);
  assert.throws(
    () => store.put(1, { buffer: Buffer.from("bad") }),
    /unsupported_image/,
  );
  assert.ok(store.bytes > 0);
  now = 101;
  assert.throws(() => store.get(1, [token]), /photo_expired/);
  assert.equal(store.bytes, 0);
  store.clear();
});
test("delivery deduplicates concurrent and completed calls, isolates owners and rejects changed payloads", async () => {
  const cache = createPostDeliveryCache();
  let calls = 0;
  const work = async () => {
    calls++;
    return { ok: true };
  };
  const id = "a".repeat(32);
  await Promise.all([
    cache.run(1, id, "same", work),
    cache.run(1, id, "same", work),
  ]);
  await cache.run(1, id, "same", work);
  assert.equal(calls, 1);
  assert.throws(() => cache.run(1, id, "different", work), /post_changed/);
  await cache.run(2, id, "same", work);
  assert.equal(calls, 2);
  cache.clear();
});
test("real HTTP multipart + grammY: photos pass a 1MB proxy, album caption and all history IDs persist; text, permissions and retry errors", async () => {
  const telegram = express(),
    received = [];
  telegram.use(express.json());
  let failure = null,
    historyFails = false;
  telegram.post(
    "/bot:token/:method",
    multer({ storage: multer.memoryStorage() }).any(),
    (req, res) => {
      received.push({
        method: req.params.method,
        body: req.body,
        files: req.files,
      });
      if (failure === "forbidden")
        return res
          .status(403)
          .json({
            ok: false,
            error_code: 403,
            description: "Forbidden: CHAT_SEND_PHOTOS_FORBIDDEN",
          });
      if (failure === "network") {
        res.destroy();
        return;
      }
      const method = req.params.method;
      if (method === "sendMediaGroup") {
        const media = JSON.parse(req.body.media);
        assert.equal(media.length, 2);
        assert.equal(req.files.length, 2);
        assert.equal(media[0].caption, "Подпись");
        assert.equal(media[1].caption, undefined);
        for (const item of media)
          assert.ok(
            req.files.some(
              (file) => `attach://${file.fieldname}` === item.media,
            ),
          );
        return res.json({
          ok: true,
          result: media.map((item, i) => ({
            message_id: 100 + i,
            media_group_id: "album1",
            photo: [{ file_id: `p${i}` }],
            ...(item.caption ? { caption: item.caption } : {}),
          })),
        });
      }
      res.json({
        ok: true,
        result: {
          message_id: 200,
          photo: method === "sendPhoto" ? [{ file_id: "single" }] : undefined,
        },
      });
    },
  );
  const tg = await listen(telegram),
    api = new Api("123456:TEST_ONLY", { apiRoot: tg.url }),
    logs = [];
  const routes = createCustomPostRoutes({
    api,
    getChatId: async () => "-10042",
    logMessage: async (row) => {
      if (historyFails) throw new Error("db unavailable");
      logs.push(row);
    },
    logger: { error() {} },
  });
  const app = express();
  app.use((req, res, next) => {
    if (Number(req.headers["content-length"] || 0) > 1024 * 1024)
      return res.status(413).send("<html>Request Entity Too Large</html>");
    next();
  });
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers.authorization !== "Bearer owner")
      return res.status(403).json({ ok: false, reason: "not_super_admin" });
    req.customPostUser = { id: 1 };
    next();
  });
  app.post("/photos", routes.upload);
  app.post("/send", routes.send);
  const service = await listen(app);
  const upload = async (buffer) => {
    const form = new FormData();
    form.append(
      "photo",
      new Blob([buffer], { type: "image/jpeg" }),
      "photo.jpg",
    );
    return fetch(service.url + "/photos", {
      method: "POST",
      headers: { authorization: "Bearer owner" },
      body: form,
    });
  };
  const send = (body) =>
    fetch(service.url + "/send", {
      method: "POST",
      headers: {
        authorization: "Bearer owner",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await fetch(service.url + "/photos", { method: "POST" })).status,
      403,
    );
    const huge = Buffer.alloc(1.2 * 1024 * 1024);
    jpeg.buffer.copy(huge);
    assert.equal(
      (await upload(huge)).status,
      413,
      "Reproduces large raw-photo rejection at a default nginx size limit",
    );
    const big = Buffer.alloc(850 * 1024);
    jpeg.buffer.copy(big);
    const tokens = [];
    for (let i = 0; i < 2; i++) {
      const response = await upload(big);
      assert.equal(response.status, 200);
      tokens.push((await response.json()).token);
    }
    const body = {
      text: "Подпись",
      photo_tokens: tokens,
      request_id: "b".repeat(32),
    };
    const first = await send(body);
    assert.equal(first.status, 200);
    assert.deepEqual((await first.json()).message_ids, [100, 101]);
    assert.equal(logs.length, 2);
    assert.equal(logs[0].text, "Подпись");
    assert.equal(logs[1].text, "");
    assert.equal(logs[0].meta.media_count, 2);
    assert.equal(
      (await send(body)).status,
      200,
      "Retry works even after uploaded buffers are removed",
    );
    assert.equal(received.length, 1);
    assert.equal(
      (await send({ text: "Обычный текст", request_id: "c".repeat(32) }))
        .status,
      200,
    );
    assert.equal(received.at(-1).method, "sendMessage");
    const token = (await (await upload(jpeg.buffer)).json()).token;
    failure = "forbidden";
    const blocked = {
      text: "Фото",
      photo_tokens: [token],
      request_id: "d".repeat(32),
    };
    const failed = await send(blocked);
    assert.equal(failed.status, 502);
    assert.ok(
      (await failed.json()).detail.includes("CHAT_SEND_PHOTOS_FORBIDDEN"),
    );
    failure = null;
    historyFails = true;
    const restored = await send(blocked);
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).history_warning, true);
    assert.equal(received.at(-1).method, "sendPhoto");
    const uncertainToken = (await (await upload(jpeg.buffer)).json()).token;
    failure = "network";
    const uncertain = {
      text: "Проверка",
      photo_tokens: [uncertainToken],
      request_id: "e".repeat(32),
    };
    const count = received.length;
    assert.equal(
      (await (await send(uncertain)).json()).reason,
      "telegram_delivery_unknown",
    );
    await send(uncertain);
    assert.equal(
      received.length,
      count + 1,
      "No blind resend when Telegram response was lost",
    );
  } finally {
    routes.close();
    await new Promise((r) => service.server.close(r));
    await new Promise((r) => tg.server.close(r));
  }
});
