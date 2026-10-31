import React from "react";
import GameSettingsDialog from "./GameSettingsDialog.jsx";
import { clampSkill } from "./adminUtils.js";

const skills = {
  skill: "Общий уровень",
  skating: "Катание",
  iq: "Понимание игры",
  stamina: "Выносливость",
  passing: "Пас",
  shooting: "Бросок",
};
export default function GameGuestEditor({
  draft,
  setDraft,
  editingId,
  busy,
  onClose,
  onSave,
  onPromote,
  onDelete,
}) {
  const update = (key, value) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <GameSettingsDialog
      nested
      title={editingId ? "Карточка гостя" : "Новый гость"}
      subtitle="Добавьте участника без Telegram-аккаунта"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            className="btn secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Отмена
          </button>
          <button
            className="btn"
            type="submit"
            form="game-guest-form"
            disabled={busy}
          >
            {busy
              ? "Сохраняем…"
              : editingId
                ? "Сохранить гостя"
                : "Добавить гостя"}
          </button>
        </>
      }
    >
      <form
        id="game-guest-form"
        className="gsForm"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <section className="gsSection">
          <h3>Данные игрока</h3>
          <label className="gsField">
            Имя гостя
            <input
              className="input"
              required
              maxLength={100}
              value={draft.display_name}
              onChange={(e) => update("display_name", e.target.value)}
              placeholder="Например: Саша"
            />
          </label>
          <div className="gsFieldGrid">
            <label className="gsField">
              Номер
              <input
                className="input"
                inputMode="numeric"
                placeholder="0–99"
                value={draft.jersey_number}
                onChange={(e) =>
                  update(
                    "jersey_number",
                    e.target.value.replace(/[^\d]/g, "").slice(0, 2),
                  )
                }
              />
            </label>
            <label className="gsField">
              Позиция
              <select
                className="input"
                aria-label="Позиция"
                value={draft.position}
                onChange={(e) => update("position", e.target.value)}
              >
                <option value="F">Нападающий</option>
                <option value="D">Защитник</option>
                <option value="G">Вратарь</option>
              </select>
            </label>
          </div>
          <fieldset className="gsStatusField">
            <legend>Участие в игре</legend>
            <div className="gsStatusChoices">
              {[
                ["yes", "✓", "Будет"],
                ["no", "✕", "Не будет"],
                ["maybe", "?", "Под вопросом"],
              ].map(([value, icon, label]) => (
                <button
                  type="button"
                  key={value}
                  className={`gsStatusChoice gsStatusChoice--${value}`}
                  aria-pressed={draft.status === value}
                  onClick={() => update("status", value)}
                >
                  <b aria-hidden="true">{icon}</b>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </section>
        <details className="gsSection gsDisclosure">
          <summary>
            <span>
              Навыки и заметки
              <small>Для распределения составов · по умолчанию 5 из 10</small>
            </span>
          </summary>
          <div className="gsDisclosure__body">
            <div className="gsFieldGrid">
              {Object.entries(skills).map(([key, label]) => (
                <label className="gsField" key={key}>
                  {label}
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    value={draft[key]}
                    onChange={(e) => update(key, e.target.value)}
                    onBlur={() => update(key, clampSkill(draft[key]))}
                  />
                </label>
              ))}
            </div>
            <label className="gsField">
              Заметки
              <textarea
                className="input"
                aria-label="Заметки"
                rows={3}
                value={draft.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Что стоит знать об игроке"
              />
            </label>
          </div>
        </details>
        {editingId && (
          <details className="gsSection gsDisclosure">
            <summary>
              <span>
                Постоянный игрок
                <small>Перевести гостя в основной список команды</small>
              </span>
            </summary>
            <div className="gsDisclosure__body">
              <label className="gsField">
                Email игрока
                <input
                  className="input"
                  type="email"
                  value={draft.email || ""}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="name@example.com"
                />
              </label>
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={onPromote}
              >
                Перевести в постоянные игроки
              </button>
            </div>
          </details>
        )}
        {editingId && (
          <details className="gsSection gsDisclosure gsDanger">
            <summary>Удаление гостя</summary>
            <div className="gsDisclosure__body">
              <p className="gsHint">
                Гость исчезнет из списков игроков и составов.
              </p>
              <button
                className="btn secondary gsDangerButton"
                type="button"
                disabled={busy}
                onClick={onDelete}
              >
                Удалить гостя
              </button>
            </div>
          </details>
        )}
      </form>
    </GameSettingsDialog>
  );
}
