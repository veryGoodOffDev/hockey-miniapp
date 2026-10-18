// Run Vite first, then: NODE_PATH=/path/to/playwright/node_modules node webapp/tests/sheep-reminder.browser.cjs
// All API calls are mocked; this test never changes live awards.
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
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const player = {
      tg_id: 1,
      display_name: "Иван",
      position: "F",
      status: "yes",
    };
    const games = [
      {
        id: 11,
        starts_at: new Date(Date.now() - 86400000).toISOString(),
        status: "scheduled",
        best_player_tg_id: 1,
      },
      {
        id: 12,
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        status: "scheduled",
      },
    ];
    let failDetail = false;
    let detailRequests = 0;
    let writes = 0;
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
      const url = new URL(r.request().url());
      if (r.request().method() !== "GET") writes++;
      let body = {
        ok: true,
        messages: [],
        conversations: [],
        comments: [],
        players: [player],
        items: [],
        reactions: [],
        unread_total: 0,
      };
      if (url.pathname === "/api/me")
        body = { ok: true, player, is_admin: false };
      if (url.pathname === "/api/games")
        body = {
          ok: true,
          games:
            url.searchParams.get("scope") === "past" ? [games[0]] : [games[1]],
          total: 1,
        };
      if (url.pathname === "/api/game") {
        detailRequests++;
        if (failDetail) return r.fulfill({ status: 503, json: { ok: false } });
        const game = games.find(
          (g) => g.id === Number(url.searchParams.get("game_id")),
        );
        body = {
          ok: true,
          game: {
            ...game,
            previous_game_award:
              game.id === games[1].id && games[0].best_player_tg_id != null
                ? {
                    game_id: 11,
                    tg_id: games[0].best_player_tg_id,
                    name: "Иван",
                  }
                : null,
          },
          rsvps: [player],
          teams: null,
          vote_results: [],
        };
      }
      if (url.pathname === "/api/game/profile")
        body = { ok: true, sheepCoins: 0 };
      return r.fulfill({ json: body });
    });
    const modal = () =>
      page.getByRole("dialog", {
        name: "Не забудь принести овечку на следующую игру",
        exact: true,
      });
    const url = process.argv[2] || "http://localhost:5173/";
    async function enter() {
      detailRequests = 0;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.locator(".gameCard").first().waitFor();
    }
    await enter();
    await modal().waitFor();
    assert.equal(await modal().evaluate((e) => e.matches(":modal")), true);
    assert.equal(
      await modal().locator("img").getAttribute("src"),
      "/premiumaward.png",
    );
    assert.equal(
      await modal()
        .locator("img")
        .evaluate((e) => e.complete && e.naturalWidth > 0),
      true,
    );
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await modal().evaluate(
          (e) => e.getBoundingClientRect().right <= innerWidth,
        ),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await page.screenshot({ path: "/tmp/sheep-reminder.png" });
    await modal().getByRole("button", { name: "Хорошо", exact: true }).click();
    assert.equal(await modal().count(), 0);
    await page.locator(".gameCard__main").first().click();
    await page.locator(".gameDetailNav").waitFor();
    assert.equal(await modal().count(), 0); // Navigation does not reopen it.
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    await enter(); // Acknowledge without checkbox: shown on next entry.
    await modal().waitFor();
    await modal().getByRole("checkbox").check();
    await modal().getByRole("button", { name: "Хорошо", exact: true }).click();
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("sheep-reminder:v1:1:11:12"),
      ),
      "1",
    );
    await enter();
    assert.equal(await modal().count(), 0); // Persisted across reload.
    games[1].id = 15; // A new award/next-game context is independent.
    await enter();
    await modal().waitFor();
    await modal().getByRole("button", { name: "Хорошо", exact: true }).click();
    player.tg_id = 2; // A different authenticated player never sees someone else's reminder.
    await enter();
    assert.equal(await modal().count(), 0);
    player.tg_id = 1;
    games[0].best_player_tg_id = null;
    await enter();
    assert.equal(await modal().count(), 0); // Cancelled/no award.
    games[0].best_player_tg_id = 1;
    games[1].status = "cancelled";
    await enter();
    assert.equal(await modal().count(), 0);
    games[1].status = "scheduled";
    failDetail = true;
    await enter();
    assert.equal(await modal().count(), 0); // Optional API failure cannot block the app.
    failDetail = false;
    await page.addInitScript(() => {
      Storage.prototype.setItem = function () {
        throw new Error("Storage disabled");
      };
    });
    await enter();
    await modal().waitFor();
    await modal().getByRole("checkbox").check();
    await modal().getByRole("button", { name: "Хорошо", exact: true }).click();
    await modal().getByRole("alert").waitFor();
    await modal().getByRole("checkbox").uncheck();
    await modal().getByRole("button", { name: "Хорошо", exact: true }).click();
    assert.equal(await modal().count(), 0);
    assert.deepEqual(errors, []);
    assert.equal(writes, 0);
    console.log(
      "PASS: holder-only, native modal, image, mobile widths, session dismissal, opt-out persistence, new context, no award, cancelled game, API failure, storage failure; no live writes.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
