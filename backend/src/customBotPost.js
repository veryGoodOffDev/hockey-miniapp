export function validateCustomBotPost(text, file) {
  text = String(text || "").trim();
  if (!file && !text)
    throw Object.assign(new Error("empty_text"), { status: 400 });
  if (text.length > (file ? 1024 : 3500))
    throw Object.assign(new Error(file ? "caption_too_long" : "too_long"), {
      status: 400,
    });
  if (file) {
    const b = file.buffer;
    const jpeg = b?.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
    const png =
      b?.length >= 8 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      b?.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP";
    if (!jpeg && !png && !webp)
      throw Object.assign(new Error("unsupported_image"), { status: 400 });
    if (b.length > 10 * 1024 * 1024)
      throw Object.assign(new Error("image_too_large"), { status: 400 });
  }
  return text;
}
export async function sendCustomBotPost({
  api,
  chatId,
  text,
  file,
  makeInputFile,
}) {
  text = validateCustomBotPost(text, file);
  const sent = file
    ? await api.sendPhoto(
        chatId,
        makeInputFile(file.buffer, file.originalname),
        { caption: text || undefined },
      )
    : await api.sendMessage(chatId, text, { disable_web_page_preview: true });
  return {
    sent,
    text,
    meta: {
      type: "custom_from_admin",
      media_type: file ? "photo" : null,
      photo_file_id: sent.photo?.at(-1)?.file_id || null,
    },
  };
}
