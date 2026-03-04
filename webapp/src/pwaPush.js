import { apiGet, apiPost } from './api.js';

const DEVICE_KEY = 'push_device_id';

function getDeviceId() {
  try {
    const current = localStorage.getItem(DEVICE_KEY);
    if (current) return current;
    const next = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).slice(0, 120);
    localStorage.setItem(DEVICE_KEY, next);
    return next;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

function isTelegramWebView() {
  return Boolean(window.Telegram?.WebApp?.initDataUnsafe?.user?.id && window.Telegram?.WebApp?.initData);
}

export function isPwaPushSupported() {
  if (isTelegramWebView()) return false;
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function canRequestPushOnIOS() {
  const ua = String(navigator.userAgent || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  if (!isIOS) return true;
  return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js');
}

async function getPublicVapidKey() {
  const r = await apiGet('/api/push/vapid-public-key');
  if (!r?.ok || !r.publicKey) throw new Error('push_public_key_missing');
  return r.publicKey;
}

function base64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function enablePushNotifications() {
  if (!isPwaPushSupported()) throw new Error('push_not_supported');
  if (!canRequestPushOnIOS()) throw new Error('ios_add_to_home_screen_required');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('notification_permission_denied');

  const registration = await registerServiceWorker();
  if (!registration) throw new Error('service_worker_unavailable');

  const publicKey = await getPublicVapidKey();
  const appServerKey = base64ToUint8Array(publicKey);

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
  }

  await apiPost('/api/push/subscribe', {
    subscription: subscription.toJSON(),
    deviceId: getDeviceId(),
  });

  return subscription;
}

export async function disablePushNotifications() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try {
    await apiPost('/api/push/unsubscribe', { endpoint: sub.endpoint });
  } finally {
    await sub.unsubscribe();
  }
}

export async function syncAppBadge(unreadCount) {
  const count = Number(unreadCount || 0);
  const nav = navigator;
  if (!nav) return;
  if ('setAppBadge' in nav) {
    if (count > 0) await nav.setAppBadge(count);
    else if ('clearAppBadge' in nav) await nav.clearAppBadge();
  }
}
