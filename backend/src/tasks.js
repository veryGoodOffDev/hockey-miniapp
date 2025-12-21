import "dotenv/config";
import { initDb, q, getSetting } from "./db.js";
import { createBot, formatTeamsMessage } from "./bot.js";
import { makeTeams } from "./teamMaker.js";

const mode = process.argv[2]; // "tuesday" | "saturday"
if (!mode) {
  console.log("Usage: node src/tasks.js tuesday|saturday");
  process.exit(1);
}

await initDb();

const bot = createBot();
const chatId = await getSetting("announce_chat_id");

if (!chatId) {
  console.log("No announce_chat_id set. Run /setchat in your group chat as admin.");
  process.exit(0);
}

if (mode === "tuesday") {
  await bot.api.sendMessage(
    chatId,
    "⏰ Напоминание: отметься на ближайшую игру в мини-приложении!",
    {
      reply_markup: {
        inline_keyboard: [[{ text: "Открыть", web_app: { url: process.env.WEBAPP_URL } }]]
      }
    }
  );
  console.log("Tuesday reminder sent.");
  process.exit(0);
}

if (mode === "saturday") {
  // берем последнюю игру
  const gr = await q(`SELECT id, starts_at, location FROM games ORDER BY starts_at DESC LIMIT 1`);
  const game = gr.rows[0];
  if (!game) {
    console.log("No game found.");
    process.exit(0);
  }

  // берем YES игроков
  const pr = await q(`
    SELECT p.*
    FROM rsvps r
    JOIN players p ON p.tg_id = r.tg_id
    WHERE r.game_id = $1 AND r.status = 'yes'
  `, [game.id]);

  const players = pr.rows;
  if (players.length < 2) {
    await bot.api.sendMessage(chatId, "Недостаточно отметившихся для формирования составов.");
    process.exit(0);
  }

  const { teamA, teamB, meta } = makeTeams(players);

  await q(
    `INSERT INTO teams(game_id, team_a, team_b, meta)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(game_id) DO UPDATE SET team_a=EXCLUDED.team_a, team_b=EXCLUDED.team_b, meta=EXCLUDED.meta, generated_at=NOW()`,
    [game.id, JSON.stringify(teamA), JSON.stringify(teamB), JSON.stringify(meta)]
  );

  const msg = formatTeamsMessage(game, { team_a: teamA, team_b: teamB, meta });
  await bot.api.sendMessage(chatId, msg);
  console.log("Saturday teams generated and posted.");
  process.exit(0);
}

console.log("Unknown mode:", mode);
process.exit(1);
