import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiGet } from "./api.js";
import "./sheepReminder.css";

// A dismissal belongs to this award and its next game, never to future wins.
export function sheepReminderKey(playerId, game) {
  const award = game?.previous_game_award;
  if (
    playerId == null ||
    game?.id == null ||
    award?.game_id == null ||
    award.tg_id == null ||
    String(award.tg_id) !== String(playerId)
  )
    return null;
  return `sheep-reminder:v1:${playerId}:${award.game_id}:${game.id}`;
}

export default function SheepReminder({ playerId, nextGameId }) {
  const [reminder, setReminder] = useState(null);
  const dismissed = useRef(new Set());
  useEffect(() => {
    setReminder(null);
    if (playerId == null || nextGameId == null) return;
    const controller = new AbortController();
    apiGet(`/api/game?game_id=${encodeURIComponent(nextGameId)}`, {
      signal: controller.signal,
      timeoutMs: 10000,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const game = data?.game;
        if (
          String(game?.id) !== String(nextGameId) ||
          game.status !== "scheduled" ||
          Date.now() >= new Date(game.starts_at).getTime() + 2 * 3600000
        )
          return;
        const key = sheepReminderKey(playerId, game);
        if (!key || dismissed.current.has(key)) return;
        try {
          if (localStorage.getItem(key) === "1") return;
        } catch {
          /* Storage may be disabled. */
        }
        setReminder({
          key,
          playerId: String(playerId),
          gameId: String(nextGameId),
        });
      })
      .catch(() => {
        /* Optional reminder must never block entry. */
      });
    return () => controller.abort();
  }, [playerId, nextGameId]);

  if (
    !reminder ||
    reminder.playerId !== String(playerId) ||
    reminder.gameId !== String(nextGameId)
  )
    return null;
  return (
    <ReminderDialog
      key={reminder.key}
      onDismiss={(neverAgain) => {
        if (neverAgain) {
          try {
            localStorage.setItem(reminder.key, "1");
          } catch {
            // Keep the dialog open so we do not promise a preference we could not save.
            return false;
          }
        }
        dismissed.current.add(reminder.key);
        setReminder(null);
        return true;
      }}
    />
  );
}

function ReminderDialog({ onDismiss }) {
  const dialog = useRef(null);
  const [neverAgain, setNeverAgain] = useState(false);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    // Native modal dialogs occupy the browser's top layer, above all app overlays.
    const previousFocus = document.activeElement;
    if (node.showModal) node.showModal();
    else node.setAttribute("open", "");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.querySelector("button")?.focus();
    return () => {
      node.close?.();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, []);
  function acknowledge() {
    setSaveError(onDismiss(neverAgain) === false);
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="sheepReminder"
      aria-labelledby="sheepReminderTitle"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        acknowledge();
      }}
    >
      <div className="sheepReminder__card">
        <h2 id="sheepReminderTitle">
          Не забудь принести овечку на следующую игру
        </h2>
        <img
          className="sheepReminder__image"
          src="/premiumaward.png"
          alt="Переходящая награда — овечка"
          width="220"
          height="220"
        />
        <label className="sheepReminder__choice">
          <input
            type="checkbox"
            checked={neverAgain}
            onChange={(event) => {
              setNeverAgain(event.target.checked);
              setSaveError(false);
            }}
          />
          Больше не напоминать
        </label>
        {saveError && (
          <p className="sheepReminder__error" role="alert">
            Не удалось сохранить настройку. Разреши хранение данных или убери
            галочку, чтобы закрыть окно.
          </p>
        )}
        <button
          type="button"
          className="sheepReminder__confirm"
          onClick={acknowledge}
        >
          Хорошо
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
