import { execFile as execFileCallback } from "node:child_process";
import { access } from "node:fs/promises";
import tls from "node:tls";
import { promisify } from "node:util";

export const SSL_DOMAIN = "api.apihockeyteamru.ru";
export const CERT_PATH = `/etc/ssl/acme/${SSL_DOMAIN}/fullchain.pem`;
export const ACME_PATH = "/root/.acme.sh/acme.sh";

const execFile = promisify(execFileCallback);
const PROCESS_OPTIONS = { timeout: 120_000, maxBuffer: 1024 * 1024 };

export class SslOperationError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.code = code;
  }
}

export function parseCertificateOutput(output, now = new Date()) {
  const values = Object.fromEntries(String(output).split(/\r?\n/).map((line) => {
    const at = line.indexOf("=");
    return at < 0 ? [] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }).filter((entry) => entry.length === 2));
  const notBefore = new Date(values.notBefore);
  const notAfter = new Date(values.notAfter);
  if (!values.subject || !values.issuer || Number.isNaN(notBefore.getTime()) || Number.isNaN(notAfter.getTime())) {
    throw new SslOperationError("certificate_invalid", "Сертификат повреждён или имеет неизвестный формат");
  }
  return {
    subject: values.subject,
    issuer: values.issuer,
    notBefore: notBefore.toISOString(),
    expiresAt: notAfter.toISOString(),
    valid: now >= notBefore && now < notAfter,
    daysLeft: Math.ceil((notAfter.getTime() - now.getTime()) / 86_400_000),
  };
}

function friendlyIssuer(raw) {
  const organization = String(raw).match(/(?:^|[,/]\s*)O\s*=\s*([^,/]+)/i)?.[1]?.trim();
  if (organization) return organization;
  const cn = String(raw).match(/(?:^|[,/]\s*)CN\s*=\s*([^,/]+)/i)?.[1]?.trim();
  return cn || raw;
}

function checkExternalCertificate(domain, timeout = 8_000) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: false });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout, () => done({ available: false }));
    socket.once("error", () => done({ available: false }));
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      done({ available: true, fingerprint: String(cert?.fingerprint256 || "").replaceAll(":", "").toUpperCase(), expiresAt: cert?.valid_to ? new Date(cert.valid_to).toISOString() : null });
    });
  });
}

async function run(file, args, options = {}) {
  return execFile(file, args, { ...PROCESS_OPTIONS, ...options });
}

async function readLocalCertificate(runProcess, now) {
  try {
    const [{ stdout: details }, { stdout: fingerprint }] = await Promise.all([
      runProcess("openssl", ["x509", "-in", CERT_PATH, "-noout", "-subject", "-issuer", "-dates"]),
      runProcess("openssl", ["x509", "-in", CERT_PATH, "-noout", "-fingerprint", "-sha256"]),
    ]);
    const parsed = parseCertificateOutput(details, now);
    const localFingerprint = String(fingerprint).split("=").at(-1)?.trim().replaceAll(":", "").toUpperCase() || "";
    return { ...parsed, issuer: friendlyIssuer(parsed.issuer), fingerprint: localFingerprint };
  } catch (error) {
    if (error instanceof SslOperationError) throw error;
    if (error?.code === "ENOENT" && error?.path === "openssl") {
      throw new SslOperationError("openssl_missing", "OpenSSL не установлен", error);
    }
    if (error?.code === "ENOENT" || /No such file|unable to load certificate/i.test(error?.stderr || "")) {
      throw new SslOperationError("certificate_missing", "Файл сертификата не найден", error);
    }
    throw new SslOperationError("certificate_invalid", "Не удалось прочитать сертификат", error);
  }
}

async function getAutoRenew(runProcess) {
  try {
    const { stdout } = await runProcess("crontab", ["-l"], { timeout: 10_000 });
    const configured = String(stdout).split(/\r?\n/).some((line) => {
      const normalized = line.replaceAll('"', "").replaceAll("'", "");
      return !line.trimStart().startsWith("#") && normalized.includes("/root/.acme.sh/acme.sh") && normalized.includes("--cron") && normalized.includes("--home") && normalized.includes("/root/.acme.sh");
    });
    return { autoRenew: configured, cronConfigured: configured };
  } catch (error) {
    if (error?.code !== 1) console.error("[ssl] cron check failed:", error?.message || error);
    return { autoRenew: false, cronConfigured: false };
  }
}

export function createSslService({ runProcess = run, externalCheck = checkExternalCertificate, accessFile = access, now = () => new Date() } = {}) {
  async function getStatus() {
    const checkedAt = now();
    const [local, renewal, external] = await Promise.all([
      readLocalCertificate(runProcess, checkedAt),
      getAutoRenew(runProcess),
      externalCheck(SSL_DOMAIN).catch(() => ({ available: false })),
    ]);
    return {
      domain: SSL_DOMAIN,
      valid: local.valid,
      notBefore: local.notBefore,
      expiresAt: local.expiresAt,
      daysLeft: local.daysLeft,
      issuer: local.issuer,
      subject: local.subject,
      ...renewal,
      externalCheckAvailable: !!external.available,
      externalCertificateMatches: external.available ? !!local.fingerprint && local.fingerprint === external.fingerprint : null,
      lastCheckAt: checkedAt.toISOString(),
    };
  }

  async function renew() {
    try {
      await accessFile(ACME_PATH);
    } catch (error) {
      throw new SslOperationError("acme_missing", "acme.sh не найден", error);
    }
    try {
      await runProcess(ACME_PATH, ["--renew", "-d", SSL_DOMAIN, "--ecc", "--force"], { timeout: 10 * 60_000 });
    } catch (error) {
      console.error("[ssl] acme renew failed:", error?.message || error, error?.stderr || "");
      throw new SslOperationError("renew_failed", "Не удалось обновить сертификат", error);
    }
    try {
      await accessFile(CERT_PATH);
      await readLocalCertificate(runProcess, now());
    } catch (error) {
      if (error instanceof SslOperationError) throw error;
      throw new SslOperationError("certificate_missing", "После обновления файл сертификата не найден", error);
    }
    try {
      await runProcess("nginx", ["-t"], { timeout: 30_000 });
    } catch (error) {
      console.error("[ssl] nginx config test failed:", error?.message || error, error?.stderr || "");
      throw new SslOperationError("nginx_config_invalid", "Проверка nginx завершилась ошибкой", error);
    }
    try {
      await runProcess("systemctl", ["reload", "nginx"], { timeout: 30_000 });
    } catch (error) {
      console.error("[ssl] nginx reload failed:", error?.message || error, error?.stderr || "");
      throw new SslOperationError("nginx_reload_failed", "Не удалось перезагрузить конфигурацию nginx", error);
    }
    return getStatus();
  }

  return { getStatus, renew };
}

export const sslService = createSslService();
