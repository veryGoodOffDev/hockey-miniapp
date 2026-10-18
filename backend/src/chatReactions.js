// Standard reactions supported by the Telegram Bot API (ReactionTypeEmoji).
export const STANDARD_REACTIONS = [
  "👍",
  "👎",
  "❤",
  "🔥",
  "🥰",
  "👏",
  "😁",
  "🤔",
  "🤯",
  "😱",
  "🤬",
  "😢",
  "🎉",
  "🤩",
  "🤮",
  "💩",
  "🙏",
  "👌",
  "🕊",
  "🤡",
  "🥱",
  "🥴",
  "😍",
  "🐳",
  "❤‍🔥",
  "🌚",
  "🌭",
  "💯",
  "🤣",
  "⚡",
  "🍌",
  "🏆",
  "💔",
  "🤨",
  "😐",
  "🍓",
  "🍾",
  "💋",
  "🖕",
  "😈",
  "😴",
  "😭",
  "🤓",
  "👻",
  "👨‍💻",
  "👀",
  "🎃",
  "🙈",
  "😇",
  "😨",
  "🤝",
  "✍",
  "🤗",
  "🫡",
  "🎅",
  "🎄",
  "☃",
  "💅",
  "🤪",
  "🗿",
  "🆒",
  "💘",
  "🙉",
  "🦄",
  "😘",
  "💊",
  "🙊",
  "😎",
  "👾",
  "🤷‍♂",
  "🤷",
  "🤷‍♀",
  "😡",
];
export const canonicalEmoji = (value) =>
  typeof value === "string" ? value.replace(/\uFE0F/g, "") : "";
export const reactionKey = (reaction) =>
  reaction?.type === "emoji"
    ? canonicalEmoji(reaction.emoji)
    : reaction?.type === "custom_emoji"
      ? `custom:${reaction.custom_emoji_id}`
      : null;
const fail = (reason) => Object.assign(new Error(reason), { status: 400 });
export function parseReaction(body) {
  if (body?.reaction === null || body?.emoji === "") return null;
  const value =
    body?.reaction ??
    (typeof body?.emoji === "string"
      ? { type: "emoji", emoji: body.emoji }
      : null);
  if (
    value?.type === "emoji" &&
    typeof value.emoji === "string" &&
    value.emoji.length <= 32 &&
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u.test(value.emoji)
  )
    return { type: "emoji", emoji: canonicalEmoji(value.emoji) };
  if (
    value?.type === "custom_emoji" &&
    typeof value.custom_emoji_id === "string" &&
    /^[1-9]\d{0,29}$/.test(value.custom_emoji_id)
  )
    return { type: "custom_emoji", custom_emoji_id: value.custom_emoji_id };
  throw fail("bad_reaction");
}
export function createChatReactions(
  api,
  { now = Date.now, ttlMs = 60_000 } = {},
) {
  const cache = new Map();
  return {
    invalidate(chatId) {
      cache.delete(String(chatId));
    },
    async get(chatId) {
      const key = String(chatId),
        hit = cache.get(key);
      if (hit && hit.expires > now()) return hit.promise;
      // The application has one configured team chat; keep room for recent /setchat changes.
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      const entry = { expires: now() + ttlMs };
      entry.promise = (async () => {
        const chat = await api.getChat(
          Number(chatId),
          AbortSignal.timeout(8_000),
        );
        const allowed =
          chat.available_reactions ??
          STANDARD_REACTIONS.map((emoji) => ({ type: "emoji", emoji }));
        const distinct = new Map();
        for (const raw of allowed) {
          if (!["emoji", "custom_emoji"].includes(raw.type)) continue; // Bots cannot send paid reactions.
          const reaction = parseReaction({ reaction: raw });
          distinct.set(reactionKey(reaction), {
            ...reaction,
            key: reactionKey(reaction),
            label: reaction.emoji || "⭐",
          });
        }
        const choices = [...distinct.values()],
          custom = choices.filter((r) => r.type === "custom_emoji");
        for (let index = 0; index < custom.length; index += 200) {
          try {
            const stickers = await api.getCustomEmojiStickers(
              custom.slice(index, index + 200).map((r) => r.custom_emoji_id),
              AbortSignal.timeout(5_000),
            );
            for (const sticker of stickers) {
              const choice = distinct.get(`custom:${sticker.custom_emoji_id}`);
              if (choice && sticker.emoji) choice.label = sticker.emoji;
            }
          } catch {
            /* An emoji can still be selected by ID if preview metadata is unavailable. */
          }
        }
        return choices;
      })().catch((error) => {
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      });
      cache.set(key, entry);
      return entry.promise;
    },
  };
}
