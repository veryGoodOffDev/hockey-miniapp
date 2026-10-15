export const POST_PHOTO_LIMIT = 10;
const fail = (reason, status = 400) =>
  Object.assign(new Error(reason), { status });
export function validateCustomBotPost(text, fileOrFiles) {
  const files = Array.isArray(fileOrFiles)
    ? fileOrFiles
    : fileOrFiles
      ? [fileOrFiles]
      : [];
  text = String(text || "").trim();
  if (files.length > POST_PHOTO_LIMIT) throw fail("too_many_images");
  if (!files.length && !text) throw fail("empty_text");
  if (text.length > (files.length ? 1024 : 3500))
    throw fail(files.length ? "caption_too_long" : "too_long");
  for (const file of files) {
    const b = file.buffer;
    const jpeg = b?.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
    const png =
      b?.length >= 8 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      b?.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP";
    if (!jpeg && !png && !webp) throw fail("unsupported_image");
    if (b.length > 10 * 1024 * 1024) throw fail("image_too_large");
  }
  return text;
}
export async function sendCustomBotPost({
  api,
  chatId,
  text,
  file,
  files = file ? [file] : [],
  makeInputFile,
  signal,
  replyTo = null,
}) {
  text = validateCustomBotPost(text, files);
  const replyOptions = replyTo
    ? {
        reply_parameters: {
          message_id: replyTo,
          allow_sending_without_reply: false,
        },
      }
    : {};
  let messages;
  if (files.length > 1) {
    messages = await api.sendMediaGroup(
      chatId,
      files.map((file, index) => ({
        type: "photo",
        media: makeInputFile(file.buffer, file.originalname),
        ...(index === 0 && text ? { caption: text } : {}),
      })),
      replyOptions,
      signal,
    );
  } else if (files.length === 1) {
    messages = [
      await api.sendPhoto(
        chatId,
        makeInputFile(files[0].buffer, files[0].originalname),
        { caption: text || undefined, ...replyOptions },
        signal,
      ),
    ];
  } else
    messages = [
      await api.sendMessage(
        chatId,
        text,
        { disable_web_page_preview: true, ...replyOptions },
        signal,
      ),
    ];
  const entries = messages.map((sent, index) => ({
    sent,
    text: index === 0 ? text : "",
    meta: {
      type: "custom_from_admin",
      ...(replyTo ? { reply_to_message_id: replyTo } : {}),
      media_type: files.length ? "photo" : null,
      photo_file_id: sent.photo?.at(-1)?.file_id || null,
      media_group_id: sent.media_group_id || null,
      media_index: index,
      media_count: files.length,
    },
  }));
  return { sent: messages[0], messages, entries, text, meta: entries[0].meta };
}
