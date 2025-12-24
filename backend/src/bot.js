import { Bot, InlineKeyboard } from "grammy";
import { q } from "./db.js";

function adminIds() {
  return (process.env.ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
}
function isAdmin(id) {
  return adminIds().includes(String(id));
}

export function createBot() {
  const bot = new Bot(process.env.BOT_TOKEN);

  const webAppUrl = process.env.WEB_APP_URL;

  bot.command("start", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      return ctx.reply("Напиши мне в личку /start — там будет кнопка мини-приложения.");
    }
    if (!webAppUrl) return ctx.reply("WEB_APP_URL не задан на backend (Render env).");

    const kb = new InlineKeyboard().webApp("Открыть мини-приложение", webAppUrl);
    return ctx.reply("Открой мини-приложение:", { reply_markup: kb });
  });

  bot.command("app", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      return ctx.reply("Мини-приложение открывается из лички с ботом.");
    }
    if (!webAppUrl) return ctx.reply("WEB_APP_URL не задан на backend (Render env).");
    const kb = new InlineKeyboard().webApp("Открыть мини-приложение", webAppUrl);
    return ctx.reply("Открой мини-приложение:", { reply_markup: kb });
  });

  bot.command("id", async (ctx) => {
    return ctx.reply(`Ваш tg_id: ${ctx.from?.id}`);
  });

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

    if (!iso || !location) {
      return ctx.reply("Формат: /setgame 2025-12-27T19:00:00+03:00 Арена");
    }

    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return ctx.reply("Неверная дата. Пример: 2025-12-27T19:00:00+03:00");
    }

    const r = await q(
      `INSERT INTO games(starts_at, location, status)
       VALUES($1,$2,'scheduled')
       RETURNING id`,
      [d.toISOString(), location]
    );

    return ctx.reply(`Игра создана (id=${r.rows[0].id}). Открой мини-приложение и выбери игру в списке.`);
  });

  return bot;
}
