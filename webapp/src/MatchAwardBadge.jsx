import React from "react";

export default function MatchAwardBadge({
  className = "",
  decorative = false,
}) {
  return (
    <img
      className={`matchAwardBadge ${className}`}
      src="/sheepawardtiny.jpg"
      width="28"
      height="28"
      alt={decorative ? "" : "Лучший игрок матча"}
      aria-hidden={decorative || undefined}
      title="Награда «Лучший игрок матча» за эту игру"
      loading="lazy"
      decoding="async"
    />
  );
}
