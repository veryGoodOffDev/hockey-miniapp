import React, { useEffect, useRef, useState } from "react";
import { showName, showNum } from "./adminUtils.js";

export default function GameParticipants({
  rows,
  loading,
  busy,
  past,
  onRefresh,
  onAttend,
  onLink,
  token,
  onRevoke,
  onHideToken,
  onTokenMessage,
}) {
  const [query, setQuery] = useState("");
  const list = useRef(null);
  const choices = [
    ["yes", "✓", past ? "Был" : "Будет"],
    ["no", "✕", past ? "Не был" : "Не будет"],
    ["maybe", "?", "Не отмечен"],
  ];
  const visible = rows.filter((p) =>
    `${showName(p)} ${showNum(p)}`
      .toLocaleLowerCase("ru")
      .includes(query.trim().toLocaleLowerCase("ru")),
  );
  useEffect(() => {
    if (token.url)
      list.current
        ?.querySelector(`[data-player-id="${token.forId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [token.forId, token.url]);
  return (
    <div className="gsStack">
      <section className="gsSection">
        <div className="gsSection__heading">
          <div>
            <h3>{past ? "Посещаемость" : "Участие в игре"}</h3>
            <p className="gsHint">
              {rows.length} игроков · отметки можно изменить вручную
            </p>
          </div>
          <button
            type="button"
            className="gsIconButton"
            aria-label="Обновить игроков"
            disabled={loading || busy}
            onClick={onRefresh}
          >
            ↻
          </button>
        </div>
        <div className="gsCounters">
          {choices.map(([value, icon, label]) => (
            <span key={value}>
              <b>
                {rows.filter((p) => (p.status || "maybe") === value).length}
              </b>
              {label}
            </span>
          ))}
        </div>
        <label className="gsField gsSearch">
          <span className="gsSrOnly">Поиск игрока</span>
          <input
            className="input"
            type="search"
            placeholder="Найти по имени или номеру"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </section>
      {token.message && (
        <div className="gsNotice" role="status">
          {token.message}
        </div>
      )}
      {loading ? (
        <p className="gsHint" role="status">
          Загружаем игроков…
        </p>
      ) : (
        <div className="gsStack" ref={list}>
          {!visible.length && (
            <p className="gsEmpty">
              {query
                ? "Никого не нашли. Попробуйте другое имя."
                : "Игроков пока нет."}
            </p>
          )}
          {visible.map((p) => {
            const status = p.status || "maybe";
            return (
              <article
                className="gsParticipant"
                key={p.tg_id}
                data-player-id={p.tg_id}
              >
                <div className="gsParticipant__heading">
                  <div>
                    <strong>
                      {showName(p)}
                      <span className="gsJerseyNumber">{showNum(p)}</span>
                    </strong>
                    <span
                      className={`gsParticipant__status gsParticipant__status--${status}`}
                    >
                      {choices.find(([value]) => value === status)?.[2] ||
                        "Не отмечен"}
                      {p.player_kind === "guest" ? " · гость" : ""}
                    </span>
                  </div>
                  <button
                    className="gsIconButton"
                    type="button"
                    aria-label={`Ссылка на отметку: ${showName(p)}`}
                    title="Создать ссылку на отметку"
                    disabled={token.busy || busy}
                    onClick={() => onLink(p.tg_id)}
                  >
                    ↗
                  </button>
                </div>
                <div
                  className="gsStatusChoices"
                  role="group"
                  aria-label={`Статус: ${showName(p)}`}
                >
                  {choices.map(([value, icon, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`gsStatusChoice gsStatusChoice--${value}`}
                      aria-pressed={status === value}
                      disabled={busy}
                      onClick={() => onAttend(p, value)}
                    >
                      <b aria-hidden="true">{icon}</b>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                {String(token.forId) === String(p.tg_id) && token.url && (
                  <div className="gsToken">
                    <label className="gsField">
                      Личная ссылка на отметку
                      <input
                        className="input"
                        readOnly
                        value={token.url}
                        onFocus={(e) => e.target.select()}
                      />
                    </label>
                    <div className="gsActions">
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={async () => {
                          try {
                            if (!navigator.clipboard?.writeText)
                              throw new Error("clipboard_unavailable");
                            await navigator.clipboard.writeText(token.url);
                            onTokenMessage("Ссылка скопирована");
                          } catch {
                            onTokenMessage(
                              "Скопируйте ссылку вручную из поля выше",
                            );
                          }
                        }}
                      >
                        Копировать
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => {
                          const tg = window.Telegram?.WebApp;
                          if (tg?.openLink) tg.openLink(token.url);
                          else
                            window.open(
                              token.url,
                              "_blank",
                              "noopener,noreferrer",
                            );
                        }}
                      >
                        Открыть
                      </button>
                      <button
                        className="btn secondary gsDangerButton"
                        type="button"
                        disabled={token.busy}
                        onClick={onRevoke}
                      >
                        Отозвать
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={onHideToken}
                      >
                        Скрыть
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
