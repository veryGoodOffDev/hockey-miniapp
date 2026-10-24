import React, { useMemo, useState } from "react";
import { playerName } from "../rsvpPlayerOrder.js";
import { botLaunchSummary, playerBotStatus } from "./playerBotStatus.js";
import "./adminPlayerList.css";

const POSITIONS = { G: "Вратарь", D: "Защитник", F: "Нападающий" };
const FILTERS = [
  ["all", "Все"],
  ["started", "Запускали"],
  ["unconfirmed", "Нет подтверждения"],
  ["unavailable", "Без Telegram"],
];
function dateLabel(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function Avatar({ player, name }) {
  const url = player.avatar_url || player.photo_url || "";
  const [failed, setFailed] = useState(null);
  const words = name.trim().split(/\s+/);
  const initials = (
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => Array.from(word)[0])
          .join("")
      : Array.from(name).slice(0, 2).join("")
  ).toUpperCase();
  return (
    <span className="adminPlayerCard__avatar" aria-hidden="true">
      {url && failed !== url ? (
        <img
          src={url}
          alt=""
          width="52"
          height="52"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
        />
      ) : (
        <span>{initials || "?"}</span>
      )}
    </span>
  );
}
export default function AdminPlayerList({
  players,
  allPlayers = players,
  canViewBotStatus = false,
  onOpenPlayer,
  formatLastSeen,
}) {
  const [filter, setFilter] = useState("all");
  const summary = useMemo(() => botLaunchSummary(allPlayers), [allPlayers]);
  const visible = players.filter(
    (player) =>
      !canViewBotStatus ||
      filter === "all" ||
      playerBotStatus(player) === filter,
  );
  return (
    <>
      {canViewBotStatus && (
        <div className="adminBotOverview">
          <div className="adminBotOverview__headline">
            <span aria-hidden="true">🤖</span>
            <span>
              Бота запускали{" "}
              <strong>
                {summary.started}
                <span> / {summary.total}</span>
              </strong>
            </span>
          </div>
          <p>
            Среди активных игроков с Telegram. Факт запуска не гарантирует, что
            бот сейчас не заблокирован.
          </p>
          <div
            className="adminBotFilters"
            role="group"
            aria-label="Фильтр по запуску бота"
          >
            {FILTERS.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={filter === value ? "isActive" : ""}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="adminPlayerList__count" role="status">
        Показано игроков: {visible.length}
      </div>
      <div className="adminPlayerList">
        {visible.map((player) => {
          const name = playerName(player),
            status = playerBotStatus(player);
          const position = String(player.position || "F").toUpperCase();
          const number = player.jersey_number;
          const hasNumber =
            number != null && number !== "" && Number.isFinite(Number(number));
          const startedAt = dateLabel(player.bot_pm?.started_at),
            lastInteraction = dateLabel(player.bot_pm?.last_interaction_at);
          return (
            <button
              type="button"
              key={player.tg_id}
              className={`adminPlayerCard position-${position}${player.disabled ? " isDisabled" : ""}`}
              onClick={() => onOpenPlayer(player)}
              aria-label={`Открыть игрока: ${name}`}
            >
              <span className="adminPlayerCard__top">
                <Avatar player={player} name={name} />
                <span className="adminPlayerCard__identity">
                  <strong>{name}</strong>
                  <span className="adminPlayerCard__username">
                    {player.username
                      ? `@${player.username}`
                      : `ID ${player.tg_id}`}
                  </span>
                </span>
                {hasNumber && (
                  <span className="adminPlayerCard__number">
                    <small>ДЖЕРСИ</small>№ {Math.trunc(Number(number))}
                  </span>
                )}
                <svg
                  className="adminPlayerCard__chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m9 5 7 7-7 7" />
                </svg>
              </span>
              <span className="adminPlayerCard__tags">
                <span className="adminPlayerCard__position">
                  {POSITIONS[position] || POSITIONS.F}
                </span>
                <span
                  className={
                    player.disabled
                      ? "adminPlayerCard__disabled"
                      : "adminPlayerCard__active"
                  }
                >
                  {player.disabled ? "Отключён" : "Активен"}
                </span>
                {(player.is_guest || player.player_kind === "guest") && (
                  <span>Гость</span>
                )}
                {player.player_kind === "manual" && (
                  <span>Добавлен вручную</span>
                )}
                {player.is_admin && <span>★ Админ</span>}
                {player.is_env_admin && <span>🔒 ENV-админ</span>}
                {player.joke_premium_active && <span>✦ Премиум</span>}
              </span>
              {player.last_seen_at && (
                <span
                  className="adminPlayerCard__lastSeen"
                  title="Последний вход в приложение"
                >
                  ◷ {formatLastSeen(player.last_seen_at)}
                </span>
              )}
              {canViewBotStatus && (
                <span
                  className={`adminPlayerCard__bot adminPlayerCard__bot--${status}`}
                >
                  <span className="adminPlayerCard__botLabel">
                    <i aria-hidden="true" />
                    {status === "started"
                      ? "Запускал бота"
                      : status === "unconfirmed"
                        ? "Запуск не подтверждён"
                        : "Без Telegram"}
                  </span>
                  {status === "started" && startedAt && (
                    <span className="adminPlayerCard__botDate">
                      Первый запуск: {startedAt}
                    </span>
                  )}
                  {status === "started" && lastInteraction && (
                    <span className="adminPlayerCard__botDate">
                      Взаимодействие с ботом: {lastInteraction}
                    </span>
                  )}
                  {status === "unavailable" && (
                    <span className="adminPlayerCard__botDate">
                      Личные уведомления бота недоступны
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
        {!visible.length && (
          <p className="adminPlayerList__empty">
            Игроков по выбранным условиям не найдено.
          </p>
        )}
      </div>
    </>
  );
}
