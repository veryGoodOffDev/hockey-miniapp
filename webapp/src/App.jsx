// App.jsx
import { useState } from "react";

import TelegramApp from "./TelegramApp.jsx";
import PublicRsvpPage from "./PublicRsvpPage.jsx";
import MainGate from "./MainGate.jsx";

import { apiGet, apiPost } from "./api.js";

export default function App() {
  // если открыли ссылку гостя в обычном браузере
  if (window.location.pathname.startsWith("/rsvp")) {
    return <PublicRsvpPage apiGet={apiGet} apiPost={apiPost} />;
  }

  // gate решает: Telegram / Web (email) / error
  const [me, setMe] = useState(null);

  if (!me) {
    return <MainGate onAuthed={(meData) => setMe(meData)} />;
  }

  // дальше — твоё обычное приложение
  return <TelegramApp me={me} />;
}
