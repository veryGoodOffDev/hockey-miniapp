// MainGate.jsx
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "./api";
import { isInTelegram, tgReady } from "./tg";

// сюда ты позже подключишь EmailOTP экран
import AuthLanding from "./AuthLanding.jsx";

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME; // без @
const STARTAPP = import.meta.env.VITE_STARTAPP_PARAM || "home";

function openInTelegramUrl() {
  if (!BOT_USERNAME) return null;
  return `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(STARTAPP)}`;
}

export default function MainGate({ onAuthed }) {
  const [state, setState] = useState({
    loading: true,
    reason: "",
    stage: "loading", // loading | login | error
  });

  const checkMe = useCallback(async () => {
    setState({ loading: true, reason: "", stage: "loading" });

    try {
      const me = await apiGet("/api/me");

      // Если /api/me у тебя возвращает ok=true — отлично
      if (me?.ok) {
        onAuthed(me);
        return;
      }

      // Если вдруг ok=false без throw
      setState({ loading: false, reason: me?.reason || "unknown", stage: "error" });
    } catch (e) {
      const reason = e?.data?.reason || e.message || "auth_failed";

      
      // ВНЕ Telegram: это нормальная ситуация — показываем вход по email
      if (!isInTelegram()) {
        setState({ loading: false, reason, stage: "login" });
        return;
      }

      // В Telegram: показываем понятные экраны ошибок/доступа
      setState({ loading: false, reason, stage: "error" });
    }
  }, [onAuthed]);

  useEffect(() => {
    tgReady();
    checkMe();
  }, [checkMe]);

  if (state.loading) {
    return <div className="card">Загружаем…</div>;
  }

  // ===== ВЕБ-ВХОД (не Telegram) =====
  if (state.stage === "login") {
    const tgUrl = openInTelegramUrl();
    return (
        <AuthLanding
          telegramUrl={tgUrl}
          onDone={checkMe}
          teamName="Mighty Sheep"
          teamSubtitle="Вход в Hockey MiniApp"
          teamCoverSrc="/brand/teamcover.jpg"
          teamLogoSrc="/brand/commandlog.webp"
        />
    );
  }

  // ===== TG-ОШИБКИ (Telegram) =====
  if (state.reason === "not_member") {
    return (
      <div className="card">
        <h2>Нет доступа</h2>
        <div className="small">Ты не состоишь в чате команды.</div>
        <button className="btn" onClick={checkMe}>Повторить</button>
      </div>
    );
  }

  if (state.reason === "telegram_unavailable") {
    return (
      <div className="card">
        <h2>Telegram временно недоступен</h2>
        <div className="small">Сервер не смог проверить членство в чате.</div>
        <button className="btn" onClick={checkMe}>Повторить</button>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Не удалось войти</h2>
      <div className="small">Причина: {state.reason}</div>
      <button className="btn" onClick={checkMe}>Повторить</button>
    </div>
  );
}
