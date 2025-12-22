import crypto from "crypto";

function dataCheckStringFromInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push([k, v]);
  pairs.sort((a, b) => a[0].localeCompare(b[0]));

  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  return { hash, dataCheckString, params };
}

export function verifyInitData(initData, botToken) {
  if (!initData) return null;
  const { hash, dataCheckString, params } = dataCheckStringFromInitData(initData);
  if (!hash) return null;

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (hmac !== hash) return null;

  const userJson = params.get("user");
  if (!userJson) return null;

  try {
    const user = JSON.parse(userJson);
    return user;
  } catch {
    return null;
  }
}

export function tgAuthMiddleware(req, res, next) {
  const initData = req.header("x-telegram-init-data") || "";
  const botToken = process.env.BOT_TOKEN || "";
  const user = verifyInitData(initData, botToken);

  if (!user) {
    req.tgUser = null;
    return res.status(401).json({ ok: false, error: "invalid_init_data" });
  }

  req.tgUser = user;
  next();
}
