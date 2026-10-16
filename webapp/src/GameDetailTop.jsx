import React, { useRef } from "react";

function DetailIcon({ name, size = 22, className = "" }) {
  const paths = {
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18M7 15h1m4 0h1m4 0h1M7 18h1m4 0h1" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 3" />
      </>
    ),
    group: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M3 21v-4a6 6 0 0 1 12 0v4H3m14-17a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v2h-3" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 22v-3a8 8 0 0 1 16 0v3Z" />
      </>
    ),
    arrow: <path d="m10 5-7 7 7 7M3 12h18" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 5 5L20 7" />,
    cross: <path d="m6 6 12 12M18 6 6 18" />,
    note: (
      <>
        <rect x="5" y="3" width="14" height="19" rx="2" />
        <path d="M9 8h6m-6 4h6m-6 4h4" />
      </>
    ),
    hockey: (
      <>
        <path d="m20 3-9 16H5a2 2 0 0 1 0-4h4" />
        <path d="m5 12 5 1" />
        <ellipse cx="18" cy="21" rx="3" ry="1" />
      </>
    ),
    video: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m10 9 5 3-5 3Z" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-.7 2.5-2.2 1.3L3.6 6l-2 3.5 1.8 1.7v2.6L1.6 15.5l2 3.5 2.5-.8 2.2 1.3L9 22h4l.7-2.5 2.2-1.3 2.5.8 2-3.5-1.8-1.7v-2.6l1.8-1.7-2-3.5-2.5.8-2.2-1.3L13 3Z" />
        <circle cx="11" cy="12.5" r="3" />
      </>
    ),
    route: <path d="m3 10 18-7-7 18-3-8-8-3Z" fill="currentColor" />,
  };
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function GameDetailNav({ onTeams, onBack }) {
  return (
    <nav className="gameDetailNav" aria-label="Навигация по игре">
      <span className="gameDetailNav__item isActive" aria-current="page">
        <DetailIcon name="hockey" />
        <span>Игра</span>
      </span>
      <button type="button" className="gameDetailNav__item" onClick={onTeams}>
        <DetailIcon name="group" />
        <span>Составы</span>
      </button>
      <button type="button" className="gameDetailNav__item" onClick={onBack}>
        <DetailIcon name="arrow" />
        <span>К списку</span>
      </button>
    </nav>
  );
}

export default function GameDetailTop({
  game,
  when,
  status,
  myRsvp,
  isAdmin,
  locked,
  busy,
  onSettings,
  onRoute,
  onVideo,
  onRsvp,
}) {
  const participation = useRef(null);
  const cancelled = game.status === "cancelled";
  const statusText =
    { yes: "Буду", no: "Не буду", maybe: "Не отметился" }[myRsvp] ||
    "Не отметился";
  const hasRoute = game.geo_lat != null && game.geo_lon != null;
  return (
    <div className="gameDetailTop">
      <section className="gameDetailHero" aria-label="Информация об игре">
        <div className="gameDetailHero__top">
          <div className="gameDetailHero__date">
            <DetailIcon name="calendar" />
            <strong>{when}</strong>
          </div>
          {isAdmin && (
            <button
              type="button"
              className="gameDetailHero__settings"
              aria-label="Настройки игры"
              onClick={onSettings}
            >
              <DetailIcon name="settings" />
            </button>
          )}
        </div>
        <div className="gameDetailHero__location">
          <DetailIcon name="pin" />
          <span>{game.location || "Место не указано"}</span>
        </div>
        <div className="gameDetailHero__state">
          <DetailIcon name="clock" size={16} />
          <span>{status}</span>
        </div>
        {(hasRoute || game.video_url) && (
          <div className="gameDetailHero__links">
            {hasRoute && (
              <button
                type="button"
                className="gameDetailLink gameDetailLink--route"
                onClick={onRoute}
              >
                <DetailIcon name="route" />
                <span>Маршрут</span>
                <DetailIcon name="chevron" size={18} />
              </button>
            )}
            {game.video_url && (
              <button
                type="button"
                className="gameDetailLink"
                onClick={onVideo}
              >
                <DetailIcon name="video" />
                <span>Видео игры</span>
                <DetailIcon name="chevron" size={18} />
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          className={`gameDetailHero__mine status-${myRsvp || "maybe"}`}
          onClick={() =>
            participation.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            })
          }
          aria-label={`Мой статус: ${statusText}. Перейти к выбору участия`}
        >
          <DetailIcon name="user" size={19} />
          <span>Мой статус</span>
          <strong>{statusText}</strong>
          <DetailIcon name="chevron" size={17} />
        </button>
      </section>

      {(game.notice_text || game.info_text) && (
        <div className="gameDetailNotes">
          {game.notice_text && (
            <section className="gameDetailNote gameDetailNote--important">
              <h3>Важно</h3>
              <p>{game.notice_text}</p>
            </section>
          )}
          {game.info_text && (
            <section className="gameDetailNote">
              <h3>Подробности игры</h3>
              <p>{game.info_text}</p>
            </section>
          )}
        </div>
      )}

      {isAdmin && (
        <section
          className="gameDetailOrganizer"
          aria-label="Действия для организатора"
        >
          <div className="gameDetailSectionTitle">
            <DetailIcon name="note" size={24} />
            <div>
              <h3>Действия для организатора</h3>
              <p>Добавьте важную информацию или детали об игре.</p>
            </div>
          </div>
          <div className="gameDetailOrganizer__actions">
            <button
              type="button"
              className="gameDetailLink"
              onClick={onSettings}
            >
              <span className="gameDetailPlus">
                <DetailIcon name="plus" size={19} />
              </span>
              <span>
                {game.notice_text ? "Изменить «Важно»" : "Добавить «Важно»"}
              </span>
              <DetailIcon name="chevron" size={18} />
            </button>
            <button
              type="button"
              className="gameDetailLink"
              onClick={onSettings}
            >
              <span className="gameDetailPlus">
                <DetailIcon name="plus" size={19} />
              </span>
              <span>
                {game.info_text
                  ? "Изменить подробности"
                  : "Добавить подробности"}
              </span>
              <DetailIcon name="chevron" size={18} />
            </button>
          </div>
        </section>
      )}

      <section
        className="gameDetailParticipation"
        aria-label="Ваше участие"
        ref={participation}
      >
        <div className="gameDetailSectionTitle">
          <DetailIcon name="group" size={25} />
          <div>
            <h3>Ваше участие</h3>
            <p>Сообщите, будете ли вы на игре.</p>
          </div>
        </div>
        {cancelled ? (
          <p className="gameDetailParticipation__notice">Эта игра отменена.</p>
        ) : locked ? (
          <p className="gameDetailParticipation__notice">
            Игра уже прошла — менять отметки нельзя.
          </p>
        ) : (
          <div className="gameDetailParticipation__buttons">
            <button
              type="button"
              disabled={busy}
              className={`gameDetailRsvp gameDetailRsvp--yes ${myRsvp === "yes" ? "isSelected" : ""}`}
              aria-pressed={myRsvp === "yes"}
              onClick={(event) => onRsvp("yes", event)}
            >
              <span className="gameDetailRsvp__icon">
                <DetailIcon name="check" size={22} />
              </span>
              <span>Буду</span>
            </button>
            <button
              type="button"
              disabled={busy}
              className={`gameDetailRsvp gameDetailRsvp--no ${myRsvp === "no" ? "isSelected" : ""}`}
              aria-pressed={myRsvp === "no"}
              onClick={(event) => onRsvp("no", event)}
            >
              <span className="gameDetailRsvp__icon">
                <DetailIcon name="cross" size={21} />
              </span>
              <span>Не буду</span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
