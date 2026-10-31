import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { connectPvp } from "./airHockeyPvpSocket.js";
import AirHockeyPvpRink from "./AirHockeyPvpRink.jsx";
const ERRORS = {
  feature_disabled: "Air Hockey отключён администратором. Новые игры пока недоступны",
  room_full: "Комната уже заполнена",
  room_finished: "Игра уже завершена",
  room_not_found: "Комната не найдена",
  bad_code: "Введите четырёхзначный код",
  already_in_room: "Вы уже в комнате — переподключитесь",
  server_busy: "Сервер занят, попробуйте позже",
  too_fast: "Подождите немного",
  opponent_left: "Соперник покинул комнату",
  rematch_unavailable: "Реванш пока недоступен",
};
export default function AirHockeyPvp({ onClose, onProfileChange, inviteCode }) {
  const [state, setState] = useState(null),
    [connection, setConnection] = useState("connecting"),
    [code, setCode] = useState(inviteCode || ""),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  const socket = useRef(null),
    invited = useRef(false),
    profileChange = useRef(onProfileChange);
  profileChange.current = onProfileChange;
  useEffect(() => {
    const root = document.getElementById("root"),
      overflow = document.body.style.overflow;
    root?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "hidden";
    socket.current = connectPvp({
      onConnection: (status) => {
        setConnection(status);
        if (status !== "connecting") setPending(false);
      },
      onEvent: (event, data) => {
        if (event === "authenticated" && inviteCode && !invited.current) {
          invited.current = true;
          socket.current.send("join_room", { code: inviteCode });
        }
        if (
          [
            "room_state",
            "game_state",
            "goal",
            "finish",
            "disconnect",
            "reconnect",
          ].includes(event)
        ) {
          setState(data);
          setPending(false);
          setMessage("");
          if (event === "finish") profileChange.current?.();
        }
        if (event === "error") {
          setMessage(ERRORS[data.reason] || "Не удалось выполнить действие");
          setPending(false);
        }
      },
    });
    return () => {
      socket.current?.close();
      root?.removeAttribute("aria-hidden");
      document.body.style.overflow = overflow;
    };
  }, []);
  const send = useCallback(
    (event, data) => socket.current?.send(event, data),
    [],
  );
  const action = (event, data) => {
    setMessage("");
    if (send(event, data)) setPending(true);
  };
  const leave = () => {
    send("leave");
    onClose();
  };
  const share = async () => {
    const link = `https://t.me/HockeyLineupBot?startapp=airhockey_${state.code}`;
    try {
      if (navigator.share)
        await navigator.share({
          title: "Air Hockey PvP",
          text: `Комната ${state.code}`,
          url: link,
        });
      else {
        await navigator.clipboard.writeText(link);
        setMessage("Приглашение скопировано");
      }
    } catch (e) {
      if (e.name !== "AbortError") setMessage(`Код комнаты: ${state.code}`);
    }
  };
  const active =
      state && ["countdown", "playing", "reconnecting"].includes(state.status),
    finished = state && ["finished", "cancelled"].includes(state.status),
    slot = state?.slot ?? 0,
    other = 1 - slot;
  const connectionText = {
    connecting: "Подключение…",
    connected: "На связи",
    reconnecting: "Связь потеряна. Попытка переподключения…",
    replaced: "Игра открыта на другом устройстве",
    unauthorized: "Не удалось авторизоваться. Откройте приложение заново.",
  }[connection];
  return createPortal(
    <div
      className="airScreen airPvpScreen"
      role="dialog"
      aria-modal="true"
      aria-label="Игрок против игрока"
    >
      <header>
        <button className="btn secondary" onClick={leave}>
          ← Выйти
        </button>
        <h2>Игрок против игрока</h2>
      </header>
      <p className="airPvpConnection" role="status">
        {connectionText}
      </p>
      {!state && (
        <div className="airModeChoices">
          <button
            className="btn"
            disabled={connection !== "connected" || pending}
            onClick={() => action("create_room")}
          >
            Создать игру
          </button>
          <label>
            Код комнаты
            <input
              className="input"
              inputMode="numeric"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button
            className="btn secondary"
            disabled={
              connection !== "connected" || pending || code.length !== 4
            }
            onClick={() => action("join_room", { code })}
          >
            Ввести код комнаты
          </button>
          <p className="small">
            Победа +25 SC · поражение +3 SC
            <br />
            Награды: до 10 матчей в сутки, до 3 с одним соперником. Матч от 60
            секунд активной игры.
          </p>
        </div>
      )}
      {state?.status === "waiting" && (
        <div className="airModeChoices">
          <h2>Комната создана</h2>
          <span>Код игры</span>
          <strong className="airPvpCode">{state.code}</strong>
          <p>Ждём соперника…</p>
          <button className="btn" onClick={share}>
            Скопировать/поделиться приглашением
          </button>
          <button className="btn secondary" onClick={leave}>
            Отменить
          </button>
        </div>
      )}
      {active && (
        <>
          <div className="airScore airPvpScore">
            <span>{state.players[slot]?.name}</span>
            <b>
              {state.score[slot]} : {state.score[other]}
            </b>
            <span>{state.players[other]?.name || "Соперник"}</span>
          </div>
          <div className="airPvpField">
            <AirHockeyPvpRink state={state} send={send} />
            {state.status === "countdown" && (
              <div className="airPvpOverlay">
                <p>Соперник найден</p>
                <strong>{state.countdown || "🏒"}</strong>
                <p>Матч начинается…</p>
              </div>
            )}
            {(state.status === "reconnecting" ||
              connection !== "connected") && (
              <div className="airPvpOverlay">
                <p>Связь потеряна</p>
                <p>Ждём переподключения…</p>
              </div>
            )}
          </div>
        </>
      )}
      {finished && (
        <div className="airResult">
          <h2>
            {state.status === "cancelled"
              ? "Матч отменён"
              : state.winner === slot
                ? "🏆 Победа"
                : "Матч окончен"}
          </h2>
          <strong>
            {state.score[slot]} : {state.score[other]}
          </strong>
          {state.finishReason === "disconnect" && (
            <p>
              {state.winner === slot
                ? "Соперник покинул матч"
                : "Матч завершён из-за отключения"}
            </p>
          )}
          {state.rewardPending ? (
            <p>Сохраняем результат…</p>
          ) : state.rewards?.[slot] > 0 ? (
            <p>+{state.rewards[slot]} Sheep Coins</p>
          ) : (
            <p>
              Награда за этот матч не начисляется
              {state.rewardReasons?.[slot] === "too_short"
                ? " — матч слишком короткий"
                : state.rewardReasons?.[slot] === "pair_limit"
                  ? " — лимит с этим соперником"
                  : state.rewardReasons?.[slot] === "daily_limit"
                    ? " — суточный лимит"
                    : ""}
            </p>
          )}
          {state.status === "finished" && (
            <button
              className="btn"
              disabled={
                pending ||
                state.rewardPending ||
                connection !== "connected" ||
                state.rematch.includes(state.players[slot].id)
              }
              onClick={() => action("rematch")}
            >
              {state.rematch.includes(state.players[slot].id)
                ? "Ждём согласия соперника…"
                : "Реванш"}
            </button>
          )}
          <button className="btn secondary" onClick={leave}>
            Выйти
          </button>
        </div>
      )}
      {message && (
        <p className="airNotice" role="alert">
          {message}
        </p>
      )}
    </div>,
    document.body,
  );
}
