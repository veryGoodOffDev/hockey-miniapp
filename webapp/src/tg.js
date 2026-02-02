// tg.js
export function isInTelegram() {
  return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
}

export function getInitData() {
  return window.Telegram?.WebApp?.initData || "";
}

export function tgReady() {
  try {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  } catch {}
}