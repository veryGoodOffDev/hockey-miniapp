// backend/src/schema.js
export async function ensureSchema(q) {
  // --- base tables (only creates if missing)
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

  // --- migrations for existing tables (IMPORTANT)
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled';`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  // make sure not-null columns won't fail
  await q(`UPDATE games SET starts_at = NOW() WHERE starts_at IS NULL;`);
  await q(`UPDATE games SET location = '' WHERE location IS NULL;`);
  await q(`UPDATE games SET status = 'scheduled' WHERE status IS NULL OR status = '';`);

  // enforce NOT NULL if older schema had nullable
  await q(`ALTER TABLE games ALTER COLUMN starts_at SET NOT NULL;`);
  await q(`ALTER TABLE games ALTER COLUMN location SET NOT NULL;`);
  await q(`ALTER TABLE games ALTER COLUMN status SET NOT NULL;`);

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

  // migrations for players (if table existed раньше)
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS first_name TEXT DEFAULT '';`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS username TEXT DEFAULT '';`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS position TEXT DEFAULT 'F';`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS skill INT DEFAULT 5;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS skating INT DEFAULT 5;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS iq INT DEFAULT 5;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS stamina INT DEFAULT 5;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS passing INT DEFAULT 5;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS shooting INT DEFAULT 5;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

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

  // indexes (now safe)
  await q(`CREATE INDEX IF NOT EXISTS idx_games_starts_at ON games(starts_at);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_players_disabled ON players(disabled);`);
}
