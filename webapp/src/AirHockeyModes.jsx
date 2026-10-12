import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import AirHockey from "./AirHockey.jsx";
import AirHockeyPvp from "./AirHockeyPvp.jsx";
export default function AirHockeyModes({
  onClose,
  onProfileChange,
  inviteCode,
}) {
  const [mode, setMode] = useState(inviteCode ? "pvp" : null);
  const [invite, setInvite] = useState(inviteCode);
  useEffect(() => {
    if (mode) return;
    const root = document.getElementById("root"),
      overflow = document.body.style.overflow;
    root?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "hidden";
    return () => {
      root?.removeAttribute("aria-hidden");
      document.body.style.overflow = overflow;
    };
  }, [mode]);
  if (mode === "bot")
    return (
      <AirHockey
        onClose={() => setMode(null)}
        onProfileChange={onProfileChange}
      />
    );
  if (mode === "pvp")
    return (
      <AirHockeyPvp
        onClose={() => {
          setMode(null);
          setInvite(null);
        }}
        onProfileChange={onProfileChange}
        inviteCode={invite}
      />
    );
  return createPortal(
    <div
      className="airScreen airModeScreen"
      role="dialog"
      aria-modal="true"
      aria-label="Выбор режима Air Hockey"
    >
      <header>
        <button className="btn secondary" onClick={onClose}>
          ← Назад
        </button>
        <h2>🏒 Играть в хоккей</h2>
      </header>
      <div className="airModeChoices">
        <button className="btn" onClick={() => setMode("bot")}>
          Против бота
        </button>
        <button className="btn secondary" onClick={() => setMode("pvp")}>
          Игрок против игрока
        </button>
        <p className="small">PvP 1×1 · комнаты по коду · матч до 7 голов</p>
      </div>
    </div>,
    document.body,
  );
}
