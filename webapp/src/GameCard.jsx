import TeamJersey from "./TeamJersey.jsx";
import { TEAM_COLORS } from "./teamColors.js";
import React from "react";
import { apiPost } from "./api.js";
import { celebrateRsvp } from "./rsvpFeedback.js";

function GameStatusLed({ status }) {
  const label =
    status === "yes"
      ? "IN — играю"
      : status === "no"
        ? "OUT — не играю"
        : "Без ответа";
  return (
    <div
      className="game-card__status-led"
      role="img"
      aria-label={label}
      title={label}
    >
      <span />
    </div>
  );
}

// Presentation only: flags, counts and existing action orchestration come from the list.
export default function GameCard({
  g,
  idx,
  past,
  lockRsvp,
  when,
  status,
  noAutoFill,
  isNext,
  bgUrl,
  month,
  day,
  yes,
  target,
  progress,
  isAdmin,
  opBusy,
  runOp,
  openGameDetail,
  openGameSheet,
  statusLabel,
  myTeamColor = null,
}) {
  return (
    <div
      className={`card gameCard game-card scrollEnter status-${status} ${isNext ? "game-card--nearest" : ""} ${past ? "game-card--past" : ""} ${status === "yes" ? "game-card--joined" : status === "no" ? "game-card--out" : ""} ${isAdmin ? "game-card--admin" : ""}`}
      style={{
        "--enter-delay": `${Math.min(idx, 10) * 70}ms`,
        cursor: "pointer",
      }}
      data-scroll-enter="1"
      onClick={() => openGameDetail(g.id)}
    >
      <div
        className="game-card__background"
        style={{ backgroundImage: `url(${bgUrl})` }}
        aria-hidden="true"
      />
      <div className="game-card__overlay" aria-hidden="true" />
      {/* TOP BAR */}
      <div className="gameCard__topbar">
        <div className="gameCard__title">
          {isNext ? "Ближайшая игра" : statusLabel}
        </div>

        <div className="gameCard__topRight">
          {g.video_url ? (
            <span className="gameCard__pill" title="Есть видео">
              ▶️
            </span>
          ) : null}
          {(() => {
            const cc = g.comments_count ?? 0;
            return (
              <span
                className="gameCard__pill"
                aria-label={`Комментарии: ${cc}`}
                title={cc > 0 ? "Комментарии" : "Обсудить"}
                style={{ cursor: "pointer" }}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  openGameDetail(g.id, "comments");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    openGameDetail(g.id, "comments");
                  }
                }}
              >
                💬 {cc}
              </span>
            );
          })()}
          <GameStatusLed status={status} />
        </div>
      </div>

      {/* MAIN */}
      <div className="gameCard__main">
        {/* DATE BADGE */}
        <div className="gameCard__date">
          <div className="gameCard__month">{month}</div>
          <div className="gameCard__day">{day}</div>
        </div>

        {/* INFO */}
        <div className="gameCard__info">
          <div className="gameCard__when">
            {when.replace(/,?\s*\d{2}:\d{2}$/, "")}
          </div>
          <div className="gameCard__time">
            {when.match(/\d{2}:\d{2}$/)?.[0]}
          </div>
          <div className="gameCard__loc">📍 {g.location || "—"}</div>
        </div>

        {/* RING */}
        <div
          className="gameCard__ringWrap"
          title={`${yes} будут (цель ${target})`}
        >
          <div className="progressRing" style={{ "--p": progress }}>
            <div className="ringCenter">
              <span aria-hidden="true">👥</span>
              <strong>{yes}</strong>
            </div>
          </div>
        </div>
      </div>

      {status === "yes" &&
        !past &&
        g.status !== "cancelled" &&
        TEAM_COLORS[myTeamColor] && (
          <div className={`game-card__team game-card__team--${myTeamColor}`}>
            <TeamJersey color={myTeamColor} size={27} />
            <span>{TEAM_COLORS[myTeamColor].message}</span>
          </div>
        )}

      {/* ACTIONS */}
      <div className="gameCard__actions" onClick={(e) => e.stopPropagation()}>
        <button
          disabled={opBusy || lockRsvp}
          aria-pressed={status === "yes"}
          className={`rsvpBtn in ${status === "yes" ? "active" : ""}`}
          onClick={async (e) => {
            e.stopPropagation();
            const origin = e.currentTarget.getBoundingClientRect();
            if (lockRsvp) return;

            await runOp(
              "Сохраняю IN…",
              async () => {
                await apiPost("/api/rsvp", { game_id: g.id, status: "yes" });
                celebrateRsvp("yes", origin);
              },
              {
                successText: "✅ IN сохранён",
                errorText: "❌ Не удалось сохранить IN",
                sync: { gameId: g.id, refreshGames: true, refreshGame: false }, // деталка не нужна на list
              },
            );
          }}
        >
          👍 IN
        </button>

        <button
          disabled={opBusy || lockRsvp}
          aria-pressed={status === "no"}
          className={`rsvpBtn out ${status === "no" ? "active" : ""} ${status === "maybe" ? "autoNoFill" : ""}`}
          style={status === "maybe" ? { "--auto-no-p": noAutoFill } : undefined}
          onClick={async (e) => {
            e.stopPropagation();
            const origin = e.currentTarget.getBoundingClientRect();
            if (lockRsvp) return;

            await runOp(
              "Сохраняю OUT…",
              async () => {
                await apiPost("/api/rsvp", { game_id: g.id, status: "no" });
                celebrateRsvp("no", origin);
              },
              {
                successText: "✅ OUT сохранён",
                errorText: "❌ Не удалось сохранить OUT",
                sync: { gameId: g.id, refreshGames: true, refreshGame: false },
              },
            );
          }}
        >
          <span>👎 OUT</span>
          {status === "maybe" ? (
            <span className="rsvpBtn__hint">авто</span>
          ) : null}
        </button>
      </div>
      {status === "maybe" && g.auto_no_at ? (
        <div className="small autoNoHint">
          Если не отметиться, перед игрой статус станет «Не играю»
          автоматически.
        </div>
      ) : null}
      {g.notice_text ? (
        <div className="gameNoticeInline" onClick={(e) => e.stopPropagation()}>
          <span className="gameNoticeInline__icon" aria-hidden="true">
            ℹ️
          </span>
          <span className="gameNoticeInline__text">{g.notice_text}</span>
        </div>
      ) : null}
      {isAdmin ? (
        <div className="game-card__admin" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => openGameSheet(g)}
            title={
              g.notice_text
                ? "Изменить важную заметку"
                : "Добавить важную заметку"
            }
          >
            <span aria-hidden="true">{g.notice_text ? "✏️" : "＋"}</span>
            <span>Важно</span>
            <span className="game-card__adminArrow" aria-hidden="true">
              ›
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
