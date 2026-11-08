import { useCallback, useEffect, useState } from "react";
import { gameEndAt } from "./gameTiming.js";
export default function useGameClock(games, selectedGame) {
  const [now, setNow] = useState(Date.now);
  const update = useCallback(() => setNow(Date.now()), []);
  useEffect(update, [games, selectedGame, update]);
  useEffect(() => {
    const current = Date.now(),
      midnight = new Date(current);
    midnight.setHours(24, 0, 0, 0);
    let next = midnight.getTime();
    for (const game of [...games, selectedGame].filter(Boolean)) {
      for (const boundary of [Date.parse(game.starts_at), gameEndAt(game)])
        if (boundary > current) next = Math.min(next, boundary);
    }
    const timer = setTimeout(
      update,
      Math.max(20, Math.min(60000, next - current + 20)),
    );
    return () => clearTimeout(timer);
  }, [games, selectedGame, now, update]);
  useEffect(() => {
    const visible = () => {
      if (!document.hidden) update();
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [update]);
  return now;
}
