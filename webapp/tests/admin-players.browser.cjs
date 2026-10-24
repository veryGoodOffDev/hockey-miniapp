// Full application, existing admin editor and API responses mocked locally.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");
(async () => {
  const { presentAdminPlayers, canViewPlayerBotStatus } = await import(
    pathToFileURL(
      resolve(__dirname, "../../backend/src/adminPlayerPresentation.js"),
    ).href
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets",
    ],
  });
  const errors = [],
    writes = [],
    responses = new Map();
  const stamp = new Date(Date.now() - 86400000).toISOString();
  const records = [
    {
      tg_id: 1,
      display_name: "Иван",
      username: "ivan",
      player_kind: "tg",
      position: "G",
      jersey_number: 50,
      is_admin: true,
      pm_started: true,
      pm_started_at: stamp,
      pm_last_seen: stamp,
      last_seen_at: stamp,
      avatar_file_id: "private-file",
      photo_url: "/original-photo.png",
    },
    {
      tg_id: 2,
      display_name: "Алексей",
      player_kind: "tg",
      position: "D",
      jersey_number: 15,
      pm_started: false,
      last_seen_at: stamp,
    },
    {
      tg_id: -1,
      display_name: "Ручной игрок",
      player_kind: "manual",
      position: "F",
      pm_started: false,
    },
    {
      tg_id: 4,
      display_name: "Борис",
      player_kind: "tg",
      position: "F",
      disabled: true,
      pm_started: true,
      pm_started_at: stamp,
      joke_premium_active: true,
    },
    {
      tg_id: 5,
      display_name: "ОченьДлинноеИмяИгрокаБезПробеловДляПроверкиПереноса",
      player_kind: "tg",
      position: "D",
      pm_started: false,
      photo_url: "/broken-avatar.png",
    },
  ];
  const game = {
    id: 12,
    status: "scheduled",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    location: "Арена",
    yes_count: 1,
  };
  async function open(userId) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 1000 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((id) => {
      window.Telegram = {
        WebApp: {
          initData: `TEST_${id}`,
          initDataUnsafe: { user: { id, first_name: "Админ" } },
          ready() {},
          expand() {},
          onEvent() {},
          offEvent() {},
          setHeaderColor() {},
          setBackgroundColor() {},
          setBottomBarColor() {},
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        },
      };
    }, userId);
    await page.route("https://telegram.org/**", (r) =>
      r.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await page.route("**/broken-avatar.png", (r) =>
      r.fulfill({ status: 404, body: "" }),
    );
    await page.route("**/api/**", async (r) => {
      const path = new URL(r.request().url()).pathname;
      if (r.request().method() !== "GET")
        writes.push({ path, body: r.request().postDataJSON() });
      if (path === "/api/players/1/avatar")
        return r.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" fill="#2874aa"/><circle cx="26" cy="19" r="9" fill="#c5e5f8"/><path d="M9 51Q9 29 26 29Q43 29 43 51" fill="#c5e5f8"/></svg>',
        });
      let body = {
        ok: true,
        messages: [],
        conversations: [],
        comments: [],
        players: [],
        items: [],
        reactions: [],
        unread_total: 0,
        applications: [],
      };
      if (path === "/api/me")
        body = {
          ok: true,
          player: {
            tg_id: userId,
            display_name: "Админ",
            position: "G",
            rsvp_view: "list",
          },
          is_admin: true,
        };
      if (path === "/api/games") body = { ok: true, games: [game], total: 1 };
      if (path === "/api/game")
        body = {
          ok: true,
          game: { ...game, previous_game_award: null },
          rsvps: [],
          teams: null,
          vote_results: [],
        };
      if (path === "/api/game/profile") body = { ok: true, sheepCoins: 0 };
      if (path === "/api/admin/games/auto-schedule")
        body = {
          ok: true,
          cfg: { enabled: false, target_count: 12, weekday: 0, time: "07:45" },
        };
      if (path === "/api/admin/players") {
        const canView = canViewPlayerBotStatus(userId, "1");
        body = {
          ok: true,
          players: presentAdminPlayers(records, {
            envAdmins: new Set(["1", "10"]),
            canViewBotStatus: canView,
            avatarUrl: (p) =>
              p.avatar_file_id ? "/api/players/1/avatar" : p.photo_url || "",
          }),
          is_super_admin: true,
          can_view_bot_status: canView,
        };
        responses.set(userId, body);
      }
      if (path === "/api/admin/players/1" && r.request().method() === "PATCH") {
        const patch = r.request().postDataJSON();
        Object.assign(records[0], patch);
        body = { ok: true };
      }
      return r.fulfill({ json: body });
    });
    await page.goto(process.argv[2] || "http://localhost:4174/", {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("navigation", { name: "Навигация" })
      .getByRole("button", { name: "Админ", exact: true })
      .click();
    await page
      .locator(".segRow")
      .getByRole("button", { name: "Игроки", exact: true })
      .click();
    await page.locator(".adminPlayerCard").first().waitFor();
    return page;
  }
  const card = (page, name) =>
    page.getByRole("button", { name: `Открыть игрока: ${name}`, exact: true });
  try {
    const page = await open(1);
    await page.getByRole("group", { name: "Фильтр по запуску бота" }).waitFor();
    assert.equal(await page.locator(".adminPlayerCard").count(), 5);
    assert.match(
      await page.locator(".adminBotOverview__headline").innerText(),
      /1\s*\/\s*3/,
    );
    await card(page, "Иван").scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        document.querySelector(".adminPlayerCard__avatar img")?.naturalWidth >
        0,
    );
    assert.equal(
      await card(page, "Иван")
        .locator(".adminPlayerCard__avatar img")
        .getAttribute("src"),
      "/api/players/1/avatar",
    );
    assert.match(await card(page, "Иван").innerText(), /Запускал бота/);
    assert.match(await card(page, "Иван").innerText(), /Первый запуск:/);
    assert.match(
      await card(page, "Иван").innerText(),
      /Взаимодействие с ботом:/,
    );
    assert.match(
      await card(page, "Алексей").innerText(),
      /Запуск не подтверждён/,
    );
    assert.equal(
      await card(page, "Алексей")
        .locator(".adminPlayerCard__avatar img")
        .count(),
      0,
    );
    await card(page, records[4].display_name).scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          ".adminPlayerCard:last-child .adminPlayerCard__avatar img",
        ),
    );
    assert.match(await card(page, "Ручной игрок").innerText(), /Без Telegram/);
    assert.match(await card(page, "Борис").innerText(), /Отключён/);
    const filters = page.getByRole("group", { name: "Фильтр по запуску бота" });
    for (const [filter, count] of [
      ["Запускали", 2],
      ["Нет подтверждения", 2],
      ["Без Telegram", 1],
      ["Все", 5],
    ]) {
      await filters.getByRole("button", { name: filter, exact: true }).click();
      assert.equal(await page.locator(".adminPlayerCard").count(), count);
    }
    const search = page.getByPlaceholder("Поиск: имя / username / номер / id");
    await search.fill("50");
    assert.equal(await page.locator(".adminPlayerCard").count(), 1);
    assert.match(await page.locator(".adminPlayerCard").innerText(), /Иван/);
    await search.fill("");
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.locator(".adminBotOverview").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "/tmp/admin-players-owner.png",
      fullPage: true,
    });
    await card(page, "Иван").click();
    await page.getByText("Игрок: Иван #50", { exact: true }).waitFor();
    assert.equal(
      await page
        .locator('.sheetBody input[value="/original-photo.png"]')
        .count(),
      1,
    ); // Avatar proxy never becomes the editable photo URL.
    await page.locator(".sheetBody input").first().fill("Иван обновлённый");
    await page
      .locator(".sheetBody")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await card(page, "Иван обновлённый").waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "/api/admin/players/1");
    const other = await open(10);
    assert.equal(
      await other
        .locator(".adminBotOverview,.adminBotFilters,.adminPlayerCard__bot")
        .count(),
      0,
    );
    assert.equal(await other.locator(".adminPlayerCard").count(), 5);
    assert.equal(JSON.stringify(responses.get(10)).includes("bot_pm"), false);
    assert.equal(
      JSON.stringify(responses.get(10)).includes("pm_started"),
      false,
    );
    assert.equal(
      await card(other, "Иван обновлённый")
        .locator(".adminPlayerCard__avatar img")
        .count(),
      1,
    );
    await page.close();
    await other.close();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: owner-only launch statuses/dates/count/filter, search, avatars/fallbacks, mobile widths, original player editor/save, regular ENV admin gets cards without bot data. Mock API only; no real sends.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
