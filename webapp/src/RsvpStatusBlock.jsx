import MatchAwardBadge from "./MatchAwardBadge.jsx";
import TeamColorMark from "./TeamColorMark.jsx";
import { playerTeamColor } from "./teamColors.js";
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
  teams = null,
  bestPlayerId = null,
  previousAward = null,
  view = "list",
}) {
  const players = useMemo(
    () =>
      groupRsvpPlayers(list, tone).flatMap((group) =>
        group.players.map((player) => ({ player, group })),
      ),
    [list, tone],
  );
  const editable =
    isAdmin &&
    canPickPos &&
    tone === "yes" &&
    typeof setPosPopup === "function";
  return (
    <section
      className={`rsvpRoster rsvpRoster--${tone}${view === "chips" ? " rsvpRoster--chips" : ""}`}
      aria-label={title}
    >
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
        <ol className="rsvpRoster__list">
          {players.map(({ player: p, group }, index) => {
            const mine =
                me?.tg_id != null && String(me.tg_id) === String(p.tg_id),
              number = p.jersey_number,
              hasNumber =
                number !== null &&
                number !== undefined &&
                number !== "" &&
                Number.isFinite(Number(number)),
              override = !!String(p.pos_override || "").trim();
            const color =
              tone === "yes" ? playerTeamColor(teams, p.tg_id) : null;
            const Row = editable ? "button" : "div";
            return (
              <li key={p.tg_id}>
                <Row
                  className={`rsvpRoster__player position-${group.position} ${mine ? "isMine" : ""}`}
                  {...(editable
                    ? {
                        type: "button",
                        onClick: (event) => {
                          event.stopPropagation();
                          setPosPopup(p);
                        },
                        title: "Действия с игроком на эту игру",
                      }
                    : {})}
                >
                  <span className="rsvpRoster__ordinal" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span
                    className="rsvpRoster__position"
                    title={
                      override ? "Позиция изменена для этой игры" : group.title
                    }
                  >
                    {group.position}
                    {override ? "*" : ""}
                  </span>
                  <span className="rsvpRoster__identity">
                    <span className="rsvpRoster__nameLine">
                      {color && <TeamColorMark color={color} />}
                      <span className="rsvpRoster__name">
                        {playerName(p)}
                        {bestPlayerId != null &&
                          String(bestPlayerId) === String(p.tg_id) && (
                            <MatchAwardBadge />
                          )}
                      </span>
                      {mine && <span className="rsvpRoster__you">Вы</span>}
                    </span>
                    {previousAward?.tg_id != null &&
                      String(previousAward.tg_id) === String(p.tg_id) && (
                        <span
                          className="rsvpRoster__previousAward"
                          title="Лучший игрок предыдущего матча. Не забудьте принести трофей на эту игру."
                        >
                          <MatchAwardBadge previous decorative />
                          <span>В прошлой игре</span>
                        </span>
                      )}
                    {(p.is_guest || p.auto_no) && (
                      <span className="rsvpRoster__details">
                        {[
                          p.is_guest ? "Гость" : null,
                          p.auto_no ? "Автоматическая отметка" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  {(hasNumber || (isAdmin && p.skill != null)) && (
                    <span className="rsvpRoster__meta">
                      {hasNumber && (
                        <span className="rsvpRoster__number">
                          № {Math.trunc(Number(number))}
                        </span>
                      )}
                      {isAdmin && p.skill != null && (
                        <span className="rsvpRoster__skill">
                          Навык <b>{p.skill}</b>
                        </span>
                      )}
                    </span>
                  )}
                </Row>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
