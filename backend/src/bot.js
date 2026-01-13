import { Bot, InlineKeyboard, session } from "grammy";
import { q } from "./db.js";

function adminIds() {
  return (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function isAdmin(id) {
  return adminIds().includes(String(id));
}

export function createBot() {
  const bot = new Bot(process.env.BOT_TOKEN);
  const webAppUrl = process.env.WEB_APP_URL;

  // для ожидания фото/имени
  bot.use(session({ initial: () => ({ mode: null }) }));

  function profileKb() {
    const kb = new InlineKeyboard()
      .text("📸 Установить аватар", "p:avatar_set")
      .row()
      .text("🗑 Удалить аватар", "p:avatar_del")
      .row()
      .text("✏️ Изменить имя", "p:name_set");

    if (webAppUrl) kb.row().webApp("🏒 Открыть мини-приложение", webAppUrl);
    return kb;
  }

  async function markPmStarted(from) {
    // фиксируем, что человек реально открыл личку и нажал Start
    await q(
      `
      INSERT INTO players (tg_id, first_name, last_name, username, player_kind, pm_started, pm_started_at, pm_last_seen, updated_at)
      VALUES ($1,$2,$3,$4,'tg', TRUE, NOW(), NOW(), NOW())
      ON CONFLICT (tg_id)
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name  = EXCLUDED.last_name,
        username   = EXCLUDED.username,
        pm_started = TRUE,
        pm_started_at = COALESCE(players.pm_started_at, NOW()),
        pm_last_seen  = NOW(),
        updated_at = NOW()
      `,
      [from.id, from.first_name || "", from.last_name || "", from.username || ""]
    );
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

    return ctx.reply(text, { reply_markup: profileKb() });
  }

  // ===== команды =====
  bot.command("start", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      return ctx.reply("Напиши мне в личку /start — там меню профиля и кнопка мини-приложения.");
    }

    await markPmStarted(ctx.from);
    ctx.session.mode = null;

    if (!webAppUrl) {
      await ctx.reply("⚠️ WEB_APP_URL не задан на backend (Render env). Кнопка мини-приложения не появится.");
    }

    return sendProfileMenu(ctx);
  });

  bot.command("app", async (ctx) => {
    if (ctx.chat?.type !== "private") return ctx.reply("Мини-приложение открывается из лички с ботом.");
    if (!webAppUrl) return ctx.reply("WEB_APP_URL не задан на backend (Render env).");
    const kb = new InlineKeyboard().webApp("Открыть мини-приложение", webAppUrl);
    return ctx.reply("Открой мини-приложение:", { reply_markup: kb });
  });

  bot.command("profile", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await markPmStarted(ctx.from);
    ctx.session.mode = null;
    return sendProfileMenu(ctx);
  });

  bot.command("cancel", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    ctx.session.mode = null;
    return ctx.reply("Ок, отменил.", { reply_markup: profileKb() });
  });

  bot.command("id", async (ctx) => ctx.reply(`Ваш tg_id: ${ctx.from?.id}`));

  bot.command("setchat", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid || !isAdmin(uid)) return ctx.reply("Только для админа.");

    await q(
      `INSERT INTO settings(key, value) VALUES('notify_chat_id', $1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [String(ctx.chat.id)]
    );

    return ctx.reply("Всем привет, этот чат назначен для уведомлений и публикации составов.");
  });

  bot.command("setgame", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid || !isAdmin(uid)) return ctx.reply("Только для админа.");

    const text = (ctx.message?.text || "").trim();
    const args = text.split(" ").slice(1);
    const iso = args[0];
    const location = args.slice(1).join(" ").trim();

    if (!iso || !location) return ctx.reply("Формат: /setgame 2025-12-27T19:00:00+03:00 Арена");

    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return ctx.reply("Неверная дата. Пример: 2025-12-27T19:00:00+03:00");

    const r = await q(
      `INSERT INTO games(starts_at, location, status) VALUES($1,$2,'scheduled') RETURNING id`,
      [d.toISOString(), location]
    );

    return ctx.reply(`Игра создана (id=${r.rows[0].id}). Открой мини-приложение и выбери игру в списке.`);
  });

  // ===== кнопки меню =====
  bot.callbackQuery("p:avatar_set", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    ctx.session.mode = "await_avatar";
    await ctx.answerCallbackQuery();
    return ctx.reply("Отправь фото (как Фото) — поставлю его аватаркой.\n\n/cancel — отмена");
  });

  bot.callbackQuery("p:avatar_del", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    ctx.session.mode = null;

    // ✅ ВОТ СЮДА (МЕСТО A): удалить TG-аватар, НО НЕ трогать photo_url
    await q(
      `UPDATE players
       SET avatar_file_id=NULL, pm_last_seen=NOW(), updated_at=NOW()
       WHERE tg_id=$1`,
      [ctx.from.id]
    );

    await ctx.answerCallbackQuery({ text: "Аватар удалён" });
    return sendProfileMenu(ctx);
  });

  bot.callbackQuery("p:name_set", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    ctx.session.mode = "await_name";
    await ctx.answerCallbackQuery();
    return ctx.reply("Напиши новое отображаемое имя (2–24 символа).\n\n/cancel — отмена");
  });

  // ===== приём фото =====
  bot.on("message:photo", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    if (ctx.session.mode !== "await_avatar") return;

    const photos = ctx.message.photo;
    const best = photos[photos.length - 1];
    const fileId = best.file_id;

    // ✅ ВОТ СЮДА (МЕСТО B): сохранить TG-аватар
    await q(
      `UPDATE players
       SET avatar_file_id=$2, pm_last_seen=NOW(), updated_at=NOW()
       WHERE tg_id=$1`,
      [ctx.from.id, fileId]
    );

    ctx.session.mode = null;
    await ctx.reply("✅ Готово! Аватар обновлён.");
    return sendProfileMenu(ctx);
  });

  // ===== приём имени =====
  bot.on("message:text", async (ctx) => {
    if (ctx.chat?.type !== "private") return;

    if (ctx.session.mode !== "await_name") return;

    const name = (ctx.message.text || "").trim();
    if (name.length < 2 || name.length > 24) {
      return ctx.reply("Имя должно быть 2–24 символа. Попробуй ещё раз:");
    }

    await q(`UPDATE players SET display_name=$2, pm_last_seen=NOW(), updated_at=NOW() WHERE tg_id=$1`, [
      ctx.from.id,
      name,
    ]);

    ctx.session.mode = null;
    await ctx.reply(`✅ Отлично! Теперь ты: ${name}`);
    return sendProfileMenu(ctx);
  });

  return bot;
}
