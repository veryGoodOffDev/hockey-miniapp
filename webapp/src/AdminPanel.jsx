import { useEffect, useMemo, useState } from "react";

function toLocalDateTimeInputs(starts_at) {
  const d = new Date(starts_at);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

function toIsoFromLocal(dateStr, timeStr) {
  // ВАЖНО: это создаётся в локальном поясе устройства и конвертируется в ISO корректно
  const d = new Date(`${dateStr}T${timeStr}`);
  return d.toISOString();
}

export default function AdminPanel({ apiGet, apiPost, apiPatch, apiDelete, onChanged }) {
  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);
  const [q, setQ] = useState("");

  // create game form
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [weeks, setWeeks] = useState(4);

  async function load() {
    const g = await apiGet("/api/games?days=60");
    setGames(g.games || []);
    const p = await apiGet("/api/players");
    setPlayers(p.players || []);
  }

  useEffect(() => { load(); }, []);

  const filteredPlayers = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return players;
    return players.filter(p =>
      (p.first_name || "").toLowerCase().includes(s) ||
      (p.username || "").toLowerCase().includes(s) ||
      String(p.tg_id).includes(s)
    );
  }, [players, q]);

  async function createOne() {
    if (!date || !time) return;
    const starts_at = toIsoFromLocal(date, time);
    await apiPost("/api/games", { starts_at, location });
    await load();
    onChanged?.();
  }

  async function createSeries() {
    if (!date || !time || weeks < 1) return;
    // создаём N игр вперед на каждую неделю от выбранной даты
    for (let i = 0; i < weeks; i++) {
      const base = new Date(`${date}T${time}`);
      base.setDate(base.getDate() + i * 7);
      await apiPost("/api/games", { starts_at: base.toISOString(), location });
    }
    await load();
    onChanged?.();
  }

  async function saveGame(g) {
    const { date, time } = toLocalDateTimeInputs(g.starts_at);
    const starts_at = toIsoFromLocal(g._editDate || date, g._editTime || time);
    await apiPatch(`/api/games/${g.id}`, { starts_at, location: g._editLocation ?? g.location });
    await load();
    onChanged?.();
  }

  async function cancelGame(id) {
    await apiPost(`/api/games/${id}/cancel`, {});
    await load();
    onChanged?.();
  }

  async function deleteGame(id) {
    await apiDelete(`/api/games/${id}`);
    await load();
    onChanged?.();
  }

  async function savePlayer(p) {
    await apiPatch(`/api/players/${p.tg_id}`, {
      first_name: p._first_name ?? p.first_name,
      username: p._username ?? p.username,
      position: p._position ?? p.position,
      skill: Number(p._skill ?? p.skill),
      skating: Number(p._skating ?? p.skating),
      iq: Number(p._iq ?? p.iq),
      stamina: Number(p._stamina ?? p.stamina),
      passing: Number(p._passing ?? p.passing),
      shooting: Number(p._shooting ?? p.shooting),
      disabled: Boolean(p._disabled ?? p.disabled),
    });
    await load();
    onChanged?.();
  }

  return (
    <div className="card">
      <h2>Админ</h2>

      <div className="card">
        <h2>Игры</h2>

        <label>Дата</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <label>Время</label>
        <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />

        <label>Арена</label>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Например: Ледовая арена" />

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={createOne}>Создать игру</button>

          <div style={{ flex: 1, minWidth: 140 }}>
            <label>Недель вперёд</label>
            <input className="input" type="number" min={1} max={24} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} />
          </div>

          <button className="btn secondary" onClick={createSeries}>Создать расписание</button>
        </div>

        <hr />

        {(games || []).map((g) => {
          const dt = toLocalDateTimeInputs(g.starts_at);
          const cancelled = g.status === "cancelled";

          return (
            <div key={g.id} className="card" style={{ opacity: cancelled ? 0.6 : 1 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>
                    #{g.id} · {dt.date} {dt.time} {cancelled ? "(отменена)" : ""}
                  </div>
                  <div className="small">{g.location}</div>
                </div>
                <span className="badge">{g.status}</span>
              </div>

              <label>Редактировать дату/время</label>
              <div className="row">
                <input
                  className="input"
                  type="date"
                  defaultValue={dt.date}
                  onChange={(e) => { g._editDate = e.target.value; }}
                />
                <input
                  className="input"
                  type="time"
                  defaultValue={dt.time}
                  onChange={(e) => { g._editTime = e.target.value; }}
                />
              </div>

              <label>Арена</label>
              <input
                className="input"
                defaultValue={g.location}
                onChange={(e) => { g._editLocation = e.target.value; }}
              />

              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => saveGame(g)}>Сохранить</button>
                <button className="btn secondary" onClick={() => cancelGame(g.id)}>Отменить</button>
                <button className="btn secondary" onClick={() => deleteGame(g.id)}>Удалить</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Игроки</h2>

        <input className="input" placeholder="Поиск по имени/username/id" value={q} onChange={(e) => setQ(e.target.value)} />

        <hr />

        {filteredPlayers.map((p) => (
          <div key={p.tg_id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 800 }}>
                  {p.first_name || "Без имени"} {p.username ? `(@${p.username})` : ""}
                </div>
                <div className="small">tg_id: {p.tg_id}</div>
              </div>
              <span className="badge">{p.disabled ? "disabled" : "active"}</span>
            </div>

            <label>Позиция (F/D/G)</label>
            <input className="input" defaultValue={p.position || "F"} onChange={(e) => { p._position = e.target.value; }} />

            <div className="row">
              <div style={{ flex: 1, minWidth: 120 }}>
                <label>Skill</label>
                <input className="input" type="number" min={1} max={10} defaultValue={p.skill ?? 5} onChange={(e) => { p._skill = e.target.value; }} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label>Skating</label>
                <input className="input" type="number" min={1} max={10} defaultValue={p.skating ?? 5} onChange={(e) => { p._skating = e.target.value; }} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label>IQ</label>
                <input className="input" type="number" min={1} max={10} defaultValue={p.iq ?? 5} onChange={(e) => { p._iq = e.target.value; }} />
              </div>
            </div>

            <div className="row">
              <div style={{ flex: 1, minWidth: 120 }}>
                <label>Stamina</label>
                <input className="input" type="number" min={1} max={10} defaultValue={p.stamina ?? 5} onChange={(e) => { p._stamina = e.target.value; }} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label>Passing</label>
                <input className="input" type="number" min={1} max={10} defaultValue={p.passing ?? 5} onChange={(e) => { p._passing = e.target.value; }} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label>Shooting</label>
                <input className="input" type="number" min={1} max={10} defaultValue={p.shooting ?? 5} onChange={(e) => { p._shooting = e.target.value; }} />
              </div>
            </div>

            <div className="row" style={{ alignItems: "center" }}>
              <label style={{ margin: 0 }}>Отключить</label>
              <input type="checkbox" defaultChecked={!!p.disabled} onChange={(e) => { p._disabled = e.target.checked; }} />
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => savePlayer(p)}>Сохранить игрока</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
