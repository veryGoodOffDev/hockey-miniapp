import React, { useEffect, useRef, useState } from "react";
import CustomBotPostEditor from "./CustomBotPostEditor.jsx";

const mediaNames = {
  photo: "📷 Фото",
  animation: "🎞 GIF",
  video: "🎬 Видео",
  voice: "🎙 Голосовое",
  audio: "🎵 Аудио",
  document: "📎 Файл",
  sticker: "Стикер",
  video_note: "Видеосообщение",
  poll: "Опрос",
  location: "Геопозиция",
  contact: "Контакт",
  dice: "🎲",
};
function errorText(error) {
  const reason = error.data?.reason;
  if (reason === "notify_chat_id_not_set")
    return "Сначала назначьте командный чат командой /setchat в группе.";
  if (reason === "message_deleted")
    return "Сообщение удалено из чата. Ответы и реакции недоступны.";
  if (reason === "reaction_not_allowed")
    return "Эта реакция больше не разрешена в группе. Обновите список сообщений.";
  if (reason === "reply_message_not_found")
    return "Сообщение больше недоступно. Обновите список.";
  if (reason === "telegram_reaction_failed") {
    const detail = error.data?.detail || "";
    if (/REACTION_INVALID|reactions? (?:are )?not allowed/i.test(detail))
      return "Эта реакция недоступна в чате. Выберите другую или проверьте настройки реакций группы.";
    if (/MESSAGE_ID_INVALID|message.*not found/i.test(detail))
      return "Telegram не нашёл сообщение. Возможно, его удалили из чата.";
    return `Telegram не принял реакцию: ${detail || "проверьте права бота и настройки группы"}`;
  }
  if (reason === "reaction_busy")
    return "Реакция ещё обновляется. Попробуйте через несколько секунд.";
  return "Не удалось выполнить запрос. Попробуйте ещё раз.";
}
export default function ChatInbox({ apiGet, apiPost, onSent }) {
  const [opened, setOpened] = useState(false),
    [messages, setMessages] = useState([]),
    [choices, setChoices] = useState([]),
    [picker, setPicker] = useState(null),
    [reactionsError, setReactionsError] = useState(false),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reply, setReply] = useState(null),
    [editorBusy, setEditorBusy] = useState(false),
    [reacting, setReacting] = useState(null);
  const inFlight = useRef(false),
    alive = useRef(true),
    composer = useRef(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load(append = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError("");
    setOpened(true);
    try {
      const before = append ? messages.at(-1)?.message_id : null;
      const result = await apiGet(
        `/api/admin/chat-messages${before ? `?before=${before}` : ""}`,
      );
      if (!alive.current) return;
      setMessages((old) =>
        append
          ? [
              ...old,
              ...result.messages.filter(
                (m) => !old.some((p) => p.message_id === m.message_id),
              ),
            ]
          : result.messages,
      );
      setChoices(
        Array.isArray(result.reactions)
          ? result.reactions
          : (result.reaction_choices || []).map((emoji) => ({
              type: "emoji",
              emoji,
              key: emoji.replace(/\uFE0F/g, ""),
              label: emoji,
            })),
      );
      setReactionsError(!!result.reactions_error);
      setReply((old) => {
        const fresh = result.messages.find(
          (m) => String(m.message_id) === String(old?.message_id),
        );
        return fresh?.deleted_at
          ? { ...old, deleted_at: fresh.deleted_at }
          : old;
      });
      setMore(!!result.has_more);
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }
  function markDeleted(id) {
    if (id == null) return;
    const patch = (m) =>
      String(m.message_id) === String(id)
        ? {
            ...m,
            deleted_at: m.deleted_at || new Date().toISOString(),
            bot_reaction: null,
          }
        : m;
    setMessages((old) => old.map(patch));
    setReply((old) => (old ? patch(old) : old));
    setPicker(null);
  }
  async function react(message, choice) {
    if (reacting !== null || message.deleted_at) return;
    setReacting(message.message_id);
    setError("");
    setNotice("");
    try {
      const result = await apiPost(
        `/api/admin/chat-messages/${message.message_id}/reaction`,
        {
          reaction: choice
            ? choice.type === "custom_emoji"
              ? {
                  type: "custom_emoji",
                  custom_emoji_id: choice.custom_emoji_id,
                }
              : { type: "emoji", emoji: choice.emoji }
            : null,
        },
      );
      if (alive.current) {
        setMessages((old) =>
          old.map((m) =>
            m.message_id === message.message_id
              ? { ...m, bot_reaction: result.bot_reaction }
              : m,
          ),
        );
        setPicker(null);
        setNotice(
          result.bot_reaction
            ? `Реакция ${choice?.label || ""} установлена от имени бота`
            : "Реакция бота убрана",
        );
      }
    } catch (e) {
      if (alive.current) {
        if (e.data?.reason === "message_deleted")
          markDeleted(message.message_id);
        setError(errorText(e));
      }
    } finally {
      if (alive.current) setReacting(null);
    }
  }
  function chooseReply(message) {
    if (editorBusy || message.deleted_at) return;
    setReply(message);
    setNotice("");
    requestAnimationFrame(() =>
      composer.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  return (
    <section className="chatInbox" aria-label="Сообщения командного чата">
      <h3>💬 Сообщения чата</h3>
      <p className="small">
        Ответы и реакции публикуются от имени бота. Здесь появляются новые
        сообщения участников; старую переписку Telegram не передаёт.
      </p>
      <div className="adminActionRow">
        <button
          type="button"
          className="btn secondary"
          onClick={() => load()}
          disabled={loading}
        >
          {loading
            ? "Загружаю…"
            : opened
              ? "Обновить сообщения чата"
              : "Загрузить сообщения чата"}
        </button>
        {opened && (
          <button
            type="button"
            className="btn secondary"
            onClick={() => setOpened(false)}
          >
            Скрыть список
          </button>
        )}
      </div>
      {reactionsError && (
        <p className="small" role="status">
          Не удалось загрузить реакции группы. Нажмите «Обновить сообщения
          чата».
        </p>
      )}
      {error && (
        <p className="small" role="alert">
          ❌ {error}
        </p>
      )}
      {notice && (
        <p className="small" role="status">
          ✅ {notice}
        </p>
      )}
      {reply && (
        <div ref={composer} className="chatInboxComposer">
          <CustomBotPostEditor
            apiPost={apiPost}
            replyTo={reply}
            onCancelReply={() => setReply(null)}
            onBusyChange={setEditorBusy}
            onReplyDeleted={markDeleted}
            onSent={async () => {
              setNotice(`Ответ отправлен: ${reply.sender_name}`);
              setReply(null);
              await onSent?.();
            }}
          />
        </div>
      )}
      {opened && (
        <div className="chatInboxList">
          {!messages.length && !loading && !error && (
            <p className="small">
              Пока сообщений нет. Напишите в группе новое сообщение от своего
              аккаунта и нажмите «Обновить сообщения чата».
            </p>
          )}
          {messages.map((m) => (
            <article
              className={`chatInboxMessage${m.deleted_at ? " isDeleted" : ""}`}
              key={m.message_id}
            >
              <div className="chatInboxHeader">
                <strong>{m.sender_name}</strong>
                <time dateTime={m.sent_at}>
                  {new Date(m.sent_at).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              {m.deleted_at && (
                <div className="chatInboxDeleted" role="status">
                  Удалено из чата · ответы и реакции недоступны
                </div>
              )}
              {m.sender_username && (
                <div className="small">@{m.sender_username}</div>
              )}
              {m.reply_to_message_id && (
                <div className="small">
                  ↩ Ответ на сообщение #{m.reply_to_message_id}
                </div>
              )}
              {m.media_type && (
                <div className="small">
                  {mediaNames[m.media_type] || "Вложение"}
                </div>
              )}
              {m.text && <p className="chatInboxText">{m.text}</p>}
              {m.edited_at && (
                <div className="small">
                  Изменено: {new Date(m.edited_at).toLocaleString("ru-RU")}
                </div>
              )}
              <div className="chatInboxMessageActions">
                <button
                  type="button"
                  className="btn secondary chatInboxReplyButton"
                  onClick={() => chooseReply(m)}
                  disabled={editorBusy || !!m.deleted_at}
                  aria-label={`Ответить: ${m.sender_name}`}
                >
                  ↩ Ответить
                </button>
                <button
                  type="button"
                  className="btn secondary chatInboxChooseReaction"
                  disabled={
                    !!m.deleted_at || reacting !== null || !choices.length
                  }
                  aria-expanded={picker === m.message_id}
                  onClick={() =>
                    setPicker((old) =>
                      old === m.message_id ? null : m.message_id,
                    )
                  }
                >
                  {choices.find(
                    (c) =>
                      c.key ===
                      String(m.bot_reaction || "").replace(/\uFE0F/g, ""),
                  )?.label || "☺"}{" "}
                  {picker === m.message_id
                    ? "Скрыть реакции"
                    : choices.length
                      ? "Выбрать реакцию"
                      : "Реакции недоступны"}
                </button>
                {m.bot_reaction && (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={!!m.deleted_at || reacting !== null}
                    onClick={() => react(m, null)}
                  >
                    Убрать реакцию
                  </button>
                )}
              </div>
              {picker === m.message_id && !m.deleted_at && (
                <div
                  className="chatInboxPicker"
                  role="group"
                  aria-label={`Реакции для сообщения: ${m.sender_name}`}
                >
                  <div className="small chatInboxPickerCaption">
                    Доступные реакции группы · {choices.length}
                  </div>
                  <div className="chatInboxPickerGrid">
                    {choices.map((choice) => {
                      const selected =
                        choice.key ===
                        String(m.bot_reaction || "").replace(/\uFE0F/g, "");
                      return (
                        <button
                          type="button"
                          key={choice.key}
                          className={`btn secondary chatInboxReaction${selected ? " selected" : ""}`}
                          aria-label={`Реакция ${choice.label}${choice.type === "custom_emoji" ? ` · кастомная ${choice.custom_emoji_id}` : ""}: ${m.sender_name}`}
                          title={
                            choice.type === "custom_emoji"
                              ? `Кастомный эмодзи ${choice.custom_emoji_id}`
                              : choice.label
                          }
                          aria-pressed={selected}
                          disabled={reacting !== null}
                          onClick={() => react(m, selected ? null : choice)}
                        >
                          {choice.label}
                          {choice.type === "custom_emoji" && (
                            <sup aria-hidden="true">✦</sup>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {reacting === m.message_id && (
                <div className="small" role="status">
                  Обновляю реакцию…
                </div>
              )}
            </article>
          ))}
          {more && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => load(true)}
              disabled={loading}
            >
              Показать более ранние сообщения
            </button>
          )}
        </div>
      )}
    </section>
  );
}
