import test from "node:test";
import assert from "node:assert/strict";
import { sendCustomBotPost, validateCustomBotPost } from "./customBotPost.js";
const file = {
  buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  originalname: "post.png",
};
test("photo and caption are sent as one message; photo-only and existing text work", async () => {
  const calls = [],
    api = {
      sendPhoto: async (...args) => {
        calls.push(["photo", ...args]);
        return {
          message_id: 1,
          photo: [{ file_id: "small" }, { file_id: "large" }],
        };
      },
      sendMessage: async (...args) => {
        calls.push(["text", ...args]);
        return { message_id: 2 };
      },
    };
  const input = (b, n) => ({ b, n });
  const result = await sendCustomBotPost({
    api,
    chatId: 42,
    text: " Пост ",
    file,
    makeInputFile: input,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "photo");
  assert.equal(calls[0][3].caption, "Пост");
  assert.equal(result.meta.photo_file_id, "large");
  await sendCustomBotPost({
    api,
    chatId: 42,
    text: "",
    file,
    makeInputFile: input,
  });
  assert.equal(calls[1][3].caption, undefined);
  await sendCustomBotPost({
    api,
    chatId: 42,
    text: "Прежний текст",
    makeInputFile: input,
  });
  assert.equal(calls[2][0], "text");
});
test("invalid image, oversized file and caption are refused without sending", () => {
  assert.throws(
    () => validateCustomBotPost("x".repeat(1025), file),
    /caption_too_long/,
  );
  assert.throws(
    () => validateCustomBotPost("", { buffer: Buffer.from("<svg>") }),
    /unsupported_image/,
  );
  const large = Buffer.alloc(10 * 1024 * 1024 + 1);
  file.buffer.copy(large);
  assert.throws(
    () => validateCustomBotPost("", { buffer: large }),
    /image_too_large/,
  );
  assert.throws(() => validateCustomBotPost("", null), /empty_text/);
  assert.equal(validateCustomBotPost("x".repeat(3500), null).length, 3500);
});
