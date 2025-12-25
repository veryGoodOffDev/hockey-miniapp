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
  status: "yes",
};

export default function AdminPanel({ apiGet, apiPost, apiPatch, apiDelete, onChanged }) {
  // ====== main sections
  const [section, setSection] = useState("games"); // reminders | games | players

  // ====== data
  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const g = await apiGet("/api/games?days=180");
      setGames(g.games || []);

      const p = await apiGet("/api/admin/players");
      setPlayers(p.players || []);
      setIsSuperAdmin(!!p.is_super_admin);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ====== reminders
  const [reminderMsg, setReminderMsg] = useState("");

  async function sendReminderNow() {
    setReminderMsg("");
    const r = await apiPost("/api/admin/reminder/sendNow", {});
    if (r?.ok) setReminderMsg("✅ Напоминание отправлено");
    else setReminderMsg(`❌ Ошибка: ${r?.reason || r?.error || "unknown"}`);
  }

  // ====== games (create)
  const [createOpen, setCreateOpen] = useState(true);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [weeks, setWeeks] = useState(4);

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

  // ====== games list / detail state
  const [gameQ, setGameQ] = useState("");
  const [selectedGameIds, setSelectedGameIds] = useState(() => new Set());
  const [activeGameId, setActiveGameId] = useState(null);
  const [gameDraft, setGameDraft] = useState(null); // {id, date, time, location, status, video_url}

  useEffect(() => {
    // чистим bulk-выбор при обновлении
    setSelectedGameIds((prev) => {
      const ids = new Set((games || []).map((g) => g.id));
      const next = new Set();
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next;
    });

    // если активная игра исчезла
    if (activeGameId && !(games || []).some((g) => g.id === activeGameId)) {
      setActiveGameId(null);
      setGameDraft(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.length]);

  const gamesSorted = useMemo(() => {
    return [...(games || [])].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  }, [games]);

  const filteredGames = useMemo(() => {
    const s = gameQ.trim().toLowerCase();
    if (!s) return gamesSorted;
    return gamesSorted.filter((g) => {
      const dt = toLocal(g.starts_at);
      const hay = `${g.id} ${dt.date} ${dt.time} ${g.location || ""} ${g.status || ""} ${g.video_url || ""}`.toLowerCase();
      return hay.includes(s);
    });
  }, [gamesSorted, gameQ]);

  function toggleGameSelect(id) {
    setSelectedGameIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function selectAllGames() {
    setSelectedGameIds(new Set((filteredGames || []).map((g) => g.id)));
  }
  function clearAllGames() {
    setSelectedGameIds(new Set());
  }

  function openGame(g) {
    setActiveGameId(g.id);
    const dt = toLocal(g.starts_at);
    setGameDraft({
      id: g.id,
      date: dt.date,
      time: dt.time,
      location: g.location || "",
      status: g.status || "scheduled",
      video_url: g.video_url || "",
    });

    // гости подтягиваем под выбранную игру
    setGuestPanelGameId(g.id);
    loadGuestsForGame(g.id, false);
  }

  async function saveGameDraft() {
    if (!gameDraft?.id) return;
    const starts_at = toIsoFromLocal(gameDraft.date, gameDraft.time);

    await apiPatch(`/api/games/${gameDraft.id}`, {
      starts_at,
      location: gameDraft.location,
      status: gameDraft.status,
      video_url: gameDraft.video_url || "",
    });

    // если хочешь статус менять только отдельным endpoint — оставим как есть у тебя:
    await apiPost(`/api/games/${gameDraft.id}/status`, { status: gameDraft.status });

    await load();
    onChanged?.();
  }

  async function deleteGame(id) {
    const ok = confirm("Удалить игру?");
    if (!ok) return;
    await apiDelete(`/api/games/${id}`);
    if (activeGameId === id) {
      setActiveGameId(null);
      setGameDraft(null);
    }
    await load();
    onChanged?.();
  }

  async function deleteSelectedGames() {
    if (selectedGameIds.size === 0) return;
    const ok = confirm(`Удалить выбранные игры (${selectedGameIds.size} шт.)?`);
    if (!ok) return;

    for (const id of selectedGameIds) {
      await apiDelete(`/api/games/${id}`);
    }
    setSelectedGameIds(new Set());
    setActiveGameId(null);
    setGameDraft(null);

    await load();
    onChanged?.();
  }

  async function deleteAllGames() {
    const ok = confirm("ТОЧНО удалить ВСЕ игры из базы? Это необратимо.");
    if (!ok) return;
    const ok2 = confirm("Последнее подтверждение: удалить ВСЕ игры?");
    if (!ok2) return;

    // если endpoint реально есть — ок. Если нет — лучше убрать эту кнопку.
    await apiDelete("/api/games");
    setSelectedGameIds(new Set());
    setActiveGameId(null);
    setGameDraft(null);

    await load();
    onChanged?.();
  }

  // ====== guests (same logic, но привязано к выбранной игре)
  const [guestPanelGameId, setGuestPanelGameId] = useState(null);
  const [guestFormOpen, setGuestFormOpen] = useState(false);
  const [guestEditingId, setGuestEditingId] = useState(null);
  const [guestDraft, setGuestDraft] = useState({ ...GUEST_DEFAULT });
  const [guestsByGame, setGuestsByGame] = useState({}); // { [gameId]: { loading, list } }

  async function loadGuestsForGame(gameId, force = false) {
    setGuestsByGame((prev) => {
      const cur = prev[gameId];
      if (cur?.loading) return prev;
      if (cur?.list && !force) return prev;
      return { ...prev, [gameId]: { loading: true, list: cur?.list || [] } };
    });

    try {
      const g = await apiGet(`/api/game?game_id=${gameId}`);
      const list = (g.rsvps || []).filter((x) => x.is_guest === true);
      setGuestsByGame((prev) => ({ ...prev, [gameId]: { loading: false, list } }));
    } catch (e) {
      console.error("loadGuestsForGame failed", e);
      setGuestsByGame((prev) => ({ ...prev, [gameId]: { loading: false, list: [] } }));
    }
  }

  function openAddGuest(gameId) {
    setGuestPanelGameId(gameId);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT });
    setGuestFormOpen(true);
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
      await apiPatch(`/api/admin/players/${guestEditingId}`, payload);
      await apiPost(`/api/admin/rsvp`, { game_id: gameId, tg_id: guestEditingId, status: payload.status });
    } else {
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
    const ok = confirm("Удалить гостя? (Он исчезнет из списков и состава)");
    if (!ok) return;

    await apiDelete(`/api/admin/players/${tgId}`);
    if (guestPanelGameId) await loadGuestsForGame(guestPanelGameId, true);
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

  // ====== players list / detail
  const [playerQ, setPlayerQ] = useState("");
  const [activePlayerId, setActivePlayerId] = useState(null);
  const [playerDraft, setPlayerDraft] = useState(null);

  const filteredPlayers = useMemo(() => {
    const s = playerQ.trim().toLowerCase();
    if (!s) return players;
    return (players || []).filter((p) =>
      (p.display_name || "").toLowerCase().includes(s) ||
      (p.first_name || "").toLowerCase().includes(s) ||
      (p.username || "").toLowerCase().includes(s) ||
      String(p.tg_id).includes(s) ||
      String(p.jersey_number ?? "").includes(s)
    );
  }, [players, playerQ]);

  function openPlayer(p) {
    setActivePlayerId(p.tg_id);
    setPlayerDraft({
      tg_id: p.tg_id,
      display_name: p.display_name || "",
      jersey_number: p.jersey_number ?? "",
      position: (p.position || "F").toUpperCase(),
      skill: p.skill ?? 5,
      skating: p.skating ?? 5,
      iq: p.iq ?? 5,
      stamina: p.stamina ?? 5,
      passing: p.passing ?? 5,
      shooting: p.shooting ?? 5,
      notes: p.notes || "",
      disabled: !!p.disabled,
      is_admin: !!p.is_admin,
      is_guest: !!p.is_guest,
      username: p.username || "",
      first_name: p.first_name || "",
      is_env_admin: !!p.is_env_admin,
    });
  }

  async function savePlayerDraft() {
    if (!playerDraft?.tg_id) return;

    await apiPatch(`/api/admin/players/${playerDraft.tg_id}`, {
      display_name: playerDraft.display_name,
      jersey_number: playerDraft.jersey_number,
      position: playerDraft.position,
      skill: Number(playerDraft.skill || 5),
      skating: Number(playerDraft.skating || 5),
      iq: Number(playerDraft.iq || 5),
      stamina: Number(playerDraft.stamina || 5),
      passing: Number(playerDraft.passing || 5),
      shooting: Number(playerDraft.shooting || 5),
      notes: playerDraft.notes,
      disabled: !!playerDraft.disabled,
    });

    await load();
    onChanged?.();
  }

  async function toggleAdminForPlayerDraft() {
    if (!isSuperAdmin) return;
    if (!playerDraft?.tg_id) return;
    if (playerDraft.is_guest) return; // гостей не делаем админами

    await apiPost(`/api/admin/players/${playerDraft.tg_id}/admin`, { is_admin: !playerDraft.is_admin });
    await load();
    onChanged?.();

    // обновим draft после reload
    const updated = (players || []).find((x) => x.tg_id === playerDraft.tg_id);
    if (updated) openPlayer(updated);
  }

  // ====== UI
  return (
    <div className="card">
      <style>{`
        .adminTopRow{ display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
        .adminNav{ display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
        .adminSplit{ display:grid; grid-template-columns: 1fr 1.3fr; gap:12px; }
        @media (max-width: 820px){ .adminSplit{ grid-template-columns: 1fr; } }
        .adminListItem{ cursor:pointer; }
        .adminListItem.active{ outline:2px solid color-mix(in srgb, var(--tg-text) 25%, transparent); }
        .muted{ opacity:.8; }
        .dangerZone{ border:1px dashed var(--border); border-radius:14px; padding:12px; }

        /* guest pills (твои, оставил) */
        .guestPill{
          display:flex; align-items:center; justify-content:space-between; gap:10px;
          padding:10px 12px; border:1px solid var(--border); border-radius:999px;
          background: var(--card-bg); margin-top:8px;
        }
        .guestPill.yes{ box-shadow: inset 0 0 0 999px color-mix(in srgb, #16a34a 10%, transparent); }
        .guestPill.maybe{ box-shadow: inset 0 0 0 999px color-mix(in srgb, #f59e0b 12%, transparent); }
        .guestPill.no{ box-shadow: inset 0 0 0 999px color-mix(in srgb, #ef4444 10%, transparent); }
        .guestPillMain{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        .guestTag{
          font-weight:800; font-size:12px; padding:4px 8px; border-radius:999px;
          border:1px solid var(--border);
          background: color-mix(in srgb, var(--tg-text) 6%, transparent);
        }
        .guestName{ font-weight:800; }
        .guestMeta{ opacity:.85; font-size:13px; }
        .guestStatus{ opacity:.9; font-size:13px; }
        .guestPillActions{ display:flex; gap:8px; }
        .iconBtn{
          border:1px solid var(--border); background: transparent;
          border-radius:10px; padding:6px 8px; cursor:pointer; line-height:1;
        }
        .iconBtn:active{ transform: translateY(1px); }
        .guestFormGrid{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
        .guestFormGrid .full{ grid-column: 1 / -1; }
        @media (max-width: 520px){ .guestFormGrid{ grid-template-columns:1fr; } }
      `}</style>

      <div className="adminTopRow">
        <h2 style={{ margin: 0 }}>Админка</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary" onClick={load} disabled={loading}>Обновить</button>
        </div>
      </div>

      <div className="adminNav">
        <button className={section === "reminders" ? "btn" : "btn secondary"} onClick={() => setSection("reminders")}>
          🔔 Напоминания
        </button>
        <button className={section === "games" ? "btn" : "btn secondary"} onClick={() => setSection("games")}>
          📅 Игры
        </button>
        <button className={section === "players" ? "btn" : "btn secondary"} onClick={() => setSection("players")}>
          👥 Игроки
        </button>
      </div>

      <hr />

      {loading ? (
        <div className="small muted">Загрузка…</div>
      ) : section === "reminders" ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Напоминания</h3>
          <div className="small">
            Сначала в нужной группе напиши боту команду <b>/setchat</b>, чтобы назначить чат для уведомлений.
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={sendReminderNow}>Отправить напоминание сейчас</button>
          </div>

          {reminderMsg && <div className="small" style={{ marginTop: 8 }}>{reminderMsg}</div>}
        </div>
      ) : section === "games" ? (
        <div className="adminSplit">
          {/* ===== LEFT: games list */}
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Игры</h3>
              <span className="badge">{filteredGames.length}</span>
            </div>

            <input
              className="input"
              placeholder="Поиск: id / дата / арена / статус"
              value={gameQ}
              onChange={(e) => setGameQ(e.target.value)}
              style={{ marginTop: 10 }}
            />

            <div className="row" style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center" }}>
              <div className="small">
                Выбрано: <b>{selectedGameIds.size}</b>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn secondary" onClick={selectAllGames}>Выделить</button>
                <button className="btn secondary" onClick={clearAllGames}>Снять</button>
              </div>
            </div>

            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
              <button className="btn secondary" disabled={selectedGameIds.size === 0} onClick={deleteSelectedGames}>
                Удалить выбранные
              </button>
              <button className="btn secondary" onClick={() => setCreateOpen((v) => !v)}>
                {createOpen ? "Скрыть создание" : "Создать игру"}
              </button>
            </div>

            {createOpen && (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 800 }}>Создание</div>
                </div>

                <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label>Дата</label>
                    <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label>Время</label>
                    <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </div>
                </div>

                <label style={{ marginTop: 10 }}>Арена</label>
                <input
                  className="input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Например: Ледовая арена"
                />

                <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
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

                <div className="dangerZone" style={{ marginTop: 12 }}>
                  <div className="small muted">
                    Опасная зона: кнопка ниже работает только если у тебя реально есть endpoint DELETE /api/games
                  </div>
                  <button className="btn" onClick={deleteAllGames} style={{ marginTop: 10 }}>
                    Удалить ВСЕ игры
                  </button>
                </div>
              </div>
            )}

            <hr />

            {filteredGames.length === 0 ? (
              <div className="small muted">Игр пока нет.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {filteredGames.map((g) => {
                  const dt = toLocal(g.starts_at);
                  const isActive = activeGameId === g.id;
                  const cancelled = g.status === "cancelled";
                  const checked = selectedGameIds.has(g.id);

                  return (
                    <div
                      key={g.id}
                      className={`card adminListItem ${isActive ? "active" : ""}`}
                      style={{ opacity: cancelled ? 0.7 : 1 }}
                      onClick={() => openGame(g)}
                    >
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <div className="row" style={{ alignItems: "center", gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => { e.stopPropagation(); toggleGameSelect(g.id); }}
                            style={{ transform: "scale(1.15)" }}
                          />
                          <div>
                            <div style={{ fontWeight: 900 }}>
                              #{g.id} · {dt.date} {dt.time}
                            </div>
                            <div className="small muted">{g.location || "—"}</div>
                          </div>
                        </div>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          {g.video_url ? <span className="badge" title="Есть видео">▶️</span> : null}
                          <span className="badge">{g.status}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ===== RIGHT: game detail */}
          <div className="card">
            {!gameDraft ? (
              <div className="small muted">Выбери игру слева, чтобы редактировать.</div>
            ) : (
              <>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>Игра #{gameDraft.id}</h3>
                  <button className="btn secondary" onClick={() => deleteGame(gameDraft.id)}>Удалить</button>
                </div>

                <hr />

                <label>Дата/время</label>
                <div className="row">
                  <input
                    className="input"
                    type="date"
                    value={gameDraft.date}
                    onChange={(e) => setGameDraft((d) => ({ ...d, date: e.target.value }))}
                  />
                  <input
                    className="input"
                    type="time"
                    value={gameDraft.time}
                    onChange={(e) => setGameDraft((d) => ({ ...d, time: e.target.value }))}
                  />
                </div>

                <label>Арена</label>
                <input
                  className="input"
                  value={gameDraft.location}
                  onChange={(e) => setGameDraft((d) => ({ ...d, location: e.target.value }))}
                />

                <label>Статус</label>
                <select
                  value={gameDraft.status}
                  onChange={(e) => setGameDraft((d) => ({ ...d, status: e.target.value }))}
                >
                  <option value="scheduled">scheduled</option>
                  <option value="cancelled">cancelled</option>
                </select>

                <label>Ссылка на видео (YouTube)</label>
                <input
                  className="input"
                  value={gameDraft.video_url}
                  placeholder="https://www.youtube.com/watch?v=..."
                  onChange={(e) => setGameDraft((d) => ({ ...d, video_url: e.target.value }))}
                />
                <div className="small muted">
                  Оставь пустым и нажми “Сохранить” — ссылка удалится
                </div>

                <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" onClick={saveGameDraft}>Сохранить</button>
                  <button
                    className="btn secondary"
                    onClick={() => {
                      // перезагрузка draft из текущих данных
                      const g = (games || []).find((x) => x.id === gameDraft.id);
                      if (g) openGame(g);
                    }}
                  >
                    Сбросить правки
                  </button>
                </div>

                <hr />

                {/* Guests block */}
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div className="small" style={{ fontWeight: 900 }}>Гости</div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="btn secondary" onClick={() => loadGuestsForGame(gameDraft.id, true)}>
                      Обновить гостей
                    </button>
                    <button className="btn" onClick={() => openAddGuest(gameDraft.id)}>
                      + Добавить гостя
                    </button>
                  </div>
                </div>

                {(() => {
                  const st = guestsByGame[gameDraft.id] || { loading: false, list: [] };
                  if (st.loading) return <div className="small muted" style={{ marginTop: 8 }}>Загружаю гостей…</div>;
                  if ((st.list || []).length === 0) return <div className="small muted" style={{ marginTop: 8 }}>Гостей пока нет.</div>;
                  return (
                    <div style={{ marginTop: 8 }}>
                      {st.list.map((guestRow) => (
                        <GuestPill
                          key={guestRow.tg_id}
                          g={guestRow}
                          onEdit={() => openEditGuest(gameDraft.id, guestRow)}
                          onDel={() => deleteGuest(guestRow.tg_id)}
                        />
                      ))}
                    </div>
                  );
                })()}

                {guestFormOpen && guestPanelGameId === gameDraft.id && (
                  <div className="card" style={{ marginTop: 12 }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>
                        {guestEditingId ? "Редактировать гостя" : "Добавить гостя"}
                      </div>
                      <button className="btn secondary" onClick={() => setGuestFormOpen(false)}>Закрыть</button>
                    </div>

                    <div className="guestFormGrid" style={{ marginTop: 10 }}>
                      <div className="full">
                        <label>Имя гостя</label>
                        <input
                          className="input"
                          value={guestDraft.display_name}
                          onChange={(e) => setGuestDraft((d) => ({ ...d, display_name: e.target.value }))}
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
                            setGuestDraft((d) => ({ ...d, jersey_number: v }));
                          }}
                        />
                      </div>

                      <div>
                        <label>Позиция</label>
                        <select
                          value={guestDraft.position}
                          onChange={(e) => setGuestDraft((d) => ({ ...d, position: e.target.value }))}
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
                            onClick={() => setGuestDraft((d) => ({ ...d, status: "yes" }))}
                          >
                            ✅ Будет
                          </button>
                          <button
                            className={guestDraft.status === "maybe" ? "btn" : "btn secondary"}
                            onClick={() => setGuestDraft((d) => ({ ...d, status: "maybe" }))}
                          >
                            ❓ Под вопросом
                          </button>
                          <button
                            className={guestDraft.status === "no" ? "btn" : "btn secondary"}
                            onClick={() => setGuestDraft((d) => ({ ...d, status: "no" }))}
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
                              onChange={(e) => setGuestDraft((d) => ({ ...d, [k]: Number(e.target.value || 5) }))}
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
                          onChange={(e) => setGuestDraft((d) => ({ ...d, notes: e.target.value }))}
                        />
                      </div>

                      <div className="row full" style={{ marginTop: 6, gap: 8, flexWrap: "wrap" }}>
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
              </>
            )}
          </div>
        </div>
      ) : (
        // ===== PLAYERS section
        <div className="adminSplit">
          {/* LEFT: players list */}
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Игроки</h3>
              <span className="badge">{filteredPlayers.length}</span>
            </div>

            <input
              className="input"
              placeholder="Поиск: имя / username / id / номер"
              value={playerQ}
              onChange={(e) => setPlayerQ(e.target.value)}
              style={{ marginTop: 10 }}
            />

            <hr />

            {filteredPlayers.length === 0 ? (
              <div className="small muted">Игроков нет.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {filteredPlayers.map((p) => {
                  const isActive = activePlayerId === p.tg_id;
                  return (
                    <div
                      key={p.tg_id}
                      className={`card adminListItem ${isActive ? "active" : ""}`}
                      onClick={() => openPlayer(p)}
                    >
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 900 }}>
                            {showName(p)}{showNum(p)}{" "}
                            {p.username ? <span className="small muted">(@{p.username})</span> : null}
                          </div>
                          <div className="small muted">
                            tg_id: {p.tg_id}
                            {p.is_guest ? " · 🧷 гость" : ""}
                            {p.is_admin ? " · ⭐ админ" : ""}
                            {p.is_env_admin ? " · 🔒 env-админ" : ""}
                          </div>
                        </div>
                        <span className="badge">{p.disabled ? "disabled" : "active"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT: player detail */}
          <div className="card">
            {!playerDraft ? (
              <div className="small muted">Выбери игрока слева, чтобы редактировать.</div>
            ) : (
              <>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>
                    {showName(playerDraft)}{showNum(playerDraft)}
                  </h3>
                  <div className="row" style={{ gap: 8 }}>
                    {playerDraft.disabled ? <span className="badge">disabled</span> : <span className="badge">active</span>}
                  </div>
                </div>

                <div className="small muted" style={{ marginTop: 6 }}>
                  tg_id: {playerDraft.tg_id}
                  {playerDraft.is_guest ? " · 🧷 гость" : ""}
                  {playerDraft.is_admin ? " · ⭐ админ" : ""}
                  {playerDraft.is_env_admin ? " · 🔒 env-админ" : ""}
                </div>

                <hr />

                <label>display_name</label>
                <input
                  className="input"
                  value={playerDraft.display_name}
                  onChange={(e) => setPlayerDraft((d) => ({ ...d, display_name: e.target.value }))}
                  placeholder="Если пусто — будет Telegram first_name/username"
                />

                <label>Номер (0–99)</label>
                <input
                  className="input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={playerDraft.jersey_number}
                  onChange={(e) => setPlayerDraft((d) => ({ ...d, jersey_number: e.target.value.replace(/[^\d]/g, "").slice(0, 2) }))}
                />

                <label>Позиция (F/D/G)</label>
                <select
                  value={playerDraft.position}
                  onChange={(e) => setPlayerDraft((d) => ({ ...d, position: e.target.value }))}
                >
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
                        value={playerDraft[k]}
                        onChange={(e) => setPlayerDraft((d) => ({ ...d, [k]: Number(e.target.value || 5) }))}
                      />
                    </div>
                  ))}
                </div>

                <label>Заметки</label>
                <textarea
                  className="input"
                  rows={2}
                  value={playerDraft.notes}
                  onChange={(e) => setPlayerDraft((d) => ({ ...d, notes: e.target.value }))}
                />

                <div className="row" style={{ alignItems: "center", gap: 10 }}>
                  <label style={{ margin: 0 }}>Отключить</label>
                  <input
                    type="checkbox"
                    checked={!!playerDraft.disabled}
                    onChange={(e) => setPlayerDraft((d) => ({ ...d, disabled: e.target.checked }))}
                  />
                </div>

                <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" onClick={savePlayerDraft}>Сохранить игрока</button>

                  {isSuperAdmin && !playerDraft.is_guest && (
                    <button className="btn secondary" onClick={toggleAdminForPlayerDraft}>
                      {playerDraft.is_admin ? "Снять админа" : "Сделать админом"}
                    </button>
                  )}

                  <button
                    className="btn secondary"
                    onClick={() => {
                      const p = (players || []).find((x) => x.tg_id === playerDraft.tg_id);
                      if (p) openPlayer(p);
                    }}
                  >
                    Сбросить правки
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
