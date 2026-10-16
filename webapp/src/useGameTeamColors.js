import { useEffect, useState } from "react";
import { apiGet } from "./api.js";
import { fetchGameTeamColors } from "./teamColors.js";

export default function useGameTeamColors(games, playerId, enabled) {
  const [result, setResult] = useState({ owner: null, colors: {} });
  useEffect(() => {
    if (!enabled || playerId == null) return;
    const controller = new AbortController(),
      owner = String(playerId);
    setResult({ owner, colors: {} });
    void fetchGameTeamColors({
      games,
      playerId,
      request: apiGet,
      signal: controller.signal,
      onResult: (id, color) =>
        setResult((current) => ({
          owner,
          colors: { ...current.colors, [id]: color },
        })),
    });
    return () => controller.abort();
  }, [games, playerId, enabled]);
  return result.owner === String(playerId) ? result.colors : {};
}
