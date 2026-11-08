// Production frontend with a mocked API; no production data or Telegram requests.
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
  const page = await browser.newPage({
    viewport: { width: 390, height: 920 },
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  await page.clock.setFixedTime(new Date("2026-11-08T09:44:00Z"));
  page.setDefaultTimeout(8000);
  const errors = [],
    requests = [];
  let attendanceFailure = false,
    engagementFailure = false,
    wrongPeriod = false,
    slowResponse = null;
  const people = [
    { tg_id: 1, display_name: "Иван", position: "F", status: "yes" },
  ];
  const game = {
    id: 1000,
    starts_at: "2026-11-15T04:45:00Z",
    status: "scheduled",
    location: "Шуваловский лёд",
    my_status: "yes",
    yes_count: 20,
  };
  const games = [];
  for (let month = 1; month <= 11; month++)
    for (const day of [1, 8, 15, 22]) {
      if (month === 11 && day > 8) continue;
      const players = Math.round(
        25 +
          7 * Math.sin(((month - 1) / 12) * Math.PI * 2) +
          ((day % 3) - 1) * 2,
      );
      const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      games.push({
        id: games.length + 1,
        starts_at: date + "T04:45:00Z",
        date,
        players,
        location: "Шуваловский лёд",
      });
    }
  page.on("pageerror", (e) => errors.push(e.message));
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
    const url = new URL(r.request().url()),
      path = url.pathname;
    requests.push(path + url.search);
    let body = {
      ok: true,
      games: [game],
      total: 1,
      players: people,
      comments: [],
      messages: [],
      conversations: [],
      unread_total: 0,
      items: [],
      reactions: [],
      applications: [],
    };
    if (path === "/api/me")
      body = {
        ok: true,
        is_admin: true,
        player: people[0],
        features: { chat: true, game_comments: true, air_hockey: true },
      };
    if (path === "/api/game")
      body = { ok: true, game, rsvps: people, teams: null };
    if (path === "/api/game/profile") body = { ok: true, sheepCoins: 0 };
    if (path === "/api/stats/attendance")
      body = {
        ok: true,
        rows: [{ tg_id: 1, name: "Иван", yes: 30, no: 2, maybe: 1, total: 33 }],
      };
    if (path === "/api/admin/engagement") {
      if (engagementFailure)
        return r.fulfill({
          status: 503,
          json: { ok: false, reason: "engagement_unavailable" },
        });
      const year = Number(url.searchParams.get("year")),
        month = Number(url.searchParams.get("month"));
      const prefix = `${year}-${String(month).padStart(2, "0")}`;
      body = {
        ok: true,
        year,
        month: wrongPeriod ? 10 : month,
        team_size: 35,
        by_day: { [`${prefix}-01`]: 11, [`${prefix}-08`]: 17 },
        users_by_day: { [`${prefix}-08`]: people },
      };
    }
    if (path === "/api/stats/game-attendance") {
      if (attendanceFailure)
        return r.fulfill({
          status: 503,
          json: { ok: false, reason: "stats_unavailable" },
        });
      const year = Number(url.searchParams.get("year") || 2026);
      const from = url.searchParams.get("from") || `${year}-01-01`,
        to = url.searchParams.get("to") || `${year}-12-31`;
      body = {
        ok: true,
        filter: { from, to, year },
        games: games.filter((g) => g.date >= from && g.date <= to),
        years: [2025, 2026],
        as_of: "2026-11-08T09:44:00Z",
      };
      if (slowResponse && year === slowResponse.year) {
        const snapshot = body;
        await slowResponse.wait;
        return r.fulfill({ json: snapshot }).catch(() => {});
      }
    }
    return r.fulfill({ json: body });
  });
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Навигация", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
  const trend = () =>
    page.getByRole("region", { name: "Посещаемость игр", exact: true });
  const loaded = () => trend().locator(".gameTrend__metrics").waitFor();
  try {
    await page.goto(process.argv[2] || "http://localhost:4174/", {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".gameCard__main").first().waitFor();
    await nav("Статистика");
    await loaded();
    assert.equal(
      requests.some((r) => r === "/api/stats/game-attendance?year=2026"),
      true,
    );
    assert.equal(
      await trend()
        .locator(".gameTrend__metrics > div")
        .first()
        .locator("strong")
        .innerText(),
      String(games.length),
    );
    assert.equal(
      await trend()
        .getByRole("button", { name: "Недели", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const countBeforeMode = requests.filter((r) =>
      r.startsWith("/api/stats/game-attendance"),
    ).length;
    await trend().getByRole("button", { name: "Месяцы", exact: true }).click();
    assert.equal(
      await trend()
        .getByRole("combobox", { name: "Период на графике" })
        .locator("option")
        .count(),
      12,
    );
    await trend()
      .getByRole("combobox", { name: "Период на графике" })
      .selectOption("2026-01-01");
    assert.equal(await trend().locator(".gameTrend__game").count(), 4);
    assert.equal(
      requests.filter((r) => r.startsWith("/api/stats/game-attendance")).length,
      countBeforeMode,
      "grouping should be local and instant",
    );
    await trend()
      .getByRole("combobox", { name: "Период на графике" })
      .selectOption("2026-12-01");
    assert.match(
      await trend().locator(".gameTrend__periodStats").innerText(),
      /Среднее: —/,
    );
    await trend()
      .getByRole("combobox", { name: "Период на графике" })
      .selectOption("2026-10-01");
    for (const width of [320, 390, 430, 900]) {
      await page.setViewportSize({ width, height: 920 });
      await page.waitForTimeout(60);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `no horizontal overflow at ${width}`,
      );
    }
    await page.setViewportSize({ width: 390, height: 920 });
    await page.screenshot({
      path: "/tmp/game-attendance-analytics.png",
      fullPage: true,
    });
    await trend()
      .getByRole("button", { name: "Предыдущий год", exact: true })
      .click();
    await loaded();
    await trend()
      .getByText(
        "За этот период нет завершённых игр. Выберите другой год или диапазон.",
        { exact: true },
      )
      .waitFor();
    assert.match(await trend().locator(".gameTrend__year").innerText(), /2025/);
    await trend()
      .getByRole("button", { name: "Текущий год", exact: true })
      .click();
    await loaded();
    await trend()
      .getByRole("button", { name: "Выбрать диапазон", exact: true })
      .click();
    await trend().getByLabel("С", { exact: true }).fill("2026-01-01");
    await trend().getByLabel("По", { exact: true }).fill("2026-02-28");
    await trend()
      .getByRole("button", { name: "Применить диапазон", exact: true })
      .click();
    await loaded();
    assert.equal(
      await trend()
        .getByRole("combobox", { name: "Период на графике" })
        .locator("option")
        .count(),
      2,
    );
    assert.equal(
      await trend()
        .locator(".gameTrend__metrics > div")
        .first()
        .locator("strong")
        .innerText(),
      "8",
    );
    // Abort/out-of-order response: a slow older year must not replace the selected year.
    let release;
    const oldYearRequest = page.waitForRequest(
      (r) =>
        new URL(r.url()).pathname === "/api/stats/game-attendance" &&
        new URL(r.url()).searchParams.get("year") === "2025",
    );
    slowResponse = {
      year: 2025,
      wait: new Promise((resolve) => {
        release = resolve;
      }),
    };
    await trend()
      .getByRole("button", { name: "Предыдущий год", exact: true })
      .click();
    await oldYearRequest;
    await trend()
      .getByRole("button", { name: "Следующий год", exact: true })
      .click();
    await loaded();
    release();
    slowResponse = null;
    assert.match(await trend().locator(".gameTrend__year").innerText(), /2026/);
    attendanceFailure = true;
    await trend()
      .getByRole("button", { name: "↻ Обновить", exact: true })
      .click();
    await trend().getByRole("alert").waitFor();
    assert.equal(
      await trend().locator(".gameTrend__metrics").count(),
      0,
      "network errors must not show invented zeroes",
    );
    attendanceFailure = false;
    await trend()
      .getByRole("button", { name: "Повторить", exact: true })
      .click();
    await loaded();
    await trend()
      .getByRole("combobox", { name: "Период на графике" })
      .selectOption("2026-01-01");
    const gameRequest = page.waitForRequest(
      (r) =>
        new URL(r.url()).pathname === "/api/game" &&
        new URL(r.url()).searchParams.get("game_id") === "1",
    );
    await trend().locator(".gameTrend__game").first().click();
    await gameRequest;
    await page.locator(".gameDetailNav").waitFor();
    await nav("Статистика");
    await loaded();
    await page.getByRole("button", { name: "По игрокам", exact: true }).click();
    await page
      .getByRole("heading", { name: "✅ Топ посещаемости (Буду)", exact: true })
      .waitFor();
    await page.locator("b").filter({ hasText: "Иван" }).first().waitFor();
    await nav("Админ");
    await page
      .getByRole("button", { name: "Вовлеченность", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector(".engTodayCircle")?.textContent === "17",
    );
    assert.match(
      await page.locator(".engMonthTitle").innerText(),
      /ноябрь 2026/i,
    );
    assert.equal(
      await page
        .locator(".engCell")
        .filter({ has: page.locator(".engDay", { hasText: /^8$/ }) })
        .locator(".engCount")
        .innerText(),
      "17",
    );
    // Historical/month navigation also updates the selected day to the displayed month.
    await page.locator(".engMonthBtn").first().click();
    await page.waitForFunction(
      () => document.querySelector(".engTodayCircle")?.textContent === "11",
    );
    assert.match(
      await page.locator(".engTodayBadge").innerText(),
      /01 октября 2026/,
    );
    await page.locator(".engMonthBtn").last().click();
    await page.waitForFunction(
      () => document.querySelector(".engTodayCircle")?.textContent === "17",
    );
    engagementFailure = true;
    await page
      .getByRole("button", { name: "Обновить", exact: true })
      .last()
      .click();
    await page.waitForFunction(
      () => document.querySelector(".engTodayCircle")?.textContent === "—",
    );
    await page
      .getByText(
        "Не удалось загрузить заходы. Проверьте соединение и нажмите «Обновить».",
        { exact: true },
      )
      .waitFor();
    engagementFailure = false;
    wrongPeriod = true;
    await page
      .getByRole("button", { name: "Обновить", exact: true })
      .last()
      .click();
    await page
      .getByText(
        "Не удалось получить данные за выбранный месяц. Повторите загрузку позже.",
        { exact: true },
      )
      .waitFor();
    wrongPeriod = false;
    await page
      .getByRole("button", { name: "Обновить", exact: true })
      .last()
      .click();
    await page.waitForFunction(
      () => document.querySelector(".engTodayCircle")?.textContent === "17",
    );
    await page.screenshot({
      path: "/tmp/engagement-november-fixed.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: current year, weeks/months, game details, gaps, range/year switching, stale response, errors/retry, player stats, responsive layout, November visits and calendar period/error handling. Mock API only.",
    );
  } catch (e) {
    await page.screenshot({
      path: "/tmp/attendance-analytics-error.png",
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
