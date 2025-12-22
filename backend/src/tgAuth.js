import crypto from "crypto";

export function verifyTelegramWebApp(initData, botToken) {
  try {
    if (!initData) return { ok: false, reason: "no_init_data" };
    if (!botToken) return { ok: false, reason: "no_bot_token" };

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false, reason: "no_hash" };

    params.delete("hash");

    const pairs = [];
    for (const [k, v] of params.entries()) pairs.push([k, v]);
    pairs.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

    // secretKey = HMAC_SHA256(botToken, key="WebAppData")
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    // checkHash = HMAC_SHA256(dataCheckString, key=secretKey)
    const checkHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (checkHash !== hash) return { ok: false, reason: "BOT_INVALID" };

    const userRaw = params.get("user");
    if (!userRaw) return { ok: false, reason: "no_user" };

    const user = JSON.parse(userRaw);
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: "exception" };
  }
}
