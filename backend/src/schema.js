export async function ensureSchema(q) {
  /** ===================== GAMES ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      starts_at TIMESTAMPTZ NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      video_url TEXT
    );
  `);

  // idempotent alterations (ok to keep)
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled';`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS video_url TEXT;`);

  await q(`CREATE INDEX IF NOT EXISTS idx_games_starts_at ON games(starts_at);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);`);

  /** ===================== PLAYERS ===================== */
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
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '';`);

  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS display_name TEXT;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS jersey_number INT;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;`);

  // ✅ поля гостей (оставляем для совместимости)
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS created_by BIGINT;`);

  // ✅ НОВОЕ: тип игрока
  // tg     = игрок из Telegram (обычный)
  // manual = постоянный игрок, добавлен админом вручную (без TG)
  // guest  = разовый гость (не в общем списке игроков)
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS player_kind TEXT;`);

  // миграция/нормализация значений
  // 1) кто был гостем раньше -> guest
  await q(`
    UPDATE players
    SET player_kind = 'guest'
    WHERE is_guest = TRUE AND (player_kind IS NULL OR BTRIM(player_kind) = '');
  `);

  // 2) все остальные -> tg
  await q(`
    UPDATE players
    SET player_kind = 'tg'
    WHERE (player_kind IS NULL OR BTRIM(player_kind) = '');
  `);

  // 3) default + not null
  await q(`ALTER TABLE players ALTER COLUMN player_kind SET DEFAULT 'tg';`);
  await q(`ALTER TABLE players ALTER COLUMN player_kind SET NOT NULL;`);

  await q(`CREATE INDEX IF NOT EXISTS idx_players_kind ON players(player_kind);`);

  /** ===================== RSVPS ===================== */
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

  // ✅ индекс на rsvps — важно создавать ПОСЛЕ таблицы
  await q(`CREATE INDEX IF NOT EXISTS idx_rsvps_tg_id ON rsvps(tg_id);`);

  /** ===================== TEAMS ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS teams (
      game_id INT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      team_a JSONB NOT NULL DEFAULT '[]',
      team_b JSONB NOT NULL DEFAULT '[]',
      meta JSONB NOT NULL DEFAULT '{}',
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  /** ===================== SETTINGS ===================== */
  await q(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

  // ✅ последовательность для гостевых id (tg_id будет отрицательным)
  await q(`CREATE SEQUENCE IF NOT EXISTS guest_seq START 1`);

  /** ===================== FEEDBACK ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS feedback (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      team_chat_id BIGINT,
      tg_user_id BIGINT NOT NULL,
      tg_username TEXT DEFAULT '',
      tg_name TEXT DEFAULT '',

      category TEXT NOT NULL DEFAULT 'bug',
      message TEXT NOT NULL,

      app_version TEXT DEFAULT '',
      platform TEXT DEFAULT '',

      status TEXT NOT NULL DEFAULT 'open'
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);`);

  await q(`
    CREATE TABLE IF NOT EXISTS feedback_files (
      id BIGSERIAL PRIMARY KEY,
      feedback_id BIGINT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      original_name TEXT DEFAULT '',
      mime TEXT DEFAULT '',
      size_bytes INT DEFAULT 0,

      tg_file_id TEXT DEFAULT '',
      tg_message_id BIGINT
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_feedback_files_feedback_id ON feedback_files(feedback_id);`);

  /** ===================== APP UPDATES ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS app_updates (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      version TEXT NOT NULL,
      title TEXT DEFAULT '',
      body_md TEXT NOT NULL DEFAULT '',
      released_at DATE NOT NULL
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_app_updates_released_at ON app_updates(released_at DESC);`);

  /** ===================== BOT MESSAGES ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS bot_messages (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      message_id BIGINT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'custom', -- custom | reminder
      text TEXT NOT NULL,
      parse_mode TEXT,
      disable_web_page_preview BOOLEAN NOT NULL DEFAULT TRUE,
      reply_markup JSONB,
      meta JSONB,
      sent_by_tg_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checked_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      delete_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS bot_messages_chat_created_idx
      ON bot_messages(chat_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS bot_messages_chat_kind_idx
      ON bot_messages(chat_id, kind, created_at DESC);
  `);
}
