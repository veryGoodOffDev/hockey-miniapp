import test from "node:test";
import assert from "node:assert/strict";
import {
  createRsvpViewPreference,
  resolveRsvpView,
  rsvpViewKey,
} from "./rsvpViewPreference.js";
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const response = (view) => ({ ok: true, preferences: { rsvp_view: view } });

test("server wins over cache, local fallback is per account, and unknown values default to list", () => {
  const cache = storage();
  cache.setItem(rsvpViewKey(1), "chips");
  assert.equal(resolveRsvpView(1, "list", cache), "list");
  assert.equal(resolveRsvpView(1, undefined, cache), "chips");
  assert.equal(resolveRsvpView(2, undefined, cache), "list");
  assert.equal(resolveRsvpView(null, undefined, cache), "list");
  cache.setItem(rsvpViewKey(2), "bad");
  assert.equal(resolveRsvpView(2, undefined, cache), "list");
  assert.equal(
    resolveRsvpView(1, null, {
      getItem() {
        throw new Error("blocked");
      },
    }),
    "list",
  );
});

test("changes immediately and serializes/coalesces rapid clicks without stale acknowledgements", async () => {
  const calls = [],
    saved = [],
    cache = storage();
  const store = createRsvpViewPreference({
    playerId: 1,
    serverView: "list",
    storage: cache,
    onSaved: (view) => saved.push(view),
    save: (view, signal) =>
      new Promise((resolve) => calls.push({ view, signal, resolve })),
  });
  store.setView("chips");
  assert.equal(store.getSnapshot().view, "chips");
  assert.equal(cache.getItem(rsvpViewKey(1)), "chips");
  assert.equal(store.getSnapshot().saving, true);
  store.setView("list");
  store.syncServer("list"); // A background refresh must not cancel the latest choice.
  assert.equal(calls.length, 1);
  calls[0].resolve(response("chips"));
  await tick();
  assert.deepEqual(
    calls.map((c) => c.view),
    ["chips", "list"],
  );
  assert.deepEqual(saved, []);
  calls[1].resolve(response("list"));
  await tick();
  assert.deepEqual(saved, ["list"]);
  assert.deepEqual(store.getSnapshot(), {
    view: "list",
    saving: false,
    error: false,
  });
  store.syncServer("chips");
  assert.equal(store.getSnapshot().view, "chips");
  store.dispose();
});

test("repeated choices coalesce to one write when the final choice matches the pending request", async () => {
  const calls = [],
    saved = [];
  const store = createRsvpViewPreference({
    playerId: 1,
    serverView: "list",
    save: (view) => new Promise((resolve) => calls.push({ view, resolve })),
    onSaved: (view) => saved.push(view),
  });
  store.setView("chips");
  store.setView("list");
  store.setView("chips");
  calls[0].resolve(response("chips"));
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(saved, ["chips"]);
  assert.equal(store.getSnapshot().saving, false);
  store.dispose();
});

test("network failures retain the local view and retry writes even when the old server state looked identical", async () => {
  let fail = true;
  const calls = [],
    cache = storage();
  const store = createRsvpViewPreference({
    playerId: 1,
    serverView: "list",
    storage: cache,
    save: async (view) => {
      calls.push(view);
      if (fail) throw new Error("timeout");
      return response(view);
    },
  });
  store.setView("chips");
  await tick();
  assert.equal(store.getSnapshot().error, true);
  assert.equal(store.getSnapshot().view, "chips");
  store.syncServer("list");
  assert.equal(store.getSnapshot().view, "chips");
  fail = false;
  store.setView("list");
  await tick();
  assert.deepEqual(calls, ["chips", "list"]);
  assert.equal(store.getSnapshot().error, false);
  fail = true;
  store.setView("chips");
  await tick();
  fail = false;
  await store.retry();
  assert.equal(store.getSnapshot().view, "chips");
  assert.equal(store.getSnapshot().error, false);
  assert.equal(cache.getItem(rsvpViewKey(1)), "chips");
  store.dispose();
});

test("invalid API response is not reported as saved; storage failures do not break server persistence", async () => {
  let valid = false;
  const saved = [];
  const store = createRsvpViewPreference({
    playerId: 1,
    serverView: "list",
    storage: {
      setItem() {
        throw new Error("blocked");
      },
    },
    onSaved: (view) => saved.push(view),
    save: async (view) => (valid ? response(view) : { ok: true }),
  });
  store.setView("invalid");
  assert.equal(store.getSnapshot().view, "list");
  store.setView("chips");
  await tick();
  assert.equal(store.getSnapshot().error, true);
  assert.deepEqual(saved, []);
  valid = true;
  await store.retry();
  assert.deepEqual(saved, ["chips"]);
  store.dispose();
});

test("unmount cancels requests and suppresses callbacks for a former user", async () => {
  let complete, signal;
  const saved = [],
    states = [];
  const store = createRsvpViewPreference({
    playerId: 1,
    serverView: "list",
    onSaved: (view) => saved.push(view),
    save: (view, s) => {
      signal = s;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  store.subscribe((state) => states.push(state));
  store.setView("chips");
  store.dispose();
  assert.equal(signal.aborted, true);
  const count = states.length;
  complete(response("chips"));
  await tick();
  assert.deepEqual(saved, []);
  assert.equal(states.length, count);
});
