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

  // режим ожидания: await_avatar | await_name | null
  bot.use(session({ initial: () => ({ mode: null, owner_reply_to: null }) }));

  // ---------------- DB helpers ----------------
  async function markPmStarted(from) {
    await q(
      `
      INSERT INTO players (
        tg_id, first_name, last_name, username, player_kind,
        pm_started, pm_started_at, pm_last_seen, updated_at
      )
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
    // safe upsert (на случай если записи игрока ещё нет)
    await q(
      `
      INSERT INTO players (tg_id, player_kind, bot_menu_msg_id, updated_at)
      VALUES ($1,'tg',$2,NOW())
      ON CONFLICT (tg_id)
      DO UPDATE SET bot_menu_msg_id=EXCLUDED.bot_menu_msg_id, updated_at=NOW()
      `,
      [uid, mid]
    );
  }

  // ---------------- UI keyboards ----------------
  function mainMenuKb() {
    const kb = new InlineKeyboard()
      .text("👤 Профиль", "m:profile")
      .row();

    if (webAppUrl) kb.webApp("🏒 Открыть мини-приложение", webAppUrl).row();

    kb.text("ℹ️ Помощь", "m:help").row()
      .text("🔄 Перезапустить", "m:home").row()
      .text("💬 Написать админу", "m:to_owner");

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
      .text("⬅️ Меню", "m:home");

    if (webAppUrl) kb.row().webApp("🏒 Открыть мини-приложение", webAppUrl);
    return kb;
  }

  function cancelKb(back = "m:profile") {
    return new InlineKeyboard().text("❌ Отмена", back).row().text("⬅️ Меню", "m:home");
  }

  // ---------------- “one message UI” core ----------------
  function isNotModifiedError(e) {
    const msg = String(e?.message || "").toLowerCase();
    return msg.includes("message is not modified");
  }

  async function safeDelete(chatId, mid) {
    if (!mid) return;
    try {
      await bot.api.deleteMessage(chatId, mid);
    } catch {}
  }

  async function editText(chatId, mid, text, kb) {
    try {
      await bot.api.editMessageText(chatId, mid, text, {
        reply_markup: kb,
        disable_web_page_preview: true,
      });
      return true;
    } catch (e) {
      if (isNotModifiedError(e)) return true;
      return false;
    }
  }

  async function editPhoto(chatId, mid, media, caption, kb) {
    try {
      await bot.api.editMessageMedia(
        chatId,
        mid,
        {
          type: "photo",
          media,         // file_id или URL
          caption,       // текст профиля
        },
        { reply_markup: kb }
      );
      return true;
    } catch (e) {
      if (isNotModifiedError(e)) return true;
      return false;
    }
  }

  async function sendText(chatId, text, kb) {
    return bot.api.sendMessage(chatId, text, {
      reply_markup: kb,
      disable_web_page_preview: true,
    });
  }

  async function sendPhoto(chatId, media, caption, kb) {
    return bot.api.sendPhoto(chatId, media, {
      caption,
      reply_markup: kb,
    });
  }

  /**
   * showScreen:
   * - стараемся редактировать текущее сообщение (если callback)
   * - иначе редактируем сохранённое bot_menu_msg_id
   * - если не получается (тип не тот / удалено / etc) — шлём новое и удаляем старое
   *
   * opts:
   * { text, kb }                     -> текстовый экран
   * { caption, kb, photo_media }     -> фото-экран (миниатюра) + caption
   */
  async function showScreen(ctx, opts) {
    if (ctx.chat?.type !== "private" || !ctx.from?.id) return;

    const chatId = ctx.chat.id;
    const uid = ctx.from.id;

    const wantPhoto = !!opts.photo_media;
    const text = opts.text || "";
    const caption = opts.caption || "";
    const kb = opts.kb;

    // target message id (prefer callback message)
    const cbMid = ctx.callbackQuery?.message?.message_id;
    const savedMid = await getMenuMsgId(uid);
    const targetMid = cbMid || savedMid;

    if (targetMid) {
      const ok = wantPhoto
        ? await editPhoto(chatId, targetMid, opts.photo_media, caption, kb)
        : await editText(chatId, targetMid, text, kb);

      if (ok) {
        await setMenuMsgId(uid, targetMid);
        return;
      }
    }

    // Не смогли отредактировать — создаём новое сообщение “экрана”
    const oldMid = targetMid;

    const msg = wantPhoto
      ? await sendPhoto(chatId, opts.photo_media, caption, kb)
      : await sendText(chatId, text, kb);

    await setMenuMsgId(uid, msg.message_id);

    // удаляем старое, чтобы не копилось
    if (oldMid && oldMid !== msg.message_id) {
      await safeDelete(chatId, oldMid);
    }
  }

  // ---------------- screens ----------------
  async function sendMainMenu(ctx) {
    const text =
      `🏒 Меню бота\n\n` +
      `• Профиль — имя и аватар\n` +
      `• Мини-приложение — игры и отметки\n\n` +
      `Нажми кнопку ниже 👇`;

    return showScreen(ctx, { text, kb: mainMenuKb() });
  }

  async function sendHelp(ctx) {
    const text =
      `ℹ️ Помощь\n\n` +
      `• Нажми «Профиль», чтобы сменить имя или аватар.\n` +
      `• «Открыть мини-приложение» — WebApp с играми.\n\n` +
      `Если что-то странное — жми «Перезапустить».`;

    const kb = new InlineKeyboard().text("⬅️ Меню", "m:home");
    return showScreen(ctx, { text, kb });
  }

  async function sendProfileMenu(ctx) {
    const r = await q(
      `
      SELECT
        COALESCE(NULLIF(display_name,''), NULLIF(first_name,''), NULLIF(username,''), 'Игрок') AS name,
        avatar_file_id,
        NULLIF(photo_url,'') AS photo_url
      FROM players
      WHERE tg_id=$1
      `,
      [ctx.from.id]
    );

    const row = r.rows?.[0] || { name: "Игрок", avatar_file_id: null, photo_url: "" };

    // чем показываем миниатюру:
    // 1) avatar_file_id (из бота) — идеально
    // 2) иначе попробуем photo_url (если это http/https) — опционально
    let media = null;
    if (row.avatar_file_id) media = row.avatar_file_id;
    else if (row.photo_url && /^https?:\/\//i.test(row.photo_url)) media = row.photo_url;

    const hasAvatar = !!row.avatar_file_id || !!media;

    const caption =
      `👤 Профиль игрока\n\n` +
      `Имя: ${row.name}\n` +
      `Аватар: ${hasAvatar ? "✅" : "— нет"}\n\n` +
      `Выбери действие:`;

    // Если есть медиа — показываем “миниатюру” фото + caption
    if (media) {
      return showScreen(ctx, { photo_media: media, caption, kb: profileKb() });
    }

    // Если аватара нет — обычный текстовый экран
    return showScreen(ctx, { text: caption, kb: profileKb() });
  }

  // ---------------- Telegram menu/commands ----------------
  bot.api
    .setMyCommands([
      { command: "menu", description: "Открыть меню" },
      { command: "profile", description: "Профиль (имя/аватар)" },
      { command: "app", description: "Открыть мини-приложение" },
      { command: "start", description: "Запуск/перезапуск" },
    ])
    .catch(() => {});

  bot.api
    .setChatMenuButton({
      menu_button: { type: "commands" },
    })
    .catch(() => {});

  // ---------------- commands ----------------
  bot.command(["start", "menu"], async (ctx) => {
    if (ctx.chat?.type !== "private") {
      return ctx.reply("Напиши мне в личку — там меню и кнопки.");
    }
    await markPmStarted(ctx.from);
    ctx.session.mode = null;
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
      return showScreen(ctx, { text: "⚠️ WEB_APP_URL не задан на backend. WebApp недоступен.", kb });
    }

    const kb = new InlineKeyboard()
      .webApp("🏒 Открыть мини-приложение", webAppUrl)
      .row()
      .text("⬅️ Меню", "m:home");

    // текстовый экран — без копления сообщений
    return showScreen(ctx, { text: "Открой мини-приложение:", kb });
  });

  bot.command("id", async (ctx) => ctx.reply(`Ваш tg_id: ${ctx.from?.id}`));

  // админ: назначить чат уведомлений
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

// ---------------- сообщение в личку только для разработчика ----------------
const OWNER_ID = Number(process.env.OWNER_TG_ID || 0);

bot.command("pm", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  if (!OWNER_ID || ctx.from?.id !== OWNER_ID) return ctx.reply("Недоступно.");

  const raw = (ctx.message?.text || "").trim();
  const parts = raw.split(" ");
  const toId = Number(parts[1]);
  const text = parts.slice(2).join(" ").trim();

  if (!Number.isFinite(toId) || !text) {
    return ctx.reply("Формат: /pm <tg_id> <текст>");
  }

  // проверим, что пользователь запускал бота
  const r = await q(`SELECT pm_started FROM players WHERE tg_id=$1`, [toId]);
  if (!r.rows?.[0]?.pm_started) {
    return ctx.reply("Пользователь ещё не нажимал Start у бота — написать нельзя.");
  }

  try {
    await bot.api.sendMessage(toId, text, { disable_web_page_preview: true });
    return ctx.reply("✅ Отправлено.");
  } catch (e) {
    return ctx.reply(`❌ Не отправилось (возможно, пользователь заблокировал бота).`);
  }
});


  // ---------------- callbacks: navigation ----------------
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

  // ---------------- callbacks: profile actions ----------------
  bot.callbackQuery("p:avatar_set", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCallbackQuery();
    await markPmStarted(ctx.from);

    ctx.session.mode = "await_avatar";

    const caption =
      `📸 Установка аватара\n\n` +
      `Отправь фото *как Фото* (не файлом).\n` +
      `После отправки я верну тебя в «Профиль».`;

    return showScreen(ctx, { text: caption, kb: cancelKb("m:profile") });
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
      `Напиши новое отображаемое имя (2–24 символа).\n` +
      `После отправки я верну тебя в «Профиль».`;

    return showScreen(ctx, { text, kb: cancelKb("m:profile") });
  });


  bot.callbackQuery("m:to_owner", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  await ctx.answerCallbackQuery();
  ctx.session.mode = "await_owner_msg";

  return showScreen(ctx, {
    text:
      "💬 Напиши сообщение админу.\n\n" +
      "Можешь отправить текст или фото. Я перешлю.\n\n" +
      "❌ Отмена — чтобы выйти.",
    kb: cancelKb("m:home"),
  });
});

  // ---------------- message handlers ----------------
// ===== relay: user -> owner, owner -> user (must be BEFORE other message handlers)
bot.on("message", async (ctx, next) => {
  if (ctx.chat?.type !== "private") return next();

  // --- пользователь пишет админу ---
  if (ctx.session.mode === "await_owner_msg") {
    ctx.session.mode = null;

    if (!OWNER_ID) {
      return showScreen(ctx, {
        text: "⚠️ OWNER_TG_ID не задан. Админ не настроен.",
        kb: new InlineKeyboard().text("⬅️ Меню", "m:home"),
      });
    }

    await markPmStarted(ctx.from);

    const u = ctx.from;
    const head =
      `📩 Сообщение админу\n` +
      `От: ${u.first_name || ""} ${u.last_name || ""}${u.username ? ` (@${u.username})` : ""}\n` +
      `tg_id: ${u.id}`;

    // кнопка “Ответить” администратору (тебе)
    const kb = new InlineKeyboard().text("↩️ Ответить", `o:reply:${u.id}`);

    try {
      await bot.api.sendMessage(OWNER_ID, head, { reply_markup: kb });
      await ctx.copyMessage(OWNER_ID); // ✅ копирует и текст, и фото, и что угодно
    } catch (e) {
      await bot.api.sendMessage(OWNER_ID, head + "\n\n❌ Не смог скопировать сообщение (см. логи).");
    }

    return showScreen(ctx, {
      text: "✅ Отправлено админу. Спасибо!",
      kb: new InlineKeyboard().text("⬅️ Меню", "m:home"),
    });
  }

  // --- админ отвечает выбранному пользователю ---
  if (ctx.from?.id === OWNER_ID && ctx.session.mode === "await_owner_reply" && ctx.session.owner_reply_to) {
    const toId = Number(ctx.session.owner_reply_to);
    ctx.session.mode = null;
    ctx.session.owner_reply_to = null;

    try {
      await ctx.copyMessage(toId); // ✅ отправляет пользователю то, что ты написал/прикрепил
      await showScreen(ctx, {
        text: "✅ Ответ отправлен игроку.",
        kb: new InlineKeyboard().text("⬅️ Меню", "m:home"),
      });
    } catch (e) {
      await showScreen(ctx, {
        text: "❌ Не смог отправить ответ. Возможно, пользователь не нажал Start или заблокировал бота.",
        kb: new InlineKeyboard().text("⬅️ Меню", "m:home"),
      });
    }
    return;
  }

  return next();
});


bot.callbackQuery(/^o:reply:(\d+)$/, async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  if (ctx.from?.id !== OWNER_ID) return;

  const toId = Number(ctx.match[1]);
  await ctx.answerCallbackQuery();

  // проверим, что пользователь стартовал бота (иначе ты не сможешь ему ответить)
  const r = await q(`SELECT pm_started FROM players WHERE tg_id=$1`, [toId]);
  if (!r.rows?.[0]?.pm_started) {
    return ctx.reply("❌ Пользователь ещё не нажимал Start у бота — ответить нельзя.");
  }

  ctx.session.mode = "await_owner_reply";
  ctx.session.owner_reply_to = toId;

  return showScreen(ctx, {
    text:
      `↩️ Режим ответа включён\n\n` +
      `Кому: tg_id ${toId}\n` +
      `Отправь текст или фото.\n\n` +
      `❌ Отмена — чтобы выйти.`,
    kb: cancelKb("m:home"),
  });
});


  bot.on("message:photo", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    if (ctx.session.mode !== "await_avatar") return;

    await markPmStarted(ctx.from);

    const photos = ctx.message.photo || [];
    const best = photos[photos.length - 1];
    const fileId = best?.file_id;

    if (!fileId) {
      ctx.session.mode = null;
      return showScreen(ctx, {
        text: "Не смог прочитать фото. Попробуй ещё раз.",
        kb: cancelKb("m:profile"),
      });
    }

    // UPSERT: сохраняем file_id как аватар
    await q(
      `
      INSERT INTO players (
        tg_id, first_name, last_name, username, player_kind,
        avatar_file_id, pm_started, pm_started_at, pm_last_seen, updated_at
      )
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

  bot.on("message", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  if (!OWNER_ID) return;

  if (ctx.session.mode !== "await_owner_msg") return;

  // выходим из режима после отправки
  ctx.session.mode = null;

  const u = ctx.from;
  const head =
    `📩 Сообщение админу\n` +
    `От: ${u.first_name || ""} ${u.last_name || ""}` +
    `${u.username ? ` (@${u.username})` : ""}\n` +
    `tg_id: ${u.id}`;

  // 1) шапка
  await bot.api.sendMessage(OWNER_ID, head);

  // 2) копируем само сообщение (текст/фото/док и т.д.)
  try {
    await ctx.copyMessage(OWNER_ID);
  } catch {
    // fallback только текстом
    const t = ctx.message?.text ? String(ctx.message.text) : "[не удалось скопировать сообщение]";
    await bot.api.sendMessage(OWNER_ID, t);
  }

  // подтверждение пользователю (без спама — редактируем экран)
  return showScreen(ctx, {
    text: "✅ Отправлено админу. Спасибо!",
    kb: new InlineKeyboard().text("⬅️ Меню", "m:home"),
  });
});


  bot.on("message:text", async (ctx) => {
    if (ctx.chat?.type !== "private") return;

    await markPmStarted(ctx.from);

    const t = (ctx.message.text || "").trim();

    if (ctx.session.mode === "await_name") {
      const name = t;
      if (name.length < 2 || name.length > 24) {
        return showScreen(ctx, {
          text: "Имя должно быть 2–24 символа. Напиши ещё раз:",
          kb: cancelKb("m:profile"),
        });
      }

      await q(
        `UPDATE players SET display_name=$2, pm_last_seen=NOW(), updated_at=NOW() WHERE tg_id=$1`,
        [ctx.from.id, name]
      );

      ctx.session.mode = null;
      return sendProfileMenu(ctx);
    }

    // если пользователь просто что-то написал — не плодим диалоги, покажем меню
    if (/^(меню|menu|start)$/i.test(t)) {
      ctx.session.mode = null;
      return sendMainMenu(ctx);
    }
    if (/^(профиль|profile)$/i.test(t)) {
      ctx.session.mode = null;
      return sendProfileMenu(ctx);
    }

    // по умолчанию — главное меню
    ctx.session.mode = null;
    return sendMainMenu(ctx);
  });

  return bot;
}
