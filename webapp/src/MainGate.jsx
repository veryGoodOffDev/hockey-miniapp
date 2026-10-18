// MainGate.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "./api";
import { isInTelegram, tgReady } from "./tg";

// сюда ты позже подключишь EmailOTP экран
import AuthLanding from "./AuthLanding.jsx";
import { describeConnectionError } from "./connectionError.js";

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME; // без @
const STARTAPP = import.meta.env.VITE_STARTAPP_PARAM || "home";

function openInTelegramUrl() {
  if (!BOT_USERNAME) return null;
  return `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(STARTAPP)}`;
}

export default function MainGate({ onAuthed }) {
  const requestRef = useRef(null);
  const [state, setState] = useState({
    loading: true,
    error: null,
    stage: "loading", // loading | login | error
  });

  const checkMe = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ loading: true, error: null, stage: "loading" });

    try {
      const me = await apiGet("/api/me", {
        timeoutMs: 12_000,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      if (me?.ok && me?.player?.tg_id != null) {
        onAuthed(me);
        return;
      }

      // A 200 response can still contain an API error or an unexpected HTML page.
      const error = new Error("invalid_response");
      error.data = me?.ok === false ? me : { reason: "invalid_response" };
      throw error;
    } catch (error) {
      if (controller.signal.aborted) return;
      const reason = error?.data?.reason || error?.data?.error || error.message;
      const needsLogin =
        error?.status === 401 ||
        ["no_init_data", "invalid_token"].includes(reason);
      // Missing credentials are expected in a browser. A network failure is not a login screen.
      setState({
        loading: false,
        error,
        stage: !isInTelegram() && needsLogin ? "login" : "error",
      });
    }
  }, [onAuthed]);

  useEffect(() => {
    tgReady();
    checkMe();
    return () => requestRef.current?.abort();
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
        teamCoverSrc="/brand/teamcover1.jpg"
        teamLogoSrc="/brand/commandlog.webp"
      />
    );
  }

  const failure = describeConnectionError(state.error);
  const tgUrl = openInTelegramUrl();
  return (
    <div className="card" role="alert" aria-live="polite">
      <h2>{failure.title}</h2>
      <p className="small" style={{ lineHeight: 1.5 }}>
        {failure.message}
      </p>
      {failure.hint && (
        <p className="small" style={{ lineHeight: 1.5 }}>
          {failure.hint}
        </p>
      )}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className="btn" onClick={checkMe}>
          Повторить
        </button>
        {failure.kind === "auth" && tgUrl && (
          <a className="btn secondary" href={tgUrl}>
            Открыть бота
          </a>
        )}
      </div>
    </div>
  );
}
