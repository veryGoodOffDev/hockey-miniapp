import React from "react";

export default function RsvpViewToggle({
  view,
  setView,
  saving,
  error,
  retry,
}) {
  return (
    <div className="rsvpViewToolbar">
      <div
        className="rsvpViewToggle"
        role="group"
        aria-label="Вид списка отметок"
      >
        <button
          type="button"
          className={view === "list" ? "isActive" : ""}
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M8 6h13M8 12h13M8 18h13" />
            <circle cx="3" cy="6" r="1" />
            <circle cx="3" cy="12" r="1" />
            <circle cx="3" cy="18" r="1" />
          </svg>
          Список
        </button>
        <button
          type="button"
          className={view === "chips" ? "isActive" : ""}
          aria-pressed={view === "chips"}
          onClick={() => setView("chips")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="12" height="6" rx="3" />
            <rect x="2" y="14" width="8" height="6" rx="3" />
            <rect x="13" y="14" width="9" height="6" rx="3" />
          </svg>
          Чипсы
        </button>
      </div>
      <span
        className="rsvpViewToolbar__status"
        role="status"
        aria-live="polite"
      >
        {saving ? (
          "Сохраняем…"
        ) : error ? (
          <>
            Не удалось подтвердить сохранение в профиле.{" "}
            <button type="button" onClick={retry}>
              Повторить
            </button>
          </>
        ) : null}
      </span>
    </div>
  );
}
