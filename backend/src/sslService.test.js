import assert from "node:assert/strict";
import test from "node:test";
import { createSslService, parseCertificateOutput, SSL_DOMAIN } from "./sslService.js";

const certText = `subject=CN = ${SSL_DOMAIN}\nissuer=C = US, O = Let's Encrypt, CN = E6\nnotBefore=Sep  1 00:00:00 2026 GMT\nnotAfter=Dec 27 00:00:00 2026 GMT\n`;

test("parseCertificateOutput calculates certificate state", () => {
  const result = parseCertificateOutput(certText, new Date("2026-09-28T00:00:00Z"));
  assert.equal(result.valid, true);
  assert.equal(result.daysLeft, 90);
  assert.equal(result.expiresAt, "2026-12-27T00:00:00.000Z");
});

test("status tolerates an unavailable external endpoint", async () => {
  const runProcess = async (file, args) => {
    if (file === "crontab") return { stdout: '21 1,7,13,19 * * * "/root/.acme.sh"/acme.sh --cron --home "/root/.acme.sh"\n' };
    if (args.includes("-fingerprint")) return { stdout: "sha256 Fingerprint=AA:BB\n" };
    return { stdout: certText };
  };
  const service = createSslService({ runProcess, externalCheck: async () => ({ available: false }), now: () => new Date("2026-09-28T00:00:00Z") });
  const result = await service.getStatus();
  assert.equal(result.autoRenew, true);
  assert.equal(result.externalCertificateMatches, null);
});

test("renew uses only fixed commands in safe order", async () => {
  const calls = [];
  const runProcess = async (file, args) => {
    calls.push([file, args]);
    if (file === "crontab") return { stdout: "" };
    if (args.includes("-fingerprint")) return { stdout: "sha256 Fingerprint=AA:BB\n" };
    if (file === "openssl") return { stdout: certText };
    return { stdout: "" };
  };
  const service = createSslService({ runProcess, accessFile: async () => {}, externalCheck: async () => ({ available: true, fingerprint: "AABB" }), now: () => new Date("2026-09-28T00:00:00Z") });
  await service.renew();
  assert.deepEqual(calls[0], ["/root/.acme.sh/acme.sh", ["--renew", "-d", SSL_DOMAIN, "--ecc", "--force"]]);
  assert.ok(calls.findIndex(([file]) => file === "nginx") < calls.findIndex(([file]) => file === "systemctl"));
});
