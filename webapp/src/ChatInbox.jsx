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
      setChoices(result.reaction_choices || []);
      setMore(!!result.has_more);
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }
  async function react(message, emoji) {
    if (reacting !== null) return;
    setReacting(message.message_id);
    setError("");
    setNotice("");
    try {
      const result = await apiPost(
        `/api/admin/chat-messages/${message.message_id}/reaction`,
        { emoji },
      );
      if (alive.current) {
        setMessages((old) =>
          old.map((m) =>
            m.message_id === message.message_id
              ? { ...m, bot_reaction: result.bot_reaction }
              : m,
          ),
        );
        setNotice(
          result.bot_reaction
            ? `Реакция ${result.bot_reaction} установлена от имени бота`
            : "Реакция бота убрана",
        );
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setReacting(null);
    }
  }
  function chooseReply(message) {
    if (editorBusy) return;
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
            <article className="chatInboxMessage" key={m.message_id}>
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
                  disabled={editorBusy}
                  aria-label={`Ответить: ${m.sender_name}`}
                >
                  ↩ Ответить
                </button>
                {choices.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    className={`btn secondary chatInboxReaction${m.bot_reaction === emoji ? " selected" : ""}`}
                    aria-label={`Реакция ${emoji}: ${m.sender_name}`}
                    aria-pressed={m.bot_reaction === emoji}
                    disabled={reacting !== null}
                    onClick={() =>
                      react(m, m.bot_reaction === emoji ? "" : emoji)
                    }
                  >
                    {emoji}
                  </button>
                ))}
                {m.bot_reaction && (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={reacting !== null}
                    onClick={() => react(m, "")}
                  >
                    Убрать реакцию
                  </button>
                )}
              </div>
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
