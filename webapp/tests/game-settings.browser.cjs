// Game administration UI, using only intercepted API requests and local assets.
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
    writes = [],
    alerts = [];
  let failGameSave = false,
    failGuestSave = false;
  let game = {
    id: 12,
    status: "scheduled",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    location: "Шуваловский лёд",
    my_status: "yes",
    yes_count: 2,
    postgame_enabled: false,
    geo_lat: 60.041,
    geo_lon: 30.25,
    notice_text: "Важное объявление",
    info_text: "Сбор за 20 минут",
    video_url: "",
  };
  let people = [
    {
      tg_id: 1,
      display_name: "Иван",
      jersey_number: 92,
      position: "F",
      status: "yes",
    },
    {
      tg_id: 2,
      display_name: "Алексей",
      jersey_number: 15,
      position: "D",
      status: "no",
    },
    {
      tg_id: -10,
      display_name: "Саша (гость)",
      position: "G",
      status: "yes",
      player_kind: "guest",
      skill: 5,
    },
  ];
  let reminders = [
    {
      id: 31,
      enabled: true,
      pin: true,
      remind_at: new Date(Date.now() + 3600000).toISOString(),
      sent_at: null,
    },
  ];
  const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", async (d) => {
    alerts.push(d.message());
    await d.accept();
  });
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        initData: "LOCAL_TEST",
        initDataUnsafe: { user: { id: 1, first_name: "Иван" } },
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
  });
  await page.route("https://telegram.org/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.route("**/*.tile.openstreetmap.org/**", (r) => r.abort());
  await page.route("https://nominatim.openstreetmap.org/**", (r) =>
    r.fulfill({ json: { display_name: "Арена" } }),
  );
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname,
      method = r.request().method();
    const payload =
      ["POST", "PATCH", "DELETE"].includes(method) && r.request().postData()
        ? r.request().postDataJSON()
        : null;
    if (method !== "GET") writes.push({ path, method, payload });
    let body = {
      ok: true,
      messages: [],
      conversations: [],
      comments: [],
      players: people,
      items: [],
      reactions: [],
      unread_total: 0,
    };
    if (path === "/api/me")
      body = {
        ok: true,
        player: people[0],
        is_admin: true,
        features: { chat: true, game_comments: true, air_hockey: true },
      };
    if (path === "/api/games") body = { ok: true, games: [game], total: 1 };
    if (path === "/api/game")
      body = { ok: true, game, rsvps: people, teams: null, vote_results: [] };
    if (path === "/api/admin/players")
      body = { ok: true, players: people, is_super_admin: true };
    if (path === "/api/game/profile") body = { ok: true, sheepCoins: 0 };
    if (path === "/api/admin/rsvp" && method === "POST")
      people = people.map((p) =>
        String(p.tg_id) === String(payload.tg_id)
          ? { ...p, status: payload.status }
          : p,
      );
    if (path === "/api/admin/guests" && method === "POST") {
      if (failGuestSave)
        return r.fulfill({
          status: 503,
          json: { ok: false, reason: "offline" },
        });
      people.push({ tg_id: -11, player_kind: "guest", ...payload });
    }
    if (path === "/api/games/12" && method === "PATCH") {
      if (failGameSave)
        return r.fulfill({
          status: 503,
          json: { ok: false, reason: "offline" },
        });
      game = { ...game, ...payload };
      body = { ok: true, game };
    }
    if (path === "/api/admin/games/12/reminders") {
      if (method === "POST") reminders.push({ id: 32, ...payload });
      body = { ok: true, reminders };
    }
    if (path === "/api/admin/reminders/31" && method === "PATCH")
      reminders = reminders.map((v) =>
        v.id === 31 ? { ...v, ...payload } : v,
      );
    if (path === "/api/admin/rsvp-tokens")
      body = {
        ok: true,
        token: { token: "test-token" },
        url: "https://example.test/rsvp?t=test-token",
      };
    return r.fulfill({ json: body });
  });
  const dialog = () =>
    page.getByRole("dialog", { name: "Игра #12", exact: true });
  const tab = (name) => dialog().getByRole("tab", { name, exact: true });
  const assertLayout = async (selector) => {
    const result = await page.locator(selector).evaluate((panel) => {
      const rect = panel.getBoundingClientRect(),
        body = panel.querySelector(".gsDialog__body"),
        footer = panel.querySelector(".gsDialog__footer");
      const footerRect = footer?.getBoundingClientRect();
      return {
        bounded: rect.top >= -1 && rect.bottom <= innerHeight + 1,
        horizontal:
          panel.scrollWidth <= panel.clientWidth + 1 &&
          body.scrollWidth <= body.clientWidth + 1,
        solid: getComputedStyle(panel).backgroundColor !== "rgba(0, 0, 0, 0)",
        footer: !footerRect || footerRect.bottom <= rect.bottom + 1,
      };
    });
    assert.deepEqual(result, {
      bounded: true,
      horizontal: true,
      solid: true,
      footer: true,
    });
  };
  try {
    await page.goto(process.argv[2] || "http://localhost:4174/", {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".gameCard__main").first().click();
    await page
      .getByRole("button", { name: "Настройки игры", exact: true })
      .click();
    await dialog().waitFor();
    assert.equal(await dialog().getByRole("tab").count(), 4);
    assert.equal(await tab("Игра").getAttribute("aria-selected"), "true");
    assert.equal(
      writes.length,
      0,
      "opening settings must not publish or save anything",
    );
    await tab("Игра").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await tab("Игроки").getAttribute("aria-selected"), "true");
    await page.keyboard.press("Home");
    assert.equal(await tab("Игра").getAttribute("aria-selected"), "true");
    await dialog()
      .getByRole("button", { name: "Сохранить игру", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await dialog()
        .getByRole("button", { name: "Закрыть: Игра #12", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await dialog().getByLabel("Арена", { exact: true }).fill("Новая арена");
    await dialog()
      .getByLabel("Важное", { exact: false })
      .fill("Новое объявление");
    await dialog()
      .getByLabel("Подробности", { exact: false })
      .fill("Новые подробности");
    for (const width of [320, 390, 430, 800]) {
      await page.setViewportSize({ width, height: 760 });
      await assertLayout(
        ".gsDialogBackdrop:not(.gsDialogBackdrop--nested) .gsDialog",
      );
    }
    await page.setViewportSize({ width: 390, height: 760 });
    await dialog()
      .locator(".gsDialog__body")
      .evaluate((el) => el.scrollTo(0, 0));
    await page.screenshot({
      path: "/tmp/game-settings-main.png",
      fullPage: true,
    });
    await tab("Игроки").click();
    await dialog().getByLabel("Поиск игрока").fill("Алексей");
    assert.equal(await dialog().locator(".gsParticipant").count(), 1);
    await dialog().getByRole("button", { name: "Будет", exact: true }).click();
    assert.equal(writes.at(-1).path, "/api/admin/rsvp");
    assert.deepEqual(writes.at(-1).payload, {
      game_id: 12,
      tg_id: 2,
      status: "yes",
    });
    await dialog().getByLabel("Поиск игрока").fill("");
    await dialog()
      .getByRole("button", { name: "Ссылка на отметку: Иван", exact: true })
      .click();
    await dialog().getByLabel("Личная ссылка на отметку").waitFor();
    assert.equal(
      await dialog().getByLabel("Личная ссылка на отметку").inputValue(),
      "https://example.test/rsvp?t=test-token",
    );
    await assertLayout(
      ".gsDialogBackdrop:not(.gsDialogBackdrop--nested) .gsDialog",
    );
    await tab("Гости").click();
    await dialog()
      .getByRole("button", { name: "+ Новый гость", exact: true })
      .click();
    const guest = page.getByRole("dialog", {
      name: "Новый гость",
      exact: true,
    });
    await guest.waitFor();
    assert.equal(
      await page
        .locator(".gsDialogBackdrop:not(.gsDialogBackdrop--nested) .gsDialog")
        .getAttribute("inert"),
      "",
    );
    await guest.getByLabel("Имя гостя", { exact: true }).fill("Новый гость");
    await guest.getByLabel("Номер", { exact: true }).fill("77");
    await guest.getByLabel("Позиция", { exact: true }).selectOption("D");
    await guest
      .getByRole("button", { name: "Под вопросом", exact: true })
      .click();
    await guest
      .locator("summary")
      .filter({ hasText: "Навыки и заметки" })
      .click();
    await guest.getByLabel("Катание", { exact: true }).fill("8");
    await guest.getByLabel("Заметки", { exact: true }).fill("Тестовая заметка");
    await guest.getByLabel("Заметки", { exact: true }).blur();
    for (const size of [
      { width: 320, height: 680 },
      { width: 390, height: 760 },
      { width: 430, height: 500 },
      { width: 390, height: 420 },
    ]) {
      await page.setViewportSize(size);
      await guest
        .locator(".gsDialog__body")
        .evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await assertLayout(".gsDialogBackdrop--nested .gsDialog");
    }
    await page.screenshot({
      path: "/tmp/game-settings-guest-small.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 760 });
    await guest.locator(".gsDialog__body").evaluate((el) => el.scrollTo(0, 0));
    await page.screenshot({
      path: "/tmp/game-settings-guest.png",
      fullPage: true,
    });
    failGuestSave = true;
    await guest
      .getByRole("button", { name: "Добавить гостя", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '.gsDialogBackdrop--nested button[type="submit"]',
        ).disabled,
    );
    assert.equal(
      await guest.getByLabel("Имя гостя", { exact: true }).inputValue(),
      "Новый гость",
    );
    failGuestSave = false;
    await guest
      .getByRole("button", { name: "Добавить гостя", exact: true })
      .click();
    await guest.waitFor({ state: "hidden" });
    const savedGuest = writes
      .filter((w) => w.path === "/api/admin/guests")
      .at(-1).payload;
    assert.equal(savedGuest.game_id, 12);
    assert.equal(savedGuest.position, "D");
    assert.equal(savedGuest.skating, 8);
    assert.equal(savedGuest.status, "maybe");
    assert.equal(savedGuest.notes, "Тестовая заметка");
    assert.equal(
      await page.evaluate(() => document.body.style.overflow),
      "hidden",
      "closing guest editor must not unlock the game dialog",
    );
    await tab("Напоминания").click();
    await dialog()
      .getByRole("button", {
        name: "Развернуть детали напоминания",
        exact: true,
      })
      .click();
    await dialog()
      .getByRole("button", { name: "Сохранить", exact: true })
      .first()
      .click();
    await page.waitForFunction(
      () => !document.querySelector(".gsDialog__body button.btn:disabled"),
    );
    assert.equal(
      writes.some(
        (w) => w.path === "/api/admin/reminders/31" && w.method === "PATCH",
      ),
      true,
    );
    await tab("Игра").click();
    assert.equal(
      await dialog().getByLabel("Арена", { exact: true }).inputValue(),
      "Новая арена",
      "tab changes and RSVP updates preserve game drafts",
    );
    await dialog()
      .getByRole("button", { name: "Выбрать на карте", exact: true })
      .click();
    await page.locator(".mapPickModal__card").waitFor();
    const mapIsTop = await page
      .locator(".mapPickModal__card")
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + 30),
        );
      });
    assert.equal(mapIsTop, true, "map must appear above the settings portal");
    await page
      .locator(".mapPickModal__card")
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await dialog().locator("summary").filter({ hasText: "Видео игры" }).click();
    await dialog()
      .getByLabel("Ссылка на видео", { exact: false })
      .fill("https://www.youtube.com/watch?v=test");
    await dialog().getByLabel("Отправить без звука", { exact: true }).check();
    await dialog()
      .getByRole("button", { name: "Отправить видео в чат", exact: true })
      .click();
    assert.equal(writes.at(-1).path, "/api/admin/games/video/send");
    assert.equal(writes.at(-1).payload.silent, true);
    failGameSave = true;
    await dialog()
      .getByRole("button", { name: "Сохранить игру", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !document.querySelector('button[form="game-settings-form"]').disabled,
    );
    assert.equal(
      await dialog().getByLabel("Арена", { exact: true }).inputValue(),
      "Новая арена",
    );
    failGameSave = false;
    await dialog()
      .getByRole("button", { name: "Сохранить игру", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    assert.equal(game.notice_text, "Новое объявление");
    assert.equal(game.info_text, "Новые подробности");
    assert.equal(game.video_url, "https://www.youtube.com/watch?v=test");
    assert.equal(game.location, "Новая арена");
    assert.equal(
      await page.evaluate(() => document.body.style.overflow),
      "",
      "closing all dialogs restores body scrolling",
    );
    // The admin Games list opens the exact same tabbed editor.
    await page
      .getByRole("navigation", { name: "Навигация", exact: true })
      .getByRole("button", { name: "Админ", exact: true })
      .click();
    await page.locator(".gameListItem").first().click();
    await dialog().waitFor();
    assert.equal(await dialog().getByRole("tab").count(), 4);
    assert.equal(
      await dialog().getByLabel("Арена", { exact: true }).inputValue(),
      "Новая арена",
    );
    await tab("Гости").click();
    await dialog()
      .getByRole("button", { name: "+ Новый гость", exact: true })
      .click();
    await guest.waitFor();
    await page.keyboard.press("Escape");
    await guest.waitFor({ state: "hidden" });
    assert.equal(
      await dialog().isVisible(),
      true,
      "Escape closes only the topmost dialog",
    );
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: both settings entry points, four tabs/draft preservation, unified save/error recovery, participants/status/link, guest layout/create/error recovery, reminders, video, map stacking, keyboard and nested scroll locks. Mock API only.",
    );
  } catch (error) {
    await page.screenshot({
      path: "/tmp/game-settings-error.png",
      fullPage: true,
    });
    throw error;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
