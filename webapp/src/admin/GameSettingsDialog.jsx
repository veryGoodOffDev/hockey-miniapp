import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

let scrollLocks = 0;
let previousOverflow = "";

// One solid, bounded surface. Only its body scrolls, so long guest forms
// cannot extend past the background or cover the action bar.
export default function GameSettingsDialog({
  title,
  subtitle,
  onClose,
  children,
  navigation,
  pageKey,
  footer,
  nested = false,
  suspended = false,
  busy = false,
}) {
  const titleId = useId();
  const panel = useRef(null);
  const body = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [viewport, setViewport] = useState(null);
  useEffect(() => {
    const opener = document.activeElement;
    if (scrollLocks++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (--scrollLocks === 0) document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setViewport({ height: vv.height, top: vv.offsetTop });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  useEffect(() => {
    if (suspended) return;
    const keydown = (event) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) close.current?.();
      }
      if (event.key !== "Tab") return;
      const nodes = [
        ...(panel.current?.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]',
        ) || []),
      ].filter((el) => el.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (!first) {
        event.preventDefault();
        panel.current?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [suspended, busy]);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [pageKey]);
  return createPortal(
    <div
      className={`gsDialogBackdrop${nested ? " gsDialogBackdrop--nested" : ""}`}
      style={
        viewport
          ? { height: viewport.height, top: viewport.top, bottom: "auto" }
          : undefined
      }
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy && !suspended)
          onClose?.();
      }}
    >
      <section
        className="gsDialog"
        role="dialog"
        aria-modal={!suspended ? "true" : undefined}
        aria-labelledby={titleId}
        aria-hidden={suspended || undefined}
        inert={suspended ? "" : undefined}
        ref={panel}
        tabIndex={-1}
      >
        <header className="gsDialog__header">
          <div>
            <span className="gsDialog__eyebrow">
              {nested ? "Участник игры" : "Управление игрой"}
            </span>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="gsDialog__close"
            aria-label={`Закрыть: ${title}`}
            onClick={onClose}
            disabled={busy}
          >
            ✕
          </button>
        </header>
        {navigation}
        <div className="gsDialog__body" ref={body}>
          {children}
        </div>
        {footer && <footer className="gsDialog__footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
