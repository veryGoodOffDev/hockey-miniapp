// MainGate.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "./api";
import { isInTelegram, tgReady } from "./tg";

// сюда ты позже подключишь EmailOTP экран
import AuthLanding from "./AuthLanding.jsx";
import HockeyLoader from "./HockeyLoader.jsx";

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME; // без @
const STARTAPP = import.meta.env.VITE_STARTAPP_PARAM || "home";

function openInTelegramUrl() {
  if (!BOT_USERNAME) return null;
  return `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(STARTAPP)}`;
}

export default function MainGate({ onAuthed, onStartupState }) {
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
    onStartupState?.({ text: "Проверяем доступ…" });

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
      const login = !isInTelegram() && needsLogin;
      onStartupState?.(
        login
          ? null
          : { error, onRetry: checkMe, telegramUrl: openInTelegramUrl() },
      );
      setState({
        loading: false,
        error,
        stage: login ? "login" : "error",
      });
    }
  }, [onAuthed, onStartupState]);

  useEffect(() => {
    tgReady();
    checkMe();
    return () => requestRef.current?.abort();
  }, [checkMe]);

  if (state.loading) {
    return onStartupState ? null : <HockeyLoader text="Проверяем доступ…" />;
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

  return onStartupState ? null : (
    <HockeyLoader
      error={state.error}
      onRetry={checkMe}
      telegramUrl={openInTelegramUrl()}
    />
  );
}
