import { useEffect, useState } from "react";
import HockeyLoader from "./HockeyLoader.jsx";

// Mounted once across auth and game loading, so the frost does not restart per step.
export default function StartupOverlay({ state }) {
  const [lastState, setLastState] = useState(state);
  useEffect(() => {
    if (state) {
      setLastState(state);
      return;
    }
    const timer = setTimeout(() => setLastState(null), 220);
    return () => clearTimeout(timer);
  }, [state]);
  const content = state || lastState;
  return content ? (
    <HockeyLoader {...content} fullScreen leaving={!state} />
  ) : null;
}
