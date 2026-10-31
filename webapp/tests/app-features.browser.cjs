// Full UI with a local API mock. Never calls a live bot or production database.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets",
    ],
  });
  const errors = [],
    requests = [],
    patches = [];
  let flags = { chat: true, game_comments: true, air_hockey: true },
    failSave = false;
  const person = {
    tg_id: 1,
    display_name: "Иван",
    position: "F",
    status: "yes",
  };
  const game = {
    id: 12,
    status: "scheduled",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    location: "Арена",
    my_status: "yes",
    yes_count: 1,
    comments_count: 2,
  };
  async function open(admin, start = "") {
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((start) => {
      window.Telegram = {
        WebApp: {
          initData: "LOCAL_TEST",
          initDataUnsafe: {
            user: { id: 1, first_name: "Иван" },
            start_param: start,
          },
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
    }, start);
    await page.route("https://telegram.org/**", (r) =>
      r.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await page.route("**/api/**", async (r) => {
      const path = new URL(r.request().url()).pathname;
      requests.push({ page, path });
      let body = {
        ok: true,
        messages: [],
        conversations: [],
        comments: [],
        players: [person],
        items: [],
        reactions: [],
        unread_total: 0,
      };
      if (path === "/api/me")
        body = {
          ok: true,
          player: person,
          is_admin: admin,
          features: { ...flags },
        };
      if (path === "/api/features") body = { ok: true, features: { ...flags } };
      if (path === "/api/admin/features") {
        const patch = r.request().postDataJSON();
        patches.push(patch);
        if (failSave)
          return r.fulfill({
            status: 503,
            json: { ok: false, reason: "features_unavailable" },
          });
        flags = { ...flags, ...patch };
        body = { ok: true, features: { ...flags } };
      }
      if (path === "/api/games") body = { ok: true, games: [game], total: 1 };
      if (path === "/api/game")
        body = {
          ok: true,
          game,
          rsvps: [person],
          teams: null,
          vote_results: [],
        };
      if (path === "/api/game/profile") body = { ok: true, sheepCoins: 0 };
      return r.fulfill({ json: body });
    });
    await page.goto(process.argv[2] || "http://localhost:4174/", {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".bottomNav").waitFor();
    if (!start) await page.locator(".gameCard__main").first().waitFor();
    return page;
  }
  const nav = (p, name) =>
    p
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  const settings = async (p) => {
    await nav(p, "Админ");
    await p.getByRole("button", { name: "Функции", exact: true }).click();
    await p.getByRole("switch", { name: "Чат приложения" }).waitFor();
    await p.waitForFunction(
      () => !document.querySelector('[role="switch"]').disabled,
    );
  };
  const count = (p) =>
    requests.filter(
      (r) =>
        r.page === p &&
        (/^\/api\/chat\//.test(r.path) || r.path === "/api/game-comments"),
    ).length;
  try {
    const page = await open(true);
    assert.equal(await page.locator(".chatFab").count(), 1);
    await page.locator(".gameCard__main").click();
    await page
      .getByRole("heading", { name: "💬 Комментарии", exact: true })
      .waitFor();
    await nav(page, "Профиль");
    await page.locator(".airProfileCard").waitFor();
    await settings(page);
    for (const name of [
      "Чат приложения",
      "Комментарии к играм",
      "Air Hockey в профиле",
    ]) {
      const toggle = page.getByRole("switch", { name, exact: true });
      assert.equal(await toggle.getAttribute("aria-checked"), "true");
      await toggle.click();
      await page.waitForFunction(
        (name) =>
          document
            .querySelector(`[role="switch"][aria-label="${name}"]`)
            .getAttribute("aria-checked") === "false",
        name,
      );
    }
    assert.deepEqual(patches, [
      { chat: false },
      { game_comments: false },
      { air_hockey: false },
    ]);
    assert.equal(await page.locator(".chatFab").count(), 0);
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    await page.screenshot({ path: "/tmp/app-features.png", fullPage: true });
    await nav(page, "Профиль");
    assert.equal(await page.locator(".airProfileCard").count(), 0);
    await nav(page, "Игры");
    await page.locator(".gameCard__main").first().click();
    assert.equal(
      await page
        .getByRole("heading", { name: "💬 Комментарии", exact: true })
        .count(),
      0,
    );
    const before = count(page);
    await page.waitForTimeout(11000);
    assert.equal(
      count(page),
      before,
      "disabled chat/comments must stop polling",
    );
    const player = await open(false, "game_12_comments");
    assert.equal(
      await player
        .getByRole("navigation")
        .getByRole("button", { name: "Админ", exact: true })
        .count(),
      0,
    );
    assert.equal(await player.locator(".chatFab").count(), 0);
    assert.equal(
      await player
        .getByRole("heading", { name: "💬 Комментарии", exact: true })
        .count(),
      0,
    );
    await nav(player, "Профиль");
    assert.equal(await player.locator(".airProfileCard").count(), 0);
    const invitedPlayer = await open(false, "airhockey_1234");
    await invitedPlayer.locator(".gameCard__main").first().waitFor();
    assert.equal(await invitedPlayer.locator(".airScreen").count(), 0);
    assert.equal(
      requests.filter(
        (r) =>
          r.page === invitedPlayer &&
          r.path === "/api/game/air-hockey/pvp/ticket",
      ).length,
      0,
    );
    await invitedPlayer.close();
    // A failed save leaves the actual switch position unchanged and can be retried.
    await settings(page);
    failSave = true;
    await page
      .getByRole("switch", { name: "Чат приложения", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Не удалось сохранить" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("switch", { name: "Чат приложения" })
        .getAttribute("aria-checked"),
      "false",
    );
    failSave = false;
    for (const name of [
      "Чат приложения",
      "Комментарии к играм",
      "Air Hockey в профиле",
    ]) {
      await page.getByRole("switch", { name, exact: true }).click();
      await page.waitForFunction(
        (name) =>
          document
            .querySelector(`[role="switch"][aria-label="${name}"]`)
            .getAttribute("aria-checked") === "true",
        name,
      );
    }
    assert.equal(await page.locator(".chatFab").count(), 1);
    await nav(page, "Игры");
    await page.locator(".gameCard__main").first().click();
    await page
      .getByRole("heading", { name: "💬 Комментарии", exact: true })
      .waitFor();
    await nav(page, "Профиль");
    await page.locator(".airProfileCard").waitFor();
    // Other open devices pick up settings on focus, without reloading the app.
    await player.evaluate(() => window.dispatchEvent(new Event("focus")));
    await player.locator(".airProfileCard").waitFor();
    await player.locator(".chatFab").waitFor();
    await player.locator(".chatFab").click();
    await player.locator(".chatDrawer").waitFor();
    flags = { ...flags, chat: false };
    await player.evaluate(() => window.dispatchEvent(new Event("focus")));
    await player.waitForFunction(
      () =>
        !document.querySelector(".chatDrawer") &&
        !document.querySelector(".chatFab"),
    );
    assert.deepEqual(errors, []);
    console.log(
      "Feature switches: admin permissions, save failure/retry, visibility, polling cleanup, mobile widths, cross-device restore and focus updates passed",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
