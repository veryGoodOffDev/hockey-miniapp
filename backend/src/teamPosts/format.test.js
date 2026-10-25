import test from "node:test";
import assert from "node:assert/strict";
import {
  renderTeamsTwoColsHtml,
  strWidth,
  renderTeamPhotoCaption,
  makeTeamPostParts,
  telegramTextLength,
} from "./format.js";
const p = (tg_id, position, display_name = "Игрок", jersey_number = tg_id) => ({
  tg_id,
  position,
  display_name,
  jersey_number,
});
test("each position starts on the same row, with dashes for missing players in either team", () => {
  const a = [p(1, "G"), p(2, "D"), p(3, "D"), p(4, "D"), p(5, "D"), p(6, "F")];
  const b = [
    p(7, "G"),
    p(8, "G"),
    p(9, "D"),
    p(10, "D"),
    p(11, "D"),
    p(12, "F"),
    p(13, "F"),
  ];
  const rows = renderTeamsTwoColsHtml(a, b)
    .replace(/<\/?pre>/g, "")
    .split("\n");
  for (const title of ["Вратари", "Защитники", "Нападающие"])
    assert.equal(
      rows.filter(
        (row) =>
          row.includes(title) && row.lastIndexOf(title) !== row.indexOf(title),
      ).length,
      1,
    );
  const d = rows.findIndex((row) => row.includes("Защитники"));
  assert.match(rows[d + 4], /—$/);
  assert.match(
    rows[rows.findIndex((row) => row.includes("Вратари")) + 2],
    /^—\s+/,
  );
  assert.ok(rows.every((row) => strWidth(row) <= 34));
  const f = rows.findIndex((row) => row.includes("Нападающие"));
  assert.match(rows[f + 2], /^—\s+/);
});
test("long names preserve jersey numbers; whitespace and HTML cannot break the table or captions", () => {
  const name = "ОченьДлинноеИмяИгрокаБезПробелов<&>\nНоваяСтрока";
  const table = renderTeamsTwoColsHtml([p(1, "D", name, 99)], []);
  assert.match(table, /… №99/);
  assert.equal(table.includes("НоваяСтрока"), false);
  const caption = renderTeamPhotoCaption({
    title: "Белые",
    players: [p(1, "D", "А<Б>&\nВ", 0)],
    when: "25.10",
    location: "Лёд <центр>",
  });
  assert.match(caption, /А&lt;Б&gt;&amp; В №0/);
  assert.match(caption, /Лёд &lt;центр&gt;/);
  assert.equal(telegramTextLength("<b>&amp;&lt;&gt;&quot;</b>"), 4);
});
test("empty groups, unknown positions, Unicode and sorting are safe without mutating inputs", () => {
  const players = [
      p(1, "X", "😀 Игрок"),
      p(2, "D", "Борис"),
      p(3, "D", "Антон"),
    ],
    original = structuredClone(players);
  const caption = renderTeamPhotoCaption({
    title: "Синие",
    players,
    when: "—",
    location: "",
  });
  assert.match(caption, /Вратари\n—/);
  assert.ok(caption.indexOf("Антон") < caption.indexOf("Борис"));
  assert.match(caption, /Нападающие\n• 😀 Игрок/);
  assert.deepEqual(players, original);
  assert.match(renderTeamsTwoColsHtml([], []), /—/);
});
test("photo plans have separate team captions/images/buttons; legacy columns do not require image configuration", () => {
  const context = {
    game: { id: 12, location: "Арена" },
    teamA: [p(1, "G")],
    teamB: [p(2, "F")],
  };
  const photos = makeTeamPostParts(context, {
    format: "jerseys",
    when: "25.10",
    frontendUrl: "https://app.example/?v=1",
    botUsername: "HockeyBot",
  });
  assert.deepEqual(
    photos.map((part) => part.photoUrl),
    [
      "https://app.example/jersey-white.jpg",
      "https://app.example/jersey-blue.jpg",
    ],
  );
  assert.deepEqual(
    photos.map((part) => part.part),
    ["white", "blue"],
  );
  assert.match(photos[0].text, /Белые/);
  assert.match(photos[1].text, /Синие/);
  assert.equal(
    photos[0].replyMarkup.inline_keyboard[0][0].url,
    "https://t.me/HockeyBot?startapp=teams_12",
  );
  assert.throws(
    () =>
      makeTeamPostParts(context, {
        format: "jerseys",
        when: "25.10",
        frontendUrl: "",
      }),
    /jersey_images_not_configured/,
  );
  assert.equal(
    makeTeamPostParts(context, { format: "columns", when: "25.10" })[0].part,
    "table",
  );
});
