// api.js
import { getInitData } from "./tg.js";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

// На будущее: токен для входа вне Telegram (Email OTP / Google)
// Если пока токена нет — просто вернёт пусто.
function getAuthToken() {
  try {
    return localStorage.getItem("auth_token") || "";
  } catch {
    return "";
  }
}

function makeError(message, data) {
  const err = new Error(message || "request_failed");
  err.data = data;
  err.status = data?.status;
  return err;
}

async function request(path, { method = "GET", body, signal } = {}) {
  const initData = getInitData();
  const token = getAuthToken();

  const headers = {
    Accept: "application/json",
  };

  // Telegram auth (когда внутри WebApp)
  if (initData) headers["x-telegram-init-data"] = initData;

  // Web auth (когда вне Telegram) — пригодится для Email OTP / Google
  if (token) headers["Authorization"] = `Bearer ${token}`;

  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,

    // Если решишь делать cookie-сессии (вместо bearer) — оставляй включённым.
    // Если у тебя API на другом домене — потребуется CORS с credentials.
    credentials: "include",
  });

  // 204 No Content
  const text = await res.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "non_json_response", status: res.status, text };
    }
  } else {
    data = { ok: res.ok, status: res.status };
  }

  if (!res.ok) {
    // удобные причины для Gate/экранов
    const msg = data?.reason || data?.error || `HTTP_${res.status}`;
    throw makeError(msg, data);
  }

  return data;
}

export async function apiUpload(path, formData, { signal } = {}) {
  const initData = getInitData();
  const token = getAuthToken();

  const headers = {};
  if (initData) headers["x-telegram-init-data"] = initData;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Важно: Content-Type для formData НЕ ставим — браузер сам проставит boundary
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: formData,
    headers,
    signal,
    credentials: "include",
  });

  const text = await r.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "non_json_response", status: r.status, text };
    }
  } else {
    data = { ok: r.ok, status: r.status };
  }

  if (!r.ok) {
    const msg = data?.reason || data?.error || `HTTP_${r.status}`;
    throw makeError(msg, data);
  }

  return data;
}

export function setAuthToken(token) {
  try { localStorage.setItem("auth_token", token || ""); } catch {}
}

export function clearAuthToken() {
  try { localStorage.removeItem("auth_token"); } catch {}
}

export const apiGet = (path, opts) => request(path, { method: "GET", ...(opts || {}) });
export const apiPost = (path, body, opts) => request(path, { method: "POST", body: body ?? {}, ...(opts || {}) });
export const apiPatch = (path, body, opts) => request(path, { method: "PATCH", body: body ?? {}, ...(opts || {}) });
export const apiDelete = (path, opts) => request(path, { method: "DELETE", ...(opts || {}) });
