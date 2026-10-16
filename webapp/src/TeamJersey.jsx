import React from "react";
import { TEAM_COLORS } from "./teamColors.js";

export default function TeamJersey({ color, size = 19 }) {
  const team = TEAM_COLORS[color];
  if (!team) return null;
  return (
    <span
      className="teamJersey"
      role="img"
      aria-label={`Команда: ${team.label}`}
      title={`Команда: ${team.label}`}
    >
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M10 5 13 3h6l3 2 7 5-4 7-4-2v13H11V15l-4 2-4-7z"
          fill={team.fill}
          stroke={team.stroke}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M13 3q3 6 6 0M11 22h10M11 25h10"
          fill="none"
          stroke={team.stripe}
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}
