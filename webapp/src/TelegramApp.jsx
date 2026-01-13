import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "./api.js";
import HockeyLoader from "./HockeyLoader.jsx";
import { JerseyBadge } from "./JerseyBadge.jsx";
import AdminPanel from "./AdminPanel.jsx";
import GameSheet from "./admin/GameSheet.jsx"; 

import { SupportForm, AboutBlock } from "./ProfileExtras.jsx";
import bg1 from "./bg1.webp";
import bg2 from "./bg2.webp";
import bg3 from "./bg3.webp";
import bg4 from "./bg4.webp";
import bg5 from "./bg5.webp";
import bg6 from "./bg6.webp";
import yandexNavIcon from "./YandexNavigatorLogo.svg";
import talismanIcon from "./talisman.webp";

const GAME_BGS = [bg1, bg2, bg3, bg4, bg5, bg6];

const BOT_DEEPLINK = "https://t.me/HockeyLineupBot";

export default function TelegramApp() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || "";
  const tgUser = tg?.initDataUnsafe?.user || null;
  const inTelegramWebApp = Boolean(initData && tgUser?.id);
  const tgPopupBusyRef = useRef(false);


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
  const [statsMode, setStatsMode] = useState("yes"); // yes | no | all
  const [statsFrom, setStatsFrom] = useState("");
  const [statsTo, setStatsTo] = useState("");

  // игры: прошедшие
  const [showPast, setShowPast] = useState(false);
  const [gamesError, setGamesError] = useState(null);

  // ===== прошедшие: пагинация + фильтры =====
  const PAST_LIMIT = 10;
  const [pastPage, setPastPage] = useState([]);
  const [pastTotal, setPastTotal] = useState(0);
  const [pastOffset, setPastOffset] = useState(0);
  const [pastLoading, setPastLoading] = useState(false);

  const [pastFrom, setPastFrom] = useState("");
  const [pastTo, setPastTo] = useState("");
  const [pastQ, setPastQ] = useState("");

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

  const isMeId = (id) => me?.tg_id != null && String(id) === String(me.tg_id);

  const [teamsSendBusy, setTeamsSendBusy] = useState(false);
  const [teamsSendMsg, setTeamsSendMsg] = useState("");
  const [talismanHolder, setTalismanHolder] = useState(null);
  const [bestPick, setBestPick] = useState("");
  const [posPopup, setPosPopup] = useState(null); 
  // ===== players photo modal =====
const [photoModal, setPhotoModal] = useState({ open: false, src: "", title: "" });

const [remEnabled, setRemEnabled] = useState(false);
const [remAt, setRemAt] = useState(""); // datetime-local string
const [remPin, setRemPin] = useState(true);
const [remSaving, setRemSaving] = useState(false);
const [gameSheetOpen, setGameSheetOpen] = useState(false);
const [gameSheetGame, setGameSheetGame] = useState(null);
function tgSafeAlert(text) {
  if (!tg?.showAlert) {
    window.alert(text);
    return Promise.resolve();
  }
  if (tgPopupBusyRef.current) return Promise.resolve(); // игнорим второй алерт

  tgPopupBusyRef.current = true;

  return new Promise((resolve) => {
    try {
      tg.showAlert(String(text || ""), () => {
        tgPopupBusyRef.current = false;
        resolve();
      });
    } catch (e) {
      tgPopupBusyRef.current = false;
      resolve();
    }
  });
}
const onChanged = async ({ label, gameId, action } = {}) => {
  if (label) console.log(label);

  closeGameSheet();

  if (gameId) {
    setSelectedGameId(gameId);
    setGameView("detail"); // сразу в деталку
  }

  await refreshAll(gameId ?? selectedGameId);
};




// function openGameSheet(g) {
//   if (!g) return;
//   setAdminGame(g);
//   setAdminGameOpen(true);
// }

// function closeGameSheet() {
//   setAdminGameOpen(false);
//   setAdminGame(null);
// }


function openGameSheet(game) {
  if (!game) return;
  setGameSheetGame(game);
  setGameSheetOpen(true);
}

function closeGameSheet() {
  setGameSheetOpen(false);
  setGameSheetGame(null);
}

const NEW_GAME_TEMPLATE = {
  id: null,               // важный признак "создание"
  starts_at: new Date().toISOString(),
  location: "",
  status: "scheduled",
  video_url: "",
  geo_lat: null,
  geo_lon: null,

  // если ты переносишь напоминание в шит — пусть поля будут сразу
  reminder_enabled: false,
  reminder_at: null,
  reminder_pin: true,
};

function openCreateGameSheet() {
  setGameSheetGame(NEW_GAME_TEMPLATE);
  setGameSheetOpen(true);
}


function getAvatarSrc(p) {
  // подстрой под своё поле, если оно другое
  return (
    p?.photo_url ||
    p?.photo ||
    p?.avatar_url ||
    p?.avatar ||
    ""
  );
}
function openPhotoModal(p) {
  const src = (p?.photo_url || "").trim();
  if (!src) return;
  setPhotoModal({ open: true, src, title: showName(p) || "Фото игрока" });
}

function closePhotoModal() {
  setPhotoModal({ open: false, src: "", title: "" });
}

  const [funStatus, setFunStatus] = useState({
  thanks_done: false,
  donate_done: false,
  donate_value: null,
});
const [funBusy, setFunBusy] = useState(false);
  const [fun, setFun] = useState(null); // {thanks_total, donate_total, premium}
  const [donateOpen, setDonateOpen] = useState(false);

function tgPopup({ title, message, buttons }) {
  return new Promise((resolve) => {
    const tg = window.Telegram?.WebApp;

    // fallback вне телеги
    if (!tg?.showPopup) {
      if (buttons?.length === 1) {
        alert(message);
        return resolve({ id: buttons[0]?.id || "ok" });
      }
      const ok = confirm(message);
      return resolve({ id: ok ? "yes" : "no" });
    }

    // ✅ защита от "Popup is already opened"
    if (tgPopupBusyRef.current) return resolve({ id: "cancel" });
    tgPopupBusyRef.current = true;

    try {
      tg.showPopup({ title, message, buttons }, (id) => {
        tgPopupBusyRef.current = false;
        resolve({ id: id || "" });
      });
    } catch (e) {
      tgPopupBusyRef.current = false;
      resolve({ id: "cancel" });
    }
  });
}


async function loadFunStatus() {
  try {
    const r = await apiGet("/api/fun/status");
    if (r?.ok) setFun(r);
  } catch {}
}

function errReason(e) {
  return e?.reason || e?.data?.reason || e?.response?.data?.reason || null;
}


  // ===== UI feedback for any mutations =====
const [op, setOp] = useState({ busy: false, text: "", tone: "info" }); // tone: info|success|error
const opTimerRef = useRef(null);
const opBusy = !!op.busy;

function flashOp(text, tone = "info", busy = false, holdMs = 1800) {
  setOp({ text, tone, busy });
  if (opTimerRef.current) clearTimeout(opTimerRef.current);
  if (holdMs > 0) {
    opTimerRef.current = setTimeout(() => {
      setOp((s) => ({ ...s, text: "" }));
    }, holdMs);
  }
}

async function runOp(label, fn, { successText = "Готово", errorText = "Не удалось", sync = null } = {}) {
  flashOp(label, "info", true, 0);
  try {
    if (typeof fn === "function") await fn();
    if (sync) {
      const syncOpts = sync === true ? {} : sync;
      await syncAfterMutation(syncOpts);
    }
    flashOp(successText, "success", false, 1400);
    return true;
  } catch (e) {
    console.error("runOp failed:", label, e);
    flashOp(errorText, "error", false, 2400);
    return false;
  }
}


  function closeOp() {
  setOp((s) => ({ ...s, busy: false, text: "" }));
  if (opTimerRef.current) clearTimeout(opTimerRef.current);
}
// ===== light refreshes (avoid heavy refreshAll) =====
async function refreshUpcomingGamesOnly() {
  const gl = await apiGet("/api/games?scope=upcoming&limit=365&offset=0");

  if (gl?.ok === false) {
    setGamesError(gl);
    setGames([]);
    return null;
  }

  setGamesError(null);
  setGames(gl.games || []);
  setTalismanHolder(gl.talisman_holder || null);
  return gl.games || [];
}

async function refreshPlayersDirOnly() {
  const r = await apiGet("/api/players");
  setPlayersDir(r.players || []);
  return r.players || [];
}

async function refreshGameOnly(gameId = selectedGameId) {
  if (!gameId) return null;
  const gg = await apiGet(`/api/game?game_id=${gameId}`);
  setGame(gg.game || null);
  setRsvps(gg.rsvps || []);
  setTeams(normalizeTeams(gg.teams));
  return gg;
}

/**
 * Единственная точка синхронизации UI после мутаций
 * opts:
 * - gameId: какой game обновлять
 * - refreshGames: обновить карточки игр (upcoming)
 * - refreshGame: обновить деталку выбранной игры + отметки
 * - refreshPlayers: обновить справочник игроков (вкладка players)
 * - refreshPast: если показываем прошедшие - перезагрузить pastPage
 */
async function syncAfterMutation(sync = {}) {
  const tasks = [];

  if (sync.refreshMe) tasks.push(refreshMeOnly());
  if (sync.refreshPlayers) tasks.push(refreshPlayersDirOnly());
  if (sync.refreshGames) tasks.push(refreshUpcomingGamesOnly());

  if (sync.refreshGame) {
    const gid = sync.gameId ?? selectedGameId;
    if (gid) tasks.push(refreshGameOnly(gid));
  }

  if (!tasks.length) return;

  const t0 = performance.now();
  const results = await Promise.allSettled(tasks);
  console.log("syncAfterMutation ms:", Math.round(performance.now() - t0));

  // опционально: лог ошибок
  results.forEach((r) => {
    if (r.status === "rejected") console.warn("sync task failed:", r.reason);
  });
}



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

async function loadAttendance(opts = {}) {
  const {
    days = statsDays,
    from = statsFrom,
    to = statsTo,
  } = opts;

  try {
    setStatsLoading(true);

    const qs = new URLSearchParams();

    // если задан диапазон — используем его
    const useRange = (from && from.trim()) || (to && to.trim());
    if (useRange) {
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      qs.set("days", "0"); // на всякий
    } else {
      qs.set("days", String(days ?? 0));
    }

    const res = await apiGet(`/api/stats/attendance?${qs.toString()}`);
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

    // доступ закрыт
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

    const gamesUrl = "/api/games?scope=upcoming&limit=365&offset=0";

    // если уже знаем игру (почти всегда да после первой загрузки) — можно грузить деталку параллельно
    const optimisticId = forceGameId ?? selectedGameId ?? null;
    const gameUrl = optimisticId ? `/api/game?game_id=${encodeURIComponent(optimisticId)}` : null;

    let gl;
    let ggOptimistic = null;

    if (gameUrl) {
      // ✅ параллельные запросы
      const [glRes, ggRes] = await Promise.allSettled([apiGet(gamesUrl), apiGet(gameUrl)]);

      if (glRes.status === "rejected") throw glRes.reason;
      gl = glRes.value;

      if (ggRes.status === "fulfilled") ggOptimistic = ggRes.value;
      // если gg упал — просто догрузим позже, не валим весь refreshAll
    } else {
      gl = await apiGet(gamesUrl);
    }

    if (gl?.ok === false) {
      setGamesError(gl);
      setGames([]);
      setTalismanHolder(null);
      setGame(null);
      setRsvps([]);
      setTeams(null);
      return;
    }

    const list = gl.games || [];
    setGames(list);
    setTalismanHolder(gl.talisman_holder || null);

    const safeNext =
      list.find((g) => g.status === "scheduled" && !isPastGame(g))?.id ??
      list.find((g) => !isPastGame(g))?.id ??
      list[0]?.id ??
      null;

    const nextId = forceGameId ?? selectedGameId ?? safeNext;
    if (nextId) setSelectedGameId(nextId);

    // если параллельно грузили не ту игру — догружаем нужную
    let gg;
    if (ggOptimistic && String(nextId) === String(optimisticId)) {
      gg = ggOptimistic;
    } else {
      gg = await apiGet(nextId ? `/api/game?game_id=${encodeURIComponent(nextId)}` : "/api/game");
    }

    setGame(gg.game);
    setRsvps(gg.rsvps || []);
    setTeams(normalizeTeams(gg.teams));
  } catch (e) {
    console.error("refreshAll failed", e);
    setGamesError({ ok: false, error: "network_or_unknown" });
  }
}



  async function loadGame(gameId) {
  const gid = gameId ?? selectedGameId;
  if (!gid) return null;

  const gg = await apiGet(`/api/game?game_id=${gid}`);
  setGame(gg.game || null);
  setRsvps(gg.rsvps || []);
  setTeams(normalizeTeams(gg.teams));
  return gg;
}
  async function loadPast(reset = false) {
    try {
      setPastLoading(true);

      const nextOffset = reset ? 0 : pastOffset;

      const qs = new URLSearchParams({
        scope: "past",
        limit: String(PAST_LIMIT),
        offset: String(nextOffset),
      });

      if (pastFrom) qs.set("from", pastFrom);
      if (pastTo) qs.set("to", pastTo);
      if (pastQ.trim()) qs.set("q", pastQ.trim());

      const r = await apiGet(`/api/games?${qs.toString()}`);

      const total = Number(r?.total ?? 0);
      const rows = Array.isArray(r?.games) ? r.games : [];

      setPastTotal(total);

      if (reset) {
        setPastPage(rows);
        setPastOffset(rows.length);
      } else {
        setPastPage((prev) => [...prev, ...rows]);
        setPastOffset(nextOffset + rows.length);
      }
    } catch (e) {
      console.error("loadPast failed", e);
    } finally {
      setPastLoading(false);
    }
  }

  function openPhotoModal(p) {
  const src = getAvatarSrc(p);
  if (!src) return; // если нет фото - ничего
  setPhotoModal({
    open: true,
    src,
    title: showName(p) || "Фото игрока",
  });
}

function closePhotoModal() {
  setPhotoModal({ open: false, src: "", title: "" });
}

useEffect(() => {
  function onKey(e) {
    if (e.key === "Escape") closePhotoModal();
  }
  if (photoModal.open) window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [photoModal.open]);

function clipText(s, max = 70) {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
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
      document.documentElement.dataset.tg = scheme;
      document.documentElement.dataset.theme = scheme;

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
    const sp = String(window.Telegram?.WebApp?.initDataUnsafe?.start_param || "").trim();
    const m = sp.match(/^teams_(\d+)$/);
    if (!m) return;
  
    const gid = Number(m[1]);
    if (!Number.isFinite(gid) || gid <= 0) return;
  
    setSelectedGameId(gid);
    setTab("teams");
  
    // если у тебя есть teamsBack и ты хочешь норм "назад"
    setTeamsBack?.({ tab: "game", gameView: "detail" });
  
    (async () => {
  setDetailLoading(true);
  try {
    await Promise.all([
      refreshUpcomingGamesOnly(), // чтобы talisman_holder и статусы в списке были свежие
      refreshGameOnly(gid),       // чтобы составы/отметки для teams были свежие
    ]);
  } finally {
    setDetailLoading(false);
  }
})();
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

  useEffect(() => {
    if (!game) return;
    setBestPick(game.best_player_tg_id ? String(game.best_player_tg_id) : "");
  }, [game?.id, game?.best_player_tg_id]);

useEffect(() => {
  if (tab === "profile" && profileView === "thanks") loadFunStatus();
}, [tab, profileView]);

useEffect(() => {
  if (!game) return;
  setRemEnabled(!!game.reminder_enabled);
  setRemPin(game.reminder_pin !== false);

  // reminder_at (timestamptz) -> datetime-local
  if (game.reminder_at) {
    const d = new Date(game.reminder_at);
    const pad = (n) => String(n).padStart(2, "0");
    const local =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setRemAt(local);
  } else {
    setRemAt("");
  }
}, [game?.id]);



async function rsvp(status) {
  if (!selectedGameId) return;

  await runOp(
    "Сохраняю отметку…",
    async () => {
      await apiPost("/api/rsvp", { game_id: selectedGameId, status });
    },
    {
      successText: "✅ Отметка сохранена",
      errorText: "❌ Не удалось сохранить отметку",
      sync: { gameId: selectedGameId, refreshGames: true, refreshGame: true },
    }
  );
}


  function posHuman(p) {
  const x = String(p || "F").toUpperCase();
  if (x === "G") return "Вратарь";
  if (x === "D") return "Защитник";
  return "Нападающий";
}

function getMyTgId(me) {
  return me?.player?.tg_id ?? me?.tg_id ?? me?.id ?? null;
}

// ⚙️ смена позиции на конкретную игру (админом)
async function setGamePosOverride(player, nextPos /* 'F'|'D'|'G' */) {
  if (!game?.id) return;

  const profile = String(player?.profile_position || player?.position || "F").toUpperCase();
  const desired = String(nextPos || "").toUpperCase();
  const pos_override = desired === profile ? null : desired;

  if (pos_override && pos_override !== profile) {
    const ok = window.confirm(
      `Вы уверены, что хотите изменить позицию игрока "${player?.display_name || player?.first_name || player?.username || player?.tg_id}" ` +
      `на эту игру на "${posHuman(pos_override)}"?\n\n` +
      `Позиция в профиле останется "${posHuman(profile)}".`
    );
    if (!ok) return;
  }

  await runOp(
    "Сохраняю позицию…",
    async () => {
      await apiPost("/api/admin/rsvp", {
        game_id: game.id,
        tg_id: player.tg_id,
        status: "yes",
        pos_override,
      });
    },
    {
      successText: "✅ Позиция сохранена",
      errorText: "❌ Не удалось сохранить позицию",
      sync: { gameId: game.id, refreshGames: true, refreshGame: true },
    }
  );
}


  
  async function sendTeamsToChat() {
  if (!selectedGameId) return;

  setTeamsSendMsg("");

  const ok1 = confirm("Отправить составы в командный чат?");
  if (!ok1) return;

  // если составы устарели — подтверждаем отдельно и шлём с force
  let force = false;

  if (teamsStaleInfo?.stale) {
    const ok2 = confirm(
      `⚠️ Составы устарели.\n` +
      `Ушли из "✅ Буду": ${teamsStaleInfo.removed || 0}\n` +
      `Добавились в "✅ Буду": ${teamsStaleInfo.added || 0}\n\n` +
      `Отправить всё равно?`
    );
    if (!ok2) return;
    force = true;
  } else {
    const ok2 = confirm("Это окончательные составы?");
    if (!ok2) return;
  }

  setTeamsSendBusy(true);
  try {
    const r = await apiPost("/api/admin/teams/send", { game_id: selectedGameId, force });

    if (!r?.ok) {
      // если бэк вернул 409 teams_stale, а фронт не знал — можно переспросить и повторить
      if (r?.reason === "teams_stale") {
        const ok3 = confirm(
          `⚠️ Составы устарели (сервер подтвердил).\n` +
          `Ушли: ${r.removed || 0}\nДобавились: ${r.added || 0}\n\nОтправить всё равно?`
        );
        if (!ok3) return;

        const r2 = await apiPost("/api/admin/teams/send", { game_id: selectedGameId, force: true });
        if (!r2?.ok) {
          setTeamsSendMsg(`❌ Не удалось отправить: ${r2?.reason || r2?.error || "unknown"}`);
          return;
        }
        setTeamsSendMsg("✅ Составы отправлены в чат");
        return;
      }

      setTeamsSendMsg(`❌ Не удалось отправить: ${r?.reason || r?.error || "unknown"}`);
      return;
    }

    setTeamsSendMsg("✅ Составы отправлены в чат");
  } finally {
    setTeamsSendBusy(false);
  }
}

async function saveReminderSettings() {
  if (!game?.id) return;

  setRemSaving(true);
  try {
    const reminder_at = remAt ? new Date(remAt).toISOString() : null;

    const r = await apiPatch(`/api/admin/games/${game.id}/reminder`, {
      reminder_enabled: remEnabled,
      reminder_at,
      reminder_pin: remPin,
      reset_sent: true, // важно: чтобы при изменении расписания отправилось заново
    });

    if (r?.ok) {
      await refreshAll(game.id);
    }
  } finally {
    setRemSaving(false);
  }
}


async function saveProfile() {
  await runOp(
    "Сохраняю профиль…",
    async () => {
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
    },
    {
      successText: "✅ Профиль сохранён",
      errorText: "❌ Не удалось сохранить профиль",
      sync: { refreshPlayers: true, refreshGames: true, refreshGame: true },
    }
  );
}


    async function generateTeams() {
      if (!selectedGameId) return;
    
      await runOp(
        "Формирую составы…",
        async () => {
          const res = await apiPost("/api/teams/generate", { game_id: selectedGameId });
          if (res?.ok) setTeams(normalizeTeams(res));
          setTab("teams");
        },
        {
          successText: "✅ Составы сформированы",
          errorText: "❌ Не удалось сформировать составы",
          sync: { gameId: selectedGameId, refreshGames: false, refreshGame: true }, // карточки игр можно не трогать
        }
      );
    }


    async function movePicked() {
      if (!picked || !selectedGameId) return;
    
      await runOp(
        "Переношу игрока…",
        async () => {
          setTeamsBusy(true);
          try {
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
        },
        { successText: "✅ Перенесено", errorText: "❌ Не удалось перенести", sync: false }
      );
    }
    
    async function swapPicked(withTeam, withId) {
      if (!picked || !selectedGameId) return;
    
      const a_id = picked.team === "A" ? picked.tg_id : withId;
      const b_id = picked.team === "B" ? picked.tg_id : withId;
    
      await runOp(
        "Меняю местами…",
        async () => {
          setTeamsBusy(true);
          try {
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
        },
        { successText: "✅ Обмен выполнен", errorText: "❌ Не удалось обменять", sync: false }
      );
    }


  function onPick(teamKey, tg_id) {
    if (!editTeams) return;

    if (!picked) return setPicked({ team: teamKey, tg_id });

    if (picked.team === teamKey) return setPicked({ team: teamKey, tg_id });

    swapPicked(teamKey, tg_id);
  }

  function medalMapForTop(list, key) {
  // медали по "местам" (по уникальным значениям), максимум 3 места
  const uniq = [];
  for (const r of list) {
    const v = Number(r?.[key] ?? 0);
    if (v <= 0) continue;
    if (!uniq.includes(v)) uniq.push(v);
    if (uniq.length >= 3) break;
  }
  return {
    [uniq[0]]: "🥇",
    [uniq[1]]: "🥈",
    [uniq[2]]: "🥉",
  };
}

function sortByMetricDesc(list, key) {
  return [...(list || [])].sort((a, b) => {
    const av = Number(a?.[key] ?? 0);
    const bv = Number(b?.[key] ?? 0);
    if (bv !== av) return bv - av;
    return String(a?.name || "").localeCompare(String(b?.name || ""), "ru");
  });
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
  const nextUpcomingId = useMemo(() => {
  // upcomingGames уже отсортирован ASC и отфильтрован от прошедших
  const next = (upcomingGames || []).find((g) => g.status === "scheduled");
  return next?.id ?? null;
}, [upcomingGames]);
const teamsStaleInfo = useMemo(() => {
  if (!teams?.ok) return { stale: false, current: 0, inTeams: 0, removed: 0, added: 0 };

  // кто сейчас "Буду" (ровно те, кого логично держать в составах)
  const yesIds = new Set(
    (rsvps || [])
      .filter((r) => (r.status || "maybe") === "yes")
      .map((r) => String(r.tg_id))
  );

  // кто сейчас в составах
  const teamIds = new Set(
    [...(teams.teamA || []), ...(teams.teamB || [])].map((p) => String(p?.tg_id ?? p))
  );

  let removed = 0; // есть в составах, но уже НЕ "yes"
  for (const id of teamIds) if (!yesIds.has(id)) removed++;

  let added = 0; // "yes" есть, но в составах НЕТ
  for (const id of yesIds) if (!teamIds.has(id)) added++;

  const stale = removed > 0 || added > 0;

  return {
    stale,
    current: yesIds.size,
    inTeams: teamIds.size,
    removed,
    added,
  };
}, [teams, rsvps]);

  const posHumanLocal = (p) => (p === "G" ? "Вратарь" : p === "D" ? "Защитник" : "Нападающий");

const teamsPosStaleInfo = React.useMemo(() => {
  if (!teams?.ok) return null;

  // актуальные "yes" из текущих rsvps (ВАЖНО: это rsvps из /api/game, а не из teams)
  const yesNow = (rsvps || []).filter((x) => x.status === "yes");
  const nowPos = new Map(
    yesNow.map((x) => [
      String(x.tg_id),
      String(x.position || x.profile_position || "F").toUpperCase(),
    ])
  );

  const inTeams = [...(teams.teamA || []), ...(teams.teamB || [])];

  const changed = [];
  for (const p of inTeams) {
    const id = String(p.tg_id);
    if (!nowPos.has(id)) continue; // если игрок уже не "yes" — это твой teamsStaleInfo про removed/added

    const teamP = String(p.position || p.profile_position || "F").toUpperCase();
    const curP = nowPos.get(id);

    if (teamP !== curP) {
      const name =
        (p.display_name || "").trim() ||
        (p.first_name || "").trim() ||
        (p.username ? "@" + p.username : "") ||
        id;

      changed.push({ id, name, from: teamP, to: curP });
    }
  }

  return { stale: changed.length > 0, changed };
}, [teams?.ok, teams?.teamA, teams?.teamB, rsvps]);

  // ВНИМАНИЕ: прошедшие теперь показываем не из games, а из pastPage (загружаем постранично)
  const listToShow = showPast ? pastPage : upcomingGames;

  function cardToneByMyStatus(s) {
    if (s === "yes") return "tone-yes";
    if (s === "maybe") return "tone-maybe";
    if (s === "no") return "tone-no";
    return "tone-none";
  }

  const POS_LABEL = {
    G: "🥅 Вратари",
    D: "🛡️ Защитники",
    F: "🏒 Нападающие",
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
        <div className="teamGroupTitle">
          <span>{title}</span>
        </div>

        <div className="pills">
          {players.map((p) => {
            const selected = picked && picked.team === teamKey && String(picked.tg_id) === String(p.tg_id);
            const n = showNum(p);
            const mine = isMeId(p.tg_id);

            return (
              <div
                key={p.tg_id}
                className={"pill " + (selected ? "pillSelected " : "") + (mine ? " isMeGold" : "")}
                onClick={() => onPick(teamKey, p.tg_id)}
                style={{ cursor: editTeams ? "pointer" : "default" }}
              >
                <span className="pillName">
                  {showName(p)}
                  {n && ` № ${n}`}
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
    const total = (list || []).length;

    return (
      <>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>
            {title} <span className="badge">👥 {total}</span>
          </h3>

          <div className="row" style={{ gap: 6 }}>
            <span className="badge">🥅 {g.G.length}</span>
            <span className="badge">🛡️ {g.D.length}</span>
            <span className="badge">🏒 {g.F.length}</span>
            {g.U.length ? <span className="badge">❓ {g.U.length}</span> : null}
          </div>
        </div>

        {renderPosGroup(teamKey, POS_LABEL.G, g.G)}
        {renderPosGroup(teamKey, POS_LABEL.D, g.D)}
        {renderPosGroup(teamKey, POS_LABEL.F, g.F)}
        {renderPosGroup(teamKey, POS_LABEL.U, g.U)}
      </>
    );
  }

async function handleThanksJoke() {
  if (funBusy) return;

  // если уже есть клики — спрашиваем "ещё раз?"
  if ((fun?.thanks_total || 0) > 0) {
    const ask = await tgPopup({
      title: "😄",
      message: "Вы ещё хотите поблагодарить?",
      buttons: [
        { id: "yes", type: "default", text: "Да" },
        { id: "no", type: "cancel", text: "Не-не" },
      ],
    });
    if (ask.id !== "yes") return;
  }

  setFunBusy(true);
  try {
    const r = await apiPost("/api/fun/thanks", {});
    if (r?.ok) {
      setFun((s) => ({ ...(s || {}), thanks_total: r.thanks_total, donate_total: s?.donate_total || 0, premium: s?.premium || false }));
      await tgPopup({
        title: "Готово",
        message: "Ваша благодарность отправлена ✅",
        buttons: [{ id: "ok", type: "ok", text: "Ок" }],
      });
    }
  } finally {
    setFunBusy(false);
  }
}

async function pickDonateValue() {
  // Шаг 1: 2 варианта + "Ещё" (всего 3 кнопки)
  let pick = await tgPopup({
    title: "Задонатить (по приколу)",
    message: "Выбери вариант:",
    buttons: [
      { id: "highfive", type: "default", text: "🤝 Дать пятюню" },
      { id: "hug", type: "default", text: "🫂 Обнять по-братски" },
      { id: "more", type: "default", text: "➕ Ещё" },
    ],
  });

  if (pick.id === "more") {
    // Шаг 2: оставшийся вариант + отмена
    pick = await tgPopup({
      title: "Задонатить (по приколу)",
      message: "Ещё вариант:",
      buttons: [
        { id: "sz", type: "default", text: "🍀 «Щастя здоровя»" },
        { id: "cancel", type: "cancel", text: "Отмена" },
      ],
    });
  }

  if (!["highfive", "hug", "sz"].includes(pick.id)) return null;
  return pick.id;
}

async function handleDonateJoke() {
  if (funBusy) return;

  if ((fun?.donate_total || 0) > 0) {
    const ask = await tgPopup({
      title: "😄",
      message: "Вы ещё хотите задонатить?",
      buttons: [
        { id: "yes", type: "default", text: "Да" },
        { id: "no", type: "cancel", text: "Не-не" },
      ],
    });
    if (ask.id !== "yes") return;
  }

  setDonateOpen(true);
}

  async function submitDonate(value /* 'highfive'|'hug'|'sz' */) {
  if (funBusy) return;

  setDonateOpen(false);
  setFunBusy(true);
  try {
    const r = await apiPost("/api/fun/donate", { value });

    if (r?.ok) {
      setFun((s) => ({
        ...(s || {}),
        donate_total: r.donate_total,
        thanks_total: s?.thanks_total || 0,
        premium: !!r.premium,
      }));

      await tgPopup({
        title: "Готово",
        message: "Донат отправлен ✅",
        buttons: [{ id: "ok", type: "ok", text: "Ок" }],
      });

      if (r.unlocked) {
        await tgPopup({
          title: "🌟 Премиум активирован",
          message: `Поздравляем! Вы накопили ${r.donate_total}/${r.threshold} донатов и получили Премиум-статус 😎`,
          buttons: [{ id: "ok", type: "ok", text: "Оооо да" }],
        });
      }
    } else {
      flashOp("❌ Не удалось задонатить", "error", false, 2000);
    }
  } catch (e) {
    console.error("submitDonate failed:", e);
    flashOp("❌ Ошибка доната", "error", false, 2000);
  } finally {
    setFunBusy(false);
  }
}

function openYandexRoute(lat, lon) {
  const tg = window.Telegram?.WebApp;

  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return;

  // Вариант 1: сразу открыть режим маршрута (часто старт = "мое местоположение")
  const urlRoute = `https://yandex.ru/maps/?rtext=~${la},${lo}&rtt=auto`;

  // Вариант 2 (fallback): просто точка на карте
  const urlPin = `https://yandex.ru/maps/?pt=${lo},${la}&z=16&l=map`;

  try {
    tg?.openLink ? tg.openLink(urlRoute) : window.open(urlRoute, "_blank");
  } catch (e) {
    tg?.openLink ? tg.openLink(urlPin) : window.open(urlPin, "_blank");
  }
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
        <div className="toastWrap" aria-live="polite" aria-atomic="true">
          <div className={`toast tone-${op.tone} ${op.text ? "isShow" : ""}`}>
            <div className="toastRow">
              <div className="toastIcon">
                {op.busy ? "⏳" : op.tone === "success" ? "✅" : op.tone === "error" ? "❌" : "ℹ️"}
              </div>
        
              <div className="toastText">{op.text || ""}</div>
        
              <button className="toastClose" onClick={closeOp} aria-label="Закрыть">
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
  const curPos = String(posPopup?.position || posPopup?.profile_position || "F").toUpperCase();
  return (
    <div className="container appShell">
      <h1>🏒 Хоккей: отметки и составы</h1>
          <div className="toastWrap" aria-live="polite" aria-atomic="true">
            <div className={`toast tone-${op.tone} ${op.text ? "isShow" : ""}`}>
              <div className="toastRow">
                <div className="toastIcon">
                  {op.busy ? "⏳" : op.tone === "success" ? "✅" : op.tone === "error" ? "❌" : "ℹ️"}
                </div>
      
                <div className="toastText">{op.text || ""}</div>
      
                <button className="toastClose" onClick={closeOp} aria-label="Закрыть">
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
      {/* ====== GAMES ====== */}
      {tab === "game" && (
        <div className="card">
          {gameView === "list" ? (
            <>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>Игры</h2>

                {isAdmin ? (
                  <button
                    className="iconBtn"
                    type="button"
                    title="Создать игру"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openCreateGameSheet();
                    }}
                  >
                    ➕
                  </button>
                ) : null}
              </div>

              <div
                className="row"
                style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}
              >
                <button
                  className="btn secondary"
                  onClick={async () => {
                    const next = !showPast;
                    setShowPast(next);

                    if (next) {
                      setPastOffset(0);
                      await loadPast(true);
                    }
                  }}
                >
                  {showPast ? "⬅️ К предстоящим" : `📜 Прошедшие${pastTotal ? ` (${pastTotal})` : ""}`}
                </button>

                <span className="small" style={{ opacity: 0.8 }}>
                  {showPast
                    ? `Показано: ${pastPage.length}${pastTotal ? ` из ${pastTotal}` : ""}`
                    : `Показаны предстоящие: ${upcomingGames.length}`}
                </span>
              </div>

              {showPast && (
                <div className="card" style={{ marginTop: 10 }}>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input
                      className="input"
                      type="date"
                      value={pastFrom}
                      onChange={(e) => setPastFrom(e.target.value)}
                    />
                    <input
                      className="input"
                      type="date"
                      value={pastTo}
                      onChange={(e) => setPastTo(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Поиск по арене…"
                      value={pastQ}
                      onChange={(e) => setPastQ(e.target.value)}
                      style={{ flex: 1, minWidth: 180 }}
                    />

                    <button
                      className="btn secondary"
                      disabled={pastLoading}
                      onClick={async () => {
                        setPastOffset(0);
                        await loadPast(true);
                      }}
                    >
                      {pastLoading ? "..." : "Применить"}
                    </button>

                    <button
                      className="btn secondary"
                      disabled={pastLoading}
                      onClick={async () => {
                        setPastFrom("");
                        setPastTo("");
                        setPastQ("");
                        setPastOffset(0);
                        await loadPast(true);
                      }}
                    >
                      Сбросить
                    </button>
                  </div>

                  {pastPage.length < pastTotal && (
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        className="btn secondary"
                        disabled={pastLoading}
                        onClick={() => loadPast(false)}
                      >
                        {pastLoading ? "..." : "Показать ещё 10"}
                      </button>
                    </div>
                  )}
                </div>
              )}

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
                <div className="small" style={{ marginTop: 2 }}>
                  {showPast ? "Прошедших игр пока нет." : "Предстоящих игр пока нет."}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {!showPast && (
                    <div className="row" style={{ marginTop: 10, gap: 8 }}>
                      <button
                        className="btn secondary"
                        disabled={opBusy}
                        onClick={async () => {
                          if (!confirm("Поставить ✅ Буду на все будущие игры?")) return;
                      
                          await runOp(
                            "Ставлю ✅ на все будущие…",
                            async () => {
                              await apiPost("/api/rsvp/bulk", { status: "yes" });
                            },
                            {
                              successText: "✅ Применено",
                              errorText: "❌ Не удалось применить",
                              sync: { refreshGames: true, refreshGame: true },
                            }
                          );
                        }}
                      >
                        ✅ Буду на все будущие
                      </button>
                      
                      <button
                        className="btn secondary"
                        disabled={opBusy}
                        onClick={async () => {
                          if (!confirm("Поставить ❌ Не буду на все будущие игры?")) return;
                      
                          await runOp(
                            "Ставлю ❌ на все будущие…",
                            async () => {
                              await apiPost("/api/rsvp/bulk", { status: "no" });
                            },
                            {
                              successText: "✅ Применено",
                              errorText: "❌ Не удалось применить",
                              sync: { refreshGames: true, refreshGame: true },
                            }
                          );
                        }}
                      >
                        ❌ Не буду на все будущие
                      </button>

                    </div>
                  )}

                    {listToShow.map((g, idx) => {
                      const past = isPastGame(g);
                      const lockRsvp = past && !isAdmin;
                      const when = formatWhen(g.starts_at);
                      const status = g.my_status || "maybe";
                      const tone = cardToneByMyStatus(status);
                      const isNext = !showPast && nextUpcomingId != null && g.id === nextUpcomingId;

                    
                      const bgUrl = GAME_BGS[idx % GAME_BGS.length];
                    
                      const { month, day } = monthDayRu(g.starts_at);
                      const yes = g.yes_count ?? 0;
                    
                      // чем делим (цель для заполнения круга)
                      const target =
                        g.rsvp_target ?? g.target_players ?? g.min_players ?? RSVP_TARGET_DEFAULT;
                    
                      const progress = Math.min(1, yes / Math.max(1, target));
                    
                      return (
                        <div
                          key={g.id}
                          className={`card gameCard ${tone} status-${status} ${isNext ? "isNext" : ""} ${past ? "isPast" : ""}`}
                          style={{
                            cursor: "pointer",
                            opacity: past ? 0.85 : 1,
                            backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,.65)), url(${bgUrl})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            backgroundRepeat: "no-repeat",
                          }}
                            onClick={() => {
                              const id = g.id;

                              setSelectedGameId(id);
                              setGameView("detail");

                              // Сброс "хвостов" прежней деталки (чтобы не мигало старым)
                              setGame(null);
                              setRsvps([]);
                              setTeams(null);

                              setDetailLoading(true);

                              Promise.all([
                                refreshGameOnly(id),          // детальная инфа
                                // refreshUpcomingGamesOnly(), // опционально, если хочешь сразу обновить talisman/best-player в списке
                              ])
                                .catch(console.error)
                                .finally(() => setDetailLoading(false));
                            }}

                        >
                          {/* TOP BAR */}
                          <div className="gameCard__topbar">
                            <div className="gameCard__title">{uiStatus(g)}</div>
                            
                            {/* BEST PLAYER */}
                           {/*  {past && g.best_player_name ? (
                              <div className="gameCard__awardLine">
                                <img className="talismanIcon" src={talismanIcon} alt="" />
                                <b>Best player:</b>&nbsp;{g.best_player_name}
                              </div>
                            ) : null}
                            {!past && isNext && talismanHolder?.name ? (
                              <div className="gameCard__awardLine">
                                <img className="talismanIcon" src={talismanIcon} alt="" />
                                <b>Талисман у:</b>&nbsp;{talismanHolder.name}
                              </div>
                            ) : null}*/}
                            
                            <div className="gameCard__topRight">
                              {g.video_url ? <span className="gameCard__pill" title="Есть видео">▶️</span> : null}
                            </div>
                          </div>
                    
                          {/* MAIN */}
                          <div className="gameCard__main">
                            {/* DATE BADGE */}
                            <div className="gameCard__date">
                              <div className="gameCard__month">{month}</div>
                              <div className="gameCard__day">{day}</div>
                            </div>
                    
                            {/* INFO */}
                            <div className="gameCard__info">
                              <div className="gameCard__when">{when}</div>
                              <div className="gameCard__loc">📍 {g.location || "—"}</div>
                            </div>

                    
                            {/* RING */}
                            <div className="gameCard__ringWrap" title={`${yes} будут (цель ${target})`}>
                              <div className="progressRing" style={{ "--p": progress }}>
                                <div className="ringCenter">{yes}</div>
                              </div>
                            </div>
                          </div>
                    
                          {/* ACTIONS */}
                          <div className="gameCard__actions" onClick={(e) => e.stopPropagation()}>
                            <button
                              disabled={opBusy || lockRsvp}
                              className={`rsvpBtn in ${status === "yes" ? "active" : ""}`}
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (lockRsvp) return;
                            
                                await runOp(
                                  "Сохраняю IN…",
                                  async () => {
                                    await apiPost("/api/rsvp", { game_id: g.id, status: "yes" });
                                  },
                                  {
                                    successText: "✅ IN сохранён",
                                    errorText: "❌ Не удалось сохранить IN",
                                    sync: { gameId: g.id, refreshGames: true, refreshGame: false }, // деталка не нужна на list
                                  }
                                );
                              }}
                            >
                              👍 IN
                            </button>
                            
                            <button
                              disabled={opBusy || lockRsvp}
                              className={`rsvpBtn out ${status === "no" ? "active" : ""}`}
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (lockRsvp) return;
                            
                                await runOp(
                                  "Сохраняю OUT…",
                                  async () => {
                                    await apiPost("/api/rsvp", { game_id: g.id, status: "no" });
                                  },
                                  {
                                    successText: "✅ OUT сохранён",
                                    errorText: "❌ Не удалось сохранить OUT",
                                    sync: { gameId: g.id, refreshGames: true, refreshGame: false },
                                  }
                                );
                              }}
                            >
                              👎 OUT
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
                    setTeamsBack({ tab: "game", gameView });
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
                  const bestCandidates = (rsvps || []).filter((p) => p.status === "yes");

                  return (
                    <>
                      <div className="row">
                        <span className="badge">⏱ {formatWhen(game.starts_at)}</span>
                        <span className="badge">📍 {game.location || "—"}</span>
                        <span className="badge">{uiStatus(game)}</span>
                                {isAdmin ? (
                                    <button
                                      className="iconBtn"
                                      type="button"
                                      title="Редактировать игру"
                                      onClick={() => openGameSheet(game)}
                                    >
                                      ⚙️
                                    </button>
                                  ) : null}

                    {game.geo_lat != null && game.geo_lon != null ? (
                      <button
                        className="btn secondary yandexRouteBtn"
                        onClick={() => openYandexRoute(game.geo_lat, game.geo_lon)}
                        title="Построить маршрут в Яндекс"
                      >
                        <img className="yandexNavIcon" src={yandexNavIcon} alt="" aria-hidden="true" />
                        Маршрут до места
                      </button>
                    ) : null}

                        
                        
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
                     {/*   {isAdmin && game && isPastGame(game) && (
                        <div className="card" style={{ marginTop: 12 }}>
                          <h3 style={{ margin: 0 }}>🏆 Best player</h3>
                      
                          <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                            Выбери лучшего игрока матча — он станет обладателем талисмана до следующей игры.
                          </div>
                      
                          <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
                            <select
                              className="input"
                              value={bestPick}
                              onChange={(e) => setBestPick(e.target.value)}
                              style={{ flex: 1 }}
                            >
                              <option value="">— не выбран —</option>
                              {bestCandidates.map((p) => (
                                <option key={p.tg_id} value={String(p.tg_id)}>
                                  {p.display_name || p.first_name || (p.username ? `@${p.username}` : p.tg_id)}
                                </option>
                              ))}
                            </select>
                      
                            <button
                              className="btn"
                              onClick={async () => {
                                const v = bestPick ? Number(bestPick) : null;
                                await apiPost(`/api/admin/games/${game.id}/best-player`, { best_player_tg_id: v });
                                await refreshAll(game.id); // чтобы game.best_player_* обновились
                              }}
                            >
                              Сохранить
                            </button>
                          </div>
                      
                          {game.best_player_name ? (
                            <div className="small" style={{ marginTop: 10 }}>
                              Сейчас: <b>{game.best_player_name}</b>
                            </div>
                          ) : null}
                        </div>
                      )}*/}

                      <hr />
                      {/* {isAdmin && game ? (
  <div className="card" style={{ marginTop: 12 }}>
    <h3 style={{ margin: 0 }}>⏰ Напоминание по этой игре</h3>

    <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <label className="row" style={{ gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={remEnabled}
          onChange={(e) => setRemEnabled(e.target.checked)}
        />
        <span>Включено</span>
      </label>

      <input
        className="input"
        type="datetime-local"
        value={remAt}
        onChange={(e) => setRemAt(e.target.value)}
        style={{ minWidth: 220 }}
        disabled={!remEnabled}
      />

      <label className="row" style={{ gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={remPin}
          onChange={(e) => setRemPin(e.target.checked)}
          disabled={!remEnabled}
        />
        <span>Закрепить</span>
      </label>

      <button className="btn" onClick={saveReminderSettings} disabled={remSaving}>
        {remSaving ? "…" : "Сохранить"}
      </button>
    </div>

    {game.reminder_sent_at ? (
      <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
        Уже отправлено: <b>{formatWhen(game.reminder_sent_at)}</b>
      </div>
    ) : null}
  </div>
) : null} */}

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
                      <StatusBlock
                        title="Буду"
                        tone="yes"
                        list={grouped.yes}
                        isAdmin={isAdmin}
                        me={me}
                        canPickPos={true}
                        setPosPopup={setPosPopup}
                      />

                        <StatusBlock title="❌ Не будут" tone="no" list={grouped.no} isAdmin={isAdmin} me={me} />
                        <StatusBlock title="❓ Не отметились" tone="maybe" list={grouped.maybe} isAdmin={isAdmin} me={me} />
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

          <button
            className={profileView === "thanks" ? "btn" : "btn secondary"}
            onClick={() => setProfileView("thanks")}
          >
            🙏 Поблагодарить
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
          {profileView === "thanks" && (
            <div className="card">
              <h2>Поблагодарить</h2>
              <div className="small" style={{ opacity: 0.8 }}>
                По правилам — 1 раз. Но если очень хочется — спросим ещё раз 😄
              </div>
          
              <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                <button className="btn secondary" onClick={handleThanksJoke} disabled={funBusy}>
                  🙏 Сказать спасибо
                </button>
                <button className="btn secondary" onClick={handleDonateJoke} disabled={funBusy}>
                  💸 Задонатить
                </button>
                {donateOpen && (
                  <div className="modalOverlay" onClick={() => !funBusy && setDonateOpen(false)}>
                    <div className="modalCard" onClick={(e) => e.stopPropagation()}>
                      <h3 style={{ margin: 0 }}>Задонатить (по приколу)</h3>
                      <div className="small" style={{ opacity: 0.85, marginTop: 6 }}>
                        Выбери вариант:
                      </div>
                
                      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                        <button className="btn secondary" disabled={funBusy} onClick={() => submitDonate("highfive")}>
                          🤝 Дать пятюню
                        </button>
                        <button className="btn secondary" disabled={funBusy} onClick={() => submitDonate("hug")}>
                          🤗 Обнять по-братски
                        </button>
                        <button className="btn secondary" disabled={funBusy} onClick={() => submitDonate("sz")}>
                          🍀 «Щастя здоровя»
                        </button>
                      </div>
                
                      <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
                        <button className="btn secondary" disabled={funBusy} onClick={() => setDonateOpen(false)}>
                          Закрыть
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
          
              <div className="small" style={{ marginTop: 10, opacity: 0.85 }}>
                Спасибо: <b>{fun?.thanks_total ?? 0}</b> • Донатов: <b>{fun?.donate_total ?? 0}</b>
                {fun?.premium ? <> • <b>🌟 Премиум</b></> : null}
              </div>
            </div>
          )}

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
    <button
      className="btn secondary"
      disabled={opBusy}
      onClick={() =>
        runOp("Обновляю данные…", async () => {}, {
          successText: "✅ Обновлено",
          errorText: "❌ Не удалось обновить",
          sync: { gameId: selectedGameId, refreshGames: true, refreshGame: true },
        })
      }
    >
      {opBusy ? "…" : "Обновить"}
    </button>


      {isAdmin && (
        <>
          <button
            className="btn"
            onClick={generateTeams}
            disabled={!selectedGameId || game?.status === "cancelled"}
          >
            Сформировать сейчас (админ)
          </button>

          <button
            className="btn secondary"
            onClick={sendTeamsToChat}
            disabled={
              !selectedGameId ||
              !teams?.ok ||
              teamsBusy ||
              teamsSendBusy ||
              game?.status === "cancelled"
            }
            title={!teams?.ok ? "Сначала сформируй составы" : "Отправить составы в чат"}
          >
            {teamsSendBusy ? "…" : "📣 Отправить составы в чат"}
          </button>
        </>
      )}
    </div>

    {teamsSendMsg ? (
      <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
        {teamsSendMsg}
      </div>
    ) : null}

{teams?.ok && teamsStaleInfo?.stale && (
  <div className="card" style={{ border: "1px solid rgba(255,200,0,.35)", marginTop: 10 }}>
    <div style={{ fontWeight: 900 }}>⚠️ Составы устарели</div>

    <div className="small" style={{ opacity: 0.9, marginTop: 6 }}>
      После последнего формирования составов изменились отметки игроков. Сейчас “✅ Буду”:{" "}
      <b>{teamsStaleInfo.current}</b>, в составах: <b>{teamsStaleInfo.inTeams}</b>.
      {teamsStaleInfo.removed ? ` Ушли: ${teamsStaleInfo.removed}.` : ""}
      {teamsStaleInfo.added ? ` Добавились: ${teamsStaleInfo.added}.` : ""}
    </div>

    {isAdmin ? (
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={generateTeams} disabled={!selectedGameId || teamsBusy}>
          🔄 Сформировать заново
        </button>
      </div>
    ) : (
      <div className="small" style={{ opacity: 0.8, marginTop: 8 }}>
        Попроси админа нажать “Сформировать сейчас”.
      </div>
    )}
  </div>
)}

{teams?.ok && teamsPosStaleInfo?.stale && (
  <div className="card" style={{ border: "1px solid rgba(255,200,0,.35)", marginTop: 10 }}>
    <div style={{ fontWeight: 900 }}>⚠️ Позиции на игру менялись вручную</div>

    <div className="small" style={{ opacity: 0.9, marginTop: 6 }}>
      После последнего формирования составов у <b>{teamsPosStaleInfo.changed.length}</b>{" "}
      игроков изменилась позиция на эту игру. Чтобы в “Составах” были актуальные позиции —
      сформируй составы заново.
    </div>

    <div className="small" style={{ opacity: 0.9, marginTop: 6, whiteSpace: "pre-line" }}>
      {teamsPosStaleInfo.changed
        .slice(0, 6)
        .map((x) => `• ${x.name}: было ${posHumanLocal(x.from)}, стало ${posHumanLocal(x.to)}`)
        .join("\n")}
      {teamsPosStaleInfo.changed.length > 6
        ? `\n…и ещё ${teamsPosStaleInfo.changed.length - 6}`
        : ""}
    </div>

    {isAdmin ? (
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={generateTeams} disabled={!selectedGameId || teamsBusy}>
          🔄 Сформировать заново
        </button>
      </div>
    ) : (
      <div className="small" style={{ opacity: 0.8, marginTop: 8 }}>
        Попроси админа нажать “Сформировать сейчас”.
      </div>
    )}
  </div>
)}

    {teams?.ok ? (
      <>
        <hr />

        {/* если эти метрики тебе больше не нужны — просто удали этот блок */}
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
    <h2>
      {statsMode === "yes" ? "✅ Топ посещаемости (Буду)" :
       statsMode === "no" ? "❌ Топ отказов (Не буду)" :
       "📊 Общая статистика"}
    </h2>

    {/* переключатель режима */}
    <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
      <button className={statsMode === "yes" ? "btn" : "btn secondary"} onClick={() => setStatsMode("yes")}>
        ✅ Топ “Буду”
      </button>
      <button className={statsMode === "no" ? "btn" : "btn secondary"} onClick={() => setStatsMode("no")}>
        ❌ Топ “Не буду”
      </button>
      <button className={statsMode === "all" ? "btn" : "btn secondary"} onClick={() => setStatsMode("all")}>
        📊 Общая
      </button>
    </div>

    {/* фильтры периода */}
    <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select
        value={statsDays}
        onChange={(e) => {
          const v = Number(e.target.value);
          setStatsDays(v);
          setStatsFrom("");
          setStatsTo("");
          loadAttendance({ days: v, from: "", to: "" });
        }}
      >
        <option value={0}>Всё время</option>
        <option value={30}>30 дней</option>
        <option value={90}>90 дней</option>
        <option value={365}>365 дней</option>
      </select>

      <span className="small" style={{ opacity: 0.8 }}>или диапазон:</span>

      <input className="input" type="date" value={statsFrom} onChange={(e) => setStatsFrom(e.target.value)} />
      <input className="input" type="date" value={statsTo} onChange={(e) => setStatsTo(e.target.value)} />

      <button
        className="btn secondary"
        onClick={() => loadAttendance({ days: 0, from: statsFrom, to: statsTo })}
        disabled={statsLoading}
      >
        Применить
      </button>

      <button className="btn secondary" onClick={() => loadAttendance()} disabled={statsLoading}>
        {statsLoading ? "Считаю..." : "Обновить"}
      </button>
    </div>

    <hr />

    {attendance.length === 0 ? (
      <div className="small">Пока нет данных.</div>
    ) : (() => {
      // режимы
      if (statsMode === "all") {
        return (
          <div style={{ display: "grid", gap: 8 }}>
            {attendance.map((r, idx) => (
              <div key={r.tg_id} className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <b>
                    {idx + 1}. {r.name}
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
            ))}
          </div>
        );
      }

      const key = statsMode === "yes" ? "yes" : "no";
      const sorted = sortByMetricDesc(attendance, key).filter((x) => Number(x?.[key] ?? 0) > 0);
      const medals = medalMapForTop(sorted, key);

      if (!sorted.length) return <div className="small">Нет данных для выбранного режима.</div>;

      return (
        <div style={{ display: "grid", gap: 8 }}>
          {sorted.map((r, idx) => {
            const v = Number(r?.[key] ?? 0);
            const medal = medals[v] || "";
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
                  <span className="badge">
                    {statsMode === "yes" ? "✅" : "❌"} {v}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      );
    })()}
  </div>
)}


      {/* ====== ADMIN ====== */}
      {tab === "admin" && isAdmin && (
        <AdminPanel
          apiGet={apiGet}
          apiPost={apiPost}
          apiPatch={apiPatch}
          apiDelete={apiDelete}
          onChanged={async (payload) => {
            const p = typeof payload === "string" ? { label: payload } : (payload || {});
            const label = p.label || "Обновляю данные после админки…";
            const gameId = p.gameId ?? selectedGameId;
        
            await runOp(label, async () => {}, {
              successText: "✅ Данные обновлены",
              errorText: "❌ Не удалось обновить данные",
              sync: {
                gameId,
                refreshGames: true,
                refreshGame: true,
                refreshPlayers: !!p.refreshPlayers,
                refreshPast: showPast,
              },
            });
          }}
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

                  {filteredPlayersDir.map((p) => {
                    const mine = isMeId(p.tg_id);

                    return (
                      <div
                        key={p.tg_id}
                        className={"card " + (mine ? "isMeGold" : "")}
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
                        <div className="row" style={{ alignItems: "center", gap: 12, marginTop: 2 }}>
                          <JerseyBadge number={showNum(p)} variant="modern" striped size={52} />
                          <Avatar p={p} big onClick={() => openPhotoModal(p)} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 900 }}>{showName(p)}</div>
                            <div className="small" style={{ opacity: 0.8 }}>
                              {posHuman(p.position)}
                            </div>
                          </div>
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
                    <Avatar p={selectedPlayer} big onClick={() => openPhotoModal(selectedPlayer)}/>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>
                        {showName(selectedPlayer)}{" "}
                        <JerseyBadge number={showNum(selectedPlayer)} variant="modern" striped size={34} />
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
       {/* ====== MODAL POSITION ====== */}
              {isAdmin && posPopup && (
                <div className="modalBackdrop" onClick={() => setPosPopup(null)}>
                  <div className="modalSheet" onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontWeight: 900, fontSize: 16 }}>Позиция на игру</div>

                    <div className="small" style={{ opacity: 0.85, marginTop: 6 }}>
                      {showName(posPopup)}
                    </div>

                    <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      <button
                        className={`btn outline ${curPos === "G" ? "active" : ""}`}
                        onClick={async () => {
                          await setGamePosOverride(posPopup, "G");
                          setPosPopup(null);
                        }}
                      >
                        🥅 Вратарь
                      </button>

                      <button
                        className={`btn outline ${curPos === "D" ? "active" : ""}`}
                        onClick={async () => {
                          await setGamePosOverride(posPopup, "D");
                          setPosPopup(null);
                        }}
                      >
                        🛡️ Защитник
                      </button>

                      <button
                        className={`btn outline ${curPos === "F" ? "active" : ""}`}
                        onClick={async () => {
                          await setGamePosOverride(posPopup, "F");
                          setPosPopup(null);
                        }}
                      >
                        🏒 Нападающий
                      </button>
                    </div>

                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="btn secondary" onClick={() => setPosPopup(null)}>
                        Отмена
                      </button>
                    </div>
                  </div>
                </div>
              )}

               {/* ====== MODAL PHOTO ====== */}
              {photoModal?.open && (
                <div className="modalOverlay" onClick={closePhotoModal}>
                  <div className="modalBody" onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ fontWeight: 900, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {photoModal.title}
                      </div>
                      <button className="btn secondary" onClick={closePhotoModal}>✕</button>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <img className="modalImg" src={photoModal.src} alt="" />
                    </div>
                  </div>
                </div>
              )}

              <GameSheet
                open={gameSheetOpen}
                game={gameSheetGame}
                onClose={closeGameSheet}
                apiGet={apiGet}
                apiPost={apiPost}
                apiPatch={apiPatch}
                apiDelete={apiDelete}
                onReload={async (gameId) => {
                  try {
                    // самый надежный вариант: один общий рефреш
                    await refreshAll?.(gameId ?? gameSheetGame?.id);

                    // если refreshAll нет — оставь только то, что у тебя реально есть:
                    // await loadGameDetail?.(gameId ?? gameSheetGame?.id);
                    // await loadGamesList?.();  // если есть функция загрузки списка
                  } catch (e) {
                    console.warn("onReload failed:", e);
                  }
                }}
                onChanged={onChanged}
              />

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
  const s = new Date(starts_at).toLocaleString("ru-RU", {
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const cleaned = String(s).replace(/\s+/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const RSVP_TARGET_DEFAULT = 24; // сколько "нужно" для заполнения круга (поменяй под себя)

function monthDayRu(iso) {
  const d = new Date(iso);
  const month = d
    .toLocaleString("ru-RU", { month: "short" })
    .replace(".", "")
    .toUpperCase(); // ДЕК / ЯНВ
  const day = String(d.getDate());
  return { month, day };
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

function StatusBlock({ title, tone, list = [], isAdmin, me, canPickPos = false, setPosPopup }) {
  const cls = `statusBlock ${tone}`;
  const [openId, setOpenId] = React.useState(null);

  React.useEffect(() => {
    const onDoc = () => setOpenId(null);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const effPos = (r) => String(r?.position || r?.profile_position || "F").toUpperCase();
  const profilePos = (r) => String(r?.profile_position || r?.position || "F").toUpperCase();
  const hasOverride = (r) => !!(r?.pos_override && String(r.pos_override).trim());

  const allowPicker = isAdmin && canPickPos && tone === "yes" && typeof setPosPopup === "function";


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
            .sort((a, b) => posOrder({ position: effPos(a) }) - posOrder({ position: effPos(b) }))
            .map((r) => {
              const pos = effPos(r);
              const n = showNum(r);
              const mine = me?.tg_id != null && String(r.tg_id) === String(me.tg_id);

              return (
                <div key={r.tg_id} style={{ position: "relative" }}>
                  <div
                    className={`pill pos-${pos} ${mine ? "isMeGold" : ""}`}
                    style={{ cursor: allowPicker ? "pointer" : "default" }}
                    onClick={(e) => {
                      if (!allowPicker) return;
                      e.stopPropagation();
                      setPosPopup(r);
                    }}
                  >
                    <span className="posTag">
                      {posLabel(pos)}
                      {hasOverride(r) ? " *" : ""}
                    </span>

                    <span className="pillName">
                      {showName(r)}
                      {n && ` № ${n}`}
                      {r.is_guest ? " · 👤 гость" : ""}
                    </span>

                    {isAdmin && r.skill != null && <span className="pillMeta">skill {r.skill}</span>}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}


function Avatar({ p, big = false, onClick }) {
  const size = big ? 84 : 52; // было 72/44 — чуть крупнее
  const url = (p?.photo_url || "").trim();
  const clickable = typeof onClick === "function";

  const handleClick = (e) => {
    if (!clickable) return;
    e.stopPropagation(); // важно: не даём сработать клику по карточке игрока
    onClick(e);
  };

  const handleKeyDown = (e) => {
    if (!clickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick(e);
    }
  };

  const wrapStyle = {
    width: size,
    height: size,
    borderRadius: 999,
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    cursor: clickable ? "zoom-in" : "default",
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    flex: "0 0 auto",
  };

  if (url) {
    return (
      <div
        style={wrapStyle}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        title={clickable ? "Открыть фото" : ""}
      >
        <img
          src={url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          draggable={false}
        />
      </div>
    );
  }

  const letter = (showName(p)[0] || "•").toUpperCase();
  return (
    <div
      style={{
        ...wrapStyle,
        fontWeight: 900,
      }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? "Открыть фото" : ""}
    >
      {letter}
    </div>
  );
}


function posHuman(posRaw) {
  const pos = String(posRaw || "F").toUpperCase();
  return pos === "G" ? "🥅 Вратарь" : pos === "D" ? "🛡️ Защитник" : "🏒 Нападающий";
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
      <div className="bottomNavInner">
        {items.map((it) => (
          <button
            key={it.key}
            className={"bottomNavItem " + (tab === it.key ? "isActive" : "")}
            onClick={() => setTab(it.key)}
            type="button"
          >
            <span className="bottomNavIcon" aria-hidden="true">
              {it.icon}
            </span>
            <span className="bottomNavLabel">{it.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}


