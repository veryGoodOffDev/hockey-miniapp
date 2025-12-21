const API_BASE = import.meta.env.VITE_API_BASE;

function getInitData() {
  const tg = window.Telegram?.WebApp;
  return tg?.initData || "";
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "x-telegram-init-data": getInitData() }
  });
  return res.json();
}

export async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-init-data": getInitData()
    },
    body: JSON.stringify(body || {})
  });
  return res.json();
}
