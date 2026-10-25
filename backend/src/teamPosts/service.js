import { createHash } from "node:crypto";
import {
  makeTeamPostParts,
  telegramTextLength,
  withChangeNote,
} from "./format.js";

export const TEAM_POST_FORMATS = ["columns", "jerseys"];
const describeError = (error) =>
  String(error?.description || error?.message || "").toLowerCase();
const isMissing = (error) =>
  /message to edit not found|message_id_invalid|message not found/.test(
    describeError(error),
  );
const isUnchanged = (error) =>
  describeError(error).includes("message is not modified");
const fail = (reason, status = 400, extra = {}) =>
  Object.assign(new Error(reason), { status, ...extra });
function recordFormat(record) {
  return record.meta?.teams_format || "columns";
}
function recordPart(record) {
  return record.meta?.teams_part || "table";
}
function newestRecords(records) {
  const result = new Map();
  for (const record of records) {
    const key = `${recordFormat(record)}:${recordPart(record)}`;
    if (!result.has(key)) result.set(key, record);
  }
  return result;
}
export function createTeamPostService({
  repository,
  telegram,
  formatWhen,
  getFrontendUrl,
  getBotUsername,
}) {
  const queue = new Map();
  async function locked(gameId, work) {
    const previous = queue.get(gameId) || Promise.resolve();
    const task = previous.catch(() => {}).then(work);
    queue.set(gameId, task);
    try {
      return await task;
    } finally {
      if (queue.get(gameId) === task) queue.delete(gameId);
    }
  }
  function validatePart(part) {
    const limit = part.mediaType === "photo" ? 1024 : 4096;
    if (telegramTextLength(part.text) > limit)
      throw fail(
        part.mediaType === "photo"
          ? "teams_caption_too_long"
          : "teams_message_too_long",
        400,
        { team: part.part },
      );
  }
  function plan(context, format, records, validate = true) {
    return makeTeamPostParts(context, {
      format,
      when: formatWhen(context.game.starts_at),
      frontendUrl: getFrontendUrl(),
      botUsername: getBotUsername(),
    }).map((part) => {
      const old = records.get(`${format}:${part.part}`);
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            part.text,
            part.replyMarkup,
            part.photoUrl || "",
            context.stale,
          ]),
        )
        .digest("hex");
      const changed =
        !!old && (old.meta?.content_key !== key || old.meta?.changed === true);
      const text = withChangeNote(part.text, changed, context.stale);
      if (validate) validatePart({ ...part, text });
      return { ...part, old, key, text, changed, format };
    });
  }
  async function publishPart(context, part, { automatic, sentBy }) {
    validatePart(part);
    let record = part.old;
    const meta = {
      ...(record?.meta || {}),
      game_id: Number(context.game.id),
      teams_format: part.format,
      teams_part: part.part,
      content_key: part.key,
      changed: part.changed,
      stale: context.stale,
      removed: context.removed,
      added: context.added,
      media_type: part.mediaType,
      photo_url: part.photoUrl || null,
    };
    const update = { part, text: part.text, meta, sentBy };
    if (record) {
      if (
        automatic &&
        record.meta?.content_key === part.key &&
        record.text === part.text
      )
        return {
          message_id: Number(record.message_id),
          part: part.part,
          action: "unchanged",
        };
      try {
        if (part.mediaType === "photo")
          await telegram.editMessageCaption(
            context.chatId,
            Number(record.message_id),
            {
              caption: part.text,
              parse_mode: "HTML",
              reply_markup: part.replyMarkup,
            },
          );
        else
          await telegram.editMessageText(
            context.chatId,
            Number(record.message_id),
            part.text,
            {
              parse_mode: "HTML",
              disable_web_page_preview: true,
              reply_markup: part.replyMarkup,
            },
          );
      } catch (error) {
        if (isMissing(error)) {
          await repository.missing(record);
          if (automatic)
            return {
              message_id: Number(record.message_id),
              part: part.part,
              action: "missing",
            };
          record = null;
        } else if (!isUnchanged(error)) {
          if (describeError(error).includes("message can't be edited"))
            throw fail("teams_message_not_editable", 409);
          throw error;
        }
      }
      if (record) {
        await repository.update(record, update);
        return {
          message_id: Number(record.message_id),
          part: part.part,
          action:
            record.meta?.content_key === part.key ? "unchanged" : "edited",
        };
      }
    }
    if (automatic) return null;
    let sent;
    try {
      sent =
        part.mediaType === "photo"
          ? await telegram.sendPhoto(
              context.chatId,
              part.old?.meta?.photo_url === part.photoUrl &&
                part.old?.meta?.media_file_id
                ? part.old.meta.media_file_id
                : part.photoUrl,
              {
                caption: part.text,
                parse_mode: "HTML",
                reply_markup: part.replyMarkup,
              },
            )
          : await telegram.sendMessage(context.chatId, part.text, {
              parse_mode: "HTML",
              disable_web_page_preview: true,
              reply_markup: part.replyMarkup,
            });
    } catch (error) {
      if (
        part.mediaType === "photo" &&
        /http url|wrong file identifier|failed to get|webpage_curl|photo_invalid/.test(
          describeError(error),
        )
      )
        throw fail("jersey_photo_unavailable", 502);
      throw error;
    }
    if (sent.photo?.length) meta.media_file_id = sent.photo.at(-1).file_id;
    await repository.insert({ ...update, context, messageId: sent.message_id });
    return {
      message_id: Number(sent.message_id),
      part: part.part,
      action: "sent",
    };
  }
  return {
    get pendingCount() {
      return queue.size;
    },
    publish(gameId, { format = "columns", force = false, sentBy } = {}) {
      if (!TEAM_POST_FORMATS.includes(format))
        return Promise.reject(fail("bad_teams_format"));
      return locked(gameId, async () => {
        const context = await repository.context(gameId);
        if (!context.teamA.length && !context.teamB.length)
          throw fail("no_teams");
        if (context.stale && !force)
          throw fail("teams_stale", 409, {
            removed: context.removed,
            added: context.added,
          });
        const records = newestRecords(
          await repository.find(gameId, context.chatId),
        );
        // Preflight every caption before sending either team.
        const parts = plan(context, format, records),
          results = [];
        for (const part of parts) {
          try {
            results.push(
              await publishPart(context, part, { automatic: false, sentBy }),
            );
          } catch (error) {
            error.partial_messages = results;
            throw error;
          }
        }
        return {
          ok: true,
          format,
          message_id: results[0]?.message_id,
          message_ids: results.map((result) => result.message_id),
          messages: results,
          edited: results.every((result) => result.action !== "sent"),
          stale: context.stale,
          removed: context.removed,
          added: context.added,
        };
      });
    },
    sync(gameId) {
      return locked(gameId, async () => {
        let context;
        try {
          context = await repository.context(gameId);
        } catch (error) {
          if (
            [
              "no_teams",
              "game_not_found",
              "game_cancelled",
              "chat_not_set",
            ].includes(error.message)
          )
            return [];
          throw error;
        }
        const records = newestRecords(
          await repository.find(gameId, context.chatId),
        );
        if (!records.size) return [];
        const formats = [...new Set([...records.values()].map(recordFormat))],
          results = [],
          errors = [];
        for (const format of formats) {
          if (!TEAM_POST_FORMATS.includes(format)) continue;
          try {
            const parts = plan(context, format, records, false).filter(
              (part) => part.old,
            );
            for (const part of parts) {
              try {
                results.push(
                  await publishPart(context, part, { automatic: true }),
                );
              } catch (error) {
                errors.push(error);
              }
            }
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) throw errors[0];
        return results;
      });
    },
  };
}
