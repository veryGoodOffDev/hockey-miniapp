// backend/src/schema.js
export async function ensureSchema(q) {
  // games
  await q(`
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      starts_at TIMESTAMPTZ NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // players
  await q(`
    CREATE TABLE IF NOT EXISTS players (
      tg_id BIGINT PRIMARY KEY,
      first_name TEXT DEFAULT '',
      username TEXT DEFAULT '',
      position TEXT DEFAULT 'F',
      skill INT DEFAULT 5,
      skating INT DEFAULT 5,
      iq INT DEFAULT 5,
      stamina INT DEFAULT 5,
      passing INT DEFAULT 5,
      shooting INT DEFAULT 5,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // rsvps
  await q(`
    CREATE TABLE IF NOT EXISTS rsvps (
      game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('yes','maybe','no')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (game_id, tg_id)
    );
  `);

  // teams
  await q(`
    CREATE TABLE IF NOT EXISTS teams (
      game_id INT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      team_a JSONB NOT NULL DEFAULT '[]',
      team_b JSONB NOT NULL DEFAULT '[]',
      meta JSONB NOT NULL DEFAULT '{}',
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // indexes
  await q(`CREATE INDEX IF NOT EXISTS idx_games_starts_at ON games(starts_at);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_players_disabled ON players(disabled);`);
}
