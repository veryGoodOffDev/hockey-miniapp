import React from "react";
import { formatGameDuration } from "../gameTiming.js";
export default function GameDurationField({ value, onChange }) {
  return (
    <label className="gsField">
      Продолжительность игры, мин
      <input
        className="input"
        type="number"
        aria-label="Продолжительность игры, мин"
        min="1"
        max="1440"
        step="1"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <small className="gsField__hint">
        {formatGameDuration(value)} · После окончания игра получит отметку
        «Прошла» и откроется выдача награды.
      </small>
    </label>
  );
}
