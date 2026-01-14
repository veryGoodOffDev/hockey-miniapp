import { Bot, InlineKeyboard, session } from "grammy";
import { q } from "./db.js";

function adminIds() {
  return (process.env.ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function isAdmin(id) {
  return adminIds().includes(String(id));
}

export function createBot() {
  const bot = new Bot(process.env.BOT_TOKEN);
  const webAppUrl = process.env.WEB_APP_URL;

  // состояние ожидания (фото/имя)
  bot.use(session({ initial: () => ({ mode: null }) }));

  // ---------- helpers ----------
  async function markPmStarted(from) {
    await q(
      `
      INSERT INTO players (tg_id, first_name, last_name, username, player_kind,
                           pm_started, pm_started_at, pm_last_seen, updated_at)
      VALUES ($1,$2,$3,$4,'tg', TRUE, NOW(), NOW(), NOW())
      ON CONFLICT (tg_id)
      DO UPDATE SET
        first_name   = EXCLUDED.first_name,
        last_name    = EXCLUDED.last_name,
        username     = EXCLUDED.username,
        pm_started   = TRUE,
        pm_started_at = COALESCE(players.pm_started_at, NOW()),
        pm_last_seen = NOW(),
        updated_at   = NOW()
      `,
      [from.id, from.first_name || "", from.last_name || "", from.username || ""]
    );
  }

  async function getMenuMsgId(uid) {
    const r = await q(`SELECT bot_menu_msg_id FROM players WHERE tg_id=$1`, [uid]);
    return r.rows?.[0]?.bot_menu_msg_id || null;
  }

  async function setMenuMsgId(uid, mid) {
    await q(
      `UPDATE players SET bot_menu_msg_id=$2, pm_last_seen=NOW(), updated_at=NOW() WHERE tg_id=$1`,
      [uid, mid]
    );
  }

  function isNotModifiedError(e) {
    const msg = String(e?.message || "");
    // grammy error messages differ a bit, but this substring is stable enough
    return msg.toLowerCase().includes("message is not modified");
  }

  async function tryEdit(botChatId, msgId, text, kb) {
    try {
      await bot.api.editMessageText(botChatId, msgId, text, {
        reply_markup: kb,
        disable_web_page_preview: true,
      });
      return true;
    } catch (e) {
      if (isNotModifiedError(e)) return true;
      return false;
    }
  }

  /**
   * Единый “экран” — не плодим сообщения:
   * - если кликнули кнопку (callback) → редактируем это сообщение
   * - иначе редактируем сохранённое меню-сообщение (bot_menu_msg_id)
   * - иначе создаём новое и сохраняем id
   */
  async function showScreen(ctx, text, kb) {
    if (!ctx.from?.id || ctx.chat?.type !== "private") return;

    const uid = ctx.from.id;
    const chatId = ctx.chat.id;

    // 1) если это callback — редактируем текущее сообщение (самый надёжный путь)
    const cbMid = ctx.callbackQuery?.message?.message_id;
    if (cbMid) {
      const ok = await tryEdit(chatId, cbMid, text, kb);
      if (ok) {
        // запомним, чтобы команды/сообщения тоже редактировали именно его
        await setMenuMsgId(uid, cbMid);
        return;
      }
    }

    // 2) пробуем редактировать сохранённое меню
    const savedMid = await getMenuMsgId(uid);
    if (savedMid) {
      const ok = await tryEdit(chatId, savedMid, text, kb);
      if (ok) return;
    }

    // 3) создаём новое “главное” сообщение
    const m = await ctx.reply(text, {
      reply_markup: kb,
      disable_web_page_preview: true,
    });
    await setMenuMsgId(uid, m.message_id);
  }

  // ---------- UI keyboards ----------
  function mainMenuKb() {
    const kb = new InlineKeyboard()
      .text("👤 Профиль", "m:profile")
      .row()
      .text("🔄 Перезапустить", "m:home");

    if (webAppUrl) kb.row().webApp("🏒 Открыть мини-приложение", webAppUrl);
    kb.row().text("ℹ️ Помощь", "m:help");
    return kb;
  }

  function profileKb() {
    const kb = new InlineKeyboard()
      .text("📸 Установить аватар", "p:avatar_set")
      .row()
      .text("🗑 Удалить аватар", "p:avatar_del")
      .row()
      .text("✏️ Изменить имя", "p:name_set")
      .row()
      .text("⬅️ Назад в меню", "m:home");

    if (webAppUrl) kb.row().webApp("🏒 Открыть мини-приложение", webAppUrl);
    return kb;
  }

  function cancelKb(back = "m:profile") {
    return new InlineKeyboard().text("❌ Отмена", back).row().text("⬅️ Меню", "m:home");
  }

  // ---------- screens ----------
  async function sendMainMenu(ctx) {
    const text =
      `🏒 Меню бота\n\n` +
      `• Профиль — имя и аватар\n` +
      `• Мини-приложение — игры и отметки\n\n` +
      `Нажми кнопку ниже 👇`;
    return showScreen(ctx, text, mainMenuKb());
  }

  async function sendHelp(ctx) {
    const text =
      `ℹ️ Помощь\n\n` +
      `• Нажми «Профиль», чтобы сменить имя или аватар.\n` +
      `• «Мини-приложение» открывает WebApp для игр.\n\n` +
      `Если что-то сломалось — жми «Перезапустить».\n`;
    const kb = new InlineKeyboard().text("⬅️ Назад", "m:home");
    return showScreen(ctx, text, kb);
  }

  async function sendProfileMenu(ctx) {
    const r = await q(
      `
      SELECT
        COALESCE(NULLIF(display_name,''), NULLIF(first_name,''), NULLIF(username,''), 'Игрок') AS name,
        (avatar_file_id IS NOT NULL) AS has_avatar
      FROM players
      WHERE tg_id=$1
      `,
      [ctx.from.id]
    );

    const row = r.rows?.[0] || { name: "Игрок", has_avatar: false };

    const text =
      `👤 Профиль игрока\n\n` +
      `Имя: ${row.name}\n` +
      `Аватар: ${row.has_avatar ? "✅ установлен" : "— нет"}\n\n` +
      `Выбери действие:`;

    return showScreen(ctx, text, profileKb());
  }

  // ---------- Telegram menu button + commands ----------
  bot.api
    .setMyCommands([
      { command: "menu", description: "Открыть меню" },
      { command: "profile", description: "Профиль (имя/аватар)" },
      { command: "app", description: "Открыть мини-приложение" },
      { command: "start", description: "Запуск/перезапуск" },
    ])
    .catch(() => {});

  // Встроенная кнопка “Меню” в личке бота (рядом с полем ввода)
  bot.api
    .setChatMenuButton({
      menu_button: { type: "commands" },
    })
    .catch(() => {});

  // ---------- commands ----------
  bot.command(["start", "menu"], async (ctx) => {
    if (ctx.chat?.type !== "private") {
      return ctx.reply("Напиши мне в личку — там будет меню и кнопки.");
    }
    await markPmStarted(ctx.from);
    ctx.session.mode = null;

    if (!webAppUrl) {
      // просто покажем предупреждение один раз на меню
      // (не создавая отдельное сообщение)
    }

    return sendMainMenu(ctx);
  });

  bot.command("profile", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await markPmStarted(ctx.from);
    ctx.session.mode = null;
    return sendProfileMenu(ctx);
  });

  bot.command("app", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await markPmStarted(ctx.from);
    ctx.session.mode = null;

    if (!webAppUrl) {
      const kb = new InlineKeyboard().text("⬅️ Меню", "m:home");
      return showScreen(ctx, "⚠️ WEB_APP_URL не задан на backend. Кнопка WebApp недоступна.", kb);
    }

    const kb = new InlineKeyboard()
      .webApp("🏒 Открыть мини-приложение", webAppUrl)
      .row()
      .text("⬅️ Меню", "m:home");

    return showScreen(ctx, "Открой мини-приложение:", kb);
  });

  bot.command("id", async (ctx) => ctx.reply(`Ваш tg_id: ${ctx.from?.id}`));

  // админ: назначить чат для уведомлений
  bot.command("setchat", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid || !isAdmin(uid)) return ctx.reply("Только для разработчика/админа.");

    await q(
      `INSERT INTO settings(key, value) VALUES('notify_chat_id', $1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [String(ctx.chat.id)]
    );

    return ctx.reply("✅ Этот чат назначен для уведомлений.");
  });

  // ---------- callbacks: navigation ----------
  bot.callbackQuery("m:home", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCallbackQuery();
    await markPmStarted(ctx.from);
    ctx.session.mode = null;
    return sendMainMenu(ctx);
  });

  bot.callbackQuery("m:help", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCallbackQuery();
    await markPmStarted(ctx.from);
    ctx.session.mode = null;
    return sendHelp(ctx);
  });

  bot.callbackQuery("m:profile", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCallbackQuery();
    await markPmStarted(ctx.from);
    ctx.session.mode = null;
    return sendProfileMenu(ctx);
  });

  // ---------- callbacks: profile actions ----------
  bot.callbackQuery("p:avatar_set", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCallbackQuery();
    await markPmStarted(ctx.from);

    ctx.session.mode = "await_avatar";
    const text =
      `📸 Установка аватара\n\n` +
      `Отправь фото *как Фото* (не файлом) — поставлю его аватаркой.\n\n` +
      `После отправки верну тебя в «Профиль».`;
    return showScreen(ctx, text, cancelKb("m:profile"));
  });

  bot.callbackQuery("p:avatar_del", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCallbackQuery({ text: "Ок" });
    await markPmStarted(ctx.from);

    ctx.session.mode = null;
    await q(
      `UPDATE players
       SET avatar_file_id=NULL, pm_last_seen=NOW(), updated_at=NOW()
       WHERE tg_id=$1`,
      [ctx.from.id]
    );

    return sendProfileMenu(ctx);
  });

  bot.callbackQuery("p:name_set", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCallbackQuery();
    await markPmStarted(ctx.from);

    ctx.session.mode = "await_name";
    const text =
      `✏️ Смена имени\n\n` +
      `Напиши новое отображаемое имя (2–24 символа).\n\n` +
      `После отправки верну тебя в «Профиль».`;
    return showScreen(ctx, text, cancelKb("m:profile"));
  });

  // ---------- message handlers ----------
  bot.on("message:photo", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    if (ctx.session.mode !== "await_avatar") return;

    await markPmStarted(ctx.from);

    const photos = ctx.message.photo || [];
    const best = photos[photos.length - 1];
    const fileId = best?.file_id;
    if (!fileId) {
      ctx.session.mode = null;
      return showScreen(ctx, "Не смог прочитать фото. Попробуй ещё раз.", cancelKb("m:profile"));
    }

    // UPSERT на всякий случай (если записи игрока почему-то ещё нет)
    await q(
      `
      INSERT INTO players (tg_id, first_name, last_name, username, player_kind,
                           avatar_file_id, pm_started, pm_started_at, pm_last_seen, updated_at)
      VALUES ($1,$2,$3,$4,'tg',$5, TRUE, NOW(), NOW(), NOW())
      ON CONFLICT (tg_id)
      DO UPDATE SET
        avatar_file_id = EXCLUDED.avatar_file_id,
        pm_last_seen   = NOW(),
        updated_at     = NOW()
      `,
      [ctx.from.id, ctx.from.first_name || "", ctx.from.last_name || "", ctx.from.username || "", fileId]
    );

    ctx.session.mode = null;
    return sendProfileMenu(ctx);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await markPmStarted(ctx.from);

    const text = (ctx.message.text || "").trim();

    // если ждём имя — обрабатываем
    if (ctx.session.mode === "await_name") {
      const name = text;
      if (name.length < 2 || name.length > 24) {
        return showScreen(
          ctx,
          "Имя должно быть 2–24 символа. Напиши ещё раз:",
          cancelKb("m:profile")
        );
      }

      await q(
        `UPDATE players
         SET display_name=$2, pm_last_seen=NOW(), updated_at=NOW()
         WHERE tg_id=$1`,
        [ctx.from.id, name]
      );

      ctx.session.mode = null;
      return sendProfileMenu(ctx);
    }

    // если не в режиме ввода — не плодим ответы: просто показываем меню/профиль
    // (люди часто пишут “привет” или “меню” — пусть это ведёт в меню)
    if (/^(меню|menu|start|профиль|profile)$/i.test(text)) {
      ctx.session.mode = null;
      if (/профиль|profile/i.test(text)) return sendProfileMenu(ctx);
      return sendMainMenu(ctx);
    }
  });

  return bot;
}
