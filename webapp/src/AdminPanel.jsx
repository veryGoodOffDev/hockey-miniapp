import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import GameSheet from "./admin/GameSheet.jsx";
import PlayerSheet from "./admin/PlayerSheet.jsx";
// import MapPickModal from "./admin/MapPickModal.jsx";
// import { toLocal, showName, showNum, posHuman } from "./admin/adminUtils.js";


delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});


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

function tgConfirm({ title, message, okText = "OK", cancelText = "Отмена" }) {
  return new Promise((resolve) => {
    const tg = window.Telegram?.WebApp;
    if (tg?.showPopup) {
      tg.showPopup(
        {
          title,
          message,
          buttons: [
            { id: "cancel", type: "cancel", text: cancelText },
            { id: "ok", type: "default", text: okText },
          ],
        },
        (id) => resolve(id === "ok")
      );
      return;
    }
    resolve(window.confirm(`${title}\n\n${message}`));
  });
}
const SKILLS = ["skill", "skating", "iq", "stamina", "passing", "shooting"];
const DEFAULT_SKILL = 5;

function clampSkill(v) {
  if (v === "" || v == null) return DEFAULT_SKILL;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SKILL;
  return Math.max(1, Math.min(10, Math.round(n)));
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

function MapPickModal({ open, initial, onClose, onPick }) {
  const [pos, setPos] = useState(() => {
    if (initial?.lat != null && initial?.lon != null) return { lat: initial.lat, lon: initial.lon };
    return { lat: 55.751244, lon: 37.618423 }; // Москва
  });

  const [picked, setPicked] = useState(() => ({
    lat: initial?.lat ?? null,
    lon: initial?.lon ?? null,
    address: "",
  }));

  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState("");

  useEffect(() => {
    if (!open) return;

    const lat = initial?.lat ?? null;
    const lon = initial?.lon ?? null;

    setPos(() => {
      if (lat != null && lon != null) return { lat, lon };
      return { lat: 55.751244, lon: 37.618423 };
    });

    setPicked({ lat, lon, address: "" });
    setAddr("");
    setQ("");
    setList([]);
  }, [open, initial?.lat, initial?.lon]);

  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const j = await r.json();
      const text = j?.display_name || "";
      setAddr(text);
      return text;
    } catch {
      return "";
    }
  }

  async function doSearch() {
    const s = q.trim();
    if (!s) return setList([]);
    setBusy(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(s)}&limit=6`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const j = await r.json();
      setList(Array.isArray(j) ? j : []);
    } finally {
      setBusy(false);
    }
  }

  function Recenter({ lat, lon }) {
    const map = useMap();
    useEffect(() => {
      if (lat == null || lon == null) return;
      map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lat, lon]);
    return null;
  }

  function ClickToPick() {
    useMapEvents({
      click: async (e) => {
        const lat = Number(e.latlng.lat);
        const lon = Number(e.latlng.lng);

        setPicked({ lat, lon, address: "" });
        const a = await reverseGeocode(lat, lon);
        setPicked({ lat, lon, address: a });
      },
    });

    return picked.lat != null && picked.lon != null ? <Marker position={[picked.lat, picked.lon]} /> : null;
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 14,
      }}
      onClick={onClose}
    >
      <div className={"card mapPickModal__card"} onClick={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>📍 Выберите точку на карте</h3>
          <button className="btn secondary" onClick={onClose}>✖</button>
        </div>

        {/* BODY (SCROLL) */}
        <div className="mapPickModal__body">
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="Поиск адреса/арены…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch();
              }}
            />
            <button className="btn secondary" disabled={busy} onClick={doSearch}>
              {busy ? "..." : "Найти"}
            </button>
          </div>

          {!!list.length && (
            <div className="card mapPickModal__suggest" style={{ marginTop: 10 }}>
              {list.map((x) => (
                <div
                  key={x.place_id}
                  className="row"
                  style={{ justifyContent: "space-between", cursor: "pointer", padding: "8px 6px" }}
                  onClick={async () => {
                    const lat = Number(x.lat);
                    const lon = Number(x.lon);

                    setPos({ lat, lon });
                    setPicked({ lat, lon, address: x.display_name || "" });
                    setAddr(x.display_name || "");
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{x.display_name}</div>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              marginTop: 10,
              height: "clamp(260px, 44dvh, 520px)",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <MapContainer
              center={[pos.lat, pos.lon]}
              zoom={15}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom={true}
              attributionControl={false}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Recenter lat={pos.lat} lon={pos.lon} />
              <ClickToPick />
            </MapContainer>
          </div>

          {/* легальная атрибуция (прячем дефолтный блок, показываем текстом ниже) */}
          <div className="small" style={{ opacity: 0.7, marginTop: 6 }}>
            © OpenStreetMap contributors · Leaflet
          </div>
        </div>

        {/* FOOTER (STICKY) */}
        <div className="mapPickModal__footer">
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div className="small" style={{ opacity: 0.9 }}>
              {picked.lat != null && picked.lon != null ? (
                <>
                  Координаты: <b>{picked.lat.toFixed(6)}, {picked.lon.toFixed(6)}</b>
                  {addr ? <div style={{ marginTop: 6 }}>Адрес: {addr}</div> : null}
                </>
              ) : (
                "Кликни по карте, чтобы поставить метку"
              )}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn secondary" onClick={onClose}>Отмена</button>

              <button
                className="btn"
                disabled={picked.lat == null || picked.lon == null}
                onClick={() => {
                  onPick?.({ lat: picked.lat, lon: picked.lon, address: addr || picked.address || "" });
                  onClose?.();
                }}
              >
                ✅ Выбрать
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



export default function AdminPanel({ apiGet, apiPost, apiPatch, apiDelete, onChanged }) {
  const [section, setSection] = useState("games"); // games | players | applications | reminders | jersey

  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [teamApps, setTeamApps] = useState([]);
  const [teamAppsLoading, setTeamAppsLoading] = useState(false);

  // create game
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [weeks, setWeeks] = useState(4);

  // reminders
  const [reminderMsg, setReminderMsg] = useState("");

  // ===== jersey =====
  const [jerseyBatches, setJerseyBatches] = useState([]);
  const [jerseyOpen, setJerseyOpen] = useState(null);
  const [jerseyTitle, setJerseyTitle] = useState("");
  const [jerseyOrders, setJerseyOrders] = useState([]);
  const [jerseyLoading, setJerseyLoading] = useState(false);
  const [jerseyOrdersLoading, setJerseyOrdersLoading] = useState(false);
  const [jerseyErr, setJerseyErr] = useState("");
  // (добавь после строки 346)
const [jerseySelectedId, setJerseySelectedId] = useState(null);




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
  const [geoPickOpen, setGeoPickOpen] = useState(false);
  const [createGeo, setCreateGeo] = useState({ lat: "", lon: "", address: "" });
  const [geoPickTarget, setGeoPickTarget] = useState("create"); // 'create' | 'edit'

  const [gameSheetOpen, setGameSheetOpen] = useState(false);
const [sheetGame, setSheetGame] = useState(null);

const [playerSheetOpen, setPlayerSheetOpen] = useState(false);
const [sheetPlayer, setSheetPlayer] = useState(null);

const [createGeoPickOpen, setCreateGeoPickOpen] = useState(false);

const [videoNotifySilent, setVideoNotifySilent] = useState(false);


function openPlayerSheet(p) {
  if (!p) return;
  setSheetPlayer(p);
  setPlayerSheetOpen(true);
}

function closePlayerSheet() {
  setPlayerSheetOpen(false);
  setSheetPlayer(null);
}




  const [op, setOp] = useState({ busy: false, text: "", tone: "info" });
const opTimerRef = useRef(null);
const opBusy = !!op.busy;

function flashAdmin(text, tone = "info", busy = false, holdMs = 1800) {
  setOp({ text, tone, busy });
  if (opTimerRef.current) clearTimeout(opTimerRef.current);
  if (holdMs > 0) {
    opTimerRef.current = setTimeout(() => setOp((s) => ({ ...s, text: "" })), holdMs);
  }
}

async function runAdminOp(label, fn, { successText = "✅ Готово", errorText = "❌ Ошибка" } = {}) {
  flashAdmin(label, "info", true, 0);
  try {
    await fn();
    flashAdmin(successText, "success", false, 1400);
    return true;
  } catch (e) {
    console.error("Admin op failed:", label, e);
    flashAdmin(errorText, "error", false, 2400);
    return false;
  }
}


  function closeAdminOp() {
  setOp((s) => ({ ...s, busy: false, text: "" }));
  if (opTimerRef.current) clearTimeout(opTimerRef.current);
}


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
  if (!gameDraft?.id) return;

  await runAdminOp("Сохраняю посещаемость…", async () => {
    await apiPost("/api/admin/rsvp", { game_id: gameDraft.id, tg_id, status });

    setAttendanceRows((prev) =>
      prev.map((x) => (String(x.tg_id) === String(tg_id) ? { ...x, status } : x))
    );

    await onChanged?.({ label: "✅ Посещаемость сохранена — обновляю приложение…", gameId: gameDraft.id });
  }, { successText: "✅ Сохранено" });
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

function openGameSheet(g) {
  if (!g) return;
  setSheetGame(g);
  setGameSheetOpen(true);
}
function closeGameSheet() {
  setGameSheetOpen(false);
  setSheetGame(null);
}

function openPlayerSheet(p) {
  if (!p) return;
  setSheetPlayer(p);
  setPlayerSheetOpen(true);
}
function closePlayerSheet() {
  setPlayerSheetOpen(false);
  setSheetPlayer(null);
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


    async function load(opts = {}) {
      const { silent = false } = opts;
    
      if (!silent) flashAdmin("Обновляю админ-данные…", "info", true, 0);
    
      try {
        const g = await apiGet("/api/games?scope=all&days=180&limit=100");
        setGames(g.games || []);
    
        const p = await apiGet("/api/admin/players");
        setPlayers(p.players || []);
        setIsSuperAdmin(!!p.is_super_admin);

        const apps = await apiGet("/api/admin/team-applications");
        setTeamApps(apps.applications || []);
    
        if (!silent) flashAdmin("✅ Обновлено", "success", false, 1200);
      } catch (e) {
        console.error("load failed", e);
        if (!silent) flashAdmin("❌ Не удалось обновить", "error", false, 2400);
      }
    }

    async function approveTeamApp(id) {
      setTeamAppsLoading(true);
      try {
        await apiPost(`/api/admin/team-applications/${id}/approve`, {});
        await load({ silent: true });
      } finally {
        setTeamAppsLoading(false);
      }
    }

    async function rejectTeamApp(id) {
      setTeamAppsLoading(true);
      try {
        await apiPost(`/api/admin/team-applications/${id}/reject`, {});
        await load({ silent: true });
      } finally {
        setTeamAppsLoading(false);
      }
    }


    useEffect(() => {
      load({ silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
  if (section !== "jersey") return;
  loadJerseyBatches({ silent: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [section]);


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

  const jerseySelected = useMemo(() => {
  if (!jerseyBatches?.length) return null;
  const byId = jerseyBatches.find((b) => String(b.id) === String(jerseySelectedId));
  return byId || (jerseyOpen?.id ? jerseyOpen : null) || jerseyBatches[0] || null;
}, [jerseyBatches, jerseySelectedId, jerseyOpen]);


  async function sendReminderNow() {
    await runAdminOp("Отправляю напоминание…", async () => {
      setReminderMsg("");
      const r = await apiPost("/api/admin/reminder/sendNow", {});
      if (r?.ok) setReminderMsg("✅ Напоминание отправлено");
      else setReminderMsg(`❌ Ошибка: ${r?.reason || r?.error || "unknown"}`);
    });
  }

  function adminName(p) {
  const dn = (p.display_name || "").trim();
  if (dn) return dn;
  const fn = (p.first_name || "").trim();
  if (fn) return fn;
  if (p.username) return `@${p.username}`;
  return String(p.tg_id || "");
}

function downloadTextFile(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadJerseyBatches({ silent = false } = {}) {
  if (!silent) flashAdmin("Загружаю сборы формы…", "info", true, 0);
  setJerseyErr("");
  setJerseyLoading(true);
  try {
    const r = await apiGet("/api/admin/jersey/batches");
    if (!r?.ok) throw new Error(r?.reason || "load_failed");

    const list = r.batches || [];
    setJerseyBatches(list);

    const open = list.find((b) => b.status === "open") || null;
    setJerseyOpen(open);

    const keep =
      (jerseySelectedId && list.some((b) => String(b.id) === String(jerseySelectedId)))
        ? jerseySelectedId
        : (open?.id ?? list[0]?.id ?? null);

    setJerseySelectedId(keep);

    if (keep) {
      await loadJerseyOrders(keep, { silent: true });
    } else {
      setJerseyOrders([]);
    }

    if (!silent) flashAdmin("✅ Готово", "success", false, 1200);
  } catch (e) {
    console.error("loadJerseyBatches failed", e);
    setJerseyErr("Не удалось загрузить");
    if (!silent) flashAdmin("❌ Не удалось загрузить", "error", false, 2200);
  } finally {
    setJerseyLoading(false);
  }
}


async function loadJerseyOrders(batchId, { silent = false } = {}) {
  setJerseyOrdersLoading(true);
  try {
    const r = await apiGet(`/api/admin/jersey/batches/${batchId}/orders`);
    if (!r?.ok) throw new Error(r?.reason || "orders_failed");
    setJerseyOrders(r.orders || []);
  } catch (e) {
    console.error("loadJerseyOrders failed", e);
    if (!silent) flashAdmin("❌ Не удалось загрузить заявки", "error", false, 2200);
  } finally {
    setJerseyOrdersLoading(false);
  }
}

async function openJerseyBatch() {
  await runAdminOp("Открываю сбор…", async () => {
    const r = await apiPost("/api/admin/jersey/batches/open", { title: jerseyTitle.trim() });
    if (!r?.ok) throw new Error(r?.reason || "open_failed");
    setJerseyTitle("");
    await loadJerseyBatches({ silent: true });
  }, { successText: "✅ Сбор открыт", errorText: "❌ Не удалось открыть сбор" });
}

async function closeJerseyBatch(id) {
  await runAdminOp("Закрываю сбор…", async () => {
    const r = await apiPost(`/api/admin/jersey/batches/${id}/close`, {});
    if (!r?.ok) throw new Error(r?.reason || "close_failed");
    await loadJerseyBatches({ silent: true });
  }, { successText: "✅ Сбор закрыт", errorText: "❌ Не удалось закрыть" });
}

async function reopenJerseyBatch(id) {
  const ok = await tgConfirm({
    title: "Возобновить сбор?",
    message: "Сбор снова откроется для отправки и редактирования заявок.",
    okText: "Возобновить",
    cancelText: "Отмена",
  });
  if (!ok) return;

  await runAdminOp("Возобновляю сбор…", async () => {
    const r = await apiPost(`/api/admin/jersey/batches/${id}/reopen`, {});
    if (!r?.ok) throw new Error(r?.reason || "reopen_failed");
    await loadJerseyBatches({ silent: true });
  }, { successText: "✅ Сбор возобновлён", errorText: "❌ Не удалось возобновить" });
}

async function deleteJerseyBatch(id) {
  const ok = await tgConfirm({
    title: "Удалить сбор?",
    message: "Будут удалены все заявки из этого сбора. Действие необратимо.",
    okText: "Удалить",
    cancelText: "Отмена",
  });
  if (!ok) return;

  await runAdminOp("Удаляю сбор…", async () => {
    const r = await apiDelete(`/api/admin/jersey/batches/${id}`);
    if (!r?.ok) throw new Error(r?.reason || "delete_failed");
    setJerseyOrders([]);
    await loadJerseyBatches({ silent: true });
  }, { successText: "✅ Сбор удалён", errorText: "❌ Не удалось удалить" });
}

async function announceJerseyBatch(id) {
  await runAdminOp("Отправляю сообщение в чат…", async () => {
    const r = await apiPost(`/api/admin/jersey/batches/${id}/announce`, {});
    if (!r?.ok) throw new Error(r?.reason || "announce_failed");
    await loadJerseyBatches({ silent: true });
  }, { successText: "✅ Отправлено в чат", errorText: "❌ Не удалось отправить" });
}

async function exportJerseyCsv(id) {
  await runAdminOp("Готовлю CSV…", async () => {
    const r = await apiGet(`/api/admin/jersey/batches/${id}/export`);
    if (!r?.ok) throw new Error(r?.reason || "export_failed");
    downloadTextFile(r.filename || `jersey_batch_${id}.csv`, r.csv || "", "text/csv;charset=utf-8");
  }, { successText: "✅ CSV скачан", errorText: "❌ Не удалось выгрузить" });
}





async function createOne() {
  if (!date || !time) return;

  await runAdminOp("Создаю игру…", async () => {
    const starts_at = toIsoFromLocal(date, time);

    const latStr = String(createGeo.lat ?? "").replace(",", ".").trim();
    const lonStr = String(createGeo.lon ?? "").replace(",", ".").trim();

    const geo_lat = latStr === "" ? null : Number(latStr);
    const geo_lon = lonStr === "" ? null : Number(lonStr);

    if ((geo_lat !== null && !Number.isFinite(geo_lat)) || (geo_lon !== null && !Number.isFinite(geo_lon))) {
      alert("❌ Геоточка: lat/lon должны быть числами (или пусто)");
      return;
    }
    if ((geo_lat === null) !== (geo_lon === null)) {
      alert("❌ Геоточка: нужно заполнить и lat, и lon (или оставить оба пустыми)");
      return;
    }

    const payload = { starts_at, location, geo_lat, geo_lon };
    console.log("CREATE payload:", payload, "createGeo:", createGeo);

    const r = await apiPost("/api/games", payload);
    console.log("CREATE response:", r);

    await load({ silent: true });
    await onChanged?.({ label: "✅ Игра создана — обновляю приложение…", refreshPlayers: false });

    setCreateGeo({ lat: "", lon: "", address: "" });
  }, { successText: "✅ Игра создана" });
}




  
async function createSeries() {
  if (!date || !time || weeks < 1) return;

  await runAdminOp(`Создаю расписание (${weeks} нед.)…`, async () => {
    const geo_lat = createGeo.lat.trim() ? Number(createGeo.lat) : null;
    const geo_lon = createGeo.lon.trim() ? Number(createGeo.lon) : null;

    for (let i = 0; i < weeks; i++) {
      const base = new Date(`${date}T${time}`);
      base.setDate(base.getDate() + i * 7);

      await apiPost("/api/games", {
        starts_at: base.toISOString(),
        location,
        geo_lat,
        geo_lon,
      });
    }

    await load({ silent: true });
    await onChanged?.({ label: "✅ Расписание создано — обновляю приложение…", refreshPlayers: false });

    setCreateGeo({ lat: "", lon: "", address: "" });
  }, { successText: "✅ Расписание создано" });
}




function openGameSheetLegacy(g) {
  // ✅ защита от null/undefined
  if (!g) {
    console.warn("openGameSheet: game is null");
    return;
  }

  const dt = toLocal(g.starts_at);

  setOpenGameId(g.id);
  setVideoOpen(false);
  setGuestFormOpen(false);
  setGuestEditingId(null);
  setGuestDraft({ ...GUEST_DEFAULT });

 setGameDraft({
  id: g.id,
  status: g.status || "scheduled",
  location: g.location || "",
  date: dt.date,
  time: dt.time,
  video_url: g.video_url || "",

  geo_lat: g.geo_lat == null ? "" : String(g.geo_lat),
  geo_lon: g.geo_lon == null ? "" : String(g.geo_lon),
  geo_address: g.geo_address || "",

  raw: g,
});


  loadGuestsForGame(g.id);
  loadAttendanceForGame(g.id);
}


  function closeGameSheetLegacy() {
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

  await runAdminOp("Сохраняю игру…", async () => {
    const starts_at = toIsoFromLocal(gameDraft.date, gameDraft.time);

    const latStr = String(gameDraft.geo_lat ?? "").replace(",", ".").trim();
    const lonStr = String(gameDraft.geo_lon ?? "").replace(",", ".").trim();

    const geo_lat = latStr === "" ? null : Number(latStr);
    const geo_lon = lonStr === "" ? null : Number(lonStr);

    if ((geo_lat !== null && !Number.isFinite(geo_lat)) || (geo_lon !== null && !Number.isFinite(geo_lon))) {
      alert("❌ Геоточка: lat/lon должны быть числами (или пусто)");
      return;
    }
    if ((geo_lat === null) !== (geo_lon === null)) {
      alert("❌ Геоточка: нужно заполнить и lat, и lon (или оставить оба пустыми)");
      return;
    }

    await apiPatch(`/api/games/${gameDraft.id}`, {
      starts_at,
      location: gameDraft.location,
      status: gameDraft.status,
      video_url: gameDraft.video_url || "",
      geo_lat,
      geo_lon
    });

    await load({ silent: true });
    await onChanged?.({ label: "✅ Игра сохранена — обновляю приложение…", gameId: gameDraft.id });
  }, { successText: "✅ Игра сохранена" });
}

async function sendVideoNotify() {
  if (!gameDraft?.id) return;

  const url = String(gameDraft.video_url || "").trim();
  if (!url) {
    alert("❌ Ссылка на видео пустая");
    return;
  }

  await runAdminOp("Отправляю уведомление о видео…", async () => {
    await apiPost("/api/admin/games/video/send", {
      game_id: gameDraft.id,
      video_url: url,              // чтобы можно было отправить даже до сохранения
      silent: videoNotifySilent,   // ✅ галочка
    });
  }, { successText: "✅ Отправлено в чат" });
}


async function sendVideoToChat() {
  if (!gameDraft) return;

  const url = String(gameDraft.video_url || "").trim();
  if (!url) {
    alert("Сначала добавь ссылку на видео.");
    return;
  }

  const savedUrl = String(gameDraft.raw?.video_url || "").trim();
  const dirty = savedUrl !== url;

  if (dirty) {
    const ok = confirm("Ссылка на видео ещё не сохранена. Отправить в чат то, что сейчас в поле?");
    if (!ok) return;
  }

  await runAdminOp("Отправляю сообщение о видео в чат…", async () => {
    await apiPost("/api/admin/games/video/send", {
      game_id: gameDraft.id,
      video_url: url, // ✅ отправляем явным образом
    });

    // если хочешь — обновляй историю сообщений
    // await loadMsgHistory();
  }, { successText: "✅ Отправлено в чат", errorText: "❌ Не удалось отправить" });
}

async function setGameStatus(status) {
  if (!gameDraft) return;

  await runAdminOp("Меняю статус игры…", async () => {
    await apiPost(`/api/games/${gameDraft.id}/status`, { status });
    setGameDraft((d) => ({ ...d, status }));

    await load({ silent: true });
    await onChanged?.({ label: "✅ Статус обновлён — обновляю приложение…", gameId: gameDraft.id });
  }, { successText: "✅ Статус обновлён" });
}

async function deleteGame() {
  if (!gameDraft) return;
  const ok = confirm(`Удалить игру #${gameDraft.id}?`);
  if (!ok) return;

  await runAdminOp("Удаляю игру…", async () => {
    await apiDelete(`/api/games/${gameDraft.id}`);
    const deletedId = gameDraft.id;

    closeGameSheet();
    await load({ silent: true });
    await onChanged?.({ label: "✅ Игра удалена — обновляю приложение…", gameId: deletedId });
  }, { successText: "✅ Игра удалена" });
}


  async function openPlayerSheetLegacy(p) {
    setOpenPlayerId(p.tg_id);
    setPlayerDraft({
      tg_id: p.tg_id,
      display_name: p.display_name || "",
      player_kind: p.player_kind || "tg",
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

  function closePlayerSheetLegacy() {
    setOpenPlayerId(null);
    setPlayerDraft(null);
  }

async function adminDeleteJerseyReq(id) {
  const ok = await tgConfirm({
    title: "Удалить заявку?",
    message: `Заявка #${id} будет удалена навсегда.`,
    okText: "Удалить",
    cancelText: "Отмена",
  });
  if (!ok) return;

  await runAdminOp(
    "Удаляю…",
    async () => {
      const r = await apiDelete(`/api/admin/jersey/requests/${id}`); // если у тебя apiDelete нет — скажи, дам 3 строки реализации
      if (!r?.ok) throw new Error(r?.reason || "delete_failed");

      setJerseyOrders((prev) => (prev || []).filter((row) => row.id !== id));

      // перезагрузи список заявок текущего батча
      if (jerseySelectedId) {
        await loadJerseyOrders(jerseySelectedId, { silent: true });
      }
    },
    { successText: "✅ Удалено", errorText: "❌ Не удалось удалить" }
  );
}


    async function savePlayer() {
      if (!playerDraft) return;
    
      await runAdminOp("Сохраняю игрока…", async () => {
        const body = {
          display_name: (playerDraft.display_name ?? "").trim(),
          jersey_number:
            playerDraft.jersey_number === "" || playerDraft.jersey_number == null
              ? null
              : Number(String(playerDraft.jersey_number).replace(/[^\d]/g, "").slice(0, 2)),
          position: (playerDraft.position || "F").toUpperCase(),
          notes: playerDraft.notes ?? "",
          disabled: !!playerDraft.disabled,
        };
    
        for (const k of SKILLS) body[k] = clampSkill(playerDraft[k]);
    
        await apiPatch(`/api/admin/players/${playerDraft.tg_id}`, body);
    
        await load({ silent: true });
        await onChanged?.({ label: "✅ Игрок сохранён — обновляю приложение…", refreshPlayers: true });
      }, { successText: "✅ Игрок сохранён" });
    }
    
    async function toggleAdmin() {
      if (!playerDraft) return;
    
      await runAdminOp("Меняю права админа…", async () => {
        await apiPost(`/api/admin/players/${playerDraft.tg_id}/admin`, { is_admin: !playerDraft.is_admin });
        setPlayerDraft((d) => ({ ...d, is_admin: !d.is_admin }));
    
        await load({ silent: true });
        await onChanged?.({ label: "✅ Права обновлены — обновляю приложение…", refreshPlayers: true });
      }, { successText: "✅ Права обновлены" });
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

  await runAdminOp(guestEditingId ? "Сохраняю гостя…" : "Добавляю гостя…", async () => {
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
      await apiPost("/api/admin/rsvp", { game_id: gameDraft.id, tg_id: guestEditingId, status: payload.status });
    } else {
      await apiPost("/api/admin/guests", payload);
    }

    setGuestFormOpen(false);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT });

    await loadGuestsForGame(gameDraft.id);
    await loadAttendanceForGame(gameDraft.id);
    await load({ silent: true });

    await onChanged?.({ label: "✅ Гости обновлены — обновляю приложение…", gameId: gameDraft.id });
  }, { successText: "✅ Сохранено" });
}

async function deleteGuest(tgId) {
  const ok = confirm("Удалить гостя? (Он исчезнет из списков и состава)");
  if (!ok) return;

  await runAdminOp("Удаляю гостя…", async () => {
    await apiDelete(`/api/admin/players/${tgId}`);

    if (gameDraft) {
      await loadGuestsForGame(gameDraft.id);
      await loadAttendanceForGame(gameDraft.id);
    }
    await load({ silent: true });

    await onChanged?.({ label: "✅ Гость удалён — обновляю приложение…", gameId: gameDraft?.id });
  }, { successText: "✅ Гость удалён" });
}

async function promoteGuestToManual(tg_id) {
  const ok = confirm("Сделать этого гостя постоянным игроком команды (без Telegram)?");
  if (!ok) return;

  await runAdminOp("Перевожу гостя в игроки…", async () => {
    const r = await apiPost(`/api/admin/players/${tg_id}/promote`, {});
    if (!r?.ok) {
      setTokenMsg(`❌ Не удалось: ${r?.reason || r?.error || "unknown"}`);
      return;
    }

    setTokenMsg("⭐ Гость переведён в игроки команды (manual)");

    if (gameDraft?.id) {
      await loadGuestsForGame(gameDraft.id);
      await loadAttendanceForGame(gameDraft.id);
    }
    await load({ silent: true });

    await onChanged?.({ label: "✅ Состав игроков обновлён — обновляю приложение…", refreshPlayers: true, gameId: gameDraft?.id });
  }, { successText: "✅ Переведено" });
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
        <div className="toastWrap" aria-live="polite" aria-atomic="true">
          <div className={`toast tone-${op.tone} ${op.text ? "isShow" : ""}`}>
            <div className="toastRow">
              <div className="toastIcon">
                {op.busy ? "⏳" : op.tone === "success" ? "✅" : op.tone === "error" ? "❌" : "ℹ️"}
              </div>
        
              <div className="toastText">{op.text || ""}</div>
        
              <button className="toastClose" onClick={closeAdminOp} aria-label="Закрыть">
                ✕
              </button>
            </div>
        
            {op.busy ? (
              <div className="toastBar" aria-hidden="true">
                <i />
              </div>
            ) : null}
          </div>
        </div>

      <div className="segRow">
        <button className={`segBtn ${section === "games" ? "active" : ""}`} onClick={() => setSection("games")}>
          Игры
        </button>
        <button className={`segBtn ${section === "players" ? "active" : ""}`} onClick={() => setSection("players")}>
          Игроки
        </button>
        <button className={`segBtn ${section === "applications" ? "active" : ""}`} onClick={() => setSection("applications")}>
          Заявки{teamApps.length ? ` (${teamApps.length})` : ""}
        </button>
        <button className={`segBtn ${section === "jersey" ? "active" : ""}`} onClick={() => setSection("jersey")}>
          Форма
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
{/* ====== JERSEY ====== */}
{section === "jersey" && (
  <div className="card" style={{ marginTop: 12 }}>
    <h2>👕 Командная форма</h2>

    {jerseyErr ? <div className="small" style={{ marginTop: 8 }}>❌ {jerseyErr}</div> : null}

    <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <div className="small" style={{ opacity: 0.8 }}>Сбор:</div>

      <select
        className="input"
        style={{ maxWidth: 320 }}
        value={jerseySelectedId ?? ""}
        onChange={async (e) => {
          const id = Number(e.target.value);
          if (!id) return;
          setJerseySelectedId(id);
          await loadJerseyOrders(id, { silent: true });
        }}
        disabled={jerseyLoading}
      >
        <option value="" disabled>— выбрать —</option>
        {jerseyBatches.map((b) => (
          <option key={b.id} value={b.id}>
            {(b.status === "open" ? "🟢" : "⚪️")} {b.title ? b.title : `Сбор #${b.id}`}
          </option>
        ))}
      </select>

      <button
        className="btn secondary"
        onClick={() => loadJerseyBatches({ silent: false })}
        disabled={jerseyLoading}
      >
        Обновить
      </button>
    </div>

    {jerseySelected ? (
      <>
        <div className="badge" style={{ marginTop: 10 }}>
          {jerseySelected.status === "open" ? "🟢 Сбор открыт" : "⚪️ Сбор закрыт"}
          {jerseySelected.title ? `: ${jerseySelected.title}` : ""}
          {" · "}
          заявок: {jerseySelected.orders_count ?? 0}
        </div>

        <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
          {jerseySelected.status === "open" ? (
            <>
              <button className="btn" onClick={() => announceJerseyBatch(jerseySelected.id)} disabled={jerseyLoading}>
                Отправить сообщение в чат
              </button>
              <button className="btn secondary" onClick={() => closeJerseyBatch(jerseySelected.id)} disabled={jerseyLoading}>
                Закрыть сбор
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => reopenJerseyBatch(jerseySelected.id)} disabled={jerseyLoading}>
                Возобновить сбор
              </button>
              <button className="btn secondary" onClick={() => deleteJerseyBatch(jerseySelected.id)} disabled={jerseyLoading}>
                Удалить сбор
              </button>
            </>
          )}

          <button className="btn secondary" onClick={() => exportJerseyCsv(jerseySelected.id)} disabled={jerseyLoading}>
            Скачать CSV
          </button>

          <button className="btn secondary" onClick={() => loadJerseyOrders(jerseySelected.id)} disabled={jerseyOrdersLoading}>
            Обновить заявки
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <h3 style={{ margin: "10px 0" }}>Заявки</h3>

          {jerseyOrdersLoading ? (
            <div className="small" style={{ opacity: 0.8 }}>Загружаю…</div>
          ) : jerseyOrders.length === 0 ? (
            <div className="small" style={{ opacity: 0.8 }}>Пока нет заявок.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {jerseyOrders.map((o) => (
                <div key={o.id} className="card" style={{ margin: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    {adminName(o)} {o.username ? <span style={{ opacity: 0.7 }}>({`@${o.username}`})</span> : null}
                    {o.status ? <span style={{ marginLeft: 10, opacity: 0.75 }}>· {o.status}</span> : null}
                  </div>

                  <div className="small" style={{ opacity: 0.85, marginTop: 6 }}>
                    Имя на джерси: <b>{o.name_on_jersey}</b><br/>
                    Цвета: <b>{(o.jersey_colors || []).join(", ") || "—"}</b><br/>
                    Номер: <b>{o.jersey_number ?? "—"}</b><br/>
                    Размер: <b>{o.jersey_size || "—"}</b><br/>
                    Гамаши: <b>{o.socks_needed ? "Да" : "Нет"}</b>
                    {o.socks_needed ? (
                      <>
                        <br/>Цвета гамаш: <b>{(o.socks_colors || []).join(", ") || "—"}</b>
                        <br/>Размер гамаш: <b>{o.socks_size || "adult"}</b>
                      </>
                    ) : null}
                    <br/>Отправлено: <b>{String(o.sent_at || o.updated_at || "")}</b>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() => adminDeleteJerseyReq(o.id)}
                    title="Удалить заявку"
                  >
                    🗑
                  </button>

                </div>
              ))}
            </div>
          )}
        </div>
      </>
    ) : (
      <div className="small" style={{ marginTop: 10, opacity: 0.8 }}>
        Сборов ещё нет. Открой первый сбор ниже.
      </div>
    )}

    {/* Блок открытия нового сбора */}
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      {jerseyOpen ? (
        <div className="small" style={{ opacity: 0.8 }}>
          Сейчас уже есть открытый сбор: <b>{jerseyOpen.title || `#${jerseyOpen.id}`}</b>. Сначала закрой его.
        </div>
      ) : (
        <>
          <div className="small" style={{ opacity: 0.85 }}>
            Открой сбор — и игроки смогут отправлять заявки.
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Название сбора (необязательно)</label>
            <input
              className="input"
              value={jerseyTitle}
              onChange={(e) => setJerseyTitle(e.target.value)}
              placeholder="Например: Весна 2026"
            />
          </div>

          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={openJerseyBatch} disabled={jerseyLoading}>
              Открыть сбор
            </button>
          </div>
        </>
      )}
    </div>
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
<label>Геоточка (необязательно)</label>

<div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
  <input
    className="input"
    style={{ flex: 1, minWidth: 140 }}
    placeholder="lat (например 55.751244)"
    value={createGeo.lat}
    onChange={(e) => setCreateGeo((s) => ({ ...s, lat: e.target.value.replace(",", ".") }))}
  />
  <input
    className="input"
    style={{ flex: 1, minWidth: 140 }}
    placeholder="lon (например 37.618423)"
    value={createGeo.lon}
    onChange={(e) => setCreateGeo((s) => ({ ...s, lon: e.target.value.replace(",", ".") }))}
  />
</div>

<div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
<button className="btn secondary" onClick={() => setCreateGeoPickOpen(true)}>
  🗺️ Выбрать на карте
</button>


  <button
    className="btn secondary"
    onClick={() => setCreateGeo({ lat: "", lon: "", address: "" })}
  >
    🗑 Убрать точку
  </button>

  {createGeo.lat && createGeo.lon ? (
    <span className="badge">✅ {Number(createGeo.lat).toFixed(6)}, {Number(createGeo.lon).toFixed(6)}</span>
  ) : (
    <span className="badge">—</span>
  )}
</div>



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
              <b>{g.id}</b>
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


{/* ====== APPLICATIONS ====== */}
      {section === "applications" && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="rowBetween">
            <h2 style={{ margin: 0 }}>Заявки</h2>
            <button className="btn secondary" onClick={load}>Обновить</button>
          </div>

          {teamApps.length === 0 ? (
            <div className="small" style={{ marginTop: 10, opacity: 0.8 }}>
              Пока заявок нет.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {teamApps.map((app) => (
                <div key={app.id} className="listItem">
                  <div className="rowBetween">
                    <div style={{ fontWeight: 800 }}>{app.email}</div>
                    <div className="small">{new Date(app.created_at).toLocaleString("ru-RU")}</div>
                  </div>
                  <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                    <button className="btn" onClick={() => approveTeamApp(app.id)} disabled={teamAppsLoading}>
                      Принять
                    </button>
                    <button className="btn secondary" onClick={() => rejectTeamApp(app.id)} disabled={teamAppsLoading}>
                      Отклонить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                  {p.joke_premium_active ? " · 🌟 премиум" : ""}
                </div>
              </div>
            ))}
            {filteredPlayers.length === 0 && <div className="small">Игроков не найдено.</div>}
          </div>
        </div>
      )}

 
<MapPickModal
  open={createGeoPickOpen}
  initial={{
    lat: createGeo.lat ? Number(createGeo.lat) : null,
    lon: createGeo.lon ? Number(createGeo.lon) : null,
  }}
  onClose={() => setCreateGeoPickOpen(false)}
  onPick={(v) => {
    setCreateGeo({
      lat: v.lat != null ? String(v.lat) : "",
      lon: v.lon != null ? String(v.lon) : "",
      address: v.address || "",
    });
    setCreateGeoPickOpen(false);
  }}
/>

<GameSheet
  open={gameSheetOpen}
  game={sheetGame}
  onClose={closeGameSheet}
  apiGet={apiGet}
  apiPost={apiPost}
  apiPatch={apiPatch}
  apiDelete={apiDelete}
  onReload={() => load({ silent: true })}
  onChanged={onChanged}
/>

<PlayerSheet
  open={playerSheetOpen}
  player={sheetPlayer}
  isSuperAdmin={isSuperAdmin}
  onClose={closePlayerSheet}
  apiPatch={apiPatch}
  apiPost={apiPost}
  apiDelete={apiDelete}
  onReload={() => load({ silent: true })}
  onChanged={onChanged}
/>

    </div>
  );
}
