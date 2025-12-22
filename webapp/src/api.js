const API_BASE = import.meta.env.VITE_API_BASE;

function getInitData() {
  const tg = window.Telegram?.WebApp;
  return tg?.initData || "";
}

async function request(path, { method = "GET", body } = {}) {
  const headers = {
    "x-telegram-init-data": getInitData(),
  };

  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // на всякий случай: если backend вернёт не-JSON
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "non_json_response", status: res.status, text };
  }
}

export function apiGet(path) {
  return request(path, { method: "GET" });
}

export function apiPost(path, body) {
  return request(path, { method: "POST", body: body ?? {} });
}

export function apiPatch(path, body) {
  return request(path, { method: "PATCH", body: body ?? {} });
}

export function apiDelete(path) {
  return request(path, { method: "DELETE" });
}
