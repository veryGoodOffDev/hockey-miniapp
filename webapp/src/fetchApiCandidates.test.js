import test from "node:test";
import assert from "node:assert/strict";
import { fetchApiCandidates } from "./fetchApiCandidates.js";

test("a single budget is shared by fallback hosts; no third 12-second request starts", async () => {
  const originalFetch = globalThis.fetch,
    originalNow = Date.now;
  let clock = 1000;
  const calls = [];
  try {
    Date.now = () => clock;
    globalThis.fetch = async (url) => {
      calls.push(url);
      clock += 40;
      throw new TypeError("network");
    };
    await assert.rejects(
      fetchApiCandidates(["one", "two", "three"], { method: "GET" }, 70),
      { name: "TimeoutError" },
    );
    assert.deepEqual(calls, ["one", "two"]);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test("fast network failure can use a working fallback; HTTP failures never switch origin", async () => {
  const original = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      if (url === "one") throw new TypeError("network");
      return { status: 200, text: async () => '{"ok":true}' };
    };
    assert.equal(
      (await fetchApiCandidates(["one", "two"], { method: "GET" }, 1000)).text,
      '{"ok":true}',
    );
    assert.deepEqual(calls, ["one", "two"]);
    calls.length = 0;
    globalThis.fetch = async (url) => {
      calls.push(url);
      return { status: 503, text: async () => "unavailable" };
    };
    assert.equal(
      (await fetchApiCandidates(["one", "two"], { method: "GET" }, 1000))
        .response.status,
      503,
    );
    assert.deepEqual(calls, ["one"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("a hung response body times out within the shared deadline and a write is never retried on timeout", async () => {
  const original = globalThis.fetch;
  try {
    for (const method of ["GET", "POST"]) {
      const calls = [];
      globalThis.fetch = async (url, { signal }) => {
        calls.push(url);
        return {
          text: () =>
            new Promise((_, reject) =>
              signal.addEventListener(
                "abort",
                () => reject(new Error("body aborted")),
                { once: true },
              ),
            ),
        };
      };
      await assert.rejects(
        fetchApiCandidates(["one", "two", "three"], { method }, 30),
        { name: "TimeoutError" },
      );
      if (method === "POST") assert.deepEqual(calls, ["one"]);
      else assert.ok(calls.length < 3);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("external cancellation skips fallbacks and never becomes a network/timeout failure", async () => {
  const original = globalThis.fetch;
  try {
    const calls = [];
    const controller = new AbortController();
    globalThis.fetch = (url, { signal }) => {
      calls.push(url);
      return new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("cancelled", "AbortError")),
          { once: true },
        ),
      );
    };
    const request = fetchApiCandidates(
      ["one", "two"],
      { method: "GET", signal: controller.signal },
      1000,
    );
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
    assert.deepEqual(calls, ["one"]);
    calls.length = 0;
    await assert.rejects(
      fetchApiCandidates(
        ["one", "two"],
        { method: "GET", signal: controller.signal },
        1000,
      ),
      { name: "AbortError" },
    );
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = original;
  }
});
