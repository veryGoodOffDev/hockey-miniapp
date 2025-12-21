import crypto from "crypto";

function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const data = {};
  for (const [k, v] of params.entries()) data[k] = v;
  return data;
}

export function verifyTelegramWebApp(initData, botToken) {
  if (!initData) return { ok: false, reason: "no_init_data" };

  const data = parseInitData(initData);
  const hash = data.hash;
  if (!hash) return { ok: false, reason: "no_hash" };

  delete data.hash;

  // строим data_check_string: key=value \n key=value (отсортировано)
  const keys = Object.keys(data).sort();
  const checkString = keys.map(k => `${k}=${data[k]}`).join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");

  if (hmac !== hash) return { ok: false, reason: "bad_hash" };

  // user лежит JSON строкой
  let user = null;
  try { user = JSON.parse(data.user || "null"); } catch {}
  if (!user?.id) return { ok: false, reason: "no_user" };

  return { ok: true, user, raw: data };
}
