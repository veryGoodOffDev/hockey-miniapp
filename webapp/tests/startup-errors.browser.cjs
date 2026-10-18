// All endpoints are mocked. Start Vite and run with playwright-core on NODE_PATH.
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
  const url = process.argv[2] || "http://localhost:5173/";
  const player = { tg_id: 1, display_name: "Иван", position: "F" };
  const game = {
    id: 12,
    status: "scheduled",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    location: "Арена",
    my_status: "yes",
  };
  const runtimeErrors = [];
  async function setup(initialMode, { telegram = true, offline = false } = {}) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.on("pageerror", (e) => runtimeErrors.push(e.message));
    let mode = initialMode;
    await page.addInitScript(
      ({ telegram, offline }) => {
        if (telegram)
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
        if (offline)
          Object.defineProperty(navigator, "onLine", { get: () => false });
        // Accelerate the UI timeout case; unit tests exercise the real deadline/body-abort logic.
        const original = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) =>
          original(fn, ms > 10000 && ms <= 12000 ? 150 : ms, ...args);
      },
      { telegram, offline },
    );
    await page.route("https://telegram.org/**", (r) =>
      r.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await page.route("**/api/**", async (r) => {
      const path = new URL(r.request().url()).pathname;
      if (
        path === "/api/me" &&
        mode !== "healthy" &&
        mode !== "games-network"
      ) {
        if (mode === "network") return r.abort("failed");
        if (mode === "timeout") return; // No response until the real request timer aborts it.
        if (mode === "html")
          return r.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<html>Proxy response</html>",
          });
        if (mode === "empty") return r.fulfill({ status: 200, body: "" });
        const cases = {
          server: [503, { ok: false, reason: "server_error" }],
          gateway: [502, null],
          telegram: [503, { ok: false, reason: "telegram_unavailable" }],
          auth: [401, { ok: false, reason: "expired_init_data" }],
          login: [401, { ok: false, reason: "no_init_data" }],
          access: [403, { ok: false, reason: "not_member" }],
          unknown: [200, { ok: false, reason: "unknown" }],
          returnedError: [200, { ok: false, error: "network_error" }],
        };
        const [status, json] = cases[mode];
        return json
          ? r.fulfill({ status, json })
          : r.fulfill({
              status,
              contentType: "text/html",
              body: "<html>Bad gateway</html>",
            });
      }
      if (path === "/api/games" && mode === "games-network")
        return r.abort("failed");
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
      if (path === "/api/me") body = { ok: true, player, is_admin: false };
      if (path === "/api/games") body = { ok: true, games: [game], total: 1 };
      if (path === "/api/game")
        body = {
          ok: true,
          game: { ...game, previous_game_award: null },
          rsvps: [{ ...player, status: "yes" }],
          teams: null,
          vote_results: [],
        };
      if (path === "/api/game/profile") body = { ok: true, sheepCoins: 0 };
      return r.fulfill({ json: body });
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return {
      page,
      setMode: (next) => {
        mode = next;
      },
    };
  }
  try {
    for (const [mode, title, hasVPN] of [
      ["network", "Не удалось связаться с сервером", true],
      ["timeout", "Сервер не ответил вовремя", true],
      ["html", "Не удалось получить данные приложения", true],
      ["empty", "Не удалось получить данные приложения", true],
      ["server", "Сервер временно недоступен", false],
      ["gateway", "Сервер временно недоступен", false],
      ["telegram", "Не удалось проверить доступ через Telegram", false],
      ["auth", "Не удалось подтвердить вход", false],
      ["access", "Нет доступа", false],
      ["unknown", "Не удалось завершить загрузку", false],
      ["returnedError", "Не удалось связаться с сервером", true],
    ]) {
      const { page, setMode } = await setup(mode);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      assert.equal(
        (await page.locator("body").innerText()).includes("VPN"),
        hasVPN,
        mode,
      );
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /unknown|network_error|non_json_response/,
      );
      assert.equal(await page.locator(".appShell").count(), 0, mode);
      assert.equal(
        await page
          .getByRole("button", { name: "Повторить", exact: true })
          .count(),
        1,
      );
      if (mode === "network")
        await page.screenshot({ path: "/tmp/startup-network-error.png" });
      setMode("healthy");
      await page
        .getByRole("button", { name: "Повторить", exact: true })
        .click();
      await page.locator(".gameCard").first().waitFor();
      assert.equal(
        await page.getByRole("heading", { name: title, exact: true }).count(),
        0,
      );
      await page.close();
    }
    {
      const { page } = await setup("network", { offline: true });
      await page
        .getByRole("heading", {
          name: "Нет подключения к интернету",
          exact: true,
        })
        .waitFor();
      assert.doesNotMatch(await page.locator("body").innerText(), /VPN/);
      await page.close();
    }
    {
      const { page } = await setup("login", { telegram: false });
      await page
        .getByRole("button", { name: "Войти по email (код)", exact: true })
        .waitFor();
      await page.close();
    }
    {
      const { page } = await setup("network", { telegram: false });
      await page
        .getByRole("heading", {
          name: "Не удалось связаться с сервером",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Войти по email (код)", exact: true })
          .count(),
        0,
      );
      await page.close();
    }
    {
      const { page, setMode } = await setup("games-network");
      await page
        .getByRole("heading", {
          name: "Не удалось связаться с сервером",
          exact: true,
        })
        .waitFor();
      assert.match(await page.locator("body").innerText(), /VPN/);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /Предстоящих игр пока нет|network_or_unknown/,
      );
      setMode("healthy");
      await page
        .getByRole("button", { name: "Повторить", exact: true })
        .click();
      await page.locator(".gameCard").first().waitFor();
      assert.equal(
        await page
          .getByText("Не удалось загрузить игры", { exact: true })
          .count(),
        0,
      );
      await page.close();
    }
    assert.deepEqual(runtimeErrors, []);
    console.log(
      "PASS: startup network/offline/timeout/malformed-200/empty-200/HTTP5xx/Telegram/auth/access/unknown errors, working retry, browser login vs connectivity, game-loading failure and retry; no live API calls.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
