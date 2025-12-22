import { Bot, InlineKeyboard } from "grammy";
import { getSetting, upsertSetting, q } from "./db.js";

export function createBot() {
  const bot = new Bot(process.env.BOT_TOKEN);

  const adminIds = new Set(
    (process.env.ADMIN_IDS || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  );

  function isAdmin(ctx) {
    return adminIds.has(String(ctx.from?.id));
  }

function appKeyboard(bot, chatType) {
  const webAppUrl = process.env.WEB_APP_URL || process.env.WEBAPP_URL;

  if (chatType === "private") {
    if (!webAppUrl) return undefined;
    return new InlineKeyboard().webApp("Открыть мини-приложение", webAppUrl);
  }

  // В группе web_app нельзя → даём direct link
  const username = bot.botInfo?.username || process.env.BOT_USERNAME;
  const deepLink = username ? `https://t.me/${username}?startapp` : null;

  const url = deepLink || webAppUrl;
  if (!url) return undefined;

  return new InlineKeyboard().url("Открыть мини-приложение", url);
}

  bot.command("start", async (ctx) => {
    const kb = appKeyboard(ctx);
    await ctx.reply( "Привет! Здесь отмечаемся на хоккей и собираем составы.\n\nКоманды лучше смотреть через мини-приложение.", kb ? { reply_markup: kb } : undefined);
  });

  bot.command("app", async (ctx) => {
    const kb = appKeyboard(ctx);
    await ctx.reply("Открой мини-приложение:", kb ? { reply_markup: kb } : undefined);
  });

  bot.command("setchat", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("Только для админа.");
    if (!ctx.chat?.id) return;

    await upsertSetting("announce_chat_id", ctx.chat.id);
    await ctx.reply("Ок, этот чат назначен для уведомлений и публикации составов.");
  });

  bot.command("setgame", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("Только для админа.");
    const text = ctx.message?.text || "";
    const args = text.split(" ").slice(1);
    // формат: /setgame 2025-12-27T19:00 ArenaName
    const iso = args[0];
    const location = args.slice(1).join(" ") || "";
    if (!iso) return ctx.reply("Формат: /setgame 2025-12-27T19:00 Arena");

    const startsAt = new Date(iso);
    if (isNaN(startsAt.getTime())) return ctx.reply("Не понял дату. Пример: 2025-12-27T19:00");

    const r = await q(
      `INSERT INTO games(starts_at, location, created_by)
       VALUES($1,$2,$3)
       RETURNING id`,
      [startsAt.toISOString(), location, ctx.from.id]
    );
    await ctx.reply(`Игра создана (id=${r.rows[0].id}). Открыть мини-приложение для отметок:`, {
      reply_markup: webappKeyboard()
    });
  });

  bot.command("teams", async (ctx) => {
    const game = await q(`SELECT id, starts_at, location FROM games ORDER BY starts_at DESC LIMIT 1`);
    const g = game.rows[0];
    if (!g) return ctx.reply("Нет созданной игры. Админ: /setgame ...");

    const t = await q(`SELECT team_a, team_b, meta FROM teams WHERE game_id=$1`, [g.id]);
    if (!t.rows[0]) return ctx.reply("Составы ещё не сформированы.");

    const msg = formatTeamsMessage(g, t.rows[0]);
    await ctx.reply(msg);
  });

  bot.on("message", async (ctx) => {
    // мягко подсказываем
    if (ctx.chat.type !== "private") return;
    if (!ctx.message?.text?.startsWith("/")) {
      const kb = appKeyboard(bot, ctx.chat.type);
      await ctx.reply("Открой мини-приложение:", kb ? { reply_markup: kb } : undefined);
    }
  });
bot.catch((err) => console.error("BOT_ERROR:", err));

  return bot;
}

export function formatTeamsMessage(game, teamsRow) {
  const a = teamsRow.team_a || [];
  const b = teamsRow.team_b || [];
  const m = teamsRow.meta || {};
  const when = new Date(game.starts_at).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

  const list = (arr) => arr
    .map(p => `• ${name(p)} (${p.position}, ${p.rating.toFixed(1)})`)
    .join("\n");

  return [
    `🏒 Составы на игру`,
    `${when} — ${game.location || ""}`.trim(),
    ``,
    `🟥 Команда A (Σ ${Number(m.sumA||0).toFixed(1)})`,
    list(a),
    ``,
    `🟦 Команда B (Σ ${Number(m.sumB||0).toFixed(1)})`,
    list(b),
    ``,
    `Баланс: разница ≈ ${Number(m.diff||0).toFixed(1)} | D: ${m.dA}-${m.dB} | G: ${m.gA}-${m.gB}`
  ].join("\n");
}

function name(p) {
  return p.first_name || p.username || String(p.tg_id);
}
