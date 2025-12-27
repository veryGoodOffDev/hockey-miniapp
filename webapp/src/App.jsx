import TelegramApp from "./TelegramApp.jsx";
import PublicRsvpPage from "./PublicRsvpPage.jsx";
import { apiGet, apiPost } from "./api.js";

export default function App() {
  // если открыли ссылку гостя в обычном браузере
  if (window.location.pathname.startsWith("/rsvp")) {
    return <PublicRsvpPage apiGet={apiGet} apiPost={apiPost} />;
  }

  // обычное мини-приложение внутри Telegram
  return <TelegramApp />;
}
