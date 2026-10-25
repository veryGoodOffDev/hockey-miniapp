function isCombining(cp) {
  // combining marks (0 width)
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x200d ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff)
  );
}

function isWide(cp) {
  // emoji + wide east asian (2 cells)
  if (
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji blocks
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff) || // misc symbols
    (cp >= 0x1100 && cp <= 0x115f) || // hangul jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // cjk
    (cp >= 0xac00 && cp <= 0xd7a3) || // hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // cjk compat
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  )
    return true;
  return false;
}

export function strWidth(s) {
  const x = String(s ?? "");
  let w = 0;
  for (const ch of x) {
    const cp = ch.codePointAt(0);
    if (!cp) continue;
    if (isCombining(cp)) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

export function clipW(s, maxCells) {
  const x = String(s ?? "");
  if (strWidth(x) <= maxCells) return x;

  const ell = "…";
  const target = Math.max(0, maxCells - 1); // "…" считаем за 1 ячейку
  let w = 0;
  let out = "";

  for (const ch of x) {
    const cp = ch.codePointAt(0);
    if (!cp) continue;
    const cw = isCombining(cp) ? 0 : isWide(cp) ? 2 : 1;
    if (w + cw > target) break;
    out += ch;
    w += cw;
  }
  return out + ell;
}

export function padRightW(s, targetCells) {
  const x = String(s ?? "");
  const w = strWidth(x);
  return x + " ".repeat(Math.max(0, targetCells - w));
}

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const GROUPS = [
  ["G", "🥅 Вратари"],
  ["D", "🛡 Защитники"],
  ["F", "🏒 Нападающие"],
];
export function playerName(player) {
  return String(
    player.display_name?.trim() ||
      player.first_name?.trim() ||
      (player.username ? `@${player.username}` : (player.tg_id ?? "—")),
  ).replace(/\s+/gu, " ");
}
function numberSuffix(player) {
  return player.jersey_number == null || player.jersey_number === ""
    ? ""
    : ` №${String(player.jersey_number).replace(/\s+/gu, " ")}`;
}
export function groupTeam(players) {
  const groups = { G: [], D: [], F: [] };
  for (const player of players) {
    const position = String(player.position || "F").toUpperCase();
    groups[position === "G" || position === "D" ? position : "F"].push(player);
  }
  for (const group of Object.values(groups))
    group.sort(
      (a, b) =>
        playerName(a).localeCompare(playerName(b), "ru") ||
        String(a.tg_id).localeCompare(String(b.tg_id)),
    );
  return groups;
}
function columnPlayer(player, width) {
  if (!player) return "—";
  const suffix = clipW(numberSuffix(player), Math.max(0, width - 2));
  return clipW(playerName(player), width - strWidth(suffix)) + suffix;
}
export function renderTeamsTwoColsHtml(teamA, teamB) {
  const a = groupTeam(teamA),
    b = groupTeam(teamB),
    width = 16,
    gap = "  ";
  const rows = [
    ["⬜ Белые", "🟦 Синие"],
    ["", ""],
  ];
  for (const [position, title] of GROUPS) {
    rows.push([title, title]);
    for (
      let i = 0;
      i < Math.max(1, a[position].length, b[position].length);
      i++
    )
      rows.push([
        columnPlayer(a[position][i], width),
        columnPlayer(b[position][i], width),
      ]);
    rows.push(["", ""]);
  }
  while (rows.length && !rows.at(-1)[0] && !rows.at(-1)[1]) rows.pop();
  return `<pre>${rows.map(([left, right]) => escapeHtml((padRightW(clipW(left, width), width) + gap + clipW(right, width)).trimEnd())).join("\n")}</pre>`;
}
export function renderTeamPhotoCaption({ title, players, when, location }) {
  const grouped = groupTeam(players);
  const header = `<b>${escapeHtml(title)} · ${players.length}</b>\n⏱ <code>${escapeHtml(when)}</code>\n📍 ${escapeHtml(location || "—")}`;
  return (
    header +
    "\n\n" +
    GROUPS.map(
      ([position, label]) =>
        `${label}\n${grouped[position].length ? grouped[position].map((p) => `• ${escapeHtml(playerName(p))}${escapeHtml(numberSuffix(p))}`).join("\n") : "—"}`,
    ).join("\n\n")
  );
}
export function telegramTextLength(html) {
  return html.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot);/g, "x")
    .length;
}
export function withChangeNote(text, changed, stale) {
  return (
    text +
    (changed ? "\n\n<b>🔄 Составы изменены после публикации.</b>" : "") +
    (stale ? "\n<b>⚠️ Отметки менялись после формирования.</b>" : "")
  );
}
export function makeTeamPostParts(
  context,
  { format, when, frontendUrl, botUsername },
) {
  const replyMarkup = botUsername
    ? {
        inline_keyboard: [
          [
            {
              text: "📋 Открыть составы",
              url: `https://t.me/${botUsername}?startapp=teams_${context.game.id}`,
            },
          ],
        ],
      }
    : { inline_keyboard: [] };
  if (format === "columns")
    return [
      {
        part: "table",
        mediaType: "text",
        replyMarkup,
        text: `<b>🏒 Составы на игру</b>\n⏱ <code>${escapeHtml(when)}</code>\n📍 <b>${escapeHtml(context.game.location || "—")}</b>\n\n${renderTeamsTwoColsHtml(context.teamA, context.teamB)}`,
      },
    ];
  let base;
  try {
    base = new URL(frontendUrl);
    if (!["http:", "https:"].includes(base.protocol))
      throw new Error("bad protocol");
  } catch {
    throw Object.assign(new Error("jersey_images_not_configured"), {
      status: 400,
    });
  }
  return [
    ["white", "⬜ Белые", context.teamA],
    ["blue", "🟦 Синие", context.teamB],
  ].map(([part, title, players]) => ({
    part,
    mediaType: "photo",
    photoUrl: new URL(`/jersey-${part}.jpg`, base).href,
    replyMarkup,
    text: renderTeamPhotoCaption({
      title,
      players,
      when,
      location: context.game.location,
    }),
  }));
}
