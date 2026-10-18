import React from "react";

export default function MatchAwardBadge({
  className = "",
  decorative = false,
  previous = false,
}) {
  return (
    <img
      className={`matchAwardBadge ${previous ? "matchAwardBadge--previous" : ""} ${className}`}
      src="/sheepawardtiny.jpg"
      width="28"
      height="28"
      alt={
        decorative
          ? ""
          : previous
            ? "Лучший игрок предыдущего матча"
            : "Лучший игрок матча"
      }
      aria-hidden={decorative || undefined}
      title={
        previous
          ? "Награда за предыдущий матч. Не забудьте принести трофей на эту игру."
          : "Награда «Лучший игрок матча» за эту игру"
      }
      loading="lazy"
      decoding="async"
    />
  );
}
