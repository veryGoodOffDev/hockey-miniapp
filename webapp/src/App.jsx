import { useEffect, useState } from "react";
import TelegramApp from "./TelegramApp.jsx";
import PublicRsvpPage from "./PublicRsvpPage.jsx";
import MainGate from "./MainGate.jsx";
import StartupOverlay from "./StartupOverlay.jsx";
import { apiGet, apiPost } from "./api.js";

export default function App() {
  const [me, setMe] = useState(null);
  const [startup, setStartup] = useState({ text: "Подключаемся…" });
  useEffect(() => {
    document.getElementById("startup-splash")?.remove();
  }, []);
  if (window.location.pathname.startsWith("/rsvp")) {
    return <PublicRsvpPage apiGet={apiGet} apiPost={apiPost} />;
  }
  return (
    <>
      <div
        inert={startup ? "" : undefined}
        aria-hidden={startup ? true : undefined}
      >
        {me ? (
          <TelegramApp me={me} onStartupState={setStartup} />
        ) : (
          <MainGate onAuthed={setMe} onStartupState={setStartup} />
        )}
      </div>
      <StartupOverlay state={startup} />
    </>
  );
}
