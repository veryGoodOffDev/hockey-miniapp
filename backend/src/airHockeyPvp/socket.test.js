import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { PvpRooms } from "./rooms.js";
import {
  createPvpTickets,
  attachPvpSocket,
  PVP_SOCKET_PATH,
} from "./socket.js";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function client(url, ticket) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw)));
  await once(ws, "open");
  ws.send(
    JSON.stringify({ event: "airhockey:auth", data: { ticket, userId: 999 } }),
  );
  return {
    ws,
    messages,
    send: (event, data = {}) =>
      ws.send(JSON.stringify({ event: `airhockey:${event}`, data })),
  };
}
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const value = fn();
    if (value) return value;
    await wait(10);
  }
  throw new Error("event_timeout");
}
test("tickets expire and can only authenticate once", () => {
  let now = 0;
  const tickets = createPvpTickets({ now: () => now });
  const t = tickets.issue({ id: 1 });
  assert.equal(tickets.consume(t).id, 1);
  assert.equal(tickets.consume(t), null);
  const expired = tickets.issue({ id: 2 });
  now = 30001;
  assert.equal(tickets.consume(expired), null);
});
test("an existing WebSocket cannot start, join or rematch after disabling hockey; reconnect and play remain available", async () => {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let enabled = false;
  const calls = [];
  const rooms = {
    start() {}, stop() {}, disconnect() {},
    reconnect: () => calls.push("reconnect"),
    create: async () => calls.push("create"),
    join: async () => calls.push("join"),
    rematch: async () => calls.push("rematch"),
    move: () => calls.push("move"),
  };
  const tickets = createPvpTickets();
  const service = attachPvpSocket({ server, rooms, tickets, canStartGame: async () => enabled });
  let a;
  try {
    a = await client(`ws://127.0.0.1:${server.address().port}${PVP_SOCKET_PATH}`, tickets.issue({ id: 1 }));
    await until(() => a.messages.find((m) => m.event === "airhockey:authenticated"));
    for (const event of ["create_room", "join_room", "rematch"]) {
      a.messages.length = 0;
      a.send(event, { code: "1234" });
      const result = await until(() => a.messages.find((m) => m.event === "airhockey:error"));
      assert.equal(result.data.reason, "feature_disabled");
      await wait(310);
    }
    assert.deepEqual(calls, ["reconnect"]);
    a.send("paddle_move", { x: 50, y: 50 });
    await until(() => calls.includes("move"));
    a.send("reconnect");
    await until(() => calls.filter((c) => c === "reconnect").length === 2);
    await wait(310);
    enabled = true;
    a.send("create_room");
    await until(() => calls.includes("create"));
  } finally {
    a?.ws.terminate();
    service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
test("real WebSocket requires auth, uses ticket identity and reconnects same participant", async () => {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}${PVP_SOCKET_PATH}`;
  const tickets = createPvpTickets();
  const rooms = new PvpRooms({
    repository: {
      create: async () => {},
      join: async () => {},
      start: async () => {},
      finish: async () => ({
        rewards: [0, 0],
        reasons: ["too_short", "too_short"],
      }),
    },
  });
  const socket = attachPvpSocket({ server, rooms, tickets });
  const clients = [];
  try {
    const bad = await client(url, "fake");
    clients.push(bad.ws);
    const [code] = await once(bad.ws, "close");
    assert.equal(code, 4401);
    assert.equal(rooms.rooms.size, 0);
    const a = await client(url, tickets.issue({ id: 1, name: "A" }));
    clients.push(a.ws);
    await until(() =>
      a.messages.find((m) => m.event === "airhockey:authenticated"),
    );
    a.send("create_room");
    const state = (
      await until(() =>
        a.messages.find((m) => m.event === "airhockey:room_state"),
      )
    ).data;
    assert.equal(state.players[0].id, "1");
    const b = await client(url, tickets.issue({ id: 2, name: "B" }));
    clients.push(b.ws);
    await until(() =>
      b.messages.find((m) => m.event === "airhockey:authenticated"),
    );
    b.send("join_room", { code: state.code });
    await until(() => rooms.rooms.get(state.code).players[1]);
    b.ws.close();
    await once(b.ws, "close");
    await until(() => rooms.rooms.get(state.code).status === "reconnecting");
    const again = await client(url, tickets.issue({ id: 2, name: "B" }));
    clients.push(again.ws);
    await until(() =>
      again.messages.find((m) => m.event === "airhockey:room_state"),
    );
    assert.equal(rooms.rooms.get(state.code).players[1].connected, true);
    const third = await client(url, tickets.issue({ id: 3 }));
    clients.push(third.ws);
    await until(() =>
      third.messages.find((m) => m.event === "airhockey:authenticated"),
    );
    third.send("join_room", { code: state.code });
    assert.equal(
      (
        await until(() =>
          third.messages.find((m) => m.event === "airhockey:error"),
        )
      ).data.reason,
      "room_full",
    );
  } finally {
    for (const c of clients) c.terminate();
    socket.close();
    await new Promise((r) => server.close(r));
    assert.equal(rooms.timer, null);
    assert.equal(rooms.rooms.size, 0);
  }
});

test("malformed JSON payloads cannot crash the socket service", async () => {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const rooms = new PvpRooms({ repository: {} }),
    tickets = createPvpTickets(),
    socket = attachPvpSocket({ server, rooms, tickets });
  try {
    for (const payload of ["null", "[]", "123", '{"data":{}}']) {
      const ws = new WebSocket(
        `ws://127.0.0.1:${server.address().port}${PVP_SOCKET_PATH}`,
      );
      await once(ws, "open");
      ws.send(payload);
      assert.equal((await once(ws, "close"))[0], 4400);
    }
  } finally {
    socket.close();
    await new Promise((r) => server.close(r));
  }
});
