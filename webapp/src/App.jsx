import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "./api.js";
import HockeyLoader from "./HockeyLoader.jsx";
import AdminPanel from "./AdminPanel.jsx";

export default function App() {
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [rsvps, setRsvps] = useState([]);

  const [games, setGames] = useState([]);
  const [selectedGameId, setSelectedGameId] = useState(null);

  const [isAdmin, setIsAdmin] = useState(false);

  const [teams, setTeams] = useState(null);
  const [tab, setTab] = useState("game");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // --- helper: normalize teams payload
  function normalizeTeams(t) {
    if (!t) return null;

    // вариант: из /api/teams/generate -> { ok, teamA, teamB, meta }
    if (t.ok && (t.teamA || t.teamB)) return t;

    // вариант: из /api/game -> teams row { team_a, team_b, meta }
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

  async function refreshAll(forceGameId) {
    const m = await apiGet("/api/me");
    if (m?.player) setMe(m.player);
    setIsAdmin(!!m?.is_admin);

    const gl = await apiGet("/api/games?days=35");
    const list = gl.games || [];
    setGames(list);

    const nextId =
      forceGameId ??
      selectedGameId ??
      (list.find((g) => g.status === "scheduled")?.id ?? null);

    if (nextId) setSelectedGameId(nextId);

    const g = await apiGet(nextId ? `/api/game?game_id=${nextId}` : "/api/game");
    setGame(g.game);
    setRsvps(g.rsvps || []);
    setTeams(normalizeTeams(g.teams));
  }

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    const applyTheme = () => {
      if (!tg) return;
      document.documentElement.dataset.tg = tg.colorScheme; // "light" | "dark"
    };

    (async () => {
      try {
        setLoading(true);

        if (tg) {
          tg.ready();
          tg.expand();
          applyTheme();
          tg.onEvent("themeChanged", applyTheme);
        }

        await refreshAll();
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (tg) tg.offEvent("themeChanged", applyTheme);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const res = await apiPost("/api/me", me);
    if (res?.player) setMe(res.player);
    setSaving(false);
  }

  async function generateTeams() {
    if (!selectedGameId) return;
    const res = await apiPost("/api/teams/generate", { game_id: selectedGameId });
    if (res?.ok) setTeams(normalizeTeams(res));
    setTab("teams");
  }

  const myRsvp = useMemo(() => {
    if (!me?.tg_id) return null;
    const row = rsvps.find((r) => String(r.tg_id) === String(me.tg_id));
    return row?.status || null;
  }, [rsvps, me]);

  const statusLabel = (s) =>
    ({
      yes: "Буду",
      maybe: "Под вопросом",
      no: "Не буду",
    }[s] || s);

  const btnClass = (s) => (myRsvp === s ? "btn" : "btn secondary");

  if (loading) return <HockeyLoader text="Загружаем..." />;

  return (
    <div className="container">
      <h1>🏒 Хоккей: отметки и составы</h1>

      <div className="row">
        <button className={tab === "game" ? "btn" : "btn secondary"} onClick={() => setTab("game")}>
          Игра
        </button>
        <button className={tab === "profile" ? "btn" : "btn secondary"} onClick={() => setTab("profile")}>
          Профиль
        </button>
        <button className={tab === "teams" ? "btn" : "btn secondary"} onClick={() => setTab("teams")}>
          Составы
        </button>
        {isAdmin && (
          <button className={tab === "admin" ? "btn" : "btn secondary"} onClick={() => setTab("admin")}>
            Админ
          </button>
        )}
      </div>

      {tab === "game" && (
        <div className="card">
          <h2>Игры</h2>

          {games.length > 0 && (
            <>
              <label>Выбор игры</label>
              <select
                value={selectedGameId || ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSelectedGameId(id);
                  refreshAll(id);
                }}
              >
                {games.map((g) => {
                  const d = new Date(g.starts_at);
                  const label = `${d.toLocaleDateString("ru-RU")} ${d.toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })} · ${g.location}${g.status === "cancelled" ? " (отменена)" : ""}`;
                  return (
                    <option key={g.id} value={g.id}>
                      {label}
                    </option>
                  );
                })}
              </select>

              <hr />
            </>
          )}

          {!game ? (
            <div className="small">Игры ещё нет. Админ может создать в вкладке “Админ”.</div>
          ) : (
            <>
              <div className="row">
                <span className="badge">⏱ {new Date(game.starts_at).toLocaleString("ru-RU")}</span>
                <span className="badge">📍 {game.location || "—"}</span>
                <span className="badge">Статус: {game.status}</span>
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

              <div className="small">Отметившиеся:</div>
              <div style={{ marginTop: 8 }}>
                {rsvps.length === 0 ? (
                  <div className="small">Пока никто не отметился.</div>
                ) : (
                  rsvps.map((r) => (
                    <div key={r.tg_id} className="row" style={{ alignItems: "center" }}>
                      <span className="badge">{statusLabel(r.status)}</span>
                      <div>{r.first_name || r.username || r.tg_id}</div>
                      <span className="small">
                        ({r.position}, skill {r.skill})
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "profile" && me && (
        <div className="card">
          <h2>Мой профиль</h2>
          <div className="small">Заполни один раз — дальше просто отмечайся.</div>

          <div style={{ marginTop: 10 }}>
            <label>Позиция</label>
            <select value={me.position || "F"} onChange={(e) => setMe({ ...me, position: e.target.value })}>
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
                type="number"
                min="1"
                max="10"
                value={me[k] ?? 5}
                onChange={(e) => setMe({ ...me, [k]: Number(e.target.value) })}
              />
            </div>
          ))}

          <div style={{ marginTop: 10 }}>
            <label>Комментарий</label>
            <textarea
              className="input"
              rows={3}
              value={me.notes || ""}
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

      {tab === "teams" && (
        <div className="card">
          <h2>Составы</h2>
          <div className="small">Админ может сформировать вручную.</div>

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

          {teams?.ok && (
            <>
              <hr />
              <div className="row">
                <span className="badge">ΣA {Number(teams.meta?.sumA ?? 0).toFixed(1)}</span>
                <span className="badge">ΣB {Number(teams.meta?.sumB ?? 0).toFixed(1)}</span>
                <span className="badge">diff {Number(teams.meta?.diff ?? 0).toFixed(1)}</span>
              </div>

              <hr />
              <h3>🟥 A</h3>
              {(teams.teamA || []).map((p) => (
                <div key={p.tg_id} className="small">
                  • {p.first_name || p.username || p.tg_id} ({p.position}, {Number(p.rating ?? 0).toFixed(1)})
                </div>
              ))}

              <hr />
              <h3>🟦 B</h3>
              {(teams.teamB || []).map((p) => (
                <div key={p.tg_id} className="small">
                  • {p.first_name || p.username || p.tg_id} ({p.position}, {Number(p.rating ?? 0).toFixed(1)})
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "admin" && isAdmin && (
        <AdminPanel
          apiGet={apiGet}
          apiPost={apiPost}
          apiPatch={apiPatch}
          apiDelete={apiDelete}
          onChanged={() => refreshAll(selectedGameId)}
        />
      )}

      <div className="small" style={{ marginTop: 10 }}>
        Если что-то не грузится — открой бота и зайди через кнопку “Открыть мини-приложение”.
      </div>
    </div>
  );
}

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
