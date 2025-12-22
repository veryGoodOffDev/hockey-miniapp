import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "./api.js";

export default function App() {
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [rsvps, setRsvps] = useState([]);
  const [teams, setTeams] = useState(null);
  const [tab, setTab] = useState("game");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);


  const isAdmin = useMemo(() => {
    const tgId = me?.tg_id;
    // админство проверяет backend, тут просто визуально не скрываем критично
    return Boolean(tgId);
  }, [me]);

  async function refreshAll() {
    const m = await apiGet("/api/me");
    if (m?.player) setMe(m.player);

    const g = await apiGet("/api/game");
    setGame(g.game);
    setRsvps(g.rsvps || []);
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
}, []);



async function rsvp(status) {
  try {
    setLoading(true);
    await apiPost("/api/rsvp", { status });
    await refreshAll();
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
    const res = await apiPost("/api/teams/generate", {});
    if (res?.ok) setTeams(res);
    setTab("teams");
  }

  const myRsvp = useMemo(() => {
    if (!me?.tg_id) return null;
    const row = rsvps.find(r => String(r.tg_id) === String(me.tg_id));
    return row?.status || null;
  }, [rsvps, me]);
  
  const statusLabel = (s) => ({
  yes: "Буду",
  maybe: "Под вопросом",
  no: "Не буду",
}[s] || s);

const btnClass = (s) => (myRsvp === s ? "btn" : "btn secondary");

if (loading) return <Loader text="Загружаем..." />;
  return (
    <div className="container">
      <h1>🏒 Хоккей: отметки и составы</h1>

      <div className="row">
        <button className={"btn secondary"} onClick={() => setTab("game")}>Игра</button>
        <button className={"btn secondary"} onClick={() => setTab("profile")}>Профиль</button>
        <button className={"btn secondary"} onClick={() => setTab("teams")}>Составы</button>
      </div>

      {tab === "game" && (
        <div className="card">
          <h2>Ближайшая игра</h2>
          {!game ? (
            <div className="small">Игры ещё нет. Попроси админа сделать /setgame … в боте.</div>
          ) : (
            <>
              <div className="row">
                <span className="badge">⏱ {new Date(game.starts_at).toLocaleString("ru-RU")}</span>
                <span className="badge">📍 {game.location || "—"}</span>
                {myRsvp && <span className="badge">Мой статус: {statusLabel(myRsvp)}</span>}
              </div>

              <hr />

              <div className="row">
                <button className={btnClass("yes")} onClick={() => rsvp("yes")}>✅ Буду</button>
                <button className={btnClass("maybe")} onClick={() => rsvp("maybe")}>❓ Под вопросом</button>
                <button className={btnClass("no")} onClick={() => rsvp("no")}>❌ Не буду</button>
              </div>


              <hr />

              <div className="small">Отметившиеся:</div>
              <div style={{ marginTop: 8 }}>
                {rsvps.length === 0 ? (
                  <div className="small">Пока никто не отметился.</div>
                ) : (
                  rsvps.map((r) => (
                    <div key={r.tg_id} className="row" style={{ alignItems: "center" }}>
                      <span className="badge">{r.status}</span>
                      <div>{r.first_name || r.username || r.tg_id}</div>
                      <span className="small">({r.position}, skill {r.skill})</span>
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
            <select value={me.position || "F"} onChange={e => setMe({ ...me, position: e.target.value })}>
              <option value="F">F (нападающий)</option>
              <option value="D">D (защитник)</option>
              <option value="G">G (вратарь)</option>
            </select>
          </div>

          {["skill","skating","iq","stamina","passing","shooting"].map((k) => (
            <div key={k} style={{ marginTop: 10 }}>
              <label>{label(k)} (1–10)</label>
              <input
                className="input"
                type="number"
                min="1"
                max="10"
                value={me[k] ?? 5}
                onChange={e => setMe({ ...me, [k]: Number(e.target.value) })}
              />
            </div>
          ))}

          <div style={{ marginTop: 10 }}>
            <label>Комментарий</label>
            <textarea
              className="input"
              rows={3}
              value={me.notes || ""}
              onChange={e => setMe({ ...me, notes: e.target.value })}
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
          <div className="small">Админ может сформировать вручную, либо это сделает субботний cron.</div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn secondary" onClick={() => refreshAll()}>Обновить</button>
            <button className="btn" onClick={generateTeams}>Сформировать сейчас (админ)</button>
          </div>

          {teams?.ok && (
            <>
              <hr />
              <div className="row">
                <span className="badge">ΣA {teams.meta.sumA.toFixed(1)}</span>
                <span className="badge">ΣB {teams.meta.sumB.toFixed(1)}</span>
                <span className="badge">diff {teams.meta.diff.toFixed(1)}</span>
              </div>

              <hr />
              <h3>🟥 A</h3>
              {(teams.teamA || []).map(p => (
                <div key={p.tg_id} className="small">• {p.first_name || p.username || p.tg_id} ({p.position}, {p.rating.toFixed(1)})</div>
              ))}

              <hr />
              <h3>🟦 B</h3>
              {(teams.teamB || []).map(p => (
                <div key={p.tg_id} className="small">• {p.first_name || p.username || p.tg_id} ({p.position}, {p.rating.toFixed(1)})</div>
              ))}
            </>
          )}
        </div>
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
    shooting: "Бросок"
  };
  return m[k] || k;
}
function Loader({ text }) {
  return (
    <div className="loaderWrap">
      <div className="loaderIce">
        <div className="hStick left" />
        <div className="hStick right" />
        <div className="puck" />
      </div>
      <div className="loaderText">{text}</div>
    </div>
  );
}

