let cleanupCurrent = null;

// Capture the button's rectangle before awaiting the request. Feedback is
// shown only after the server accepts the mark, never on a failed request.
export function celebrateRsvp(status, origin) {
  if (!["yes", "no"].includes(status) || !origin) return;
  cleanupCurrent?.();
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const layer = document.createElement("div");
  layer.className = `rsvpFeedback ${status === "yes" ? "isIn" : "isOut"}${reduced ? " isReduced" : ""}`;
  layer.setAttribute("aria-hidden", "true");
  const emoji = document.createElement("span");
  emoji.className = "rsvpFeedbackEmoji";
  emoji.textContent = status === "yes" ? "👍" : "😢";
  const x = origin.left + origin.width / 2, y = origin.top + origin.height / 2;
  emoji.style.left = `${x}px`; emoji.style.top = `${y}px`;
  emoji.style.setProperty("--fly-x", `${window.innerWidth / 2 - x}px`);
  emoji.style.setProperty("--fly-y", `${window.innerHeight / 2 - y}px`);
  layer.append(emoji); document.body.append(layer);
  const cleanup = () => { clearTimeout(timer); layer.remove(); if (cleanupCurrent === cleanup) cleanupCurrent = null; };
  const timer = setTimeout(cleanup, reduced ? 250 : 650);
  cleanupCurrent = cleanup;
}
