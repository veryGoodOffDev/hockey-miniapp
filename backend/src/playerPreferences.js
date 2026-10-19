export function createPlayerPreferencesHandler({ authenticate, q }) {
  return async (req, res) => {
    try {
      const user = await authenticate(req, res);
      if (!user) return;
      const body = req.body;
      if (
        !body ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !["list", "chips"].includes(body.rsvp_view)
      ) {
        return res.status(400).json({ ok: false, reason: "invalid_rsvp_view" });
      }
      const result = await q(
        "UPDATE players SET rsvp_view=$2 WHERE tg_id=$1 RETURNING rsvp_view",
        [user.id, body.rsvp_view],
      );
      if (!result.rows[0])
        return res.status(404).json({ ok: false, reason: "player_deleted" });
      return res.json({ ok: true, preferences: result.rows[0] });
    } catch (error) {
      console.error("[player preferences]", error?.message);
      return res.status(500).json({ ok: false, reason: "server_error" });
    }
  };
}
