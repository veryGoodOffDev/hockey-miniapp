import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "./api.js";

const defaults = { chat: true, game_comments: true, air_hockey: true };
export function normalizeFeatures(value) {
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [
      key,
      typeof value?.[key] === "boolean" ? value[key] : true,
    ]),
  );
}

export default function useAppFeatures(initial, enabled) {
  const [features, setFeatures] = useState(() => normalizeFeatures(initial));
  const version = useRef(0);
  const apply = useCallback((next) => {
    if (!next) return;
    version.current++;
    setFeatures(normalizeFeatures(next));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true,
      busy = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (!active || busy || document.hidden) return;
      busy = true;
      const stamp = version.current;
      try {
        const result = await apiGet("/api/features", {
          signal: controller.signal,
        });
        if (active && stamp === version.current && result.features)
          apply(result.features);
      } catch {
        // Keep the last known settings during network interruptions.
      } finally {
        busy = false;
      }
    };
    if (!initial) refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, apply]);
  return { features, apply };
}
