import React, { useId } from "react";

const PATHS = {
  classic: "M20 12 L26 8 Q28 6 32 6 Q36 6 38 8 L44 12 H53 Q55 12 56 14 L60 22 L52 28 V56 Q52 58 50 58 H14 Q12 58 12 56 V28 L4 22 L8 14 Q9 12 11 12 H20 Z",
  pro:     "M19 12 L26 7 Q28 6 32 6 Q36 6 38 7 L45 12 H54 Q56 12 57 14 L61 23 L53 29 V56 Q53 59 50 59 H14 Q11 59 11 56 V29 L3 23 L7 14 Q8 12 10 12 H19 Z",
  raglan:  "M24 10 L28 7 Q30 6 32 6 Q34 6 36 7 L40 10 C41 11 42 12 44 12 H52 Q55 12 56 15 L60 24 L53 30 V56 Q53 59 50 59 H14 Q11 59 11 56 V30 L4 24 L8 15 Q9 12 12 12 H20 C22 12 23 11 24 10 Z",
  goalie:  "M17 12 L25 7 Q28 6 32 6 Q36 6 39 7 L47 12 H56 Q58 12 59 14 L63 24 L54 31 V56 Q54 59 51 59 H13 Q10 59 10 56 V31 L1 24 L5 14 Q6 12 8 12 H17 Z",
};

export function JerseyBadge({
  number,
  variant = "classic",
  striped = false,
  size = 42,          // увеличил дефолт
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

  // Важно: задаём только то, что реально передали
  const styleVars = { "--jb-size": `${size}px` };
  if (fill) styleVars["--jersey-fill"] = fill;
  if (stroke) styleVars["--jersey-stroke"] = stroke;
  if (accent) styleVars["--jersey-accent"] = accent;
  if (textColor) styleVars["--jersey-text"] = textColor;

  return (
    <div
      className={`jerseyWrap jersey--${variant} ${className}`}
      style={styleVars}
      data-len={len}
      aria-label={raw ? `Номер ${text}` : "Номер не указан"}
      title={raw ? `Номер ${text}` : "Номер не указан"}
    >
      <svg viewBox="0 0 64 64" className="jerseySvg" aria-hidden="true">
        <path d={d} className="jerseyFill" />
        <path d={d} className="jerseyStroke" />

        {striped && (
          <>
            <clipPath id={`${uid}-clip`}>
              <path d={d} />
            </clipPath>
            <g clipPath={`url(#${uid}-clip)`}>
              <rect x="8" y="34" width="48" height="6" className="jerseyStripe" />
              <rect x="8" y="42" width="48" height="3" className="jerseyStripeSoft" />
            </g>
          </>
        )}
      </svg>

      <span className="jerseyNum">{text}</span>
    </div>
  );
}
