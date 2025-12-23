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

function gameStatusRu(s) {
  return ({ scheduled: "Запланирована", cancelled: "Отменена" }[s] || s);
}

function clampNum(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeJersey(v) {
  if (v === null || v === undefined) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  return clampNum(digits, 0, 99, null);
}

export default function AdminPanel({ apiGet, apiPost, apiPatch, apiDelete, onChanged }) {
  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);

  // separate searches
  const [gameQ, setGameQ] = useState("");
  const [playerQ, setPlayerQ] = useState("");

  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [weeks, setWeeks] = useState(4);
  const [reminderMsg, setReminderMsg] = useState("");
  const [guestGameId, setGuestGameId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPos, setGuestPos] = useState("F");
  const [guestSkill, setGuestSkill] = useState(5);
  const [guestStatus, setGuestStatus] = useState("yes");
  const [guestNum, setGuestNum] = useState("");
  const [guestMsg, setGuestMsg] = useState("");


  // bulk selection for games
  const [selected, setSelected] = useState(() => new Set());

  // drafts for players edits (tg_id -> fields)
  const [draftPlayers, setDraftPlayers] = useState({});

  async function load() {
    const g = await apiGet("/api/games?days=180");
    setGames(g.games || []);

    // IMPORTANT: admin endpoint, чтобы видеть is_admin и скрытые поля
    const p = await apiGet("/api/admin/players");
    setPlayers(p.players || []);

    // init drafts once per load (keeps UI stable)
    const nextDraft = {};
    for (const pl of (p.players || [])) {
      nextDraft[pl.tg_id] = {
        display_name: pl.display_name ?? "",
        jersey_number: pl.jersey_number ?? "",
        position: pl.position ?? "F",
        skill: pl.skill ?? 5,
        skating: pl.skating ?? 5,
        iq: pl.iq ?? 5,
        stamina: pl.stamina ?? 5,
        passing: pl.passing ?? 5,
        shooting: pl.shooting ?? 5,
        notes: pl.notes ?? "",
        disabled: !!pl.disabled,
      };
    }
    setDraftPlayers(nextDraft);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    // при перезагрузке списка — чистим выбор тех игр, кого больше нет
    setSelected((prev) => {
      const ids = new Set((games || []).map((g) => g.id));
      const next = new Set();
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.length]);

  const filteredGames = useMemo(() => {
    const s = gameQ.trim().toLowerCase();
    if (!s) return games;
    return (games || []).filter((g) => {
      const dt = toLocal(g.starts_at);
      const hay = `${g.id} ${dt.date} ${dt.time} ${g.location || ""} ${g.status || ""}`.toLowerCase();
      return hay.includes(s);
    });
  }, [games, gameQ]);

  const filteredPlayers = useMemo(() => {
    const s = playerQ.trim().toLowerCase();
    if (!s) return players;
    return (players || []).filter((p) => {
      const hay = [
        p.display_name,
        p.first_name,
        p.last_name,
        p.username,
        String(p.tg_id),
        p.jersey_number == null ? "" : String(p.jersey_number),
        p.is_admin ? "admin" : "user",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [players, playerQ]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set((games || []).map((g) => g.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

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

  async function setGameStatus(id, status) {
    await apiPost(`/api/games/${id}/status`, { status });
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

    await apiDelete("/api/games"); // если у тебя есть этот endpoint
    setSelected(new Set());
    await load();
    onChanged?.();
  }

  function setDraft(tgId, key, value) {
    setDraftPlayers((prev) => ({
      ...prev,
      [tgId]: { ...(prev[tgId] || {}), [key]: value },
    }));
  }

  async function savePlayer(tgId) {
    const d = draftPlayers[tgId] || {};
    await apiPatch(`/api/admin/players/${tgId}`, {
      display_name: (d.display_name || "").trim(),
      jersey_number: normalizeJersey(d.jersey_number),
      position: (d.position || "F").trim().toUpperCase(),
      skill: clampNum(d.skill, 1, 10, 5),
      skating: clampNum(d.skating, 1, 10, 5),
      iq: clampNum(d.iq, 1, 10, 5),
      stamina: clampNum(d.stamina, 1, 10, 5),
      passing: clampNum(d.passing, 1, 10, 5),
      shooting: clampNum(d.shooting, 1, 10, 5),
      notes: (d.notes || "").slice(0, 500),
      disabled: !!d.disabled,
    });
    await load();
    onChanged?.();
  }

  function showName(p) {
    const dn = (p.display_name || "").trim();
    if (dn) return dn;
    const fn = (p.first_name || "").trim();
    if (fn) return fn;
    if (p.username) return `@${p.username}`;
    return String(p.tg_id);
  }

  function showNum(p) {
    if (p.jersey_number === null || p.jersey_number === undefined || p.jersey_number === "") return "";
    return ` №${p.jersey_number}`;
  }

  return (
    <div className="card">
      <h2>Админ</h2>

      {/* --- reminders --- */}
      <div className="card">
        <h2>Напоминания</h2>
        <div className="small">
          Сначала в нужной группе напиши боту команду <b>/setchat</b>, чтобы назначить чат для уведомлений.
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={sendReminderNow}>
            Отправить напоминание сейчас
          </button>
          <button className="btn secondary" onClick={load}>
            Обновить
          </button>
        </div>

        {reminderMsg && <div className="small" style={{ marginTop: 8 }}>{reminderMsg}</div>}
      </div>

      {/* --- create game --- */}
      <div className="card">
        <h2>Создать игру</h2>

        <label>Дата</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <label>Время</label>
        <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />

        <label>Арена</label>
        <input
          className="input"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Например: Ледовая арена"
        />

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={createOne}>Создать</button>

          <div style={{ flex: 1, minWidth: 140 }}>
            <label>Недель вперёд</label>
            <input
              className="input"
              type="number"
              min={1}
              max={52}
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
            />
          </div>

          <button className="btn secondary" onClick={createSeries}>Создать расписание</button>
        </div>
      </div>

      {/* --- games list --- */}
      <div className="card">
        <h2>Список игр</h2>

        <input
          className="input"
          placeholder="Поиск по играм (id/дата/арена/статус)"
          value={gameQ}
          onChange={(e) => setGameQ(e.target.value)}
        />

        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
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

        {(filteredGames || []).map((g) => {
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
                <span className="badge">{gameStatusRu(g.status)}</span>
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

                {g.status === "cancelled" ? (
                  <button className="btn secondary" onClick={() => setGameStatus(g.id, "scheduled")}>
                    Вернуть (запланирована)
                  </button>
                ) : (
                  <button className="btn secondary" onClick={() => setGameStatus(g.id, "cancelled")}>
                    Отменить
                  </button>
                )}

                <button className="btn secondary" onClick={() => deleteGame(g.id)}>Удалить</button>
              </div>
            </div>
          );
        })}

        {filteredGames.length === 0 && <div className="small">Пока игр нет.</div>}
      </div>

      {/* --- players list --- */}
      <div className="card">
        <h2>Игроки</h2>

        <input
          className="input"
          placeholder="Поиск по игрокам (имя/username/id/номер/admin)"
          value={playerQ}
          onChange={(e) => setPlayerQ(e.target.value)}
        />

        <hr />

        {filteredPlayers.map((p) => {
          const d = draftPlayers[p.tg_id] || {};
          return (
            <div key={p.tg_id} className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 900 }}>
                    {showName(p)}{showNum(p)}
                  </div>
                  <div className="small">
                    tg_id: {p.tg_id} {p.username ? `• @${p.username}` : ""} {p.first_name ? `• tg: ${p.first_name}` : ""}
                  </div>
                </div>
                <span className="badge">{p.is_admin ? "admin" : "user"}</span>
              </div>

              <label>Отображаемое имя</label>
              <input
                className="input"
                value={d.display_name ?? ""}
                onChange={(e) => setDraft(p.tg_id, "display_name", e.target.value)}
                placeholder={p.first_name || "Имя"}
              />

              <label>Номер (0–99)</label>
              <input
                className="input"
                inputMode="numeric"
                pattern="[0-9]*"
                value={d.jersey_number ?? ""}
                onChange={(e) => setDraft(p.tg_id, "jersey_number", e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Например: 17"
              />

              <label>Позиция (F/D/G)</label>
              <input
                className="input"
                value={d.position ?? "F"}
                onChange={(e) => setDraft(p.tg_id, "position", e.target.value)}
              />

              <div className="row">
                {["skill", "skating", "iq", "stamina", "passing", "shooting"].map((k) => (
                  <div key={k} style={{ flex: 1, minWidth: 120 }}>
                    <label>{k}</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={10}
                      value={d[k] ?? 5}
                      onChange={(e) => setDraft(p.tg_id, k, e.target.value)}
                    />
                  </div>
                ))}
              </div>

              <label>Заметки</label>
              <textarea
                className="input"
                rows={2}
                value={d.notes ?? ""}
                onChange={(e) => setDraft(p.tg_id, "notes", e.target.value)}
              />

              <div className="row" style={{ alignItems: "center" }}>
                <label style={{ margin: 0 }}>Отключить</label>
                <input
                  type="checkbox"
                  checked={!!d.disabled}
                  onChange={(e) => setDraft(p.tg_id, "disabled", e.target.checked)}
                />
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => savePlayer(p.tg_id)}>Сохранить игрока</button>
              </div>
            </div>
          );
        })}

        {filteredPlayers.length === 0 && <div className="small">Игроков пока нет.</div>}
      </div>
    </div>
  );
}
