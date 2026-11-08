// Duration UI, clock boundaries and payloads: intercepted API only.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets",
    ],
  });
  const errors = [],
    writes = [],
    reads = [];
  let game = {
    id: 12,
    starts_at: "2026-11-08T04:45:00Z",
    duration_minutes: 75,
    status: "scheduled",
    location: "Арена",
    my_status: "yes",
    yes_count: 1,
  };
  const next = { ...game, id: 20, starts_at: "2026-11-15T04:45:00Z" };
  const others = [];
  const person = {
    tg_id: 1,
    display_name: "Иван",
    position: "F",
    status: "yes",
  };
  async function open(admin) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
    });
    page.setDefaultTimeout(8000);
    await page.clock.install({ time: new Date("2026-11-08T05:58:30Z") });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
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
    await page.route("**/api/**", async (r) => {
      const path = new URL(r.request().url()).pathname,
        method = r.request().method();
      reads.push(path);
      const payload = r.request().postData()
        ? r.request().postDataJSON()
        : null;
      if (method !== "GET") writes.push({ path, payload });
      let body = {
        ok: true,
        games: [game, next, ...others],
        total: 2 + others.length,
        players: [person],
        items: [],
        comments: [],
        messages: [],
        conversations: [],
        reactions: [],
        unread_total: 0,
        reminders: [],
        applications: [],
      };
      if (path === "/api/me")
        body = {
          ok: true,
          is_admin: admin,
          player: person,
          features: { chat: false, game_comments: false, air_hockey: false },
        };
      if (path === "/api/features")
        body = {
          ok: true,
          features: { chat: false, game_comments: false, air_hockey: false },
        };
      if (path === "/api/game") {
        const id = Number(
          new URL(r.request().url()).searchParams.get("game_id"),
        );
        body = {
          ok: true,
          game: [game, next, ...others].find((g) => g.id === id) || game,
          rsvps: [person],
          teams: null,
        };
      }
      if (path === "/api/games/12" && method === "PATCH") {
        game = { ...game, ...payload };
        body = { ok: true, game };
      }
      if (path === "/api/games" && method === "POST") {
        const created = { id: 31, status: "scheduled", ...payload };
        others.push(created);
        body = { ok: true, game: created };
      }
      if (path === "/api/admin/games/12/best-player") {
        game = { ...game, best_player_tg_id: payload.best_player_tg_id };
        body = { ok: true, game };
      }
      return r.fulfill({ json: body });
    });
    await page.goto(process.argv[2] || "http://localhost:4174/", {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".gameCard__main").first().waitFor();
    return page;
  }
  const popup = (p) =>
    p.getByRole("dialog", { name: "Действия с игроком", exact: true });
  let page;
  try {
    page = await open(true);
    await page.locator(".gameCard__main").first().click();
    await page
      .getByRole("button", { name: "Настройки игры", exact: true })
      .waitFor();
    await page.clock.pauseAt(new Date("2026-11-08T05:59:59.900Z"));
    await page.locator(".rsvpRoster__player").first().click();
    assert.equal(
      await popup(page)
        .getByRole("button", { name: "Выдать награду", exact: true })
        .count(),
      0,
    );
    await popup(page)
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await page.clock.runFor(200);
    await page.getByText("Прошла", { exact: true }).first().waitFor();
    await page.locator(".rsvpRoster__player").first().click();
    await popup(page)
      .getByRole("button", { name: "Выдать награду", exact: true })
      .waitFor();
    await popup(page)
      .getByRole("button", { name: "Выдать награду", exact: true })
      .click();
    await popup(page).waitFor({ state: "hidden" });
    assert.equal(
      writes.some(
        (w) =>
          w.path === "/api/admin/games/12/best-player" &&
          w.payload.best_player_tg_id === 1,
      ),
      true,
    );
    await page
      .getByRole("button", { name: "Настройки игры", exact: true })
      .click();
    const settings = page.getByRole("dialog", {
      name: "Игра #12",
      exact: true,
    });
    const duration = settings.getByLabel("Продолжительность игры, мин", {
      exact: true,
    });
    assert.equal(await duration.inputValue(), "75");
    await duration.fill("90");
    await settings
      .getByRole("button", { name: "Сохранить игру", exact: true })
      .click();
    await settings.waitFor({ state: "hidden" });
    assert.equal(game.duration_minutes, 90);
    assert.equal(
      writes.findLast((w) => w.path === "/api/games/12").payload
        .duration_minutes,
      90,
    );
    assert.equal(
      await page.getByText("Прошла", { exact: true }).count(),
      0,
      "extending duration puts the game back in progress",
    );
    await page.locator(".rsvpRoster__player").first().click();
    assert.equal(
      await popup(page)
        .getByRole("button", { name: "Отменить награду", exact: true })
        .count(),
      0,
    );
    await popup(page)
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await page.clock.pauseAt(new Date("2026-11-08T06:14:59.900Z"));
    assert.equal(await page.getByText("Прошла", { exact: true }).count(), 0);
    await page.clock.runFor(200);
    await page.getByText("Прошла", { exact: true }).first().waitFor();
    await page.locator(".rsvpRoster__player").first().click();
    await popup(page)
      .getByRole("button", { name: "Отменить награду", exact: true })
      .waitFor();
    await popup(page)
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    // The creation sheet gets 75 by default and sends a real POST with that value.
    await page
      .getByRole("navigation", { name: "Навигация", exact: true })
      .getByRole("button", { name: "Игры", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Создать игру", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "Новая игра",
      exact: true,
    });
    await create.waitFor();
    assert.equal(
      await create
        .getByLabel("Продолжительность игры, мин", { exact: true })
        .inputValue(),
      "75",
    );
    assert.equal(
      await create
        .getByRole("tab", { name: "Гости", exact: true })
        .isDisabled(),
      true,
    );
    await create.getByLabel("Арена", { exact: true }).fill("Новая арена");
    await create
      .getByRole("button", { name: "Создать игру", exact: true })
      .click();
    await create.waitFor({ state: "hidden" });
    assert.equal(
      writes.findLast((w) => w.path === "/api/games").payload.duration_minutes,
      75,
    );
    // The admin's Games form also defaults to 75 (including series creation).
    await page
      .getByRole("navigation", { name: "Навигация", exact: true })
      .getByRole("button", { name: "Админ", exact: true })
      .click();
    await page
      .getByLabel("Продолжительность игры, мин", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByLabel("Продолжительность игры, мин", { exact: true })
        .inputValue(),
      "75",
    );
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    const member = await open(false);
    await member.locator(".gameCard__main").first().click();
    assert.equal(
      await member
        .getByRole("button", { name: "Настройки игры", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await member
        .getByLabel("Продолжительность игры, мин", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await member.getByText("1 ч 30 мин", { exact: false }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 75-minute and custom end boundaries update without polling/reload, award controls follow end, saved durations/create defaults, admin-only visibility and mobile layout. Mock API only.",
    );
  } catch (e) {
    if (page)
      await page.screenshot({
        path: "/tmp/game-duration-error.png",
        fullPage: true,
      });
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
