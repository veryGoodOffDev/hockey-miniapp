export async function ensureSchema(q) {
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

  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled';`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await q(`
    CREATE TABLE IF NOT EXISTS players (
      tg_id BIGINT PRIMARY KEY,
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      username TEXT DEFAULT '',
      position TEXT DEFAULT 'F',
      skill INT DEFAULT 5,
      skating INT DEFAULT 5,
      iq INT DEFAULT 5,
      stamina INT DEFAULT 5,
      passing INT DEFAULT 5,
      shooting INT DEFAULT 5,
      notes TEXT DEFAULT '',
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_name TEXT DEFAULT '';`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

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

  await q(`
    CREATE TABLE IF NOT EXISTS teams (
      game_id INT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      team_a JSONB NOT NULL DEFAULT '[]',
      team_b JSONB NOT NULL DEFAULT '[]',
      meta JSONB NOT NULL DEFAULT '{}',
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

  await q(`CREATE INDEX IF NOT EXISTS idx_games_starts_at ON games(starts_at);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);`);
}
