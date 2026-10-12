export async function ensurePvpSchema(q) {
  await q(`CREATE TABLE IF NOT EXISTS air_hockey_pvp_matches (
    id UUID PRIMARY KEY, room_code TEXT NOT NULL,
    player_a_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE, player_b_id BIGINT REFERENCES players(tg_id) ON DELETE CASCADE,
    score_a INT NOT NULL DEFAULT 0 CHECK(score_a BETWEEN 0 AND 7), score_b INT NOT NULL DEFAULT 0 CHECK(score_b BETWEEN 0 AND 7),
    winner_id BIGINT REFERENCES players(tg_id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'waiting',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
    active_ms INT NOT NULL DEFAULT 0, finish_reason TEXT,
    reward_a INT NOT NULL DEFAULT 0, reward_b INT NOT NULL DEFAULT 0, reward_reason_a TEXT, reward_reason_b TEXT,
    reward_processed BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK(player_b_id IS NULL OR player_a_id <> player_b_id)
  )`);
  await q(
    `CREATE INDEX IF NOT EXISTS air_hockey_pvp_daily ON air_hockey_pvp_matches(finished_at,player_a_id,player_b_id) WHERE reward_processed`,
  );
  await q(
    `ALTER TABLE sheep_coin_transactions ADD COLUMN IF NOT EXISTS pvp_match_id UUID REFERENCES air_hockey_pvp_matches(id) ON DELETE SET NULL`,
  );
  await q(
    `CREATE UNIQUE INDEX IF NOT EXISTS sheep_coin_pvp_once ON sheep_coin_transactions(user_id,pvp_match_id) WHERE pvp_match_id IS NOT NULL`,
  );
}
