import test from "node:test";
import assert from "node:assert/strict";
import { describeConnectionError as describe } from "./connectionError.js";

test("network, offline and timeout failures explain how to retry and mention VPN only as a possibility", () => {
  for (const error of [
    { reason: "network_error" },
    new TypeError("Failed to fetch"),
  ]) {
    assert.equal(describe(error, { online: true }).kind, "network");
    assert.match(describe(error, { online: true }).hint, /VPN/);
    assert.equal(describe(error, { online: false }).kind, "offline");
  }
  const timeout = { data: { reason: "request_timeout" } };
  assert.equal(describe(timeout, { online: true }).kind, "timeout");
  assert.equal(describe(timeout, { online: false }).kind, "offline");
  assert.match(describe(timeout, { online: true }).hint, /VPN/);
});

test("HTTP and explicit access failures stay distinct from local network/VPN errors", () => {
  const cases = [
    [{ status: 502, error: "non_json_response" }, "server"],
    [{ data: { status: 503, reason: "telegram_unavailable" } }, "telegram"],
    [{ reason: "member_check_failed" }, "telegram"],
    [{ reason: "not_member", status: 403 }, "access"],
    [{ reason: "player_deleted" }, "access"],
    [{ reason: "access_chat_not_set" }, "configuration"],
    [{ reason: "bot_forbidden" }, "configuration"],
    [{ reason: "no_bot_token" }, "configuration"],
    [{ status: 401 }, "auth"],
    [{ reason: "BOT_INVALID" }, "auth"],
    [{ reason: "expired_init_data" }, "auth"],
    [{ reason: "no_hash" }, "auth"],
    [{ reason: "HTTP_504" }, "server"],
    [{ status: 429 }, "server"],
  ];
  for (const [error, kind] of cases) {
    const result = describe(error, { online: false });
    assert.equal(result.kind, kind, JSON.stringify(error));
    assert.equal(result.hint, undefined);
  }
});

test("malformed 200 response is explained; unknown codes and raw content are never shown to users", () => {
  assert.equal(
    describe({ error: "non_json_response", status: 200 }).kind,
    "response",
  );
  assert.equal(describe(new Error("invalid_response")).kind, "response");
  for (const error of [
    null,
    { reason: "unknown" },
    { error: "new_backend_code", text: "<html>private content</html>" },
    new Error("secret internal error"),
  ]) {
    const failure = describe(error);
    assert.equal(failure.kind, "unknown");
    assert.doesNotMatch(
      `${failure.title} ${failure.message} ${failure.hint || ""}`,
      /secret|private|new_backend_code|Причина|unknown"/,
    );
  }
});
