import { apiPost } from "./api.js";
export function pvpSocketUrl() {
  const base =
    import.meta.env.VITE_PVP_WS_URL ||
    import.meta.env.VITE_API_BASE ||
    window.location.origin;
  const url = new URL(base, window.location.origin);
  url.protocol =
    url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  if (!import.meta.env.VITE_PVP_WS_URL)
    url.pathname = "/api/game/air-hockey/pvp/ws";
  return url.toString();
}
export function connectPvp({ onEvent, onConnection }) {
  let socket,
    timer,
    watchdog,
    stopped = false,
    attempt = 0;
  const connect = async () => {
    onConnection("connecting");
    try {
      const { ticket } = await apiPost("/api/game/air-hockey/pvp/ticket");
      if (stopped) return;
      socket = new WebSocket(pvpSocketUrl());
      watchdog = setTimeout(() => socket.close(), 8000);
      socket.onopen = () =>
        socket.send(
          JSON.stringify({ event: "airhockey:auth", data: { ticket } }),
        );
      socket.onmessage = (e) => {
        let message;
        try {
          message = JSON.parse(e.data);
        } catch {
          return;
        }
        if (message.event === "airhockey:authenticated") {
          clearTimeout(watchdog);
          attempt = 0;
          onConnection("connected");
        }
        onEvent(message.event.replace("airhockey:", ""), message.data);
      };
      socket.onclose = (e) => {
        clearTimeout(watchdog);
        if (stopped) return;
        if (e.code === 4409) {
          onConnection("replaced");
          return;
        }
        onConnection("reconnecting");
        timer = setTimeout(connect, Math.min(5000, 500 * 2 ** attempt++));
      };
      socket.onerror = () => {
        socket.close();
      };
    } catch (e) {
      if (stopped) return;
      if (
        [401, 403].includes(e.status) ||
        [
          "expired_init_data",
          "no_init_data",
          "invalid_token",
          "BOT_INVALID",
          "player_unavailable",
          "profile_only",
          "not_member",
          "player_deleted",
        ].includes(e.data?.reason)
      ) {
        onConnection("unauthorized");
        return;
      }
      onConnection("reconnecting");
      timer = setTimeout(connect, Math.min(5000, 500 * 2 ** attempt++));
    }
  };
  void connect();
  return {
    send(event, data = {}) {
      if (socket?.readyState !== 1) return false;
      socket.send(JSON.stringify({ event: `airhockey:${event}`, data }));
      return true;
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      socket?.close();
    },
  };
}
