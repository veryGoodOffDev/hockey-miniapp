import { useEffect, useMemo, useState } from "react";

function toLocal(starts_at) {
  const d = new Date(starts_at);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function toIsoFromLocal(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}`);
  return d.toISOString();
}

export default function AdminPanel({ apiGet, apiPost, apiPatch, apiDelete, onChanged }) {
  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);

  const [q, setQ] = useState("");

  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [weeks, setWeeks] = useState(4);
  const [reminderMsg, setReminderMsg] = useState("");

  // bulk selection
  const [selected, setSelected] = useState(() => new Set());

  async function load() {
    const g = await apiGet("/api/games?days=180");
    setGames(g.games || []);
    const p = await apiGet("/api/players");
    setPlayers(p.players || []);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    // при перезагрузке списка — чистим выбор тех, кого больше нет
    setSelected(prev => {
      const ids = new Set((games || []).map(g => g.id));
      const next = new Set();
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.length]);

  const filteredPlayers = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return players;
    return players.filter((p) =>
      (p.first_name || "").toLowerCase().includes(s) ||
      (p.username || "").toLowerCase().includes(s) ||
      String(p.tg_id).includes(s)
    );
  }, [players, q]);
  async function sendReminderNow() {
    setReminderMsg("");
    const r = await apiPost("/api/admin/reminder/sendNow", {});
    if (r?.ok) setReminderMsg("✅ Напоминание отправлено");
    else setReminderMsg(`❌ Ошибка: ${r?.reason || r?.error || "unknown"}`);
  }

  async function createOne() {
    if (!date || !time) return;
    const starts_at = toIsoFromLocal(date, time);
    await apiPost("/api/games", { starts_at, location });
    await load();
    onChanged?.();
  }

  async function createSeries() {
    if (!date || !time || weeks < 1) return;
    for (let i = 0; i < weeks; i++) {
      const base = new Date(`${date}T${time}`);
      base.setDate(base.getDate() + i * 7);
      await apiPost("/api/games", { starts_at: base.toISOString(), location });
    }
    await load();
    onChanged?.();
  }

  async function saveGame(g) {
    const base = toLocal(g.starts_at);
    const starts_at = toIsoFromLocal(g._editDate || base.date, g._editTime || base.time);
    await apiPatch(`/api/games/${g.id}`, {
      starts_at,
      location: g._editLocation ?? g.location,
      status: g._editStatus ?? g.status,
    });
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

  async function deleteSelected() {
    if (selected.size === 0) return;
    const ok = confirm(`Удалить выбранные игры (${selected.size} шт.)?`);
    if (!ok) return;

    // удаляем по одной (быстро и надёжно)
    for (const id of selected) {
      await apiDelete(`/api/games/${id}`);
    }
    setSelected(new Set());
    await load();
    onChanged?.();
  }

  async function deleteAllGames() {
    const ok = confirm("ТОЧНО удалить ВСЕ игры из базы? Это необратимо.");
    if (!ok) return;

    const ok2 = confirm("Последнее подтверждение: удалить ВСЕ игры?");
    if (!ok2) return;

    await apiDelete("/api/games"); // новый endpoint
    setSelected(new Set());
    await load();
    onChanged?.();
  }

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set((games || []).map(g => g.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function savePlayer(p) {
    await apiPatch(`/api/players/${p.tg_id}`, {
      first_name: p._first_name ?? p.first_name,
      last_name: p._last_name ?? p.last_name,
      username: p._username ?? p.username,
      position: p._position ?? p.position,
      skill: Number(p._skill ?? p.skill),
      skating: Number(p._skating ?? p.skating),
      iq: Number(p._iq ?? p.iq),
      stamina: Number(p._stamina ?? p.stamina),
      passing: Number(p._passing ?? p.passing),
      shooting: Number(p._shooting ?? p.shooting),
      notes: p._notes ?? p.notes,
      disabled: Boolean(p._disabled ?? p.disabled),
    });
    await load();
    onChanged?.();
  }

  return (
    <div className="card">
        <h2>Админ</h2>
        <div className="card">
          <h2>Напоминания</h2>
          <div className="small">
            Сначала в нужной группе напиши боту команду <b>/setchat</b>, чтобы назначить чат для уведомлений.
          </div>
        
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={sendReminderNow}>
              Отправить напоминание сейчас
            </button>
          </div>
        
          {reminderMsg && <div className="small" style={{ marginTop: 8 }}>{reminderMsg}</div>}
        </div>

      <div className="card">
        <h2>Создать игру</h2>

        <label>Дата</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <label>Время</label>
        <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />

        <label>Арена</label>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Например: Ледовая арена" />

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={createOne}>Создать</button>

          <div style={{ flex: 1, minWidth: 140 }}>
            <label>Недель вперёд</label>
            <input className="input" type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} />
          </div>

          <button className="btn secondary" onClick={createSeries}>Создать расписание</button>
        </div>
      </div>

      <div className="card">
        <h2>Список игр</h2>

        <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div className="small">
            Выбрано: <b>{selected.size}</b>
          </div>
          <div className="row">
            <button className="btn secondary" onClick={selectAll}>Выделить всё</button>
            <button className="btn secondary" onClick={clearAll}>Снять выделение</button>
          </div>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn secondary" disabled={selected.size === 0} onClick={deleteSelected}>
            Удалить выбранные
          </button>
          <button className="btn secondary" onClick={load}>Обновить</button>
          <button className="btn" onClick={deleteAllGames}>
            Удалить ВСЕ игры
          </button>
        </div>

        <hr />

        {(games || []).map((g) => {
          const dt = toLocal(g.starts_at);
          const cancelled = g.status === "cancelled";
          const checked = selected.has(g.id);

          return (
            <div key={g.id} className="card" style={{ opacity: cancelled ? 0.7 : 1 }}>
              <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <div className="row" style={{ alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(g.id)}
                    style={{ transform: "scale(1.2)" }}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>
                      #{g.id} · {dt.date} {dt.time} {cancelled ? "(отменена)" : ""}
                    </div>
                    <div className="small">{g.location}</div>
                  </div>
                </div>
                <span className="badge">{g.status}</span>
              </div>

              <label>Дата/время</label>
              <div className="row">
                <input className="input" type="date" defaultValue={dt.date} onChange={(e) => (g._editDate = e.target.value)} />
                <input className="input" type="time" defaultValue={dt.time} onChange={(e) => (g._editTime = e.target.value)} />
              </div>

              <label>Арена</label>
              <input className="input" defaultValue={g.location} onChange={(e) => (g._editLocation = e.target.value)} />

              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => saveGame(g)}>Сохранить</button>
                <button className="btn secondary" onClick={() => cancelGame(g.id)}>Отменить</button>
                <button className="btn secondary" onClick={() => deleteGame(g.id)}>Удалить</button>
              </div>
            </div>
          );
        })}

        {games.length === 0 && <div className="small">Пока игр нет.</div>}
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
                  {p.first_name || "Без имени"} {p.last_name ? p.last_name : ""} {p.username ? `(@${p.username})` : ""}
                </div>
                <div className="small">tg_id: {p.tg_id}</div>
              </div>
              <span className="badge">{p.disabled ? "disabled" : "active"}</span>
            </div>

            <label>Позиция (F/D/G)</label>
            <input className="input" defaultValue={p.position || "F"} onChange={(e) => (p._position = e.target.value)} />

            <div className="row">
              {["skill", "skating", "iq", "stamina", "passing", "shooting"].map((k) => (
                <div key={k} style={{ flex: 1, minWidth: 120 }}>
                  <label>{k}</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={p[k] ?? 5}
                    onChange={(e) => (p[`_${k}`] = e.target.value)}
                  />
                </div>
              ))}
            </div>

            <label>Заметки</label>
            <textarea className="input" rows={2} defaultValue={p.notes || ""} onChange={(e) => (p._notes = e.target.value)} />

            <div className="row" style={{ alignItems: "center" }}>
              <label style={{ margin: 0 }}>Отключить</label>
              <input type="checkbox" defaultChecked={!!p.disabled} onChange={(e) => (p._disabled = e.target.checked)} />
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
