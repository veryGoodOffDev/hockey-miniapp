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
      video_url TEXT,
      geo_lat DOUBLE PRECISION,
      geo_lon DOUBLE PRECISION
    );
  `);

  
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled';`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS video_url TEXT;`);
  //  Best player (обладатель талисмана после игры)
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS best_player_tg_id BIGINT;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS best_player_set_by BIGINT;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS best_player_set_at TIMESTAMPTZ;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS best_player_source TEXT DEFAULT 'manual';`);

  await q(`CREATE INDEX IF NOT EXISTS idx_games_starts_at ON games(starts_at);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS geo_lon DOUBLE PRECISION;`);
  //  текстовые блоки информации по игре
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS info_text TEXT;`);    // длинный текст "Важная информация"
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS notice_text TEXT;`);  // короткий "Важно!"
  //  Напоминания по игре
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS reminder_message_id BIGINT;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS reminder_pin BOOLEAN NOT NULL DEFAULT TRUE;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS pinned_comment_id BIGINT;`);

    /** ===================== GAME REMINDERS (MULTI) ===================== */

  await q(`
    CREATE TABLE IF NOT EXISTS game_reminders (
      id BIGSERIAL PRIMARY KEY,
      game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,

      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      remind_at TIMESTAMPTZ NOT NULL,
      pin BOOLEAN NOT NULL DEFAULT TRUE,

      sent_at TIMESTAMPTZ,
      message_id BIGINT,

      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,

      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_game_reminders_game_id ON game_reminders(game_id);`);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_game_reminders_due
    ON game_reminders (remind_at) INCLUDE (id, game_id)
    WHERE enabled = TRUE AND sent_at IS NULL;
  `);

  // Авто-миграция старого одиночного напоминания из games.* в game_reminders
  // (idempotent: вставляем только если для game_id ещё нет напоминаний)
  await q(`
    INSERT INTO game_reminders (game_id, enabled, remind_at, sent_at, message_id, pin, created_by)
    SELECT
      g.id,
      COALESCE(g.reminder_enabled, FALSE),
      g.reminder_at,
      g.reminder_sent_at,
      g.reminder_message_id,
      COALESCE(g.reminder_pin, TRUE),
      NULL
    FROM games g
    WHERE g.reminder_at IS NOT NULL
      AND COALESCE(g.reminder_enabled, FALSE) = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM game_reminders r WHERE r.game_id = g.id
      );
  `);

    // ===== Postgame discuss message (в командный чат) =====
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS postgame_sent_at TIMESTAMPTZ;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS postgame_message_id BIGINT;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS postgame_chat_id BIGINT;`);
  await q(`ALTER TABLE games ADD COLUMN IF NOT EXISTS postgame_last_count INT;`);

  // быстрый поиск "кому пора отправить"
  await q(`
    CREATE INDEX IF NOT EXISTS idx_games_postgame_due
    ON games (starts_at) INCLUDE (id)
    WHERE status IS DISTINCT FROM 'cancelled' AND postgame_sent_at IS NULL;
  `);



  // полезный индекс: быстро искать “к отправке”
  await q(`
    CREATE INDEX IF NOT EXISTS idx_games_reminder_due
    ON games (reminder_at) INCLUDE (id)
    WHERE reminder_enabled = TRUE AND reminder_at IS NOT NULL;
  `);


  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'games_geo_pair_chk'
          AND conrelid = 'games'::regclass
      ) THEN
        ALTER TABLE games
          ADD CONSTRAINT games_geo_pair_chk
          CHECK (
            (geo_lat IS NULL AND geo_lon IS NULL)
            OR
            (geo_lat IS NOT NULL AND geo_lon IS NOT NULL)
          );
      END IF;
    END$$;
`);

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

  //  поля гостей (оставляем для совместимости)
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS created_by BIGINT;`);

  //  тип игрока
  // tg     = игрок из Telegram (обычный)
  // manual = постоянный игрок, добавлен админом вручную (без TG)
  // guest  = разовый гость (не в общем списке игроков)
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS player_kind TEXT;`);

  // BOT AVATAR: хранить file_id телеги (НЕ url)
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_file_id TEXT;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pm_started BOOLEAN NOT NULL DEFAULT FALSE;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pm_started_at TIMESTAMPTZ;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pm_last_seen TIMESTAMPTZ;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS bot_menu_msg_id BIGINT;`);
  await q(`CREATE INDEX IF NOT EXISTS idx_players_pm_started ON players(pm_started);`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;`);
  await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;`);

  await q(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email_unique
    ON players (LOWER(email))
    WHERE email IS NOT NULL AND BTRIM(email) <> '';
  `);


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

  
    //  позиция на конкретную игру (оверрайд профиля)
  await q(`ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS pos_override TEXT;`);

  //  check-constraint (idempotent)
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rsvps_pos_override_chk'
      ) THEN
        ALTER TABLE rsvps
          ADD CONSTRAINT rsvps_pos_override_chk
          CHECK (pos_override IN ('F','D','G') OR pos_override IS NULL);
      END IF;
    END$$;
  `);

  //  индекс на rsvps — важно создавать ПОСЛЕ таблицы
  await q(`CREATE INDEX IF NOT EXISTS idx_rsvps_tg_id ON rsvps(tg_id);`);

  


  /** ===================== BEST PLAYER VOTES ===================== */
await q(`
  CREATE TABLE IF NOT EXISTS best_player_votes (
    game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    voter_tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
    candidate_tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, voter_tg_id)
  );
`);

await q(`CREATE INDEX IF NOT EXISTS idx_best_votes_game_candidate ON best_player_votes(game_id, candidate_tg_id);`);


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

  /** ===================== JERSEY ORDERS ===================== */
await q(`
  CREATE TABLE IF NOT EXISTS jersey_orders (
    id BIGSERIAL PRIMARY KEY,
    batch_id BIGINT NOT NULL REFERENCES jersey_batches(id) ON DELETE CASCADE,
    tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
    name_on_jersey TEXT NOT NULL,
    jersey_colors TEXT[] NOT NULL DEFAULT '{}'::text[],
    jersey_number INT,
    jersey_size TEXT NOT NULL,
    socks_needed BOOLEAN NOT NULL DEFAULT FALSE,
    socks_colors TEXT[] NOT NULL DEFAULT '{}'::text[],
    socks_size TEXT NOT NULL DEFAULT 'adult',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(batch_id, tg_id)
  );
`);

// миграция для старых БД, где jersey_orders уже была создана без updated_at
await q(`ALTER TABLE jersey_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);


  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_batches_status ON jersey_batches(status);`);

  await q(`
    CREATE TABLE IF NOT EXISTS jersey_drafts (
      tg_id BIGINT PRIMARY KEY REFERENCES players(tg_id) ON DELETE CASCADE,
      name_on_jersey TEXT NOT NULL DEFAULT '',
      jersey_colors TEXT[] NOT NULL DEFAULT '{}'::text[],
      jersey_number INT,
      jersey_size TEXT NOT NULL DEFAULT '',
      socks_needed BOOLEAN NOT NULL DEFAULT FALSE,
      socks_colors TEXT[] NOT NULL DEFAULT '{}'::text[],
      socks_size TEXT NOT NULL DEFAULT 'adult',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_drafts_updated_at ON jersey_drafts(updated_at DESC);`);

  await q(`
    CREATE TABLE IF NOT EXISTS jersey_orders (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES jersey_batches(id) ON DELETE CASCADE,
      tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
      name_on_jersey TEXT NOT NULL,
      jersey_colors TEXT[] NOT NULL DEFAULT '{}'::text[],
      jersey_number INT,
      jersey_size TEXT NOT NULL,
      socks_needed BOOLEAN NOT NULL DEFAULT FALSE,
      socks_colors TEXT[] NOT NULL DEFAULT '{}'::text[],
      socks_size TEXT NOT NULL DEFAULT 'adult',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(batch_id, tg_id)
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_orders_batch_id ON jersey_orders(batch_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_orders_tg_id ON jersey_orders(tg_id);`);


  // ✅ последовательность для гостевых id (tg_id будет отрицательным)
  await q(`CREATE SEQUENCE IF NOT EXISTS guest_seq START 1`);

  /** ===================== EMAIL AUTH ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_auth_tokens_tg_id ON auth_tokens(tg_id);`);

  await q(`
    CREATE TABLE IF NOT EXISTS email_login_codes (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_email_login_codes_email ON email_login_codes(email);`);

  await q(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      token_hash TEXT PRIMARY KEY,
      tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS team_applications (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      player_tg_id BIGINT REFERENCES players(tg_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ,
      decided_by BIGINT
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_team_applications_status ON team_applications(status);`);

    /** ===================== JERSEY (BATCHES + REQUESTS) ===================== */

  await q(`
    CREATE TABLE IF NOT EXISTS jersey_batches (
      id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('open','closed')) DEFAULT 'open',
      title TEXT NOT NULL DEFAULT '',
      opened_by BIGINT,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      announced_at TIMESTAMPTZ
    );
  `);

  // если таблица уже есть, но колонок не было
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS opened_by BIGINT;`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS announced_at TIMESTAMPTZ;`);

  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_batches_status ON jersey_batches(status);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_batches_opened_at ON jersey_batches(opened_at DESC);`);

  await q(`
    CREATE TABLE IF NOT EXISTS jersey_requests (
      id BIGSERIAL PRIMARY KEY,
      tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,

      status TEXT NOT NULL CHECK (status IN ('draft','sent','deleted')) DEFAULT 'draft',
      batch_id BIGINT REFERENCES jersey_batches(id) ON DELETE SET NULL,

      name_on_jersey TEXT NOT NULL DEFAULT '',
      jersey_colors TEXT[] NOT NULL DEFAULT '{}'::text[],
      jersey_number INT,
      jersey_size TEXT NOT NULL DEFAULT '',

      socks_needed BOOLEAN NOT NULL DEFAULT FALSE,
      socks_colors TEXT[] NOT NULL DEFAULT '{}'::text[],
      socks_size TEXT NOT NULL DEFAULT 'adult' CHECK (socks_size IN ('adult','junior')),

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      sent_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_requests_tg_status ON jersey_requests(tg_id, status);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_requests_batch ON jersey_requests(batch_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_requests_updated_at ON jersey_requests(updated_at DESC);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_requests_sent_at ON jersey_requests(sent_at DESC);`);

  // ---- МИГРАЦИЯ из старых таблиц (если они есть) ----
  await q(`
    DO $$
    BEGIN
      IF to_regclass('public.jersey_drafts') IS NOT NULL THEN
        INSERT INTO jersey_requests(
          tg_id, status, batch_id,
          name_on_jersey, jersey_colors, jersey_number, jersey_size,
          socks_needed, socks_colors, socks_size,
          created_at, updated_at
        )
        SELECT
          d.tg_id, 'draft', NULL,
          COALESCE(d.name_on_jersey,''), COALESCE(d.jersey_colors,'{}'::text[]), d.jersey_number, COALESCE(d.jersey_size,''),
          COALESCE(d.socks_needed,false), COALESCE(d.socks_colors,'{}'::text[]), COALESCE(d.socks_size,'adult'),
          COALESCE(d.updated_at, NOW()), COALESCE(d.updated_at, NOW())
        FROM jersey_drafts d
        WHERE NOT EXISTS (
          SELECT 1 FROM jersey_requests r
          WHERE r.tg_id = d.tg_id AND r.status='draft'
        );
      END IF;
    END $$;
  `);

  await q(`
    DO $$
    BEGIN
      IF to_regclass('public.jersey_orders') IS NOT NULL THEN
        INSERT INTO jersey_requests(
          tg_id, status, batch_id,
          name_on_jersey, jersey_colors, jersey_number, jersey_size,
          socks_needed, socks_colors, socks_size,
          created_at, updated_at,
          sent_at
        )
        SELECT
          o.tg_id, 'sent', o.batch_id,
          COALESCE(o.name_on_jersey,''), COALESCE(o.jersey_colors,'{}'::text[]), o.jersey_number, COALESCE(o.jersey_size,''),
          COALESCE(o.socks_needed,false), COALESCE(o.socks_colors,'{}'::text[]), COALESCE(o.socks_size,'adult'),
          COALESCE(o.created_at, NOW()), COALESCE(o.updated_at, o.created_at, NOW()),
          COALESCE(o.updated_at, o.created_at, NOW())
        FROM jersey_orders o
        WHERE NOT EXISTS (
          SELECT 1 FROM jersey_requests r
          WHERE r.status='sent' AND r.batch_id=o.batch_id AND r.tg_id=o.tg_id
            AND r.name_on_jersey = o.name_on_jersey
            AND COALESCE(r.jersey_number,-9999) = COALESCE(o.jersey_number,-9999)
            AND r.jersey_size = o.jersey_size
        );
      END IF;
    END $$;
  `);


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

    /** ===================== RSVP TOKENS (public links) ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS rsvp_tokens (
      id BIGSERIAL PRIMARY KEY,

      token TEXT UNIQUE NOT NULL,

      game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by BIGINT,

      expires_at TIMESTAMPTZ,
      max_uses INT NOT NULL DEFAULT 0, -- 0 = unlimited
      used_count INT NOT NULL DEFAULT 0,
      last_used_at TIMESTAMPTZ
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_rsvp_tokens_game_id ON rsvp_tokens(game_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_rsvp_tokens_tg_id ON rsvp_tokens(tg_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_rsvp_tokens_expires_at ON rsvp_tokens(expires_at);`);

    /** ===================== FUN ACTIONS (profile jokes) ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS fun_actions (
      user_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
      action  TEXT NOT NULL CHECK (action IN ('thanks','donate')),
      value   TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, action)
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_fun_actions_action ON fun_actions(action);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_fun_actions_created_at ON fun_actions(created_at DESC);`);

  /** ===================== FUN ACTIONS LOG ===================== */
await q(`
  CREATE TABLE IF NOT EXISTS fun_actions_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
    action  TEXT NOT NULL CHECK (action IN ('thanks','donate')),
    value   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);
await q(`CREATE INDEX IF NOT EXISTS idx_fun_actions_log_user ON fun_actions_log(user_id, action);`);

await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS joke_premium BOOLEAN NOT NULL DEFAULT FALSE;`);
// premium по времени (истекает)
await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS joke_premium_until TIMESTAMPTZ;`);

// опционально: кто/когда выдал (удобно)
await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS joke_premium_set_by BIGINT;`);
await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS joke_premium_set_at TIMESTAMPTZ;`);
await q(`ALTER TABLE players ADD COLUMN IF NOT EXISTS joke_premium_note TEXT;`);


  /** ===================== GAME COMMENTS ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS game_comments (
      id BIGSERIAL PRIMARY KEY,
      game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      author_tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_game_comments_game_id_created ON game_comments(game_id, created_at);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_game_comments_author ON game_comments(author_tg_id);`);

    // FK games.pinned_comment_id -> game_comments.id
  // важно: добавлять только ПОСЛЕ того, как создана таблица game_comments
  await q(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'games_pinned_comment_fk'
          AND conrelid = 'games'::regclass
      ) THEN
        ALTER TABLE games
          ADD CONSTRAINT games_pinned_comment_fk
          FOREIGN KEY (pinned_comment_id)
          REFERENCES game_comments(id)
          ON DELETE SET NULL;
      END IF;
    END$$;
  `);


  /** ===================== GAME COMMENT REACTIONS ===================== */
  await q(`
    CREATE TABLE IF NOT EXISTS game_comment_reactions (
      comment_id BIGINT NOT NULL REFERENCES game_comments(id) ON DELETE CASCADE,
      user_tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
      reaction TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (comment_id, user_tg_id, reaction)
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_gcr_comment ON game_comment_reactions(comment_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_gcr_user ON game_comment_reactions(user_tg_id);`);

    /** ===================== JERSEY ORDERS (BATCHES) ===================== */

  await q(`
    CREATE TABLE IF NOT EXISTS jersey_batches (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open', -- open|closed

      opened_by BIGINT,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      closed_by BIGINT,
      closed_at TIMESTAMPTZ,

      announced_at TIMESTAMPTZ,
      announce_message_id BIGINT
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_batches_status ON jersey_batches(status);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_batches_opened_at ON jersey_batches(opened_at DESC);`);

  // на случай если таблица уже была, но без колонок
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS opened_by BIGINT;`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS closed_by BIGINT;`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS announced_at TIMESTAMPTZ;`);
  await q(`ALTER TABLE jersey_batches ADD COLUMN IF NOT EXISTS announce_message_id BIGINT;`);

  await q(`
    CREATE TABLE IF NOT EXISTS jersey_requests (
      id BIGSERIAL PRIMARY KEY,

      tg_id BIGINT NOT NULL REFERENCES players(tg_id) ON DELETE CASCADE,
      batch_id INT NOT NULL REFERENCES jersey_batches(id) ON DELETE CASCADE,

      status TEXT NOT NULL DEFAULT 'draft', -- draft|sent

      name_on_jersey TEXT,
      jersey_number INT,
      jersey_size TEXT,
      jersey_colors TEXT[] NOT NULL DEFAULT '{}'::text[],

      socks_needed BOOLEAN NOT NULL DEFAULT FALSE,
      socks_colors TEXT[] NOT NULL DEFAULT '{}'::text[],
      socks_size TEXT, -- normal|junior

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    );
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_requests_batch_status ON jersey_requests(batch_id, status);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_jersey_requests_tg ON jersey_requests(tg_id);`);

  // на случай если таблица уже была, но без колонок
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS tg_id BIGINT;`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS batch_id INT;`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS name_on_jersey TEXT;`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS jersey_number INT;`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS jersey_size TEXT;`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS jersey_colors TEXT[] NOT NULL DEFAULT '{}'::text[];`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS socks_needed BOOLEAN NOT NULL DEFAULT FALSE;`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS socks_colors TEXT[] NOT NULL DEFAULT '{}'::text[];`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS socks_size TEXT;`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await q(`ALTER TABLE jersey_requests ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;`);

}
