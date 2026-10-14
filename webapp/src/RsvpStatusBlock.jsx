import React, { useMemo } from "react";
import { groupRsvpPlayers, playerName } from "./rsvpPlayerOrder.js";
export default function RsvpStatusBlock({
  title,
  tone,
  list = [],
  isAdmin,
  me,
  canPickPos = false,
  setPosPopup,
}) {
  const groups = useMemo(() => groupRsvpPlayers(list, tone), [list, tone]);
  const editable =
    isAdmin &&
    canPickPos &&
    tone === "yes" &&
    typeof setPosPopup === "function";
  return (
    <section className={`rsvpRoster rsvpRoster--${tone}`} aria-label={title}>
      <header className="rsvpRoster__header">
        <div className="rsvpRoster__heading">
          <span className="rsvpRoster__led" aria-hidden="true" />
          <h4>{title}</h4>
        </div>
        <span
          className="rsvpRoster__total"
          aria-label={`${list.length} игроков`}
        >
          {list.length}
        </span>
      </header>
      {!list.length ? (
        <p className="rsvpRoster__empty">Пока нет игроков</p>
      ) : (
        groups.map((group) => (
          <div
            className={`rsvpRoster__group position-${group.position}`}
            key={group.position}
          >
            <div className="rsvpRoster__groupHeading">
              <span>
                {group.icon} {group.title}
              </span>
              <span>{group.players.length}</span>
            </div>
            <ol className="rsvpRoster__list">
              {group.players.map((p, index) => {
                const mine =
                    me?.tg_id != null && String(me.tg_id) === String(p.tg_id),
                  number = p.jersey_number,
                  hasNumber =
                    number !== null &&
                    number !== undefined &&
                    number !== "" &&
                    Number.isFinite(Number(number)),
                  override = !!String(p.pos_override || "").trim();
                const Row = editable ? "button" : "div";
                return (
                  <li key={p.tg_id}>
                    <Row
                      className={`rsvpRoster__player ${mine ? "isMine" : ""}`}
                      {...(editable
                        ? {
                            type: "button",
                            onClick: (event) => {
                              event.stopPropagation();
                              setPosPopup(p);
                            },
                            title: "Изменить позицию игрока",
                          }
                        : {})}
                    >
                      <span className="rsvpRoster__ordinal" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span
                        className="rsvpRoster__position"
                        title={
                          override
                            ? "Позиция изменена для этой игры"
                            : group.title
                        }
                      >
                        {group.position}
                        {override ? "*" : ""}
                      </span>
                      <span className="rsvpRoster__identity">
                        <span className="rsvpRoster__name">
                          {playerName(p)}
                        </span>
                        {(mine || p.is_guest || p.auto_no) && (
                          <span className="rsvpRoster__details">
                            {[
                              mine ? "Вы" : null,
                              p.is_guest ? "Гость" : null,
                              p.auto_no ? "Автоматическая отметка" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                        {isAdmin && p.skill != null && (
                          <span className="rsvpRoster__skill">
                            Навык <b>{p.skill}</b>
                          </span>
                        )}
                      </span>
                      {hasNumber && (
                        <span className="rsvpRoster__number">
                          № {Math.trunc(Number(number))}
                        </span>
                      )}
                    </Row>
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}
