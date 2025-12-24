import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "./api.js";
import HockeyLoader from "./HockeyLoader.jsx";
import AdminPanel from "./AdminPanel.jsx";

const BOT_DEEPLINK = "https://t.me/HockeyLineupBot";

export default function App() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || "";
  const tgUser = tg?.initDataUnsafe?.user || null;
  const inTelegramWebApp = Boolean(initData && tgUser?.id);

  // ✅ ВСЕ ХУКИ — ДО ЛЮБЫХ return (иначе ломается React)
  const [tab, setTab] = useState("game"); // game | profile | teams | stats | admin
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [me, setMe] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [games, setGames] = useState([]);
  const [selectedGameId, setSelectedGameId] = useState(null);

  const [gameView, setGameView] = useState("list"); // list | detail
  const [detailLoading, setDetailLoading] = useState(false);

  const [game, setGame] = useState(null);
  const [rsvps, setRsvps] = useState([]);
  const [teams, setTeams] = useState(null);

  // составы — ручная правка
  const [editTeams, setEditTeams] = useState(false);
  const [picked, setPicked] = useState(null); // { team:'A'|'B', tg_id }
  const [teamsBusy, setTeamsBusy] = useState(false);

  // статистика
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsDays, setStatsDays] = useState(365);
  const [attendance, setAttendance] = useState([]);

  // прошедшие игры
  const [showPast, setShowPast] = useState(false);

  function normalizeTeams(t) {
    if (!t) return null;
    if (t.ok && (t.teamA || t.teamB)) return t;
    if (t.team_a || t.team_b) {
      return {
        ok: true,
        teamA: Array.isArray(t.team_a) ? t.team_a : [],
        teamB: Array.isArray(t.team_b) ? t.team_b : [],
        meta: t.meta || { sumA: 0, sumB: 0, diff: 0 },
      };
    }
    return t;
  }

  function isPastGame(g) {
    if (!g?.starts_at) return false;
    const t = new Date(g.starts_at).getTime();
    // "прошла", если начало было больше чем 3 часа назад
    return t < (Date.now() - 3 * 60 * 60 * 1000);
  }

  function uiStatus(g) {
    if (!g) return "";
    if (g.status === "cancelled") return "Отменена";
    if (isPastGame(g)) return "Прошла";
    return "Запланирована";
  }

  async function loadAttendance(days = statsDays) {
    try {
      setStatsLoading(true);
      const res = await apiGet(`/api/stats/attendance?days=${days}`);
      if (res?.ok) setAttendance(res.rows || []);
      else setAttendance([]);
    } finally {
      setStatsLoading(false);
    }
  }

  async function refreshAll(forceGameId) {
    const m = await apiGet("/api/me");

    // если backend не принял initData — покажем понятный экран
    if (m?.ok === false && (m?.error === "invalid_init_data" || m?.error === "no_user")) {
      setMe(null);
      setIsAdmin(false);
      setGames([]);
      setSelectedGameId(null);
      setGame(null);
      setRsvps([]);
      setTeams(null);
      return;
    }

    if (m?.player) {
      setMe(m.player);
    } else if (tgUser?.id) {
      setMe({
        tg_id: tgUser.id,
        first_name: tgUser.first_name || "",
        username: tgUser.username || "",
        position: "F",
        skill: 5,
        skating: 5,
        iq: 5,
        stamina: 5,
        passing: 5,
        shooting: 5,
        notes: "",
      });
    }

    setIsAdmin(!!m?.is_admin);

    const gl = await apiGet("/api/games?days=365");
    const list = gl.games || [];
    setGames(list);

    const safeNext =
      list.find((g) => g.status === "scheduled" && !isPastGame(g))?.id ??
      list.find((g) => !isPastGame(g))?.id ??
      list[0]?.id ??
      null;

    const nextId = forceGameId ?? selectedGameId ?? safeNext;

    if (nextId) setSelectedGameId(nextId);

    const g = await apiGet(nextId ? `/api/game?game_id=${nextId}` : "/api/game");
    setGame(g.game);
    setRsvps(g.rsvps || []);
    setTeams(normalizeTeams(g.teams));
  }

  // init
  useEffect(() => {
    if (!inTelegramWebApp) {
      setLoading(false);
      return;
    }

    const applyTheme = () => {
      if (!tg) return;
      document.documentElement.dataset.tg = tg.colorScheme;
    };

    (async () => {
      try {
        setLoading(true);
        tg?.ready?.();
        tg?.expand?.();
        applyTheme();
        tg?.onEvent?.("themeChanged", applyTheme);
        await refreshAll();
      } finally {
        setLoading(false);
      }
    })();

    return () => tg?.offEvent?.("themeChanged", applyTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "stats") loadAttendance(statsDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function rsvp(status) {
    if (!selectedGameId) return;
    try {
      setLoading(true);
      await apiPost("/api/rsvp", { game_id: selectedGameId, status });
      await refreshAll(selectedGameId);
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      const numeric = ["skill", "skating", "iq", "stamina", "passing", "shooting"];
      const payload = { ...me };
      for (const k of numeric) {
        if (payload[k] == null || payload[k] === "") payload[k] = 5;
      }

      const res = await apiPost("/api/me", payload);
      if (res?.player) setMe(res.player);
    } finally {
      setSaving(false);
    }
  }

  async function generateTeams() {
    if (!selectedGameId) return;
    const res = await apiPost("/api/teams/generate", { game_id: selectedGameId });
    if (res?.ok) setTeams(normalizeTeams(res));
    setTab("teams");
  }

  // ручное редактирование составов (эндпоинт должен существовать на backend)
  async function movePicked() {
    if (!picked || !selectedGameId) return;
    try {
      setTeamsBusy(true);
      const res = await apiPost("/api/teams/manual", {
        game_id: selectedGameId,
        op: "move",
        from: picked.team,
        tg_id: picked.tg_id,
      });
      if (res?.ok) {
        setTeams(normalizeTeams(res));
        setPicked(null);
      }
    } finally {
      setTeamsBusy(false);
    }
  }

  async function swapPicked(withTeam, withId) {
    if (!picked || !selectedGameId) return;
    const a_id = picked.team === "A" ? picked.tg_id : withId;
    const b_id = picked.team === "B" ? picked.tg_id : withId;

    try {
      setTeamsBusy(true);
      const res = await apiPost("/api/teams/manual", {
        game_id: selectedGameId,
        op: "swap",
        a_id,
        b_id,
      });
      if (res?.ok) {
        setTeams(normalizeTeams(res));
        setPicked(null);
      }
    } finally {
      setTeamsBusy(false);
    }
  }

  function onPick(teamKey, tg_id) {
    if (!editTeams) return;

    if (!picked) return setPicked({ team: teamKey, tg_id });

    if (picked.team === teamKey) return setPicked({ team: teamKey, tg_id });

    swapPicked(teamKey, tg_id);
  }

  const myRsvp = useMemo(() => {
    if (!me?.tg_id) return null;
    const row = (rsvps || []).find((r) => String(r.tg_id) === String(me.tg_id));
    return row?.status || null;
  }, [rsvps, me]);

  const statusLabel = (s) => ({ yes: "Буду", maybe: "Под вопросом", no: "Не буду" }[s] || s);
  const btnClass = (s) => (myRsvp === s ? "btn" : "btn secondary");

  function displayName(r) {
    const dn = (r?.display_name || "").trim();
    if (dn) return dn;
    const fn = (r?.first_name || "").trim();
    if (fn) return fn;
    if (r?.username) return `@${r.username}`;
    return String(r?.tg_id ?? "—");
  }

  const grouped = useMemo(() => {
    const g = { yes: [], maybe: [], no: [] };
    for (const r of rsvps || []) {
      if (g[r.status]) g[r.status].push(r);
    }
    for (const k of ["yes", "maybe", "no"]) {
      g[k].sort((a, b) => displayName(a).localeCompare(displayName(b), "ru"));
    }
    return g;
  }, [rsvps]);

  const upcomingGames = useMemo(
    () =>
      (games || [])
        .filter((g) => !isPastGame(g))
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)),
    [games]
  );

  const pastGames = useMemo(
    () =>
      (games || [])
        .filter((g) => isPastGame(g))
        .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)),
    [games]
  );

  const listToShow = showPast ? pastGames : upcomingGames;

  const POS_LABEL = {
    G: "🥅 Вратари",
    D: "🛡️ Защитники",
    F: "⚡ Нападающие",
    U: "❓ Без позиции",
  };

  function groupByPos(list = []) {
    const g = { G: [], D: [], F: [], U: [] };
    for (const p of list) {
      const pos = String(p?.position ?? "").toUpperCase();
      if (pos === "G" || pos === "D" || pos === "F") g[pos].push(p);
      else g.U.push(p);
    }
    return g;
  }

  function renderPosGroup(teamKey, title, players) {
    if (!players?.length) return null;

    return (
      <>
        <div className="teamGroupTitle">{title}</div>
        <div className="pills">
          {players.map((p) => {
            const selected = picked && picked.team === teamKey && String(picked.tg_id) === String(p.tg_id);

            return (
              <div
                key={p.tg_id}
                className={"pill " + (selected ? "pillSelected" : "")}
                onClick={() => onPick(teamKey, p.tg_id)}
                style={{ cursor: editTeams ? "pointer" : "default" }}
              >
                <span className="pillName">
                  {showName(p)}
                  {showNum(p)}
                </span>
                {isAdmin && <span className="pillMeta">{Number(p.rating ?? 0).toFixed(1)}</span>}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function renderTeam(teamKey, title, list) {
    const g = groupByPos(list || []);
    return (
      <>
        <h3>{title}</h3>
        {renderPosGroup(teamKey, POS_LABEL.G, g.G)}
        {renderPosGroup(teamKey, POS_LABEL.D, g.D)}
        {renderPosGroup(teamKey, POS_LABEL.F, g.F)}
        {renderPosGroup(teamKey, POS_LABEL.U, g.U)}
      </>
    );
  }

  // === РЕНДЕРЫ ===

  if (loading) return <HockeyLoader text="Загружаем..." />;

  // если открыли не через Telegram Mini App
  if (!inTelegramWebApp) {
    return (
      <div className="container">
        <h1>🏒 Хоккей: отметки и составы</h1>
        <div className="card">
          <div className="small">
            Ты открыл приложение как обычный сайт, поэтому Telegram не передал данные пользователя. Открой мини-приложение
            через Telegram.
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <a className="btn" href={BOT_DEEPLINK}>
              Открыть в Telegram
            </a>
          </div>
          <div className="small" style={{ marginTop: 10 }}>
            Если ссылка не сработала — открой бота в Telegram и нажми “Start”.
          </div>
        </div>
      </div>
    );
  }

  // если /api/me вернул ошибку по initData
  if (!me) {
    return (
      <div className="container">
        <h1>🏒 Хоккей: отметки и составы</h1>
        <div className="card">
          <div className="small">
            Backend не принял данные Telegram (initData). Обычно это означает неправильный BOT_TOKEN на backend или открытие
            не через Mini App.
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <a className="btn" href={BOT_DEEPLINK}>
              Открыть бота
            </a>
            <button className="btn secondary" onClick={() => refreshAll()}>
              Повторить
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>🏒 Хоккей: отметки и составы</h1>

      <div className="row">
        <button className={tab === "game" ? "btn" : "btn secondary"} onClick={() => setTab("game")}>
          Игры
        </button>
        <button className={tab === "profile" ? "btn" : "btn secondary"} onClick={() => setTab("profile")}>
          Профиль
        </button>

        <button className={tab === "stats" ? "btn" : "btn secondary"} onClick={() => setTab("stats")}>
          Статистика
        </button>
        {isAdmin && (
          <button className={tab === "admin" ? "btn" : "btn secondary"} onClick={() => setTab("admin")}>
            Админ
          </button>
        )}
      </div>

      {/* ====== GAMES ====== */}
      {tab === "game" && (
        <div className="card">
          {gameView === "list" ? (
            <>
              <h2>Игры</h2>

              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <button className="btn secondary" onClick={() => setShowPast((v) => !v)}>
                  {showPast ? "⬅️ К предстоящим" : `📜 Прошедшие (${pastGames.length})`}
                </button>

                <span className="small" style={{ opacity: 0.8 }}>
                  {showPast ? `Показаны прошедшие: ${pastGames.length}` : `Показаны предстоящие: ${upcomingGames.length}`}
                </span>
              </div>

              {listToShow.length === 0 ? (
                <div className="small" style={{ marginTop: 10 }}>
                  {showPast ? "Прошедших игр пока нет." : "Предстоящих игр пока нет."}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {listToShow.map((g) => {
                    const when = formatWhen(g.starts_at);

                    return (
                      <div
                        key={g.id}
                        className="card"
                        style={{ cursor: "pointer", opacity: isPastGame(g) ? 0.85 : 1 }}
                        onClick={() => {
                          const id = g.id;

                          setSelectedGameId(id);
                          setGameView("detail");

                          setGame(null);
                          setRsvps([]);
                          setTeams(null);

                          setDetailLoading(true);
                          refreshAll(id).finally(() => setDetailLoading(false));
                        }}
                      >
                        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: 900 }}>{when}</div>
                          <span className="badge">{uiStatus(g)}</span>
                          <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          {g.video_url ? <span className="badge" title="Есть видео">▶️</span> : null}
                        </div>
                        </div>

                        <div className="small" style={{ marginTop: 6 }}>
                          📍 {g.location || "—"}
                        </div>

                        <div className="row" style={{ marginTop: 10 }}>
                          <span className="badge">✅ {g.yes_count ?? 0}</span>
                          <span className="badge">❓ {g.maybe_count ?? 0}</span>
                          <span className="badge">❌ {g.no_count ?? 0}</span>
                        </div>
                        <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>
                          Нажми, чтобы открыть игру
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>Игра</h2>
                        <button className={tab === "teams" ? "btn" : "btn secondary"} onClick={() => setTab("teams")}>
                        Составы
                      </button>
                <button className="btn secondary" onClick={() => setGameView("list")}>
                  ← К списку
                </button>
              </div>

              <hr />

              {detailLoading ? (
                <HockeyLoader text="Загружаем игру..." />
              ) : !game ? (
                <div className="small">Не удалось загрузить игру.</div>
              ) : (
                <>
                  <div className="row">
                    <span className="badge">⏱ {formatWhen(game.starts_at)}</span>
                    <span className="badge">📍 {game.location || "—"}</span>
                    <span className="badge">{uiStatus(game)}</span>
                    {game.video_url ? (
                      <button
                        className="btn secondary"
                        onClick={() => tg?.openLink ? tg.openLink(game.video_url) : window.open(game.video_url, "_blank")}
                      >
                        ▶️ Видео
                      </button>
                    ) : null}
                    {myRsvp && <span className="badge">Мой статус: {statusLabel(myRsvp)}</span>}
                  </div>

                  <hr />

                  {game.status === "cancelled" ? (
                    <div className="small">Эта игра отменена.</div>
                  ) : (
                    <div className="row">
                      <button className={btnClass("yes")} onClick={() => rsvp("yes")}>
                        ✅ Буду
                      </button>
                      <button className={btnClass("maybe")} onClick={() => rsvp("maybe")}>
                        ❓ Под вопросом
                      </button>
                      <button className={btnClass("no")} onClick={() => rsvp("no")}>
                        ❌ Не буду
                      </button>
                    </div>
                  )}

                  <hr />

                  <div className="small">Отметки:</div>

                  <div style={{ marginTop: 10 }}>
                    <StatusBlock title="✅ Будут на игре" tone="yes" list={grouped.yes} isAdmin={isAdmin} />
                    <StatusBlock title="❓ Под вопросом" tone="maybe" list={grouped.maybe} isAdmin={isAdmin} />
                    <StatusBlock title="❌ Не будут" tone="no" list={grouped.no} isAdmin={isAdmin} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ====== PROFILE ====== */}
      {tab === "profile" && (
        <div className="card">
          <h2>Мой профиль</h2>
          <div className="small">Заполни один раз — дальше просто отмечайся.</div>

          <div style={{ marginTop: 10 }}>
            <label>Имя для отображения (если пусто — возьмём имя из Telegram)</label>
            <input
              className="input"
              type="text"
              placeholder={me?.first_name || "Например: Илья"}
              value={me?.display_name ?? ""}
              onChange={(e) => setMe({ ...me, display_name: e.target.value })}
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Номер игрока (0–99)</label>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Например: 17"
              value={me?.jersey_number == null ? "" : String(me.jersey_number)}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, "");
                if (raw === "") return setMe({ ...me, jersey_number: null });
                const n = Math.max(0, Math.min(99, parseInt(raw, 10)));
                setMe({ ...me, jersey_number: n });
              }}
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Позиция</label>
            <select value={me?.position || "F"} onChange={(e) => setMe({ ...me, position: e.target.value })}>
              <option value="F">F (нападающий)</option>
              <option value="D">D (защитник)</option>
              <option value="G">G (вратарь)</option>
            </select>
          </div>

          {["skill", "skating", "iq", "stamina", "passing", "shooting"].map((k) => (
            <div key={k} style={{ marginTop: 10 }}>
              <label>{label(k)} (1–10)</label>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="1–10"
                value={me?.[k] == null ? "" : String(me[k])}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, "");
                  if (raw === "") return setMe({ ...me, [k]: null });
                  const n = Math.max(1, Math.min(10, parseInt(raw, 10)));
                  setMe({ ...me, [k]: n });
                }}
              />
            </div>
          ))}

          <div style={{ marginTop: 10 }}>
            <label>Комментарий</label>
            <textarea className="input" rows={3} value={me?.notes || ""} onChange={(e) => setMe({ ...me, notes: e.target.value })} />
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={saveProfile} disabled={saving}>
              {saving ? "Сохраняю..." : "Сохранить"}
            </button>
          </div>
        </div>
      )}

      {/* ====== TEAMS ====== */}
      {tab === "teams" && (
        <div className="card">
          <h2>Составы</h2>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn secondary" onClick={() => refreshAll(selectedGameId)}>
              Обновить
            </button>
            {isAdmin && (
              <button className="btn" onClick={generateTeams} disabled={!selectedGameId || game?.status === "cancelled"}>
                Сформировать сейчас (админ)
              </button>
            )}
          </div>

          {teams?.ok ? (
            <>
              <hr />
              <div className="row">
                <span className="badge">ΣA {Number(teams.meta?.sumA ?? 0).toFixed(1)}</span>
                <span className="badge">ΣB {Number(teams.meta?.sumB ?? 0).toFixed(1)}</span>
                <span className="badge">
                  diff {Number(teams.meta?.diff ?? 0).toFixed(1)}
                  {Number(teams.meta?.diff ?? 0) >= 3 ? " ⚠️" : ""}
                </span>
              </div>

              {isAdmin && (
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    className={editTeams ? "btn" : "btn secondary"}
                    onClick={() => {
                      setEditTeams((v) => !v);
                      setPicked(null);
                    }}
                    disabled={teamsBusy}
                  >
                    {editTeams ? "✅ Режим правки" : "✏️ Править составы"}
                  </button>

                  {editTeams && (
                    <button className="btn secondary" onClick={movePicked} disabled={!picked || teamsBusy} title="Перенести выбранного в другую команду">
                      ⇄ Перенести
                    </button>
                  )}

                  {editTeams && picked && (
                    <span className="small" style={{ opacity: 0.8 }}>
                      Выбран: {picked.team} · {picked.tg_id}
                    </span>
                  )}
                </div>
              )}

              <hr />
              {renderTeam("A", "⬜ Белые", teams.teamA || [])}

              <hr />
              {renderTeam("B", "🟦 Синие", teams.teamB || [])}
            </>
          ) : (
            <div className="small" style={{ marginTop: 10 }}>
              Составов пока нет. Нажми “Сформировать сейчас”.
            </div>
          )}
        </div>
      )}

      {/* ====== STATS ====== */}
      {tab === "stats" && (
        <div className="card">
          <h2>Статистика посещений</h2>

          <div className="row" style={{ marginTop: 10 }}>
            <select
              value={statsDays}
              onChange={(e) => {
                const v = Number(e.target.value);
                setStatsDays(v);
                loadAttendance(v);
              }}
            >
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
              <option value={365}>365 дней</option>
              <option value={0}>Всё время</option>
            </select>

            <button className="btn secondary" onClick={() => loadAttendance(statsDays)} disabled={statsLoading}>
              {statsLoading ? "Считаю..." : "Обновить"}
            </button>
          </div>

          <hr />

          {attendance.length === 0 ? (
            <div className="small">Пока нет данных.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {attendance.map((r, idx) => {
                const medal = idx === 0 ? "🐑🥇" : idx === 1 ? "🐑🥈" : idx === 2 ? "🐑🥉" : "";
                return (
                  <div key={r.tg_id} className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <b>
                        {idx + 1}. {medal} {r.name}
                        {r.jersey_number != null ? ` №${r.jersey_number}` : ""}
                      </b>
                      <div className="small" style={{ opacity: 0.8 }}>
                        {r.position ? `Позиция: ${r.position}` : ""}
                        {r.is_guest ? " · 👤 гость" : ""}
                      </div>
                    </div>

                    <div className="row">
                      <span className="badge">✅ {r.yes ?? 0}</span>
                      <span className="badge">❓ {r.maybe ?? 0}</span>
                      <span className="badge">❌ {r.no ?? 0}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ====== ADMIN ====== */}
      {tab === "admin" && isAdmin && (
        <AdminPanel
          apiGet={apiGet}
          apiPost={apiPost}
          apiPatch={apiPatch}
          apiDelete={apiDelete}
          onChanged={() => refreshAll(selectedGameId)}
        />
      )}
    </div>
  );
}

/* ===== helpers (наружу) ===== */

function label(k) {
  const m = {
    skill: "Общий уровень",
    skating: "Катание",
    iq: "Понимание игры",
    stamina: "Выносливость",
    passing: "Пасы",
    shooting: "Бросок",
  };
  return m[k] || k;
}

function showName(p) {
  const dn = (p?.display_name || "").trim();
  if (dn) return dn;

  const fn = (p?.first_name || "").trim();
  if (fn) return fn;

  if (p?.username) return `@${p.username}`;

  return String(p?.tg_id ?? "—");
}

function showNum(p) {
  const n = p?.jersey_number;
  if (n === null || n === undefined || n === "") return "";
  const nn = Number(n);
  if (!Number.isFinite(nn)) return "";
  return ` №${Math.trunc(nn)}`;
}
function formatWhen(starts_at) {
  return new Date(starts_at).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",      // чтобы было 7, а не 07 (если хочешь 07 — поставь "2-digit")
    minute: "2-digit",
  });
}
const posOrder = (p) => {
  const pos = (p?.position || "F").toUpperCase();
  if (pos === "G") return 0;
  if (pos === "D") return 1;
  return 2; // F
};

function posLabel(posRaw) {
  const pos = (posRaw || "F").toUpperCase();
  return pos === "G" ? "🥅 G" : pos === "D" ? "🛡 D" : "🏒 F";
}

function StatusBlock({ title, tone, list = [], isAdmin }) {
  const cls = `statusBlock ${tone}`;

  return (
    <div className={cls}>
      <div className="statusHeader">
        <div className="statusTitle">{title}</div>
        <span className="badge">{list.length}</span>
      </div>

      {list.length === 0 ? (
        <div className="small" style={{ opacity: 0.8 }}>
          —
        </div>
      ) : (
        <div className="pills">
          {[...list]
            .sort((a, b) => posOrder(a) - posOrder(b))
            .map((r) => {
              const pos = (r.position || "F").toUpperCase();
              return (
                <div key={r.tg_id} className={`pill pos-${pos}`}>
                  <span className="posTag">{posLabel(pos)}</span>
                  <span className="pillName">
                    {showName(r)}
                    {showNum(r)}
                    {r.is_guest ? " · 👤 гость" : ""}
                  </span>

                  {isAdmin && r.skill != null && <span className="pillMeta">skill {r.skill}</span>}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
