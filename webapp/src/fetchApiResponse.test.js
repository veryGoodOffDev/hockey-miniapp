import test from "node:test";
import assert from "node:assert/strict";
import { fetchApiResponse } from "./fetchApiResponse.js";
test("request timeout aborts hung fetch and slow body; fast request works", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (_, options) =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      );
    await assert.rejects(fetchApiResponse("test", {}, 10), {
      name: "TimeoutError",
    });
    globalThis.fetch = async (_, options) => ({
      text: () =>
        new Promise((resolve, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("body aborted")),
            { once: true },
          ),
        ),
    });
    await assert.rejects(fetchApiResponse("test", {}, 10), {
      name: "TimeoutError",
    });
    globalThis.fetch = async () => ({ text: async () => "done" });
    assert.equal((await fetchApiResponse("test", {}, 100)).text, "done");
  } finally {
    globalThis.fetch = original;
  }
});
test("external cancellation is preserved", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (_, options) =>
      new Promise((resolve, reject) => {
        if (options.signal.aborted) reject(new Error("cancelled"));
        else
          options.signal.addEventListener("abort", () =>
            reject(new Error("cancelled")),
          );
      });
    const controller = new AbortController(),
      request = fetchApiResponse("test", { signal: controller.signal }, 1000);
    controller.abort();
    await assert.rejects(request, /cancelled/);
  } finally {
    globalThis.fetch = original;
  }
});
