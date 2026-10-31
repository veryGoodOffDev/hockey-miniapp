import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
export const PVP_SOCKET_PATH = "/api/game/air-hockey/pvp/ws";
export function createPvpTickets({ now = Date.now } = {}) {
  const tickets = new Map();
  const prune = () => {
    for (const [key, value] of tickets)
      if (value.expires <= now()) tickets.delete(key);
  };
  return {
    issue(user) {
      prune();
      if (tickets.size >= 1000) throw new Error("server_busy");
      for (const [key, value] of tickets)
        if (String(value.user.id) === String(user.id)) tickets.delete(key);
      const ticket = randomBytes(32).toString("base64url");
      tickets.set(ticket, { user, expires: now() + 30_000 });
      return ticket;
    },
    consume(ticket) {
      prune();
      const value = tickets.get(ticket);
      tickets.delete(ticket);
      return value?.user || null;
    },
    clear() {
      tickets.clear();
    },
  };
}
export function attachPvpSocket({ server, rooms, tickets, logger = console, canStartGame = async () => true }) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2048,
    perMessageDeflate: false,
  });
  const clients = new Map();
  const emit = (ws, event, data) => {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > 256 * 1024) {
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify({ event: `airhockey:${event}`, data }));
  };
  rooms.send = (id, event, data) =>
    emit(clients.get(String(id)) || {}, event, data);
  const upgrade = (req, socket, head) => {
    if (String(req.url).split("?")[0] !== PVP_SOCKET_PATH) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    if (wss.clients.size >= 600) {
      socket.end(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
      );
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  };
  server.on("upgrade", upgrade);
  wss.on("connection", (ws) => {
    let user = null,
      queue = Promise.resolve(),
      windowAt = Date.now(),
      count = 0,
      commandBusy = false,
      lastControl = 0,
      lastMove = 0;
    ws.alive = true;
    const authTimer = setTimeout(() => ws.close(4401, "auth_required"), 5000);
    authTimer.unref?.();
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("error", () => {});
    ws.on("message", (raw) => {
      if (Date.now() - windowAt > 1000) {
        windowAt = Date.now();
        count = 0;
      }
      if (++count > 80) {
        ws.close(4429, "rate_limit");
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        ws.close(4400, "bad_json");
        return;
      }
      if (
        !message ||
        typeof message !== "object" ||
        Array.isArray(message) ||
        typeof message.event !== "string"
      ) {
        ws.close(4400, "bad_message");
        return;
      }
      if (!user) {
        if (message.event !== "airhockey:auth") {
          ws.close(4401, "auth_required");
          return;
        }
        user = tickets.consume(message.data?.ticket);
        if (!user) {
          ws.close(4401, "invalid_ticket");
          return;
        }
        clearTimeout(authTimer);
        const old = clients.get(String(user.id));
        clients.set(String(user.id), ws);
        old?.close(4409, "connection_replaced");
        emit(ws, "authenticated", { id: String(user.id) });
        rooms.reconnect(user);
        return;
      }
      if (clients.get(String(user.id)) !== ws) return;
      if (message.event === "airhockey:paddle_move") {
        if (Date.now() - lastMove < 25) return;
        lastMove = Date.now();
        rooms.move(user.id, message.data);
        return;
      }
      if (message.event === "airhockey:ping") {
        emit(ws, "pong", { timestamp: message.data?.timestamp });
        return;
      }
      if (commandBusy || Date.now() - lastControl < 300) {
        emit(ws, "error", { reason: "too_fast" });
        return;
      }
      lastControl = Date.now();
      commandBusy = true;
      queue = queue
        .then(async () => {
          if (clients.get(String(user.id)) !== ws) return;
          if (["airhockey:create_room", "airhockey:join_room", "airhockey:rematch"].includes(message.event) &&
              !(await canStartGame())) throw new Error("feature_disabled");
          switch (message.event) {
            case "airhockey:create_room":
              await rooms.create(user);
              break;
            case "airhockey:join_room":
              if (!/^\d{4}$/.test(String(message.data?.code || "")))
                throw new Error("bad_code");
              await rooms.join(user, String(message.data.code));
              break;
            case "airhockey:reconnect":
              rooms.reconnect(user);
              break;
            case "airhockey:leave":
              rooms.leave(user.id);
              break;
            case "airhockey:rematch":
              await rooms.rematch(user.id);
              break;
            case "airhockey:ready":
              rooms.reconnect(user);
              break;
            default:
              throw new Error("unknown_event");
          }
        })
        .catch((e) => {
          const safe = new Set([
            "feature_disabled",
            "already_in_room",
            "server_busy",
            "room_not_found",
            "room_full",
            "room_finished",
            "bad_code",
            "rematch_unavailable",
            "opponent_left",
            "unknown_event",
          ]);
          emit(ws, "error", {
            reason: safe.has(e.message) ? e.message : "server_error",
          });
          if (!safe.has(e.message))
            logger.error("[PvP] command failed", e.message);
        })
        .finally(() => {
          commandBusy = false;
        });
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      if (user && clients.get(String(user.id)) === ws) {
        clients.delete(String(user.id));
        rooms.disconnect(user.id);
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 10_000);
  heartbeat.unref?.();
  rooms.start();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    server.off("upgrade", upgrade);
    server.off("close", close);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    rooms.stop();
    tickets.clear();
  };
  server.once("close", close);
  return { wss, close };
}
