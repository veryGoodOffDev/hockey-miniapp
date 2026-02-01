// backend/src/admin.js
export function getTgId(req) {
  return (
    req.user?.tg_id ??
    req.user?.id ??
    req.tg_id ??
    req.tg?.id ??
    req.auth?.tg_id ??
    null
  );
}

export function isAdminTgId(tgId) {
  if (!tgId) return false;
  const list = (process.env.ADMIN_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return list.includes(String(tgId));
}

export function requireAdmin(req, res, next) {
  const tgId = getTgId(req);
  if (!isAdminTgId(tgId)) return res.status(403).json({ ok: false, error: "admin_only" });
  next();
}