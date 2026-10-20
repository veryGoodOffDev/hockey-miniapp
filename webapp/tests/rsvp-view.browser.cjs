// Real app + mock authenticated API. Two browser contexts model separate devices.
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
    profiles = new Map([
      [1, { tg_id: 1, display_name: "Иван", position: "G", rsvp_view: "list" }],
      [
        2,
        { tg_id: 2, display_name: "Алексей", position: "D", rsvp_view: "list" },
      ],
    ]);
  const time = Date.now();
  const players = [
    {
      tg_id: 5,
      display_name: "Ли",
      position: "D",
      status: "yes",
      status_changed_at: new Date(time - 1000).toISOString(),
      jersey_number: 12,
      skill: 5,
    },
    {
      tg_id: 3,
      display_name: "Нападающий",
      position: "F",
      status: "yes",
      jersey_number: 92,
      skill: 6,
    },
    { ...profiles.get(1), status: "yes", jersey_number: 50, skill: 5 },
    {
      ...profiles.get(2),
      status: "yes",
      status_changed_at: new Date(time - 10000).toISOString(),
      jersey_number: 15,
      skill: 6,
    },
    { tg_id: 4, display_name: "Сергей", position: "F", status: "no" },
    { tg_id: 7, display_name: "Павел", position: "F", status: "no" },
    {
      tg_id: 6,
      display_name: "ОченьДлинноеИмяИгрокаБезПробеловДляПроверкиПереноса",
      position: "D",
      status: "maybe",
    },
  ];
  const game = {
    id: 12,
    status: "scheduled",
    starts_at: new Date(time + 86400000).toISOString(),
    location: "Ледовая арена",
    my_status: "yes",
    yes_count: 4,
    best_player_tg_id: 3,
  };
  const teams = {
    ok: true,
    teamA: [players[2], players[3]],
    teamB: [players[0], players[1]],
    meta: { sumA: 10, sumB: 11, diff: 1 },
  };
  let failSave = false,
    holdSave = false,
    pending = [];
  async function device(userId) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 1000 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((id) => {
      window.Telegram = {
        WebApp: {
          initData: `TEST_${id}`,
          initDataUnsafe: { user: { id, first_name: "Игрок" } },
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
    await page.route("**/api/**", async (r) => {
      const url = new URL(r.request().url());
      let body = {
        ok: true,
        messages: [],
        conversations: [],
        comments: [],
        players,
        items: [],
        reactions: [],
        unread_total: 0,
      };
      if (url.pathname === "/api/me/preferences") {
        assert.equal(r.request().method(), "PATCH");
        const payload = r.request().postDataJSON();
        assert.deepEqual(Object.keys(payload), ["rsvp_view"]);
        writes.push({ userId, ...payload });
        if (holdSave) await new Promise((resolve) => pending.push(resolve));
        if (failSave)
          return r.fulfill({
            status: 503,
            json: { ok: false, reason: "server_error" },
          });
        profiles.get(userId).rsvp_view = payload.rsvp_view;
        return r.fulfill({
          json: { ok: true, preferences: { rsvp_view: payload.rsvp_view } },
        });
      }
      if (url.pathname === "/api/me")
        body = {
          ok: true,
          player: profiles.get(userId),
          is_admin: userId === 1,
        };
      if (url.pathname === "/api/games")
        body = {
          ok: true,
          games: url.searchParams.get("scope") === "past" ? [] : [game],
          total: 1,
        };
      if (url.pathname === "/api/game")
        body = {
          ok: true,
          game: {
            ...game,
            previous_game_award: { game_id: 11, tg_id: 2, name: "Алексей" },
          },
          rsvps: players,
          teams,
          vote_results: [],
        };
      if (url.pathname === "/api/game/profile")
        body = { ok: true, sheepCoins: 0 };
      return r.fulfill({ json: body });
    });
    await page.goto(process.argv[2] || "http://localhost:4174/", {
      waitUntil: "domcontentloaded",
    });
    if (userId === 2)
      await page.getByRole("button", { name: "Хорошо", exact: true }).click();
    await page.locator(".gameCard__main").first().click();
    await page.getByRole("group", { name: "Вид списка отметок" }).waitFor();
    return { page, context };
  }
  const controls = (page) =>
    page.getByRole("group", { name: "Вид списка отметок" });
  const choose = (page, name) =>
    controls(page).getByRole("button", { name, exact: true }).click();
  const order = (page) => page.locator(".rsvpRoster__name").allTextContents();
  try {
    const first = await device(1),
      p = first.page;
    assert.equal(
      await controls(p)
        .getByRole("button", { name: "Список", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const before = await order(p);
    assert.deepEqual(
      before.slice(0, 4).map((x) => x.trim()),
      ["Иван", "Алексей", "Ли", "Нападающий"],
    );
    await p
      .getByPlaceholder("Сообщение…", { exact: true })
      .fill("Черновик сохраняется");
    holdSave = true;
    const expectedChips = [before[0], before[2], before[1], ...before.slice(3)];
    assert.equal(await controls(p).innerText(), "");
    await choose(p, "Капсулы");
    await p.waitForFunction(
      () => document.querySelectorAll(".rsvpRoster--chips").length === 3,
    );
    assert.deepEqual(await order(p), expectedChips);
    assert.equal(
      await p.getByPlaceholder("Сообщение…", { exact: true }).inputValue(),
      "Черновик сохраняется",
    );
    assert.equal(await p.locator(".rsvpRoster__player.isMine").count(), 1);
    assert.ok((await p.locator(".rsvpRoster .teamColorMark").count()) > 0);
    assert.equal(
      await p
        .locator(".matchAwardBadge:not(.matchAwardBadge--previous)")
        .count(),
      1,
    );
    assert.equal(await p.locator(".matchAwardBadge--previous").count(), 1);
    await p.waitForFunction(
      () => localStorage.getItem("rsvp-view:v1:1") === "chips",
    );
    const yes = p.getByRole("region", { name: "Буду", exact: true });
    await yes
      .locator(".rsvpRoster__player")
      .filter({ hasText: "Алексей" })
      .click();
    const menu = p.getByRole("dialog", {
      name: "Действия с игроком",
      exact: true,
    });
    await menu.waitFor();
    await menu.getByRole("button", { name: "Отмена", exact: true }).click();
    for (const width of [320, 390, 430]) {
      await p.setViewportSize({ width, height: 1000 });
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.equal(
        await yes
          .locator(".rsvpRoster__list")
          .evaluate((e) => getComputedStyle(e).flexWrap),
        "wrap",
      );
    }
    await p.setViewportSize({ width: 390, height: 1000 });
    const noRows = p.locator(".rsvpRoster--no .rsvpRoster__player");
    const firstChip = await noRows.nth(0).boundingBox();
    const secondChip = await noRows.nth(1).boundingBox();
    assert.equal(firstChip.y, secondChip.y); // Short capsules share a row.
    assert.ok(
      firstChip.width <
        (await p.locator(".rsvpRoster--no .rsvpRoster__list").boundingBox())
          .width,
    );
    await yes.scrollIntoViewIfNeeded();
    await p.screenshot({ path: "/tmp/rsvp-chips.png", fullPage: true });
    holdSave = false;
    pending.splice(0).forEach((resolve) => resolve());
    await p.waitForFunction(
      () => !document.querySelector(".rsvpViewToolbar__status")?.textContent,
    );
    assert.equal(profiles.get(1).rsvp_view, "chips");
    await p
      .locator(".gameDetailNav")
      .getByRole("button", { name: "Составы", exact: true })
      .click();
    await p.getByRole("button", { name: "← Назад", exact: true }).waitFor();
    assert.equal(await p.locator(".rsvpViewToggle").count(), 0); // Lineups keep their existing UI.
    await p.getByRole("button", { name: "← Назад", exact: true }).click();
    await controls(p).waitFor();
    assert.equal(await p.locator(".rsvpRoster--chips").count(), 3);
    const second = await device(1); // Independent localStorage, server chooses chips.
    assert.equal(await second.page.locator(".rsvpRoster--chips").count(), 3);
    assert.deepEqual(await order(second.page), expectedChips);
    await second.context.close();
    const other = await device(2);
    assert.equal(await other.page.locator(".rsvpRoster--chips").count(), 0);
    await other.context.close();
    failSave = true;
    await choose(p, "Список");
    await p
      .getByText("Не удалось подтвердить сохранение в профиле.", {
        exact: false,
      })
      .waitFor();
    assert.equal(await p.locator(".rsvpRoster--chips").count(), 0);
    assert.equal(profiles.get(1).rsvp_view, "chips");
    failSave = false;
    await p
      .locator(".rsvpViewToolbar")
      .getByRole("button", { name: "Повторить", exact: true })
      .click();
    await p.waitForFunction(
      () => !document.querySelector(".rsvpViewToolbar__status")?.textContent,
    );
    assert.equal(profiles.get(1).rsvp_view, "list");
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.locator(".gameCard__main").first().click();
    await controls(p).waitFor();
    assert.equal(await p.locator(".rsvpRoster--chips").count(), 0);
    assert.deepEqual(await order(p), before);
    assert.deepEqual(errors, []);
    assert.ok(writes.every((write) => write.userId === 1));
    await first.context.close();
    console.log(
      "PASS: immediate list/chips switch for all RSVP groups, view-specific sorting/draft/player actions/team colors/trophies preserved, per-user cache, second-device server restore, independent accounts, error/retry/reload, mobile wrapping, lineups unchanged; mocked API only.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
