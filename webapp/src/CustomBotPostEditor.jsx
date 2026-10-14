import React, { useEffect, useRef, useState } from "react";
import { apiUpload } from "./api.js";
export default function CustomBotPostEditor({
  apiPost,
  onSent,
  upload = apiUpload,
}) {
  const [text, setText] = useState(""),
    [photo, setPhoto] = useState(null),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const input = useRef(null);
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const select = (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Выберите изображение JPEG, PNG или WEBP");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage("Изображение должно быть не больше 10 МБ");
      return;
    }
    setPhoto(file);
    setMessage("");
  };
  const max = photo ? 1024 : 3500;
  const send = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (photo) {
        const form = new FormData();
        form.append("text", text.trim());
        form.append("photo", photo);
        await upload("/api/admin/bot-messages/send", form);
      } else
        await apiPost("/api/admin/bot-messages/send", { text: text.trim() });
      setText("");
      setPhoto(null);
      if (input.current) input.current.value = "";
      setMessage("✅ Сообщение отправлено в чат");
      try {
        await onSent?.();
      } catch {
        setMessage("✅ Сообщение отправлено. Не удалось обновить историю.");
      }
    } catch (e) {
      const reason = e.data?.reason;
      setMessage(
        reason === "caption_too_long"
          ? "Подпись к изображению должна быть не длиннее 1024 символов"
          : reason === "request_timeout"
            ? "Сервер не ответил вовремя. Проверьте историю перед повторной отправкой."
            : reason === "unsupported_image"
              ? "Файл должен быть изображением JPEG, PNG или WEBP"
              : reason === "image_too_large"
                ? "Изображение должно быть не больше 10 МБ"
                : "❌ Не удалось отправить сообщение. Текст и изображение сохранены в редакторе.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="customBotPost">
      <textarea
        className="input"
        rows={4}
        aria-label="Текст сообщения бота"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files || []).find((f) =>
            f.type.startsWith("image/"),
          );
          if (file) select(file);
        }}
        placeholder="Текст сообщения или подпись к изображению…"
      />
      <div className="small">
        {text.trim().length} / {max} символов
        {photo ? " · подпись под изображением" : ""}
      </div>
      <div className="adminActionRow">
        <label className="btn secondary customBotPostAttach">
          🖼 Добавить изображение
          <input
            ref={input}
            type="file"
            aria-label="Изображение для сообщения"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              select(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {photo && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => setPhoto(null)}
          >
            Убрать изображение
          </button>
        )}
      </div>
      {preview && (
        <div className="customBotPostPreview">
          <img src={preview} alt="Предпросмотр изображения в посте" />
          {text && <p>{text}</p>}
        </div>
      )}
      <p className="small">
        JPEG, PNG или WEBP до 10 МБ. Можно вставить картинку из буфера обмена.
      </p>
      <button
        type="button"
        className="btn"
        onClick={send}
        disabled={busy || (!text.trim() && !photo) || text.trim().length > max}
      >
        {busy ? "Отправляю…" : "Отправить в чат"}
      </button>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
