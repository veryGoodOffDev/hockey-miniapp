import React from "react";
import { TEAM_COLORS } from "./teamColors.js";

export default function TeamColorMark({ color, size = 14 }) {
  const team = TEAM_COLORS[color];
  if (!team) return null;
  return (
    <span
      className="teamColorMark"
      role="img"
      aria-label={`Команда: ${team.label}`}
      title={`Команда: ${team.label}`}
      style={{
        width: size,
        height: size,
        backgroundColor: team.fill,
        borderColor: team.stroke,
      }}
    />
  );
}
