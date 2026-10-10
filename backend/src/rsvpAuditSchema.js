export async function ensureRsvpAuditSchema(q) {
  await q(`CREATE TABLE IF NOT EXISTS rsvp_history (
    id BIGSERIAL PRIMARY KEY,
    game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    tg_id BIGINT NOT NULL,
    from_status TEXT, to_status TEXT,
    automatic BOOLEAN NOT NULL DEFAULT FALSE,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_rsvp_history_game_time ON rsvp_history(game_id, changed_at, id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_rsvp_history_player_time ON rsvp_history(tg_id, changed_at, id)`);
  await q(`CREATE TABLE IF NOT EXISTS support_rsvp_dirty (
    game_id INT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL DEFAULT 1,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INT NOT NULL DEFAULT 0
  )`);
  await q(`CREATE TABLE IF NOT EXISTS support_rsvp_messages (
    game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    bot_id BIGINT NOT NULL, chat_id BIGINT NOT NULL,
    message_id BIGINT NOT NULL, last_text TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(game_id, bot_id, chat_id)
  )`);
  await q(`CREATE OR REPLACE FUNCTION record_rsvp_interaction() RETURNS trigger AS $$
    DECLARE gid INT; pid BIGINT; old_status TEXT; new_status TEXT; is_auto BOOLEAN;
    BEGIN
      IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
        AND NEW.auto_no IS NOT DISTINCT FROM OLD.auto_no
        AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN RETURN NEW; END IF;
      IF TG_OP = 'DELETE' THEN
        gid := OLD.game_id; pid := OLD.tg_id; old_status := OLD.status; is_auto := OLD.auto_no;
      ELSE
        gid := NEW.game_id; pid := NEW.tg_id; new_status := NEW.status; is_auto := NEW.auto_no;
        IF TG_OP = 'UPDATE' THEN old_status := OLD.status; END IF;
      END IF;
      -- Cascading game removal must not resurrect its queue or fail its FK.
      IF NOT EXISTS(SELECT 1 FROM games WHERE id=gid) THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END IF;
      INSERT INTO rsvp_history(game_id,tg_id,from_status,to_status,automatic)
        VALUES(gid,pid,old_status,new_status,COALESCE(is_auto,FALSE));
      INSERT INTO support_rsvp_dirty(game_id) VALUES(gid)
        ON CONFLICT(game_id) DO UPDATE SET revision=support_rsvp_dirty.revision+1,
          changed_at=NOW(),next_attempt_at=NOW(),attempts=0;
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END;
  $$ LANGUAGE plpgsql`);
  await q(`DROP TRIGGER IF EXISTS rsvp_interaction_audit ON rsvps`);
  await q(`CREATE TRIGGER rsvp_interaction_audit AFTER INSERT OR UPDATE OR DELETE ON rsvps
    FOR EACH ROW EXECUTE FUNCTION record_rsvp_interaction()`);
  await q(`CREATE OR REPLACE FUNCTION refresh_support_game_header() RETURNS trigger AS $$
    BEGIN
      INSERT INTO support_rsvp_dirty(game_id) VALUES(NEW.id)
        ON CONFLICT(game_id) DO UPDATE SET revision=support_rsvp_dirty.revision+1,
          changed_at=NOW(),next_attempt_at=NOW(),attempts=0;
      RETURN NEW;
    END;
  $$ LANGUAGE plpgsql`);
  await q(`DROP TRIGGER IF EXISTS support_game_header_changed ON games`);
  await q(`CREATE TRIGGER support_game_header_changed AFTER UPDATE OF starts_at,location,status ON games
    FOR EACH ROW WHEN (OLD.starts_at IS DISTINCT FROM NEW.starts_at OR OLD.location IS DISTINCT FROM NEW.location
      OR OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION refresh_support_game_header()`);
  // Existing marks retain their original updated_at; do not fabricate history.
  await q(`INSERT INTO support_rsvp_dirty(game_id)
    SELECT DISTINCT g.id FROM games g JOIN rsvps r ON r.game_id=g.id
    WHERE g.starts_at >= NOW()-INTERVAL '1 day' AND g.status <> 'cancelled'
      AND r.status IN ('yes','no') AND r.auto_no=FALSE
    ON CONFLICT(game_id) DO NOTHING`);
}
