import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "./api.js";
import HockeyLoader from "./HockeyLoader.jsx";
import { JerseyBadge } from "./JerseyBadge.jsx";
import AdminPanel from "./AdminPanel.jsx";
import { SupportForm, AboutBlock } from "./ProfileExtras.jsx";

const BOT_DEEPLINK = "https://t.me/HockeyLineupBot";


export default function App() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || "";
  const tgUser = tg?.initDataUnsafe?.user || null;
  const inTelegramWebApp = Boolean(initData && tgUser?.id);

  const [tab, setTab] = useState("game"); // game | players | teams | stats | profile | admin
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [me, setMe] = useState(null);
  const [accessReason, setAccessReason] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [games, setGames] = useState([]);
  const [selectedGameId, setSelectedGameId] = useState(null);

  const [gameView, setGameView] = useState("list"); // list | detail
  const [detailLoading, setDetailLoading] = useState(false);

  const [game, setGame] = useState(null);
  const [rsvps, setRsvps] = useState([]);
  const [teams, setTeams] = useState(null);

  // ручная правка составов
  const [editTeams, setEditTeams] = useState(false);
  const [picked, setPicked] = useState(null); // { team:'A'|'B', tg_id }
  const [teamsBusy, setTeamsBusy] = useState(false);

  // статистика
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsDays, setStatsDays] = useState(365);
  const [attendance, setAttendance] = useState([]);

  // игры: прошедшие
  const [showPast, setShowPast] = useState(false);
  const [gamesError, setGamesError] = useState(null);

  // справочник игроков (вкладка players)
  const [playersDir, setPlayersDir] = useState([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playerQ, setPlayerQ] = useState("");
  const [playerView, setPlayerView] = useState("list"); // list|detail
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);

  // profile sub-tabs
  const [profileView, setProfileView] = useState("me"); // me | support | about

  const [teamsBack, setTeamsBack] = useState({ tab: "game", gameView: "list" });

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
    // прошла, если начало было больше чем 3 часа назад
    return t < Date.now() - 3 * 60 * 60 * 1000;
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
    try {
      setGamesError(null);

      const m = await apiGet("/api/me");

      // доступ закрыт (не в чате / чат не назначен)
      if (m?.ok === false && (m?.reason === "not_member" || m?.reason === "access_chat_not_set")) {
        setMe(null);
        setIsAdmin(false);
        setGames([]);
        setSelectedGameId(null);
        setGame(null);
        setRsvps([]);
        setTeams(null);
        setAccessReason(m.reason);
        return;
      }

      // invalid init data / no user
      if (m?.ok === false && (m?.error === "invalid_init_data" || m?.error === "no_user")) {
        setMe(null);
        setIsAdmin(false);
        setGames([]);
        setSelectedGameId(null);
        setGame(null);
        setRsvps([]);
        setTeams(null);
        setAccessReason(null);
        return;
      }

      // профиль
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
      setAccessReason(null);

      // игры
      const gl = await apiGet("/api/games?days=365");
      if (gl?.ok === false) {
        setGamesError(gl);
        setGames([]);
        setGame(null);
        setRsvps([]);
        setTeams(null);
        return;
      }

      const list = gl.games || [];
      setGames(list);

      const safeNext =
        list.find((g) => g.status === "scheduled" && !isPastGame(g))?.id ??
        list.find((g) => !isPastGame(g))?.id ??
        list[0]?.id ??
        null;

      const nextId = forceGameId ?? selectedGameId ?? safeNext;
      if (nextId) setSelectedGameId(nextId);

      const gg = await apiGet(nextId ? `/api/game?game_id=${nextId}` : "/api/game");
      setGame(gg.game);
      setRsvps(gg.rsvps || []);
      setTeams(normalizeTeams(gg.teams));
    } catch (e) {
      console.error("refreshAll failed", e);
      setGamesError({ ok: false, error: "network_or_unknown" });
    }
  }

  // init
  useEffect(() => {
    if (!inTelegramWebApp) {
      setLoading(false);
      return;
    }

const applyTheme = () => {
  if (!tg) return;

  const scheme = tg.colorScheme || "light";

  // оставим твой data-tg, но добавим универсальный data-theme
  document.documentElement.dataset.tg = scheme;
  document.documentElement.dataset.theme = scheme;

  // прокидываем themeParams в CSS vars (на будущее)
  const p = tg.themeParams || {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "string" && v) {
      document.documentElement.style.setProperty(`--tg-${k}`, v);
    }
  }
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

  useEffect(() => {
    if (tab !== "players") return;

    (async () => {
      try {
        setPlayersLoading(true);
        const r = await apiGet("/api/players");
        setPlayersDir(r.players || []);
      } finally {
        setPlayersLoading(false);
      }
    })();
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

  function cardToneByMyStatus(s) {
    if (s === "yes") return "tone-yes";
    if (s === "maybe") return "tone-maybe";
    if (s === "no") return "tone-no";
    return "tone-none";
  }

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
            const selected =
              picked && picked.team === teamKey && String(picked.tg_id) === String(p.tg_id);

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

  const filteredPlayersDir = useMemo(() => {
    const s = playerQ.trim().toLowerCase();
    if (!s) return playersDir;
    return playersDir.filter((p) => {
      const n = showName(p).toLowerCase();
      return (
        n.includes(s) ||
        String(p.jersey_number ?? "").includes(s) ||
        String(p.tg_id).includes(s)
      );
    });
  }, [playersDir, playerQ]);

  // === RENDER ===

  if (loading) return <HockeyLoader text="Загружаем..." />;

  if (!inTelegramWebApp) {
    return (
      <div className="container">
        <h1>🏒 Хоккей: отметки и составы</h1>
        <div className="card">
          <div className="small">
            Ты открыл приложение как обычный сайт, поэтому Telegram не передал данные пользователя.
            Открой мини-приложение через Telegram.
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

  if (!me && accessReason) {
    const isNotMember = accessReason === "not_member";
    const isChatNotSet = accessReason === "access_chat_not_set";

    return (
      <div className="container">
        <h1>🏒 Хоккей: отметки и составы</h1>

        <div className="card accessCard">
          <div className="accessIcon">{isNotMember ? "🔒" : "⚙️"}</div>

          <h2 style={{ marginTop: 6, marginBottom: 8 }}>
            {isNotMember ? "Доступ ограничен" : "Доступ ещё не настроен"}
          </h2>

          <div className="small" style={{ lineHeight: 1.5, opacity: 0.9 }}>
            {isNotMember && (
              <>
                Это мини-приложение доступно <b>только участникам командного чата</b>.
                <br />
                Если ты знаешь администратора — напиши ему, чтобы тебя добавили в чат.
              </>
            )}

            {isChatNotSet && (
              <>
                Администратор ещё не назначил командный чат для доступа.
                <br />
                Попроси админа зайти в чат команды и выполнить команду <b>/setchat</b>.
              </>
            )}
          </div>

          <hr style={{ opacity: 0.4 }} />

          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn"
              onClick={() => refreshAll(selectedGameId)}
              style={{ flex: 1, minWidth: 160 }}
            >
              🔄 Проверить доступ
            </button>

            <a
              className="btn secondary"
              href={BOT_DEEPLINK}
              style={{ flex: 1, minWidth: 160, textAlign: "center" }}
            >
              💬 Открыть бота
            </a>
          </div>

          <div className="small" style={{ marginTop: 10, opacity: 0.75 }}>
            Подсказка: после добавления в чат просто открой Mini App ещё раз из Telegram.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container appShell">
      <h1>🏒 Хоккей: отметки и составы</h1>

      {/* ====== GAMES ====== */}
      {tab === "game" && (
        <div className="card">
          {gameView === "list" ? (
            <>
              <h2>Игры</h2>

              <div
                className="row"
                style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}
              >
                <button className="btn secondary" onClick={() => setShowPast((v) => !v)}>
                  {showPast ? "⬅️ К предстоящим" : `📜 Прошедшие (${pastGames.length})`}
                </button>

                <span className="small" style={{ opacity: 0.8 }}>
                  {showPast
                    ? `Показаны прошедшие: ${pastGames.length}`
                    : `Показаны предстоящие: ${upcomingGames.length}`}
                </span>
              </div>

              {gamesError ? (
                <div className="card" style={{ border: "1px solid rgba(255,0,0,.25)", marginTop: 10 }}>
                  <div style={{ fontWeight: 900 }}>Не удалось загрузить игры</div>
                  <div className="small" style={{ opacity: 0.85, marginTop: 6 }}>
                    Причина: <b>{gamesError.reason || gamesError.error || gamesError.status || "unknown"}</b>
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn" onClick={() => refreshAll(selectedGameId)}>
                      🔄 Обновить
                    </button>
                  </div>
                </div>
              ) : null}

              {listToShow.length === 0 ? (
                <div className="small" style={{ marginTop: 10 }}>
                  {showPast ? "Прошедших игр пока нет." : "Предстоящих игр пока нет."}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <button
                      className="btn secondary"
                      onClick={async () => {
                        if (!confirm("Поставить ✅ Буду на все будущие игры?")) return;
                        await apiPost("/api/rsvp/bulk", { status: "yes" });
                        await refreshAll(selectedGameId);
                      }}
                    >
                      ✅ Буду на все будущие
                    </button>

                    <button
                      className="btn secondary"
                      onClick={async () => {
                        if (!confirm("Поставить ❌ Не буду на все будущие игры?")) return;
                        await apiPost("/api/rsvp/bulk", { status: "no" });
                        await refreshAll(selectedGameId);
                      }}
                    >
                      ❌ Не буду на все будущие
                    </button>
                  </div>

                  {listToShow.map((g, idx) => {
                    const past = isPastGame(g);
                    const lockRsvp = past && !isAdmin;
                    const when = formatWhen(g.starts_at);
                    const status = g.my_status || "maybe";
                    const tone = cardToneByMyStatus(status);
                    const isNext = !showPast && idx === 0;

                    return (
                      <div
                        key={g.id}
                        className={`card gameCard ${tone} status-${status} ${isNext ? "isNext" : ""} ${
                          past ? "isPast" : ""
                        }`}
                        style={{ cursor: "pointer", opacity: past ? 0.85 : 1 }}
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

                          <div className="row" style={{ gap: 8, alignItems: "center" }}>
                            <span className="badge">{uiStatus(g)}</span>
                            {g.video_url ? <span className="badge" title="Есть видео">▶️</span> : null}
                          </div>
                        </div>

                        <div className="small" style={{ marginTop: 6 }}>
                          📍 {g.location || "—"}
                        </div>

                        <div className="row" style={{ marginTop: 10 }}>
                          <span className="badge">✅ {g.yes_count ?? 0}</span>
                          <span className="badge">❌ {g.no_count ?? 0}</span>
                        </div>

                        <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>
                          {past ? "Игра прошла — отметки закрыты" : "Нажми, чтобы открыть игру"}
                        </div>

                        {/* быстрые кнопки RSVP — только ОДИН раз */}
                        <div
                          className="row"
                          style={{ marginTop: 10, gap: 8 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            disabled={lockRsvp}
                            className={status === "yes" ? "btn tiny" : "btn secondary tiny"}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (lockRsvp) return;
                              await apiPost("/api/rsvp", { game_id: g.id, status: "yes" });
                              await refreshAll(g.id);
                            }}
                          >
                            ✅ Буду
                          </button>

                          <button
                            disabled={lockRsvp}
                            className={status === "no" ? "btn tiny" : "btn secondary tiny"}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (lockRsvp) return;
                              await apiPost("/api/rsvp", { game_id: g.id, status: "no" });
                              await refreshAll(g.id);
                            }}
                          >
                            ❌ Не буду
                          </button>
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

                <button
                  className={tab === "teams" ? "btn" : "btn secondary"}
                    onClick={() => {
                      setTeamsBack({ tab: "game", gameView }); // gameView сейчас "detail"
                      setTab("teams");
                    }}
                >
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
                (() => {
                  const past = isPastGame(game);
                  const lockRsvp = past && !isAdmin;

                  return (
                    <>
                      <div className="row">
                        <span className="badge">⏱ {formatWhen(game.starts_at)}</span>
                        <span className="badge">📍 {game.location || "—"}</span>
                        <span className="badge">{uiStatus(game)}</span>

                        {game.video_url ? (
                          <button
                            className="btn secondary"
                            onClick={() =>
                              tg?.openLink ? tg.openLink(game.video_url) : window.open(game.video_url, "_blank")
                            }
                          >
                            ▶️ Видео
                          </button>
                        ) : null}

                        {myRsvp && <span className="badge">Мой статус: {statusLabel(myRsvp)}</span>}
                      </div>

                      <hr />

                      {game.status === "cancelled" ? (
                        <div className="small">Эта игра отменена.</div>
                      ) : lockRsvp ? (
                        <div className="small" style={{ opacity: 0.85 }}>
                          Игра уже прошла — менять отметки нельзя.
                        </div>
                      ) : (
                        <div className="row">
                          <button className={btnClass("yes")} onClick={() => rsvp("yes")}>
                            ✅ Буду
                          </button>
                          <button className={btnClass("no")} onClick={() => rsvp("no")}>
                            ❌ Не буду
                          </button>
                          <button className={btnClass("maybe")} onClick={() => rsvp("maybe")}>
                            🗘 Сбросить
                          </button>
                        </div>
                      )}

                      <hr />

                      <div className="small">Отметки:</div>

                      <div style={{ marginTop: 10 }}>
                        <StatusBlock title="✅ Будут на игре" tone="yes" list={grouped.yes} isAdmin={isAdmin} />
                        <StatusBlock title="❌ Не будут" tone="no" list={grouped.no} isAdmin={isAdmin} />
                        <StatusBlock title="❓ Не отметились" tone="maybe" list={grouped.maybe} isAdmin={isAdmin} />
                      </div>
                    </>
                  );
                })()
              )}
            </>
          )}
        </div>
      )}

      {/* ====== PROFILE ====== */}
      {tab === "profile" && (
        <div className="card">
          <h2>Профиль</h2>

          <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <button
              className={profileView === "me" ? "btn" : "btn secondary"}
              onClick={() => setProfileView("me")}
            >
              👤 Мой профиль
            </button>
            <button
              className={profileView === "support" ? "btn" : "btn secondary"}
              onClick={() => setProfileView("support")}
            >
              🛟 Техподдержка
            </button>
            <button
              className={profileView === "about" ? "btn" : "btn secondary"}
              onClick={() => setProfileView("about")}
            >
              ℹ️ О приложении
            </button>
          </div>

          {profileView === "me" && (
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
                <label>Фото (ссылка на картинку)</label>
                <input
                  className="input"
                  type="text"
                  placeholder="https://...jpg/png/webp"
                  value={me?.photo_url ?? ""}
                  onChange={(e) => setMe({ ...me, photo_url: e.target.value })}
                />
                <div className="small" style={{ opacity: 0.8, marginTop: 6 }}>
                  Быстрый вариант: вставь ссылку (позже сделаем загрузку через бота).
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <label>Комментарий</label>
                <textarea
                  className="input"
                  rows={3}
                  value={me?.notes || ""}
                  onChange={(e) => setMe({ ...me, notes: e.target.value })}
                />
              </div>

              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={saveProfile} disabled={saving}>
                  {saving ? "Сохраняю..." : "Сохранить"}
                </button>
              </div>
            </div>
          )}

          {profileView === "support" && <SupportForm />}
          {profileView === "about" && <AboutBlock />}
        </div>
      )}

      {/* ====== TEAMS ====== */}
      {tab === "teams" && (
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Составы</h2>

                <button
                  className="btn secondary"
                  onClick={() => {
                    setTab(teamsBack.tab || "game");
                    if ((teamsBack.tab || "game") === "game") {
                      setGameView(teamsBack.gameView || "detail");
                    }
                  }}
                >
                  ← Назад
                </button>
              </div>
          
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
                    <button
                      className="btn secondary"
                      onClick={movePicked}
                      disabled={!picked || teamsBusy}
                      title="Перенести выбранного в другую команду"
                    >
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

      {/* ====== PLAYERS ====== */}
      {tab === "players" && (
        <div className="card">
          {playerView === "list" ? (
            <>
              <h2>Игроки</h2>

              <input
                className="input"
                placeholder="Поиск: имя / номер / id"
                value={playerQ}
                onChange={(e) => setPlayerQ(e.target.value)}
              />

              <hr />

              {playersLoading ? (
                <HockeyLoader text="Загружаем игроков..." />
              ) : filteredPlayersDir.length === 0 ? (
                <div className="small">Пока нет игроков.</div>
              ) : (
                <div style={{ display: "grid", gap: 1 }}>
                  <h3>Игроков: {filteredPlayersDir.length}</h3>
                  {filteredPlayersDir.map((p, index) => (
                    <div
                      key={p.tg_id}
                      className="card"
                      style={{ cursor: "pointer", marginTop: 1, borderRadius: 0 }}
                      onClick={async () => {
                        setPlayerView("detail");
                        setSelectedPlayer(null);
                        setPlayerDetailLoading(true);
                        try {
                          const r = await apiGet(`/api/players/${p.tg_id}`);
                          setSelectedPlayer(r.player || null);
                        } finally {
                          setPlayerDetailLoading(false);
                        }
                      }}
                    >
                      <div className="row" style={{ alignItems: "center", gap: 5 }}>
                          <JerseyBadge
                            number={showNum(p)}
                            variant="modern"
                            striped
                            size={34}
                          />
                        <Avatar p={p} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 900 }}>
                            {showName(p)}
                          </div>
                          <div className="small" style={{ opacity: 0.8 }}>
                            {posHuman(p.position)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>Профиль игрока</h2>
                <button className="btn secondary" onClick={() => setPlayerView("list")}>
                  ← К списку
                </button>
              </div>

              <hr />

              {playerDetailLoading ? (
                <HockeyLoader text="Загружаем профиль..." />
              ) : !selectedPlayer ? (
                <div className="small">Игрок не найден.</div>
              ) : (
                <div className="card">
                  <div className="row" style={{ alignItems: "center", gap: 14 }}>
                    <Avatar p={selectedPlayer} big />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>
                        {showName(selectedPlayer)}
                        <JerseyBadge
                            number={showNum(selectedPlayer)}
                            variant="modern"
                            striped
                            size={34}
                          />
                      </div>
                      <div className="small" style={{ opacity: 0.8 }}>
                        {posHuman(selectedPlayer.position)}
                      </div>
                    </div>
                  </div>

                  {!!selectedPlayer.notes && (
                    <>
                      <hr />
                      <div className="small" style={{ opacity: 0.9 }}>
                        Комментарий:
                      </div>
                      <div>{selectedPlayer.notes}</div>
                    </>
                  )}

                  {isAdmin && (
                    <>
                      <hr />
                      <div className="small" style={{ opacity: 0.8 }}>
                        skill: {selectedPlayer.skill} · skating: {selectedPlayer.skating} · iq:{" "}
                        {selectedPlayer.iq} · stamina: {selectedPlayer.stamina} · passing:{" "}
                        {selectedPlayer.passing} · shooting: {selectedPlayer.shooting}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <BottomNav tab={tab} setTab={setTab} isAdmin={isAdmin} />
    </div>
  );
}

/* ===== helpers (outside) ===== */

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
  return `${Math.trunc(nn)}`;
}

function formatWhen(starts_at) {
  return new Date(starts_at).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const posOrder = (p) => {
  const pos = (p?.position || "F").toUpperCase();
  if (pos === "G") return 0;
  if (pos === "D") return 1;
  return 2;
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

function Avatar({ p, big = false }) {
  const size = big ? 72 : 44;
  const url = (p?.photo_url || "").trim();

  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={{ width: size, height: size, objectFit: "cover" }}
      />
    );
  }

  const letter = (showName(p)[0] || "•").toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
        fontWeight: 900,
        background: "rgba(255,255,255,0.08)",
      }}
    >
      {letter}
    </div>
  );
}
// function JerseyBadge({ number }) {
//   const text = number ? String(number) : "?";

//   return (
//     <div
//       className="jerseyBadge"
//       aria-label={number ? `Номер ${text}` : "Номер не указан"}
//       title={number ? `№ ${text}` : "?"}
//     >
//       <span className="jerseyBadgeText">{text}</span>
//     </div>
//   );
// }

function posHuman(posRaw) {
  const pos = String(posRaw || "F").toUpperCase();
  return pos === "G" ? "🥅 Вратарь" : pos === "D" ? "🛡️ Защитник" : "⚡ Нападающий";
}

function BottomNav({ tab, setTab, isAdmin }) {
  const items = [
    { key: "game", label: "Игры", icon: "📅" },
    { key: "players", label: "Игроки", icon: "👥" },
    { key: "stats", label: "Статистика", icon: "📊" },
    { key: "profile", label: "Профиль", icon: "👤" },
    ...(isAdmin ? [{ key: "admin", label: "Админ", icon: "🛠" }] : []),
  ];

  return (
    <nav className="bottomNav" role="navigation" aria-label="Навигация">
      {items.map((it) => (
        <button
          key={it.key}
          className={"bottomNavItem " + (tab === it.key ? "isActive" : "")}
          onClick={() => setTab(it.key)}
          type="button"
        >
          <span className="bottomNavIcon" aria-hidden="true">{it.icon}</span>
          <span className="bottomNavLabel">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
