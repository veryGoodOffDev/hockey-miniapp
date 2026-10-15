import React, { useEffect, useRef, useState } from "react";
import { apiUpload } from "./api.js";
import {
  MAX_POST_PHOTOS,
  postRequestId,
  preparePostPhoto,
} from "./preparePostPhoto.js";
function PhotoPreview({ photo, index, onRemove, disabled }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const value = URL.createObjectURL(photo.thumbnail || photo.file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [photo]);
  return (
    <div className="customBotPostThumb">
      <img src={url} alt={`Предпросмотр фото ${index + 1}`} />
      <button
        type="button"
        className="btn secondary"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Убрать фото ${index + 1}`}
      >
        ✕ {index + 1}
      </button>
    </div>
  );
}
export default function CustomBotPostEditor({
  apiPost,
  onSent,
  upload = apiUpload,
  replyTo = null,
  onCancelReply,
  onBusyChange,
}) {
  const [text, setText] = useState(""),
    [photos, setPhotos] = useState([]),
    [busy, setBusy] = useState(false),
    [processing, setProcessing] = useState(false),
    [message, setMessage] = useState("");
  const input = useRef(null),
    tokens = useRef(new Map()),
    requestId = useRef(null),
    preparing = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    requestId.current = null;
    setMessage("");
  }, [replyTo?.message_id]);
  useEffect(() => {
    onBusyChange?.(busy || processing);
    return () => onBusyChange?.(false);
  }, [busy, processing, onBusyChange]);
  const changed = () => {
    requestId.current = null;
    setMessage("");
  };
  const select = async (files) => {
    if (preparing.current || busy) return;
    const list = Array.from(files || []);
    if (!list.length) return;
    if (photos.length + list.length > MAX_POST_PHOTOS) {
      setMessage("В одном альбоме можно отправить до 10 фотографий");
      return;
    }
    preparing.current = true;
    setProcessing(true);
    setMessage("Подготавливаю фотографии…");
    try {
      const prepared = [];
      for (const file of list) {
        if (!alive.current) return;
        prepared.push(await preparePostPhoto(file));
      }
      if (alive.current) {
        setPhotos((old) => [...old, ...prepared]);
        changed();
      }
    } catch (error) {
      if (alive.current) setMessage(error.message);
    } finally {
      preparing.current = false;
      if (alive.current) setProcessing(false);
    }
  };
  const max = photos.length ? 1024 : 3500;
  const send = async () => {
    if (busy || processing) return;
    setBusy(true);
    setMessage("");
    try {
      const receipts = [];
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        let token = tokens.current.get(photo.id);
        if (!token) {
          setMessage(`Загружаю фото ${i + 1} из ${photos.length}…`);
          const form = new FormData();
          form.append("photo", photo.file);
          const response = await upload("/api/admin/bot-messages/photos", form);
          token = response.token;
          if (!token) throw new Error("upload_failed");
          tokens.current.set(photo.id, token);
        }
        receipts.push(token);
      }
      if (!requestId.current) requestId.current = postRequestId();
      setMessage(
        photos.length
          ? "Отправляю фотографии в Telegram…"
          : "Отправляю сообщение…",
      );
      const result = await apiPost(
        "/api/admin/bot-messages/send",
        {
          text: text.trim(),
          photo_tokens: receipts,
          request_id: requestId.current,
          ...(replyTo ? { reply_to_message_id: replyTo.message_id } : {}),
        },
        { timeoutMs: 90_000 },
      );
      setText("");
      setPhotos([]);
      tokens.current.clear();
      requestId.current = null;
      if (input.current) input.current.value = "";
      setMessage(
        result?.history_warning
          ? "✅ Пост отправлен, но не удалось сохранить всю историю."
          : `✅ ${photos.length > 1 ? "Альбом отправлен" : "Сообщение отправлено"} в чат`,
      );
      try {
        await onSent?.();
      } catch {
        setMessage("✅ Пост отправлен. Не удалось обновить историю.");
      }
    } catch (error) {
      const reason = error.data?.reason,
        detail = error.data?.detail || "";
      if (reason === "photo_expired") {
        tokens.current.clear();
        requestId.current = null;
      }
      const descriptions = {
        caption_too_long:
          "Подпись к фотографиям должна быть не длиннее 1024 символов",
        too_many_images: "В одном альбоме можно отправить до 10 фотографий",
        photo_expired:
          "Время хранения фотографий истекло. Нажмите отправку ещё раз — файлы загрузятся заново.",
        photo_queue_full:
          "Очередь загрузки заполнена. Попробуйте отправить фотографии позже.",
        unsupported_image:
          "Не удалось прочитать формат изображения. Выберите JPEG или PNG.",
        prepare_image_required:
          "Сервер отклонил размер файла. Заново добавьте фотографию для обработки.",
        request_timeout:
          "Сервер не ответил вовремя. Проверьте чат и историю перед повторной отправкой.",
        telegram_delivery_unknown:
          "Не получено подтверждение от Telegram. Проверьте чат перед повторной отправкой.",
        not_super_admin: "Отправка доступна только главному администратору.",
        notify_chat_id_not_set: "Не настроен командный чат для отправки.",
        reply_message_not_found:
          "Сообщение больше недоступно. Обновите список и выберите другое.",
        bad_message_id: "Некорректное сообщение для ответа.",
      };
      const status = error.status || error.data?.status;
      setMessage(
        reason === "reply_message_not_found"
          ? descriptions[reason]
          : status === 404 || status === 405
            ? "На сервере ещё нет загрузки фотографий. Обновите серверную часть приложения и повторите отправку."
            : status === 413
              ? "Сервер отклонил размер загрузки (413). Проверьте лимит загрузки на прокси."
              : reason === "telegram_send_failed"
                ? /message to be replied not found|REPLY_MESSAGE_ID_INVALID/i.test(
                    detail,
                  )
                  ? "Сообщение для ответа удалено или недоступно. Выберите другое сообщение."
                  : /CHAT_SEND_PHOTOS_FORBIDDEN|not enough rights|CHAT_WRITE_FORBIDDEN/i.test(
                        detail,
                      )
                    ? "У бота нет права отправлять фотографии в этот чат. Разрешите отправку фото в настройках чата."
                    : `Telegram отклонил отправку: ${detail || "проверьте права бота и формат фото"}`
                : descriptions[reason] ||
                  "❌ Отправка не выполнена. Фотографии и текст остались в редакторе.",
      );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="customBotPost">
      {replyTo && (
        <div className="chatInboxReplyTarget">
          <strong>↩ Ответ: {replyTo.sender_name}</strong>
          <div className="small">
            {String(
              replyTo.text ||
                (replyTo.media_type ? "Сообщение с вложением" : "Сообщение"),
            ).slice(0, 240)}
          </div>
          <button
            type="button"
            className="btn secondary"
            disabled={busy || processing}
            onClick={onCancelReply}
          >
            Отменить ответ
          </button>
        </div>
      )}
      <textarea
        className="input"
        rows={4}
        aria-label="Текст сообщения бота"
        value={text}
        disabled={busy || processing}
        onChange={(e) => {
          setText(e.target.value);
          changed();
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files || []).filter((file) =>
            file.type.startsWith("image/"),
          );
          if (files.length) void select(files);
        }}
        placeholder="Текст сообщения или подпись к альбому…"
      />
      <div className="small">
        {text.trim().length} / {max} символов
        {photos.length ? " · общая подпись под фотографиями" : ""}
      </div>
      {text.trim().length > max && (
        <p className="small" role="alert">
          Сократите текст на {text.trim().length - max} символов, чтобы
          отправить сообщение.
        </p>
      )}
      <div className="adminActionRow">
        <label className="btn secondary customBotPostAttach">
          🖼 Добавить фотографии · {photos.length}/10
          <input
            ref={input}
            type="file"
            multiple
            aria-label="Фотографии для сообщения"
            accept="image/*"
            disabled={busy || processing || photos.length >= 10}
            onChange={(e) => {
              void select(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {photos.length > 0 && (
        <div className="customBotPostPreview">
          <div
            className={`customBotPostGrid ${photos.length === 1 ? "isSingle" : ""}`}
          >
            {photos.map((photo, index) => (
              <PhotoPreview
                key={photo.id}
                photo={photo}
                index={index}
                disabled={busy || processing}
                onRemove={() => {
                  setPhotos((old) => old.filter((p) => p.id !== photo.id));
                  tokens.current.delete(photo.id);
                  changed();
                }}
              />
            ))}
          </div>
          {text && <p>{text}</p>}
        </div>
      )}
      <p className="small">
        До 10 фото в одном альбоме с общей подписью. Можно добавлять несколькими
        выборами или вставлять из буфера. Фотографии подготавливаются
        автоматически.
      </p>
      <button
        type="button"
        className="btn"
        onClick={send}
        disabled={
          busy ||
          processing ||
          (!text.trim() && !photos.length) ||
          text.trim().length > max
        }
      >
        {processing
          ? "Подготавливаю фото…"
          : busy
            ? "Отправляю…"
            : photos.length > 1
              ? "Отправить альбом в чат"
              : "Отправить в чат"}
      </button>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
