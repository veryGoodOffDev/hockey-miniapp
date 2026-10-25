// Exercise admin publishing controls with a mocked API; no live Telegram sends.
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
    posts = [],
    dialogs = [];
  let serverMode = "stale-once";
  const people = [
    { tg_id: 1, display_name: "Иван", position: "G", status: "yes" },
    { tg_id: 2, display_name: "Алексей", position: "D", status: "yes" },
    { tg_id: 3, display_name: "Борис", position: "F", status: "yes" },
  ];
  const game = {
    id: 12,
    status: "scheduled",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    location: "Арена",
    my_status: "yes",
    yes_count: 3,
  };
  const teams = {
    ok: true,
    teamA: [people[0], people[1]],
    teamB: [people[2]],
    meta: { sumA: 10, sumB: 5, diff: 5 },
  };
  async function open(admin) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 1000 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
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
    await page.route("**/api/**", async (r) => {
      const path = new URL(r.request().url()).pathname;
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
          player: { ...people[0], rsvp_view: "list" },
          is_admin: admin,
        };
      if (path === "/api/games") body = { ok: true, games: [game], total: 1 };
      if (path === "/api/game")
        body = {
          ok: true,
          game: { ...game, previous_game_award: null },
          rsvps: people,
          teams,
          vote_results: [],
        };
      if (path === "/api/game/profile") body = { ok: true, sheepCoins: 0 };
      if (path === "/api/admin/teams/send") {
        const payload = r.request().postDataJSON();
        posts.push(payload);
        if (serverMode === "stale-once") {
          serverMode = "success";
          return r.fulfill({
            status: 409,
            json: { ok: false, reason: "teams_stale", removed: 1, added: 2 },
          });
        }
        if (serverMode === "caption")
          return r.fulfill({
            status: 400,
            json: {
              ok: false,
              reason: "teams_caption_too_long",
              team: "white",
            },
          });
        body = {
          ok: true,
          format: payload.format,
          message_ids: payload.format === "jerseys" ? [100, 101] : [102],
          edited: serverMode === "edited",
        };
      }
      return r.fulfill({ json: body });
    });
    await page.goto(process.argv[2] || "http://localhost:4174/", {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".gameCard__main").first().click();
    await page
      .locator(".gameDetailNav")
      .getByRole("button", { name: "Составы", exact: true })
      .click();
    await page.getByRole("heading", { name: "Составы", exact: true }).waitFor();
    return page;
  }
  try {
    const page = await open(true),
      choice = page.getByLabel("Публикация составов в чат"),
      send = page.getByRole("button", {
        name: "📣 Изменить/отправить составы в чат",
        exact: true,
      });
    assert.equal(await choice.inputValue(), "columns");
    await choice.selectOption("jerseys");
    await send.click();
    await page
      .getByText("✅ Обе команды опубликованы с джерси", { exact: true })
      .waitFor();
    assert.deepEqual(posts, [
      { game_id: 12, force: false, format: "jerseys" },
      { game_id: 12, force: true, format: "jerseys" },
    ]);
    assert.ok(dialogs.some((text) => text.includes("Ушли: 1")));
    serverMode = "edited";
    await send.click();
    await page
      .getByText("✅ Составы в чате актуальны", { exact: true })
      .waitFor();
    await choice.selectOption("columns");
    serverMode = "success";
    await send.click();
    await page
      .getByText("✅ Таблица составов опубликована", { exact: true })
      .waitFor();
    assert.equal(posts.at(-1).format, "columns");
    await choice.selectOption("jerseys");
    serverMode = "caption";
    await send.click();
    await page
      .getByText(/Список команды не помещается в подпись к фото/)
      .waitFor();
    assert.equal(await send.isEnabled(), true);
    assert.equal(await choice.isEnabled(), true);
    for (const file of ["jersey-blue.jpg", "jersey-white.jpg"]) {
      const response = await page.request.get(
        new URL("/" + file, page.url()).href,
      );
      assert.equal(response.status(), 200);
      assert.match(response.headers()["content-type"], /image\/jpeg/);
    }
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
    await choice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/team-post-formats.png" });
    const member = await open(false);
    assert.equal(await member.locator(".teamPostFormat").count(), 0);
    assert.equal(
      await member
        .getByRole("button", {
          name: "📣 Изменить/отправить составы в чат",
          exact: true,
        })
        .count(),
      0,
    );
    await member.close();
    await page.close();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: two admin formats, server stale-force retry retains format, publication/update feedback, photo caption error, JPEG assets, mobile widths, member has no publishing controls. Mock API only.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
