import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { describeConnectionError } from "./connectionError.js";
import "./frostLoader.css";

export default function HockeyLoader({
  text = "Загружаем…",
  fullScreen = true,
  error = null,
  onRetry,
  telegramUrl,
  leaving = false,
}) {
  const retry = useRef(null);
  const failure = error ? describeConnectionError(error) : null;
  useEffect(() => {
    if (error && fullScreen) retry.current?.focus({ preventScroll: true });
  }, [error, fullScreen]);
  const content = (
    <div
      className={`frostLoader ${fullScreen ? "frostLoader--screen" : "frostLoader--inline"}${leaving ? " frostLoader--leaving" : ""}${error ? " frostLoader--error" : ""}`}
      aria-hidden={leaving || undefined}
    >
      <div className="frostLoader__mist" aria-hidden="true" />
      <div className="frostLoader__overlay" aria-hidden="true" />
      <div className="frostLoader__content">
        <div className="frostLoader__emblem" aria-hidden="true">
          <img
            src="/premiumaward.png"
            width="220"
            height="220"
            alt=""
            decoding="async"
          />
        </div>
        {failure ? (
          <div className="frostLoader__failure">
            <div role="alert">
              <h2>{failure.title}</h2>
              <p>{failure.message}</p>
              {failure.hint && (
                <p className="frostLoader__hint">{failure.hint}</p>
              )}
            </div>
            <button
              ref={retry}
              className="frostLoader__retry"
              type="button"
              onClick={onRetry}
            >
              Повторить
            </button>
            {failure.kind === "auth" && telegramUrl && (
              <a className="frostLoader__link" href={telegramUrl}>
                Открыть бота
              </a>
            )}
          </div>
        ) : (
          <div
            className="frostLoader__status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="frostLoader__eyebrow" aria-hidden="true">
              MIGHTY SHEEP
            </span>
            <div className="frostLoader__text">{text}</div>
            <span className="frostLoader__activity" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
    </div>
  );
  return fullScreen ? createPortal(content, document.body) : content;
}
