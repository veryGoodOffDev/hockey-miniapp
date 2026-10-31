export const DEFAULT_APP_FEATURES = Object.freeze({
  chat: true,
  game_comments: true,
  air_hockey: true,
});
export const APP_FEATURES_KEY = "app_features";

export function normalizeAppFeatures(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  return Object.fromEntries(
    Object.keys(DEFAULT_APP_FEATURES).map((key) => [
      key,
      typeof value?.[key] === "boolean" ? value[key] : true,
    ]),
  );
}

export function featureForRequest(path, method) {
  if (/^\/api\/(?:chat|messages)(?:\/|$)/.test(path)) return "chat";
  if (/^\/api\/game-comments(?:\/|$)/.test(path)) return "game_comments";
  if (/^\/api\/game\/air-hockey(?:\/|$)/.test(path)) {
    // Authentication tickets must remain available for reconnecting participants.
    // The socket independently gates create/join/rematch with the same setting.
    if (method === "POST" && path === "/api/game/air-hockey/pvp/ticket")
      return null;
    // Honour matches already started, including their normal settlement/rewards.
    if (
      method === "POST" &&
      /^\/api\/game\/air-hockey\/[^/]+\/finish\/?$/.test(path)
    )
      return null;
    return "air_hockey";
  }
  if (/^\/api\/game\/shop\/unlock-easy\/?$/.test(path)) return "air_hockey";
  return null;
}

export function createAppFeatures({
  q,
  authenticate,
  authorizeAdmin,
  logger = console,
}) {
  const get = async () => {
    const result = await q("SELECT value FROM settings WHERE key=$1", [
      APP_FEATURES_KEY,
    ]);
    return normalizeAppFeatures(result.rows[0]?.value);
  };
  const route = (fn) => async (req, res) => {
    try {
      const user = await authenticate(req, res);
      if (!user) return;
      res.set("Cache-Control", "no-store");
      await fn(req, res, user);
    } catch (error) {
      logger.error("[app features]", error.message);
      res.status(503).json({ ok: false, reason: "features_unavailable" });
    }
  };
  return {
    get,
    enabled: async (feature) => (await get())[feature] === true,
    read: route(async (req, res) =>
      res.json({ ok: true, features: await get() }),
    ),
    update: route(async (req, res, user) => {
      if (!(await authorizeAdmin(req, res, user))) return;
      const patch = req.body;
      if (
        !patch ||
        Array.isArray(patch) ||
        typeof patch !== "object" ||
        !Object.keys(patch).length ||
        Object.entries(patch).some(
          ([key, value]) =>
            !Object.hasOwn(DEFAULT_APP_FEATURES, key) ||
            typeof value !== "boolean",
        )
      ) {
        return res.status(400).json({ ok: false, reason: "invalid_features" });
      }
      // Merge inside PostgreSQL to preserve simultaneous edits of different switches.
      const result = await q(
        `INSERT INTO settings(key,value) VALUES($1,$2)
        ON CONFLICT(key) DO UPDATE SET value=(settings.value::jsonb || EXCLUDED.value::jsonb)::text
        RETURNING value`,
        [APP_FEATURES_KEY, JSON.stringify(patch)],
      );
      res.json({
        ok: true,
        features: normalizeAppFeatures(result.rows[0]?.value),
      });
    }),
    middleware: async (req, res, next) => {
      const feature = featureForRequest(req.path, req.method);
      if (!feature || req.method === "OPTIONS") return next();
      try {
        if ((await get())[feature]) return next();
        return res
          .status(403)
          .json({ ok: false, reason: "feature_disabled", feature });
      } catch (error) {
        logger.error("[app features]", error.message);
        return res
          .status(503)
          .json({ ok: false, reason: "features_unavailable" });
      }
    },
  };
}
