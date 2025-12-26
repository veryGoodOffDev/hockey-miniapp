import React, { useId } from "react";

const PATHS = {
  classic: "M22 10l6-4h8l6 4h10l6 10-8 6v26H14V26l-8-6 6-10h10z",
  modern:  "M21 11l7-5h8l7 5h9l5 9-7 6v28H14V26l-7-6 5-9h9z",
  slim:    "M23 11l6-5h6l6 5h10l5 10-8 6v27H16V27l-8-6 5-10h10z",
};

export function JerseyBadge({
  number,
  variant = "classic",  // classic | modern | slim
  striped = false,      // true = полосы
  size = 34,            // px
  fill,
  stroke,
  accent,
  textColor,
  className = "",
}) {
  const uid = useId();

  const raw = (number ?? "").toString().trim();
  const text = raw ? raw : "?";
  const len = text.length;

  const d = PATHS[variant] || PATHS.classic;

  const styleVars = {
    "--jb-size": `${size}px`,
    "--jersey-fill": fill ?? "rgba(255,255,255,0.10)",
    "--jersey-stroke": stroke ?? "rgba(255,255,255,0.18)",
    "--jersey-accent": accent ?? "rgba(255,255,255,0.08)",
    "--jersey-text": textColor ?? "rgba(255,255,255,0.92)",
  };

  return (
    <div
      className={`jerseyWrap jersey--${variant} ${className}`}
      style={styleVars}
      data-len={len}
      aria-label={raw ? `Номер ${text}` : "Номер не указан"}
      title={raw ? `Номер ${text}` : "Номер не указан"}
    >
      <svg viewBox="0 0 64 64" className="jerseySvg" aria-hidden="true">
        {/* Силуэт */}
        <path d={d} className="jerseyFill" />
        <path d={d} className="jerseyStroke" />

        {/* Лёгкий “блик” */}
        <path
          d={d}
          className="jerseySheen"
          opacity="1"
        />

        {/* Полосы (опционально), обрезаем по силуэту */}
        {striped && (
          <>
            <clipPath id={`${uid}-clip`}>
              <path d={d} />
            </clipPath>

            <g clipPath={`url(#${uid}-clip)`} opacity="1">
              <rect x="0" y="30" width="64" height="5" className="jerseyStripe" />
              <rect x="0" y="38" width="64" height="3" className="jerseyStripeSoft" />
            </g>
          </>
        )}
      </svg>

      <span className="jerseyNum">{text}</span>
    </div>
  );
}
