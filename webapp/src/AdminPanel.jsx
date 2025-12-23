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
  // ВАЖНО: это локальное время браузера -> ISO в UTC
  // Если нужно фиксировать по TZ сервера — лучше отправлять date/time отдельно и собирать на бэке.
  const d = new Date(`${dateStr}T${timeStr}`);
  return d.toISOString();
}

function showName(p) {
  const n = (p.display_name || "").trim();
  if (n) return n;
  const fn = (p.first_name || "").trim();
  if (fn) return fn;
  if (p.username) return `@${p.username}`;
  return String(p.tg_id);
}

function showNum(p) {
  const n = p.jersey_number;
  if (n === null || n === undefined || n === "") return "";
  return ` #${n}`;
}

function posLabel(pos) {
  if (pos === "G") return "G";
  if (pos === "D") return "D";
  return "F";
}

const GUEST_DEFAULT = {
  display_name: "",
  jersey_number: "",
  position: "F",
  skill: 5,
  skating: 5,
  iq: 5,
  stamina: 5,
  passing: 5,
  shooting: 5,
  notes: "",
  status: "yes", // сразу “будет”
};

export default function AdminPanel({ apiGet, apiPost, apiPatch, apiDelete, onChanged }) {
  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [q, setQ] = useState("");

  // create games
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [weeks, setWeeks] = useState(4);

  // reminders
  const [reminderMsg, setReminderMsg] = useState("");

  // bulk selection (games)
  const [selected, setSelected] = useState(() => new Set());

  // guests UI per game
  const [guestPanelGameId, setGuestPanelGameId] = useState(null); // в какой игре открыт блок гостей
  const [guestFormOpen, setGuestFormOpen] = useState(false);
  const [guestEditingId, setGuestEditingId] = useState(null); // tg_id гостя (negative)
  const [guestDraft, setGuestDraft] = useState({ ...GUEST_DEFAULT });

  // загруженные гости по игре (чтобы показывать “пилюли” прямо в карточке игры)
  const [guestsByGame, setGuestsByGame] = useState({}); // { [gameId]: { loading:boolean, list: [] } }

  async function load() {
    const g = await apiGet("/api/games?days=180");
    setGames(g.games || []);

    // ВАЖНО: админский список игроков
    const p = await apiGet("/api/admin/players");
    setPlayers(p.players || []);
    setIsSuperAdmin(!!p.is_super_admin);
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
      (p.display_name || "").toLowerCase().includes(s) ||
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
    await apiPatch(`/api/admin/players/${p.tg_id}`, {
      display_name: p._display_name ?? p.display_name,
      jersey_number: p._jersey_number ?? p.jersey_number,
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

  async function toggleAdmin(p) {
    // только super-admin (ENV ADMIN_IDS) может раздавать/забирать админку
    await apiPost(`/api/admin/players/${p.tg_id}/admin`, { is_admin: !p.is_admin });
    await load();
    onChanged?.();
  }

  /** ===================== GUESTS ===================== */

  async function loadGuestsForGame(gameId, force = false) {
    setGuestsByGame(prev => {
      const cur = prev[gameId];
      if (cur?.loading) return prev;
      if (cur?.list && !force) return prev;
      return { ...prev, [gameId]: { loading: true, list: cur?.list || [] } };
    });

    try {
      const g = await apiGet(`/api/game?game_id=${gameId}`);
      const list = (g.rsvps || []).filter(x => x.is_guest === true);
      setGuestsByGame(prev => ({ ...prev, [gameId]: { loading: false, list } }));
    } catch (e) {
      console.error("loadGuestsForGame failed", e);
      setGuestsByGame(prev => ({ ...prev, [gameId]: { loading: false, list: [] } }));
    }
  }

  function openAddGuest(gameId) {
    setGuestPanelGameId(gameId);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT });
    setGuestFormOpen(v => (guestPanelGameId === gameId ? !v : true));

    // чтобы сразу показать список гостей в карточке игры
    loadGuestsForGame(gameId, false);
  }

  function openEditGuest(gameId, guestRow) {
    setGuestPanelGameId(gameId);
    setGuestEditingId(guestRow.tg_id);

    setGuestDraft({
      display_name: guestRow.display_name || guestRow.first_name || "",
      jersey_number: guestRow.jersey_number ?? "",
      position: (guestRow.position || "F").toUpperCase(),
      skill: guestRow.skill ?? 5,
      skating: guestRow.skating ?? 5,
      iq: guestRow.iq ?? 5,
      stamina: guestRow.stamina ?? 5,
      passing: guestRow.passing ?? 5,
      shooting: guestRow.shooting ?? 5,
      notes: guestRow.notes || "",
      status: guestRow.status || "yes",
    });

    setGuestFormOpen(true);
    loadGuestsForGame(gameId, false);
  }

  async function saveGuest() {
    const gameId = guestPanelGameId;
    if (!gameId) return;

    const payload = {
      game_id: gameId,
      status: guestDraft.status,
      display_name: (guestDraft.display_name || "").trim(),
      jersey_number: guestDraft.jersey_number,
      position: guestDraft.position,
      skill: Number(guestDraft.skill || 5),
      skating: Number(guestDraft.skating || 5),
      iq: Number(guestDraft.iq || 5),
      stamina: Number(guestDraft.stamina || 5),
      passing: Number(guestDraft.passing || 5),
      shooting: Number(guestDraft.shooting || 5),
      notes: guestDraft.notes || "",
    };

    if (!payload.display_name) {
      alert("Укажи имя гостя");
      return;
    }

    if (guestEditingId) {
      // 1) правим профиль гостя
      await apiPatch(`/api/admin/players/${guestEditingId}`, payload);

      // 2) отдельно выставляем RSVP на игру (чтобы “будет/может/не будет” поменялось)
      await apiPost(`/api/admin/rsvp`, { game_id: gameId, tg_id: guestEditingId, status: payload.status });
    } else {
      // создаём гостя + сразу RSVP (backend это делает)
      await apiPost("/api/admin/guests", payload);
    }

    setGuestFormOpen(false);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT });

    await loadGuestsForGame(gameId, true);
    await load();
    onChanged?.();
  }

  async function deleteGuest(tgId) {
    const gameId = guestPanelGameId;
    const ok = confirm("Удалить гостя? (Он исчезнет из списков и состава)");
    if (!ok) return;

    await apiDelete(`/api/admin/players/${tgId}`);
    if (gameId) await loadGuestsForGame(gameId, true);
    await load();
    onChanged?.();
  }

  function GuestPill({ g, onEdit, onDel }) {
    const status = g.status || "yes";
    const tone =
      status === "yes" ? "guestPill yes" :
      status === "maybe" ? "guestPill maybe" :
      "guestPill no";

    return (
      <div className={tone}>
        <div className="guestPillMain">
          <span className="guestTag">ГОСТЬ</span>
          <span className="guestName">{showName(g)}{showNum(g)}</span>
          <span className="guestMeta">({posLabel((g.position || "F").toUpperCase())})</span>
          <span className="guestStatus">
            {status === "yes" ? "✅ будет" : status === "maybe" ? "❓ под вопросом" : "❌ не будет"}
          </span>
        </div>
        <div className="guestPillActions">
          <button className="iconBtn" title="Изменить" onClick={onEdit}>✏️</button>
          <button className="iconBtn" title="Удалить" onClick={onDel}>🗑️</button>
        </div>
      </div>
    );
  }

  /** ===================== UI ===================== */

  return (
    <div className="card">
      <h2>Админ</h2>

      {/* Мини-CSS для гостевых пилюль (чтобы не искать) */}
      <style>{`
        .guestPill{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          padding:10px 12px;
          border:1px solid var(--border);
          border-radius:999px;
          background: var(--card-bg);
          margin-top:8px;
        }
        .guestPill.yes{ box-shadow: inset 0 0 0 999px color-mix(in srgb, #16a34a 10%, transparent); }
        .guestPill.maybe{ box-shadow: inset 0 0 0 999px color-mix(in srgb, #f59e0b 12%, transparent); }
        .guestPill.no{ box-shadow: inset 0 0 0 999px color-mix(in srgb, #ef4444 10%, transparent); }
        .guestPillMain{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        .guestTag{
          font-weight:800;
          font-size:12px;
          padding:4px 8px;
          border-radius:999px;
          border:1px solid var(--border);
          background: color-mix(in srgb, var(--tg-text) 6%, transparent);
        }
        .guestName{ font-weight:800; }
        .guestMeta{ opacity:.85; font-size:13px; }
        .guestStatus{ opacity:.9; font-size:13px; }
        .guestPillActions{ display:flex; gap:8px; }
        .iconBtn{
          border:1px solid var(--border);
          background: transparent;
          border-radius:10px;
          padding:6px 8px;
          cursor:pointer;
          line-height:1;
        }
        .iconBtn:active{ transform: translateY(1px); }
        .guestFormGrid{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
        .guestFormGrid .full{ grid-column: 1 / -1; }
        @media (max-width: 520px){
          .guestFormGrid{ grid-template-columns:1fr; }
        }
      `}</style>

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

          const guestsState = guestsByGame[g.id] || { loading: false, list: [] };
          const isGuestPanelHere = guestPanelGameId === g.id;

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

              <hr />

              {/* ГОСТИ В ЭТОЙ ИГРЕ */}
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="small" style={{ fontWeight: 800 }}>Гости</div>
                <div className="row">
                  <button
                    className="btn secondary"
                    onClick={() => {
                      loadGuestsForGame(g.id, true);
                      setGuestPanelGameId(g.id);
                    }}
                  >
                    Обновить гостей
                  </button>
                  <button className="btn" onClick={() => openAddGuest(g.id)}>
                    + Добавить гостя
                  </button>
                </div>
              </div>

              {guestsState.loading ? (
                <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>Загружаю гостей…</div>
              ) : (
                <>
                  {(guestsState.list || []).length === 0 ? (
                    <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>Гостей пока нет.</div>
                  ) : (
                    <div style={{ marginTop: 8 }}>
                      {guestsState.list.map((guestRow) => (
                        <GuestPill
                          key={guestRow.tg_id}
                          g={guestRow}
                          onEdit={() => openEditGuest(g.id, guestRow)}
                          onDel={() => deleteGuest(guestRow.tg_id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ФОРМА ГОСТЯ (появляется только после кнопки) */}
              {isGuestPanelHere && guestFormOpen && (
                <div className="card" style={{ marginTop: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 800 }}>
                      {guestEditingId ? "Редактировать гостя" : "Добавить гостя"}
                    </div>
                    <button className="btn secondary" onClick={() => setGuestFormOpen(false)}>
                      Закрыть
                    </button>
                  </div>

                  <div className="guestFormGrid" style={{ marginTop: 10 }}>
                    <div className="full">
                      <label>Имя гостя</label>
                      <input
                        className="input"
                        value={guestDraft.display_name}
                        onChange={(e) => setGuestDraft(d => ({ ...d, display_name: e.target.value }))}
                        placeholder="Например: Саша (гость)"
                      />
                    </div>

                    <div>
                      <label>Номер</label>
                      <input
                        className="input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="0–99"
                        value={guestDraft.jersey_number}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d]/g, "").slice(0, 2);
                          setGuestDraft(d => ({ ...d, jersey_number: v }));
                        }}
                      />
                    </div>

                    <div>
                      <label>Позиция</label>
                      <select
                        value={guestDraft.position}
                        onChange={(e) => setGuestDraft(d => ({ ...d, position: e.target.value }))}
                      >
                        <option value="F">F (нападающий)</option>
                        <option value="D">D (защитник)</option>
                        <option value="G">G (вратарь)</option>
                      </select>
                    </div>

                    <div className="full">
                      <label>Статус на игру</label>
                      <div className="row">
                        <button
                          className={guestDraft.status === "yes" ? "btn" : "btn secondary"}
                          onClick={() => setGuestDraft(d => ({ ...d, status: "yes" }))}
                        >
                          ✅ Будет
                        </button>
                        <button
                          className={guestDraft.status === "maybe" ? "btn" : "btn secondary"}
                          onClick={() => setGuestDraft(d => ({ ...d, status: "maybe" }))}
                        >
                          ❓ Под вопросом
                        </button>
                        <button
                          className={guestDraft.status === "no" ? "btn" : "btn secondary"}
                          onClick={() => setGuestDraft(d => ({ ...d, status: "no" }))}
                        >
                          ❌ Не будет
                        </button>
                      </div>
                    </div>

                    <div className="row full" style={{ gap: 10, flexWrap: "wrap" }}>
                      {["skill", "skating", "iq", "stamina", "passing", "shooting"].map((k) => (
                        <div key={k} style={{ flex: 1, minWidth: 130 }}>
                          <label>{k}</label>
                          <input
                            className="input"
                            type="number"
                            min={1}
                            max={10}
                            value={guestDraft[k]}
                            onChange={(e) => setGuestDraft(d => ({ ...d, [k]: Number(e.target.value || 5) }))}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="full">
                      <label>Заметки</label>
                      <textarea
                        className="input"
                        rows={2}
                        value={guestDraft.notes}
                        onChange={(e) => setGuestDraft(d => ({ ...d, notes: e.target.value }))}
                      />
                    </div>

                    <div className="row full" style={{ marginTop: 6 }}>
                      <button className="btn" onClick={saveGuest}>
                        {guestEditingId ? "Сохранить изменения" : "Добавить гостя"}
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => {
                          setGuestEditingId(null);
                          setGuestDraft({ ...GUEST_DEFAULT });
                        }}
                      >
                        Очистить
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {games.length === 0 && <div className="small">Пока игр нет.</div>}
      </div>

      <div className="card">
        <h2>Игроки</h2>
        <input
          className="input"
          placeholder="Поиск по имени/username/id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <hr />

        {filteredPlayers.map((p) => (
          <div key={p.tg_id} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800 }}>
                  {showName(p)}{showNum(p)}{" "}
                  {p.username ? <span className="small">(@{p.username})</span> : null}
                </div>
                <div className="small">
                  tg_id: {p.tg_id}{" "}
                  {p.is_guest ? " · 🧷 гость" : ""}
                  {p.is_admin ? " · ⭐ админ" : ""}
                  {p.is_env_admin ? " · 🔒 env-админ" : ""}
                </div>
              </div>

              <span className="badge">{p.disabled ? "disabled" : "active"}</span>
            </div>

            <label>Отображаемое имя (display_name)</label>
            <input
              className="input"
              defaultValue={p.display_name || ""}
              onChange={(e) => (p._display_name = e.target.value)}
              placeholder="Если пусто — будет Telegram first_name/username"
            />

            <label>Номер (0–99)</label>
            <input
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue={p.jersey_number ?? ""}
              onChange={(e) => (p._jersey_number = e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
            />

            <label>Позиция (F/D/G)</label>
            <select defaultValue={(p.position || "F").toUpperCase()} onChange={(e) => (p._position = e.target.value)}>
              <option value="F">F</option>
              <option value="D">D</option>
              <option value="G">G</option>
            </select>

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

              {isSuperAdmin && !p.is_guest && (
                <button className="btn secondary" onClick={() => toggleAdmin(p)}>
                  {p.is_admin ? "Снять админа" : "Сделать админом"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
