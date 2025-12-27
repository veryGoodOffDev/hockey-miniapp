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

function posHuman(pos) {
  if (pos === "G") return "Вратарь (G)";
  if (pos === "D") return "Защитник (D)";
  return "Нападающий (F)";
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

function Sheet({ title, onClose, children }) {
  return (
    <div className="sheetBackdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheetHeader">
          <button className="sheetBtn" onClick={onClose}>
            ← Назад
          </button>

          <div className="sheetTitle">{title}</div>

          <button className="sheetBtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="sheetBody">{children}</div>
      </div>
    </div>
  );
}


export default function AdminPanel({ apiGet, apiPost, apiPatch, apiDelete, onChanged }) {
  const [section, setSection] = useState("games"); // games | players | reminders

  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // create game
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [weeks, setWeeks] = useState(4);

  // reminders
  const [reminderMsg, setReminderMsg] = useState("");

  // players search
  const [q, setQ] = useState("");

  // sheets
  const [openGameId, setOpenGameId] = useState(null);
  const [openPlayerId, setOpenPlayerId] = useState(null);

  // drafts
  const [gameDraft, setGameDraft] = useState(null);
  const [playerDraft, setPlayerDraft] = useState(null);

  // guests (только внутри game sheet)
  const [guestsState, setGuestsState] = useState({ loading: false, list: [] });
  const [guestFormOpen, setGuestFormOpen] = useState(false);
  const [guestEditingId, setGuestEditingId] = useState(null);
  const [guestDraft, setGuestDraft] = useState({ ...GUEST_DEFAULT });

  // video toggle in game sheet
  const [videoOpen, setVideoOpen] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [attLoading, setAttLoading] = useState(false);
  const [customMsg, setCustomMsg] = useState("");
  //messages
  const [msgHistory, setMsgHistory] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [showDeletedMsgs, setShowDeletedMsgs] = useState(false);
  const [showPastAdmin, setShowPastAdmin] = useState(false);
  const [tokenMsg, setTokenMsg] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenUrl, setTokenUrl] = useState("");
  const [tokenValue, setTokenValue] = useState(""); // сам токен, чтобы можно было отозвать
  const [tokenForId, setTokenForId] = useState(null); // tg_id игрока, для которого показана ссылка


function fmtTs(ts) {
  try {
    return new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

async function loadMsgHistory() {
  if (!isSuperAdmin) return;
  setMsgLoading(true);
  try {
    const r = await apiGet(`/api/admin/bot-messages?limit=50&include_deleted=${showDeletedMsgs ? 1 : 0}`);
    setMsgHistory(r.messages || []);
  } finally {
    setMsgLoading(false);
  }
}

async function sendCustomToChat() {
  if (!customMsg.trim()) return;
  setReminderMsg("");
  try {
    await apiPost("/api/admin/bot-messages/send", { text: customMsg.trim() });
    setCustomMsg("");
    setReminderMsg("✅ Сообщение отправлено в чат");
    await loadMsgHistory();
  } catch (e) {
    setReminderMsg("❌ Не удалось отправить сообщение");
  }
}

async function deleteHistoryMsg(id) {
  const ok = confirm("Удалить это сообщение из чата? (Если уже удалено — просто уйдёт из истории)");
  if (!ok) return;

  setReminderMsg("");
  try {
    await apiPost(`/api/admin/bot-messages/${id}/delete`, {});
    await loadMsgHistory();
  } catch (e) {
    setReminderMsg("❌ Не удалось удалить");
  }
}

async function syncHistory() {
  setReminderMsg("");
  try {
    const r = await apiPost("/api/admin/bot-messages/sync", { limit: 50 });
    setReminderMsg(`🔄 Проверено: ${r.checked || 0}, удалено из истории: ${r.missing || 0}`);
    await loadMsgHistory();
  } catch (e) {
    setReminderMsg("❌ Ошибка синхронизации");
  }
}


    async function loadAttendanceForGame(gameId) {
      if (!gameId) return;
      setAttLoading(true);
      try {
        const r = await apiGet(`/api/game?game_id=${gameId}`);
        setAttendanceRows(r.rsvps || []);
      } finally {
        setAttLoading(false);
      }
    }
    
    // ✅ совместимость: старое имя всё ещё существует
    async function loadAttendance() {
      return loadAttendanceForGame(gameDraft?.id);
    }

async function setAttend(tg_id, status) {
  await apiPost("/api/admin/rsvp", { game_id: gameDraft.id, tg_id, status });
  // обновим локально без перезагрузки
  setAttendanceRows(prev => prev.map(x => String(x.tg_id) === String(tg_id) ? { ...x, status } : x));
  // если у тебя статистика/счётчики — можешь refreshAll дернуть
}

async function createRsvpLink(tg_id) {
  if (!gameDraft?.id || !tg_id) return;

  setTokenMsg("");
  setTokenUrl("");
  setTokenValue("");
  setTokenBusy(true);
  setTokenForId(tg_id);

  try {
    const r = await apiPost("/api/admin/rsvp-tokens", {
      game_id: gameDraft.id,
      tg_id,
      expires_hours: 72,
      max_uses: 0,
    });

    if (!r?.ok) {
      setTokenMsg(`❌ Не удалось создать ссылку: ${r?.reason || r?.error || "unknown"}`);
      setTokenForId(null);
      return;
    }

    const token = r?.token?.token || r?.token || "";
    setTokenValue(token);

    const url =
      r?.url ||
      (token ? `${window.location.origin}/rsvp?t=${encodeURIComponent(token)}` : "");

    if (!url) {
      setTokenMsg("❌ Токен создан, но URL пустой (проверь PUBLIC_WEB_URL/WEB_APP_URL на бэке)");
      setTokenForId(null);
      return;
    }

    setTokenUrl(url);

    try {
      await navigator.clipboard?.writeText?.(url);
      setTokenMsg("✅ Ссылка готова и (возможно) скопирована");
    } catch {
      setTokenMsg("✅ Ссылка готова (скопируй вручную ниже)");
    }
  } catch (e) {
    setTokenMsg("❌ Не удалось создать ссылку (ошибка запроса)");
    setTokenForId(null);
  } finally {
    setTokenBusy(false);
  }
}


  async function revokeToken() {
  if (!tokenValue) return;

  const ok = confirm("Отозвать ссылку? Она перестанет открываться.");
  if (!ok) return;

  setTokenBusy(true);
  try {
    const r = await apiPost("/api/admin/rsvp-tokens/revoke", { token: tokenValue });
    if (!r?.ok) {
      setTokenMsg(`❌ Не удалось отозвать: ${r?.reason || r?.error || "unknown"}`);
      return;
    }
    setTokenMsg("🚫 Ссылка отозвана");
    // можно оставить URL в поле, но лучше подсветить, что она уже невалидна
  } finally {
    setTokenBusy(false);
  }
}


  async function load() {
    const g = await apiGet("/api/games?scope=all&days=180&limit=100");
    setGames(g.games || []);

    const p = await apiGet("/api/admin/players");
    setPlayers(p.players || []);
    setIsSuperAdmin(!!p.is_super_admin);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredPlayers = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return players;
    return players.filter((p) =>
      (p.display_name || "").toLowerCase().includes(s) ||
      (p.first_name || "").toLowerCase().includes(s) ||
      (p.username || "").toLowerCase().includes(s) ||
      String(p.tg_id).includes(s) ||
      String(p.jersey_number ?? "").includes(s)
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

  function openGameSheet(g) {
    const dt = toLocal(g.starts_at);
    setOpenGameId(g.id);
    setVideoOpen(false);
    setGuestFormOpen(false);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT });

    setGameDraft({
      id: g.id,
      status: g.status,
      location: g.location || "",
      date: dt.date,
      time: dt.time,
      video_url: g.video_url || "",
      raw: g,
    });

    loadGuestsForGame(g.id);
    loadAttendanceForGame(g.id);
  }

  function closeGameSheet() {
    setOpenGameId(null);
    setGameDraft(null);
    setGuestsState({ loading: false, list: [] });
    setGuestFormOpen(false);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT });
    setVideoOpen(false);
  }

  async function saveGame() {
    if (!gameDraft) return;
    const starts_at = toIsoFromLocal(gameDraft.date, gameDraft.time);
    await apiPatch(`/api/games/${gameDraft.id}`, {
      starts_at,
      location: gameDraft.location,
      status: gameDraft.status,
      video_url: gameDraft.video_url || "",
    });
    await load();
    onChanged?.();
  }

  async function setGameStatus(status) {
    if (!gameDraft) return;
    await apiPost(`/api/games/${gameDraft.id}/status`, { status });
    setGameDraft((d) => ({ ...d, status }));
    await load();
    onChanged?.();
  }

  async function deleteGame() {
    if (!gameDraft) return;
    const ok = confirm(`Удалить игру #${gameDraft.id}?`);
    if (!ok) return;
    await apiDelete(`/api/games/${gameDraft.id}`);
    closeGameSheet();
    await load();
    onChanged?.();
  }

  async function openPlayerSheet(p) {
    setOpenPlayerId(p.tg_id);
    setPlayerDraft({
      tg_id: p.tg_id,
      display_name: p.display_name || "",
      jersey_number: p.jersey_number ?? "",
      position: (p.position || "F").toUpperCase(),
      skill: Number(p.skill ?? 5),
      skating: Number(p.skating ?? 5),
      iq: Number(p.iq ?? 5),
      stamina: Number(p.stamina ?? 5),
      passing: Number(p.passing ?? 5),
      shooting: Number(p.shooting ?? 5),
      notes: p.notes || "",
      disabled: !!p.disabled,
      is_admin: !!p.is_admin,
      is_guest: !!p.is_guest,
      username: p.username || "",
      first_name: p.first_name || "",
      is_env_admin: !!p.is_env_admin,
    });
  }

  function closePlayerSheet() {
    setOpenPlayerId(null);
    setPlayerDraft(null);
  }

  async function savePlayer() {
    if (!playerDraft) return;
    await apiPatch(`/api/admin/players/${playerDraft.tg_id}`, {
      display_name: playerDraft.display_name,
      jersey_number: playerDraft.jersey_number,
      position: playerDraft.position,
      skill: Number(playerDraft.skill),
      skating: Number(playerDraft.skating),
      iq: Number(playerDraft.iq),
      stamina: Number(playerDraft.stamina),
      passing: Number(playerDraft.passing),
      shooting: Number(playerDraft.shooting),
      notes: playerDraft.notes,
      disabled: Boolean(playerDraft.disabled),
    });
    await load();
    onChanged?.();
  }

  async function toggleAdmin() {
    if (!playerDraft) return;
    await apiPost(`/api/admin/players/${playerDraft.tg_id}/admin`, { is_admin: !playerDraft.is_admin });
    setPlayerDraft((d) => ({ ...d, is_admin: !d.is_admin }));
    await load();
    onChanged?.();
  }

  /** ===================== GUESTS ===================== */
  async function loadGuestsForGame(gameId) {
    setGuestsState({ loading: true, list: [] });
    try {
      const g = await apiGet(`/api/game?game_id=${gameId}`);
      const list = (g.rsvps || []).filter((x) => x.player_kind === "guest");
      setGuestsState({ loading: false, list });
    } catch (e) {
      console.error("loadGuestsForGame failed", e);
      setGuestsState({ loading: false, list: [] });
    }
  }

  function openAddGuest() {
    if (!gameDraft) return;
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT });
    setGuestFormOpen(true);
  }

  function openEditGuest(guestRow) {
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
  }

  async function saveGuest() {
    if (!gameDraft) return;

    const payload = {
      game_id: gameDraft.id,
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
      await apiPost(`/api/admin/rsvp`, { game_id: gameDraft.id, tg_id: guestEditingId, status: payload.status });
    } else {
      await apiPost("/api/admin/guests", payload);
    }

    setGuestFormOpen(false);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT });

    await loadGuestsForGame(gameDraft.id);
    await load();
    onChanged?.();
  }

  async function deleteGuest(tgId) {
    const ok = confirm("Удалить гостя? (Он исчезнет из списков и состава)");
    if (!ok) return;
    await apiDelete(`/api/admin/players/${tgId}`);
    if (gameDraft) await loadGuestsForGame(gameDraft.id);
    await load();
    onChanged?.();
  }

  async function promoteGuestToManual(tg_id) {
  const ok = confirm("Сделать этого гостя постоянным игроком команды (без Telegram)?");
  if (!ok) return;

  const r = await apiPost(`/api/admin/players/${tg_id}/promote`, {});
  if (!r?.ok) {
    setTokenMsg(`❌ Не удалось: ${r?.reason || r?.error || "unknown"}`);
    return;
  }

  setTokenMsg("⭐ Гость переведён в игроки команды (manual)");

  // обновим всё, чтобы он исчез из “Гости” и появился в “Игроки”
  if (gameDraft?.id) {
    await loadGuestsForGame(gameDraft.id);
    await loadAttendanceForGame(gameDraft.id);
  }
  await load();
  onChanged?.();
}

  
  function isPastGameAdmin(g) {
  if (!g?.starts_at) return false;
  const t = new Date(g.starts_at).getTime();
  return t < (Date.now() - 3 * 60 * 60 * 1000); // прошло, если старт был > 3ч назад
}

const upcomingAdminGames = useMemo(() => {
  return (games || [])
    .filter(g => !isPastGameAdmin(g))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)); // ближайшая первая
}, [games]);

const pastAdminGames = useMemo(() => {
  return (games || [])
    .filter(g => isPastGameAdmin(g))
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)); // свежие прошедшие сверху
}, [games]);

const adminListToShow = showPastAdmin ? pastAdminGames : upcomingAdminGames;

  useEffect(() => {
  if (section === "reminders" && isSuperAdmin) loadMsgHistory();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [section, isSuperAdmin, showDeletedMsgs]);


  function GuestPill({ g }) {
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
          <button
            className="iconBtn"
            title="Ссылка на отметку"
            disabled={tokenBusy}
            onClick={() => createRsvpLink(g.tg_id)}
          >
            🔗
          </button>
          <button
            className="iconBtn"
            title="Сделать игроком команды (manual)"
            onClick={() => promoteGuestToManual(g.tg_id)}
          >
            ⭐
          </button>

          <button className="iconBtn" title="Изменить" onClick={() => openEditGuest(g)}>✏️</button>
          <button className="iconBtn" title="Удалить" onClick={() => deleteGuest(g.tg_id)}>🗑️</button>
        </div>
      </div>
    );
  }

  /** ===================== UI ===================== */
  return (
    <div className="card">
      <style>{`
        .segRow{ display:flex; gap:8px; margin-top:10px; }
        .segBtn{
          flex:1;
          border:1px solid var(--border);
          background: transparent;
          padding:10px 12px;
          border-radius:999px;
          font-weight:900;
          cursor:pointer;
        }
        .segBtn.active{
          background: color-mix(in srgb, var(--tg-text) 10%, transparent);
        }

        .listItem{
          padding:12px;
          border:1px solid var(--border);
          border-radius:14px;
          background: var(--card-bg);
          cursor:pointer;
        }
        .listItem:active{ transform: translateY(1px); }
        .listMeta{ opacity:.85; font-size:13px; margin-top:3px; }
        .badgeMini{
          border:1px solid var(--border);
          border-radius:999px;
          padding:4px 10px;
          font-size:12px;
          font-weight:800;
          opacity:.9;
        }
        .rowBetween{ display:flex; justify-content:space-between; align-items:center; gap:10px; }

        .sheetBackdrop{
          position:fixed; inset:0;
          background: rgba(0,0,0,.5);
          z-index: 9999;
          display:flex;
          align-items:flex-end;
        }
        .sheet{
          width:100%;
          max-height: 92vh;
          background: var(--bg);
          border-top-left-radius: 18px;
          border-top-right-radius: 18px;
          border:1px solid var(--border);
          overflow:hidden;
        }
        .sheetHeader{
          display:flex; align-items:center; justify-content:space-between;
          gap:10px;
          padding:10px 12px;
          border-bottom:1px solid var(--border);
          background: color-mix(in srgb, var(--bg) 85%, black);
        }
        .sheetTitle{
          font-weight: 1000;
          text-align:center;
          flex:1;
          overflow:hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sheetBody{
          padding:12px;
          overflow:auto;
          -webkit-overflow-scrolling: touch;
          max-height: 82vh;
          padding-bottom: calc(18px + env(safe-area-inset-bottom));
        }

        .guestPill{
          display:flex; align-items:center; justify-content:space-between;
          gap:10px; padding:10px 12px;
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
          font-weight:800; font-size:12px;
          padding:4px 8px; border-radius:999px;
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

      <h2 style={{ marginTop: 0 }}>Админ</h2>

      <div className="segRow">
        <button className={`segBtn ${section === "games" ? "active" : ""}`} onClick={() => setSection("games")}>
          Игры
        </button>
        <button className={`segBtn ${section === "players" ? "active" : ""}`} onClick={() => setSection("players")}>
          Игроки
        </button>
        <button className={`segBtn ${section === "reminders" ? "active" : ""}`} onClick={() => setSection("reminders")}>
          Напоминания
        </button>
      </div>

      {/* ====== REMINDERS ====== */}
      {section === "reminders" && (
        <div className="card" style={{ marginTop: 12 }}>
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
            {isSuperAdmin && (
  <>
    <hr />

    <div className="small" style={{ opacity: 0.85 }}>
      ✉️ Кастомное сообщение в командный чат (доступно только super-admin)
    </div>

    <textarea
      className="input"
      rows={3}
      value={customMsg}
      onChange={(e) => setCustomMsg(e.target.value)}
      placeholder="Текст сообщения…"
      style={{ marginTop: 8 }}
    />

    <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
      <button className="btn" onClick={sendCustomToChat} disabled={!customMsg.trim()}>
        Отправить в чат
      </button>

      <button className="btn secondary" onClick={syncHistory}>
        🔄 Синхронизировать (убрать удалённые)
      </button>

      <button className="btn secondary" onClick={loadMsgHistory} disabled={msgLoading}>
        {msgLoading ? "…" : "Обновить историю"}
      </button>

      <button className="btn secondary" onClick={() => setShowDeletedMsgs(v => !v)}>
        {showDeletedMsgs ? "Скрыть удалённые" : "Показать удалённые"}
      </button>
    </div>

    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
      {msgHistory.length === 0 ? (
        <div className="small" style={{ opacity: 0.8 }}>История пустая.</div>
      ) : (
        msgHistory.map((m) => (
          <div key={m.id} className="card" style={{ opacity: m.deleted_at ? 0.65 : 1 }}>
            <div className="rowBetween" style={{ gap: 10 }}>
              <div style={{ fontWeight: 900 }}>
                {m.kind === "reminder" ? "⏰ Напоминание" : "✉️ Сообщение"} · {fmtTs(m.created_at)}
              </div>
              <span className="badgeMini">
                {m.deleted_at ? "удалено" : "в чате"}
              </span>
            </div>

            <div className="small" style={{ marginTop: 6, opacity: 0.9, whiteSpace: "pre-wrap" }}>
              {String(m.text || "").slice(0, 280)}
              {String(m.text || "").length > 280 ? "…" : ""}
            </div>

            {m.deleted_at ? (
              <div className="small" style={{ marginTop: 6, opacity: 0.75 }}>
                Удалено: {fmtTs(m.deleted_at)} · {m.delete_reason || "—"}
              </div>
            ) : (
              <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                <button className="btn secondary" onClick={() => deleteHistoryMsg(m.id)}>
                  🗑 Удалить сообщение
                </button>
                <div className="small" style={{ opacity: 0.75 }}>
                  chat: {m.chat_id} · msg: {m.message_id}
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  </>
)}

          </div>

          {reminderMsg && <div className="small" style={{ marginTop: 8 }}>{reminderMsg}</div>}
        </div>
      )}

     {/* ====== GAMES ====== */}
{section === "games" && (
  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
    <div className="card">
      <h2>Создать игру</h2>

      <div className="datetimeRow" style={{ paddingRight: 15 }}>
        <label>Дата</label>
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="datetimeRow" style={{ marginTop: 10, paddingRight: 15 }}>
        <label>Время</label>
        <input
          className="input"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>

      <label>Арена</label>
      <input
        className="input"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Например: Ледовая арена"
      />

      <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
        <button className="btn" onClick={createOne}>
          Создать
        </button>

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

        <button className="btn secondary" onClick={createSeries}>
          Создать расписание
        </button>
      </div>
    </div>

    <div className="card">
      <div className="rowBetween">
        <h2 style={{ margin: 0 }}>Список игр</h2>
        <button className="btn secondary" onClick={load}>
          Обновить
        </button>
      </div>

      {/* переключатель предстоящие/прошедшие */}
      <div className="rowBetween" style={{ marginTop: 10, gap: 10, alignItems: "center" }}>
        <button
          className="btn secondary"
          type="button"
          onClick={() => setShowPastAdmin((v) => !v)}
        >
          {showPastAdmin ? "⬅️ К предстоящим" : `📜 Прошедшие (${pastAdminGames.length})`}
        </button>

        <span className="small" style={{ opacity: 0.8 }}>
          {showPastAdmin
            ? `Показаны прошедшие: ${pastAdminGames.length}`
            : `Показаны предстоящие: ${upcomingAdminGames.length}`}
        </span>
      </div>

      {/* список */}
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {adminListToShow.map((g, idx) => {
          const dt = toLocal(g.starts_at);
          const cancelled = g.status === "cancelled";

          const d = new Date(g.starts_at);
          const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(d);
          const prettyDate = new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(d);

          const head = `${weekday}, ${prettyDate}, ${dt.time}`;
          const isNext = !showPastAdmin && idx === 0;

          return (
            <div
              key={g.id}
              className={`listItem gameListItem ${cancelled ? "isCancelled" : ""} ${isNext ? "isNext" : ""}`}
              style={{ opacity: cancelled ? 0.75 : 1 }}
              onClick={() => openGameSheet(g)}
            >
              <div className="rowBetween">
                <div className="gameTitle">{head}</div>
                <span className={`badgeMini ${cancelled ? "bad" : ""}`}>{g.status}</span>
              </div>

              <div className="gameArena">{g.location || "—"}</div>

              {g.video_url ? (
                <div className="gameVideoTag" title="Есть видео">
                  ▶️ Видео
                </div>
              ) : null}

              {isNext ? (
                <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                  ⭐ Ближайшая игра
                </div>
              ) : null}
            </div>
          );
        })}

        {adminListToShow.length === 0 && (
          <div className="small">
            {showPastAdmin ? "Прошедших игр пока нет." : "Предстоящих игр пока нет."}
          </div>
        )}
      </div>
    </div>
  </div>
)}

{/* ====== PLAYERS ====== */}
      {section === "players" && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="rowBetween">
            <h2 style={{ margin: 0 }}>Игроки</h2>
            <button className="btn secondary" onClick={load}>Обновить</button>
          </div>

          <input
            className="input"
            placeholder="Поиск: имя / username / номер / id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ marginTop: 10 }}
          />

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {filteredPlayers.map((p) => (
              <div key={p.tg_id} className="listItem" onClick={() => openPlayerSheet(p)}>
                <div className="rowBetween">
                  <div style={{ fontWeight: 900 }}>
                    {showName(p)}{showNum(p)}{" "}
                    {p.username ? <span className="small">(@{p.username})</span> : null}
                  </div>
                  <span className="badgeMini">{p.disabled ? "disabled" : "active"}</span>
                </div>
                <div className="listMeta">
                  {posHuman((p.position || "F").toUpperCase())}
                  {p.is_guest ? " · 🧷 гость" : ""}
                  {p.is_admin ? " · ⭐ админ" : ""}
                  {p.is_env_admin ? " · 🔒 env-админ" : ""}
                </div>
              </div>
            ))}
            {filteredPlayers.length === 0 && <div className="small">Игроков не найдено.</div>}
          </div>
        </div>
      )}

      {/* ====== GAME SHEET ====== */}
      {openGameId && gameDraft && (
        <Sheet title={`Игра #${gameDraft.id}`} onClose={closeGameSheet}>
          <div className="card">
            <div className="rowBetween">
              <div className="small" style={{ opacity: 0.9 }}>
                Статус: <b>{gameDraft.status}</b>
              </div>
              <span className="badge">{gameDraft.status}</span>
            </div>

           <label>Дата</label>
            <div className="iosField">
              <input
                className="input"
                style={{ paddingRight:20 }}
                type="date"
                value={gameDraft.date}
                onChange={(e) => setGameDraft((d) => ({ ...d, date: e.target.value }))}
              />
            </div>
            
            <label>Время</label>
            <div className="iosField">
              <input
                className="input"
                style={{ paddingRight:20 }}
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

            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={saveGame}>Сохранить</button>

              {gameDraft.status === "cancelled" ? (
                <button className="btn secondary" onClick={() => setGameStatus("scheduled")}>
                  Вернуть (заплан.)
                </button>
              ) : (
                <button className="btn secondary" onClick={() => setGameStatus("cancelled")}>
                  Отменить
                </button>
              )}

              <button className="btn secondary" onClick={deleteGame}>Удалить</button>
            </div>

            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="btn secondary" onClick={() => setVideoOpen((v) => !v)}>
                {videoOpen ? "Скрыть видео" : (gameDraft.video_url ? "Изменить видео" : "Добавить видео")}
              </button>
              {gameDraft.video_url ? <span className="badge" title="Есть видео">▶️</span> : null}
            </div>

            {videoOpen && (
              <>
                <label>Ссылка на видео (YouTube)</label>
                <input
                  className="input"
                  value={gameDraft.video_url}
                  placeholder="https://www.youtube.com/watch?v=..."
                  onChange={(e) => setGameDraft((d) => ({ ...d, video_url: e.target.value }))}
                />
                <div className="small" style={{ opacity: 0.8 }}>
                  Оставь пустым и нажми “Сохранить” — ссылка удалится
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="rowBetween">
              <h2 style={{ margin: 0 }}>Гости</h2>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn secondary" onClick={() => loadGuestsForGame(gameDraft.id)}>
                  Обновить
                </button>
                <button className="btn" onClick={openAddGuest}>
                  + Добавить
                </button>
              </div>
            </div>
            <div className="card">
            <div className="rowBetween">
              <h2 style={{ margin: 0 }}>Посещаемость</h2>
              <button className="btn secondary" onClick={loadAttendance}>Обновить</button>
            </div>
              {tokenMsg && (
                <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
                  {tokenMsg}
                </div>
              )}
          
            {attLoading ? (
              <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>Загружаю игроков…</div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {attendanceRows.map((p) => {
                  const st = p.status || "maybe";
                  return (
                    <div key={p.tg_id}
                      className="listItem"
                      ref={(el) => {
                        if (el && tokenForId === p.tg_id) {
                          setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
                        }
                      }}>
                      <div className="rowBetween">
                        <div style={{ fontWeight: 900 }}>
                          {showName(p)}{showNum(p)}
                        </div>
                      
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <span className="badgeMini">{st}</span>
                          <button
                            className="iconBtn"
                            type="button"
                            title="Ссылка на отметку"
                            disabled={tokenBusy}
                            onClick={() => createRsvpLink(p.tg_id)}
                          >
                            🔗
                          </button>
                        </div>
                      </div>

          
                      <div className="segRow" role="radiogroup" aria-label="Посещаемость">
                        {tokenForId === p.tg_id && tokenUrl && (
                          <div className="card" style={{ marginTop: 10 }}>
                            <div className="small" style={{ opacity: 0.85, marginBottom: 6 }}>
                              Ссылка для: <b>{showName(p)}{showNum(p)}</b>
                            </div>
                        
                            <input className="input" value={tokenUrl} readOnly />
                        
                            <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                              <button
                                className="btn"
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard?.writeText?.(tokenUrl);
                                    setTokenMsg("✅ Ссылка скопирована");
                                  } catch {
                                    setTokenMsg("✅ Скопируй вручную (долгий тап по полю)");
                                  }
                                }}
                              >
                                📋 Копировать
                              </button>
                        
                              <button
                                className="btn secondary"
                                type="button"
                                onClick={() => {
                                  const tg = window.Telegram?.WebApp;
                                  if (tg?.openLink) tg.openLink(tokenUrl);
                                  else window.open(tokenUrl, "_blank", "noopener,noreferrer");
                                }}
                              >
                                🔎 Открыть
                              </button>
                        
                              <button
                                className="btn secondary"
                                type="button"
                                disabled={tokenBusy || !tokenValue}
                                onClick={revokeToken}
                              >
                                🚫 Отозвать
                              </button>
                        
                              <button
                                className="btn secondary"
                                type="button"
                                onClick={() => {
                                  setTokenForId(null);
                                  setTokenUrl("");
                                  setTokenValue("");
                                  setTokenMsg("");
                                }}
                              >
                                ✕ Скрыть
                              </button>
                            </div>
                        
                            {tokenMsg && (
                              <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
                                {tokenMsg}
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          className={st === "yes" ? "segBtn on" : "segBtn"}
                          onClick={() => setAttend(p.tg_id, "yes")}
                        >
                          ✅ Был
                        </button>
                        <button
                          className={st === "no" ? "segBtn on" : "segBtn"}
                          onClick={() => setAttend(p.tg_id, "no")}
                        >
                          ❌ Не был
                        </button>
                        <button
                          className={st === "maybe" ? "segBtn on" : "segBtn"}
                          onClick={() => setAttend(p.tg_id, "maybe")}
                        >
                          ⭕ Не отмечено
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

            {guestsState.loading ? (
              <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>Загружаю гостей…</div>
            ) : (
              <>
                {(guestsState.list || []).length === 0 ? (
                  <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>Гостей пока нет.</div>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    {guestsState.list.map((g) => (
                      <GuestPill key={g.tg_id} g={g} />
                    ))}
                  </div>
                )}
              </>
            )}

            {guestFormOpen && (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="rowBetween">
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
                      className="input"
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
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
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

                    {guestEditingId && (
                      <button className="btn secondary" onClick={() => { setGuestEditingId(null); setGuestDraft({ ...GUEST_DEFAULT }); }}>
                        Очистить
                      </button>
                    )}

                    {guestEditingId && (
                      <button className="btn secondary" onClick={() => deleteGuest(guestEditingId)}>
                        Удалить гостя
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Sheet>
      )}

      {/* ====== PLAYER SHEET ====== */}
      {openPlayerId && playerDraft && (
        <Sheet title={`Игрок: ${showName(playerDraft)}${showNum(playerDraft)}`} onClose={closePlayerSheet}>
          <div className="card">
            <div className="small" style={{ opacity: 0.9 }}>
              tg_id: <b>{playerDraft.tg_id}</b>
              {playerDraft.username ? ` · @${playerDraft.username}` : ""}
              {p.player_kind === "manual" ? " · 👤 manual" : ""}
              {playerDraft.is_env_admin ? " · 🔒 env-админ" : ""}
            </div>

            <label>Отображаемое имя</label>
            <input
              className="input"
              value={playerDraft.display_name}
              onChange={(e) => setPlayerDraft((d) => ({ ...d, display_name: e.target.value }))}
            />

            <label>Номер (0–99)</label>
            <input
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              value={playerDraft.jersey_number}
              onChange={(e) => setPlayerDraft((d) => ({ ...d, jersey_number: e.target.value.replace(/[^\d]/g, "").slice(0, 2) }))}
            />

            <label>Позиция</label>
            <select
              className="input"
              value={playerDraft.position}
              onChange={(e) => setPlayerDraft((d) => ({ ...d, position: e.target.value }))}
            >
              <option value="F">F</option>
              <option value="D">D</option>
              <option value="G">G</option>
            </select>

            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
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

            <div className="row" style={{ alignItems: "center" }}>
              <label style={{ margin: 0 }}>Отключить</label>
              <input
                type="checkbox"
                checked={!!playerDraft.disabled}
                onChange={(e) => setPlayerDraft((d) => ({ ...d, disabled: e.target.checked }))}
              />
            </div>

            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={savePlayer}>Сохранить</button>

              {isSuperAdmin && !playerDraft.is_guest && (
                <button className="btn secondary" onClick={toggleAdmin}>
                  {playerDraft.is_admin ? "Снять админа" : "Сделать админом"}
                </button>
              )}

              <button className="btn secondary" onClick={closePlayerSheet}>Готово</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
