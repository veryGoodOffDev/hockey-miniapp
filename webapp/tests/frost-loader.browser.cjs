// Real React startup with held/mocked API requests, never the production backend.
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
    // The same shell is present even before the application JavaScript runs.
    const shell = await browser.newPage({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    await shell.goto(process.argv[2] || "http://localhost:5173/", {
      waitUntil: "domcontentloaded",
    });
    await shell.locator("#startup-splash").waitFor();
    assert.equal(
      await shell.getByText("Подключаемся…", { exact: true }).count(),
      1,
    );
    assert.equal(
      await shell
        .locator("#startup-splash img")
        .evaluate((e) => e.complete && e.naturalWidth > 0),
      true,
    );
    await shell.close();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
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
    const latch = () => {
      let release;
      const promise = new Promise((r) => {
        release = r;
      });
      return { promise, release };
    };
    const auth = latch(),
      games = latch(),
      detail = latch();
    let failGames = true,
      meRequests = 0;
    const game = {
      id: 12,
      status: "scheduled",
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      location: "Ледовая арена",
      my_status: "yes",
    };
    const player = { tg_id: 1, display_name: "Иван", position: "F" };
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
        players: [player],
        items: [],
        reactions: [],
        unread_total: 0,
      };
      if (url.pathname === "/api/me") {
        meRequests++;
        await auth.promise;
        body = { ok: true, player, is_admin: false };
      }
      if (url.pathname === "/api/games") {
        if (url.searchParams.get("scope") === "upcoming") {
          await games.promise;
          if (failGames) return r.abort("failed");
        }
        body = {
          ok: true,
          games: url.searchParams.get("scope") === "past" ? [] : [game],
          total: 1,
        };
      }
      if (url.pathname === "/api/game") {
        await detail.promise;
        body = {
          ok: true,
          game: { ...game, previous_game_award: null },
          rsvps: [{ ...player, status: "yes" }],
          teams: null,
          vote_results: [],
        };
      }
      if (url.pathname === "/api/game/profile")
        body = { ok: true, sheepCoins: 0 };
      return r.fulfill({ json: body });
    });
    await page.goto(process.argv[2] || "http://localhost:5173/", {
      waitUntil: "domcontentloaded",
    });
    await page.getByText("Проверяем доступ…", { exact: true }).waitFor();
    assert.equal(await page.locator("#startup-splash").count(), 0);
    assert.equal(await page.locator(".hkLoader2,.hkOrbit").count(), 0);
    const node = await page.locator(".frostLoader--screen").elementHandle();
    const same = async () =>
      assert.equal(
        await node.evaluate(
          (e) =>
            e.isConnected &&
            e === document.querySelector(".frostLoader--screen"),
        ),
        true,
      );
    assert.equal(await page.locator(".frostLoader__edge").count(), 0);
    const overlay = page.locator(".frostLoader__overlay");
    const maskFrames = await overlay.evaluate((element) => {
      const animation = element.getAnimations()[0];
      animation.pause();
      const samples = [0, 900, 1800].map((time) => {
        animation.currentTime = time;
        return getComputedStyle(element).maskSize;
      });
      const style = getComputedStyle(element);
      const result = {
        samples,
        name: style.animationName,
        duration: style.animationDuration,
        image: style.backgroundImage,
        mask: style.maskImage,
      };
      animation.finish();
      return result;
    });
    assert.equal(maskFrames.name, "frostReveal");
    assert.equal(maskFrames.duration, "1.8s");
    assert.match(maskFrames.image, /frost-overlay\.png/);
    assert.equal((maskFrames.mask.match(/linear-gradient/g) || []).length, 4);
    assert.equal(maskFrames.samples[0], "100% 0%, 100% 0%, 0% 100%, 0% 100%");
    assert.notEqual(maskFrames.samples[1], maskFrames.samples[0]);
    assert.notEqual(maskFrames.samples[1], maskFrames.samples[2]);
    assert.equal(
      maskFrames.samples[2],
      "100% 100%, 100% 100%, 100% 100%, 100% 100%",
    );
    const asset = await page.request.get(
      new URL("/frost-overlay.png", page.url()).href,
    );
    assert.equal(asset.status(), 200);
    assert.match(asset.headers()["content-type"], /image\/png/);
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const center = await page.locator(".frostLoader__content").boundingBox();
      assert.ok(Math.abs(center.y + center.height / 2 - 422) < 4);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page
        .locator(".frostLoader__emblem img")
        .evaluate((e) => e.complete && e.naturalWidth > 0),
      true,
    );
    await page.screenshot({ path: "/tmp/frost-loader.png" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".frostLoader__overlay")
        .first()
        .evaluate((e) => getComputedStyle(e).animationName),
      "none",
    );
    assert.equal(
      await page
        .locator(".frostLoader__activity i")
        .first()
        .evaluate((e) => getComputedStyle(e).animationName),
      "none",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    auth.release();
    await page.getByText("Загружаем игры…", { exact: true }).waitFor();
    await same();
    assert.equal(meRequests, 1); // Reuse the authenticated profile; no second auth round trip.
    games.release();
    await page
      .getByRole("heading", {
        name: "Не удалось связаться с сервером",
        exact: true,
      })
      .waitFor();
    await same();
    assert.equal(
      await page
        .getByRole("button", { name: "Повторить", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(await page.locator(".appShell").count(), 0);
    await page.screenshot({ path: "/tmp/frost-loader-error.png" });
    await page.setViewportSize({ width: 390, height: 360 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    failGames = false;
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await page.getByText("Загружаем составы…", { exact: true }).waitFor();
    await same();
    assert.equal(meRequests, 1);
    detail.release();
    await page.locator(".gameCard").first().waitFor();
    await page.locator(".frostLoader--screen").waitFor({ state: "detached" });
    assert.equal(await page.locator("[inert]").count(), 0);
    assert.equal(
      await page.locator('[aria-hidden="true"] .appShell').count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: one persistent centered frost screen across auth/games/detail/error/retry, one auth request, assets, mobile widths/landscape, reduced motion, focus, fade cleanup and restored interaction.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
