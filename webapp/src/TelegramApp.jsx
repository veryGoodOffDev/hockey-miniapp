import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, getAuthToken, clearAuthToken } from "./api.js";
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
import player from "./player.png";
import yandexNavIcon from "./YandexNavigatorLogo.svg";
import talismanIcon from "./talisman.webp";
const GAME_BGS = [bg1, bg2, bg3, bg4, bg5, bg6];
const BOT_DEEPLINK = "https://t.me/HockeyLineupBot";
const JERSEY_COLOR_OPTS = [
  { code: "white", label: "Белый" },
  { code: "blue", label: "Синий" },
  { code: "black", label: "Черный" },
];
const SOCKS_SIZE_OPTS = [
  { code: "adult", label: "Обычный" },
  { code: "junior", label: "Junior" },
];
export default function TelegramApp({ me: initialMeProp }) {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || "";
  const tgUser = tg?.initDataUnsafe?.user || null;
  const inTelegramWebApp = Boolean(initData && tgUser?.id);
  const hasWebAuth = Boolean(getAuthToken() || initialMeProp?.player || initialMeProp?.tg_id);
  const tgPopupBusyRef = useRef(false);
// ===== Web popups (fallback for tgPopup / tgSafeAlert outside Telegram) =====
const [webPopup, setWebPopup] = useState(null); // { title, message, buttons }
const webPopupResolveRef = useRef(null);
const webPopupBusyRef = useRef(false);
function closeWebPopup(id = "cancel") {
  const r = webPopupResolveRef.current;
  webPopupResolveRef.current = null;
  webPopupBusyRef.current = false;
  setWebPopup(null);
  if (typeof r === "function") r({ id: id || "" });
}
function openWebPopup({ title, message, buttons }) {
  return new Promise((resolve) => {
    if (webPopupBusyRef.current) return resolve({ id: "cancel" });
    webPopupBusyRef.current = true;
    webPopupResolveRef.current = resolve;
    setWebPopup({
      title: title || "",
      message: message || "",
      buttons:
        Array.isArray(buttons) && buttons.length
          ? buttons
          : [{ id: "ok", type: "ok", text: "Ок" }],
    });
  });
}
useEffect(() => {
  if (!webPopup) return;
  const onKey = (e) => {
    if (e.key === "Escape") {
        const cancelId = (webPopup?.buttons || []).find((b) => b?.type === "cancel")?.id;
        closeWebPopup(cancelId || (webPopup?.buttons || [])[0]?.id || "cancel");
      }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [webPopup]);
  // ===== WEB theme toggle (only outside Telegram) =====
  const WEB_THEME_KEY = "web_theme";
  const [webTheme, setWebTheme] = useState(() => {
    try {
      const saved = String(localStorage.getItem(WEB_THEME_KEY) || "").trim();
      if (saved === "dark" || saved === "light") return saved;
    } catch {}
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  });
  useEffect(() => {
    // Telegram controls theme itself
    if (inTelegramWebApp) {
      delete document.documentElement.dataset.web;
      delete document.documentElement.dataset.webTheme;
      return;
    }
    document.documentElement.dataset.web = "1";
    document.documentElement.dataset.webTheme = webTheme;
    try {
      localStorage.setItem(WEB_THEME_KEY, webTheme);
    } catch {}
  }, [inTelegramWebApp, webTheme]);
  const OWNER_TG_ID = Number(import.meta.env.VITE_OWNER_TG_ID || 0);
  const myTgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  const isOwner = OWNER_TG_ID && String(myTgId) === String(OWNER_TG_ID);
  const [tab, setTab] = useState("game"); // game | players | teams | stats | profile | admin
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [me, setMe] = useState(initialMeProp?.player ?? initialMeProp ?? null);
  const [accessReason, setAccessReason] = useState(null);
  const [isAdmin, setIsAdmin] = useState(!!initialMeProp?.is_admin);
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
  const [teamsLockModalOpen, setTeamsLockModalOpen] = useState(false);
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
  const pastSentinelRef = useRef(null);
  const pastLoadLockRef = useRef(false);
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
    // ===== jersey order (profile) =====
  const jerseyCardRef = useRef(null);
  const EMPTY_JERSEY_REQ = {
    name_on_jersey: "",
    jersey_colors: [],
    jersey_number: "",
    jersey_size: "",
    socks_needed: false,
    socks_colors: [],
    socks_size: "adult",
  };
  const [jerseyOpenBatch, setJerseyOpenBatch] = useState(null);
  const [jerseyReqs, setJerseyReqs] = useState([]);       // заявки текущего открытого сбора
  const [jerseyHistory, setJerseyHistory] = useState([]); // история по прошлым сборам (опционально)
  const [jerseyActiveId, setJerseyActiveId] = useState("new"); // "new" | number
  const [jerseyActiveStatus, setJerseyActiveStatus] = useState("draft"); // draft|sent
  const [jerseyEditingSent, setJerseyEditingSent] = useState(false);
  const [jerseyDraft, setJerseyDraft] = useState({ ...EMPTY_JERSEY_REQ });
  const [jerseyUpdatedAt, setJerseyUpdatedAt] = useState(null);
  const [jerseySentAt, setJerseySentAt] = useState(null);
  const [jerseyBusy, setJerseyBusy] = useState(false);
  const [jerseyMsg, setJerseyMsg] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [emailEditMode, setEmailEditMode] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const jerseyCanEditSent = jerseyActiveStatus === "sent" && jerseyOpenBatch?.id && jerseyEditingSent;
  const jerseyInputsDisabled = jerseyBusy || (jerseyActiveStatus === "sent" && !jerseyCanEditSent);
  const jerseyNamePlaceholder = (() => {
    const name = showName(me);
    return name && name !== "—" ? name : "OVECHKIN";
  })();
  const jerseyNumberPlaceholder = (() => {
    const num = showNum(me);
    return num ? num : "8";
  })();
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
const [comments, setComments] = useState([]);
const [commentsLoading, setCommentsLoading] = useState(false);
const [commentDraft, setCommentDraft] = useState("");
const [commentEditId, setCommentEditId] = useState(null);
const [commentReplyTo, setCommentReplyTo] = useState(null);
const [commentMentionIds, setCommentMentionIds] = useState([]);
const [mentionQuery, setMentionQuery] = useState("");
const [showMentionDropdown, setShowMentionDropdown] = useState(false);
const [commentBusy, setCommentBusy] = useState(false);
const [commentBusyId, setCommentBusyId] = useState(null);   // какой коммент сейчас “в работе”
const [flashId, setFlashId] = useState(null);               // подсветить после сохранения
const commentsPollRef = useRef(null);
const commentsHashRef = useRef(""); // чтобы не перерендеривать без изменений
const commentsBlockRef = useRef(null);
const REACTIONS = ["❤️","🔥","👍","😂","👏","😡","🤔"];
const [reactPickFor, setReactPickFor] = useState(null);
const [reactWhoLoading, setReactWhoLoading] = useState(false);
const [reactWhoList, setReactWhoList] = useState([]);
const [reactWhoCanView, setReactWhoCanView] = useState(true);
const [chatOpen, setChatOpen] = useState(false);
const [chatVisible, setChatVisible] = useState(false);
const [chatTab, setChatTab] = useState("team");
const [chatUnreadTotal, setChatUnreadTotal] = useState(0);
const [chatConversations, setChatConversations] = useState([]);
const [chatActiveCid, setChatActiveCid] = useState(null);
const [chatMessages, setChatMessages] = useState([]);
const [chatDraft, setChatDraft] = useState("");
const [chatPeerQuery, setChatPeerQuery] = useState("");
const [chatDmPeer, setChatDmPeer] = useState(null);
const [chatBusy, setChatBusy] = useState(false);
const [chatReactPickFor, setChatReactPickFor] = useState(null);
const [chatReactWhoLoading, setChatReactWhoLoading] = useState(false);
const [chatReactWhoList, setChatReactWhoList] = useState([]);
const [chatReactWhoCanView, setChatReactWhoCanView] = useState(true);
const [chatDmMenuOpen, setChatDmMenuOpen] = useState(false);
const chatPollRef = useRef(null);
const chatLastMessageIdRef = useRef(0);
const chatLoadInFlightRef = useRef(false);
const chatCloseTimerRef = useRef(null);
const [detailFocus, setDetailFocus] = useState(null); // null | "comments"
const commentsCardRef = useRef(null);
const initStartedRef = useRef(false);
const [confirmOpen, setConfirmOpen] = useState(false);
function openGameDetail(id, focus = null) {
  setTab("game");                 // ✅ важно для переходов из чата
  setSelectedGameId(id);
  setGameView("detail");
  setGame(null);
  setRsvps([]);
  setTeams(null);
  setDetailLoading(true);
  setDetailFocus(focus);
  Promise.all([refreshGameOnly(id)])
    .then(() => refreshCommentsOnly(id))
    .catch(console.error)
    .finally(() => setDetailLoading(false));
}
useEffect(() => {
  if (detailFocus !== "comments") return;
  if (gameView !== "detail") return;
  if (detailLoading) return;
  if (!game) return;
  requestAnimationFrame(() => {
    commentsBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  setDetailFocus(null);
}, [detailFocus, gameView, detailLoading, game?.id]);
function tgSafeAlert(text) {
  // вне Telegram: показываем свой модал (встроенные tg.showAlert/showPopup тут часто “молчат”)
  if (!inTelegramWebApp || !tg?.showAlert) {
    return openWebPopup({
      title: "Сообщение",
      message: String(text || ""),
      buttons: [{ id: "ok", type: "ok", text: "Ок" }],
    }).then(() => {});
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
  if (action !== "keep_open") closeGameSheet();
  if (gameId) {
    setSelectedGameId(gameId);
    setGameView("detail"); // сразу в деталку
  }
  await refreshAll(gameId ?? selectedGameId);
};
const handleBottomNavSelect = (nextTab) => {
  if (nextTab === "game") {
    setTab("game");
    setGameView("list");
    return;
  }
  setTab(nextTab);
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
function commentsHash(list) {
  try {
    // учитываем текст + updated + реакции (emoji/count/my)
    return JSON.stringify(
      (list || []).map(c => ({
        id: c.id,
        body: c.body,
        u: c.updated_at || c.created_at,
        r: (c.reactions || []).map(x => `${x.emoji}:${x.count}:${x.my ? 1 : 0}`).join("|")
      }))
    );
  } catch {
    return String(Date.now());
  }
}
function patchCommentsCount(gameId, cnt) {
  setGames(prev => {
    const cur = (prev || []).find(x => x.id === gameId)?.comments_count ?? 0;
    if (cur === cnt) return prev;
    return (prev || []).map(x => x.id === gameId ? { ...x, comments_count: cnt } : x);
  });
  setPastPage(prev => {
    const cur = (prev || []).find(x => x.id === gameId)?.comments_count ?? 0;
    if (cur === cnt) return prev;
    return (prev || []).map(x => x.id === gameId ? { ...x, comments_count: cnt } : x);
  });
}
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
  const tg = window.Telegram?.WebApp;
  // вне Telegram: наш кастомный модал
  if (!inTelegramWebApp || !tg?.showPopup) {
    return openWebPopup({ title, message, buttons });
  }
  return new Promise((resolve) => {
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
function initialsFrom(name) {
  const s = String(name || "").trim();
  if (!s) return "??";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map(x => (x[0] || "").toUpperCase()).join("") || "??";
}
async function submitComment() {
  if (!game?.id) return;
  const body = String(commentDraft || "").replace(/\r\n/g, "\n").trim();
  if (!body) return;
  const gameId = game.id;
  const replyToCommentId = commentReplyTo?.id ?? null;
  const mentionIds = Array.from(
    new Set((commentMentionIds || []).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0))
  ).slice(0, 10);
  const nowIso = new Date().toISOString();
  // helper: вставить новый коммент сразу сверху, но после закрепа (если есть)
  const insertNewToTop = (prev, item) => {
    const arr = Array.isArray(prev) ? prev : [];
    const pinIdx = arr.findIndex(x => x?.is_pinned);
    if (pinIdx === 0) return [arr[0], item, ...arr.slice(1)];
    return [item, ...arr];
  };
  setCommentBusy(true);
  // ===== EDIT =====
  if (commentEditId) {
    const id = commentEditId;
    // ✅ мгновенно выходим из режима редактирования
    setCommentEditId(null);
    setCommentDraft("");
    setCommentReplyTo(null);
    setCommentMentionIds([]);
    // ✅ оптимистично обновляем текст сразу
    setComments(prev =>
      (prev || []).map(c =>
        c.id === id ? { ...c, body, updated_at: nowIso, _pending: "edit" } : c
      )
    );
    setCommentBusyId(id);
    try {
      const r = await apiPatch(`/api/game-comments/${id}`, { body });
      if (r?.ok) {
        setComments(r.comments || []);
        patchCommentsCount?.(gameId, (r.comments || []).length);
        // подсветим сохранённый коммент
        setFlashId(id);
        setTimeout(() => setFlashId(null), 900);
      } else {
        // если бек вернул ошибку — просто перезагрузим комменты
        const rr = await apiGet(`/api/game-comments?game_id=${gameId}`);
        if (rr?.ok) setComments(rr.comments || []);
      }
    } finally {
      setCommentBusy(false);
      setCommentBusyId(null);
    }
    return;
  }
  // ===== NEW =====
  const tmpId = `tmp_${Date.now()}`;
  const meId = String(me?.id ?? me?.tg_id ?? "");
  const temp = {
    id: tmpId,
    game_id: gameId,
    author_tg_id: meId,
    body,
    created_at: nowIso,
    updated_at: null,
    is_pinned: false,
    reactions: [],
    reply_to_comment_id: replyToCommentId,
    reply_to_preview: commentReplyTo?.reply_to_preview || (commentReplyTo ? {
      author_name: commentReplyTo?.author?.display_name || commentReplyTo?.author?.first_name || "",
      excerpt: String(commentReplyTo?.body || "").slice(0, 90),
    } : null),
    author: {
      tg_id: me?.id ?? me?.tg_id,
      display_name: me?.display_name || "",
      first_name: me?.first_name || "",
      username: me?.username || "",
      photo_url: me?.photo_url || "",
    },
    _pending: "send",
  };
  // ✅ сразу показываем в списке (сверху)
  setComments(prev => insertNewToTop(prev, temp));
  setCommentDraft("");
  setCommentBusyId(tmpId);
  try {
    const r = await apiPost(`/api/game-comments`, {
      game_id: gameId,
      body,
      reply_to_comment_id: replyToCommentId,
      mention_ids: mentionIds,
    });
    if (r?.ok) {
      setComments(r.comments || []);
      patchCommentsCount?.(gameId, (r.comments || []).length);
      setCommentReplyTo(null);
      setCommentMentionIds([]);
      setShowMentionDropdown(false);
      setMentionQuery("");
    } else {
      setComments(prev => (prev || []).filter(c => c.id !== tmpId));
    }
  } finally {
    setCommentBusy(false);
    setCommentBusyId(null);
  }
}
async function removeComment(id) {
  const ok = confirm("Удалить комментарий?");
  if (!ok) return;
  setCommentBusy(true);
  try {
    const r = await apiDelete(`/api/game-comments/${id}`);
    if (r?.ok) {
      setComments(r.comments || []);
      const cnt = (r.comments || []).length;
      patchCommentsCount(selectedGameId, cnt);
      commentsHashRef.current = commentsHash(r.comments || []);
    } 
  } finally {
    setCommentBusy(false);
  }
}
// async function openReactPicker(commentId) {
//   const canViewReactors = !!(isAdmin || fun?.premium);
//   setReactPickFor(commentId);
//   setReactWhoList([]);
//   setReactWhoCanView(canViewReactors);
//   // если нельзя — просто показываем “🔒”, но саму модалку откроем
//   if (!canViewReactors) return;
//   setReactWhoLoading(true);
//   try {
//     const r = await apiGet(`/api/game-comments/${commentId}/reactors`);
//     if (r?.ok) {
//       setReactWhoCanView(r.can_view !== false);
//       setReactWhoList(r.reactors || []);
//     }
//   } finally {
//     setReactWhoLoading(false);
//   }
// }
async function openReactPicker(commentId) {
  const now = Date.now();
  const isPremium =
    !!me?.joke_premium ||
    !!me?.joke_premium_active ||
    (!!me?.joke_premium_until && new Date(me.joke_premium_until).getTime() > now) ||
    !!fun?.premium; // если вдруг оставляешь совместимость
  const canViewReactors = !!(isAdmin || isPremium);
  setReactPickFor(commentId);
  setReactWhoList([]);
  setReactWhoCanView(canViewReactors);
  // 👇 лучше НЕ блокировать запрос на клиенте (пусть решает сервер)
  setReactWhoLoading(true);
  try {
    const r = await apiGet(`/api/game-comments/${commentId}/reactors`);
    if (r?.ok) {
      setReactWhoCanView(r.can_view !== false);
      setReactWhoList(r.reactors || []);
    }
  } finally {
    setReactWhoLoading(false);
  }
}
async function toggleReaction(commentId, emoji, on) {
  const gid = selectedGameId;
  // ✅ 1) СРАЗУ обновляем UI локально (optimistic)
  setComments(prev => {
    const next = (prev || []).map(c => {
      if (c.id !== commentId) return c;
      const list = Array.isArray(c.reactions) ? [...c.reactions] : [];
      const idx = list.findIndex(r => r.emoji === emoji);
      if (idx >= 0) {
        const r = { ...list[idx] };
        const count = Number(r.count || 0);
        if (on && !r.my) {
          r.my = true;
          r.count = count + 1;
        } else if (!on && r.my) {
          r.my = false;
          r.count = Math.max(0, count - 1);
        }
        // если стало 0 — можно убрать чип
        if ((r.count || 0) <= 0) list.splice(idx, 1);
        else list[idx] = r;
      } else if (on) {
        // реакции не было — добавляем
        list.unshift({ emoji, count: 1, my: true });
      }
      return { ...c, reactions: list };
    });
    commentsHashRef.current = commentsHash(next);
    return next;
  });
  // ✅ 2) Потом шлём запрос и синкаемся
  try {
    const r = await apiPost(`/api/game-comments/${commentId}/react`, { emoji, on });
    // если сервер возвращает comments — используем их
    if (r?.ok && Array.isArray(r.comments)) {
      commentsHashRef.current = commentsHash(r.comments);
      setComments(r.comments);
    } else {
      // если сервер не возвращает — просто тихо рефрешим
      refreshCommentsOnly(gid, { silent: true }).catch(() => {});
    }
  } catch (e) {
    console.error("toggleReaction failed:", e);
    // откат: просто рефрешим с сервера
    refreshCommentsOnly(gid, { silent: true }).catch(() => {});
  }
}
function openChatDrawer() {
  if (chatCloseTimerRef.current) {
    clearTimeout(chatCloseTimerRef.current);
    chatCloseTimerRef.current = null;
  }
  setChatVisible(true);
  setChatOpen(true);
}

function closeChatDrawer() {
  if (chatCloseTimerRef.current) {
    clearTimeout(chatCloseTimerRef.current);
    chatCloseTimerRef.current = null;
  }
  setChatOpen(false);
  chatCloseTimerRef.current = setTimeout(() => {
    setChatVisible(false);
    chatCloseTimerRef.current = null;
  }, 280);
}

function onChatDrawerTransitionEnd(e) {
  if (e?.target !== e?.currentTarget) return;
  if (chatOpen) return;
  if (chatCloseTimerRef.current) {
    clearTimeout(chatCloseTimerRef.current);
    chatCloseTimerRef.current = null;
  }
  setChatVisible(false);
}

function chatPeerSearchValue(p) {

  return [p?.display_name, p?.first_name, p?.last_name, p?.username ? `@${p.username}` : ""]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
async function loadChatUnreadTotal() {
  try {
    const r = await apiGet('/api/chat/unread-total');
    if (r?.ok) setChatUnreadTotal(Number(r.total || 0));
  } catch {}
}
async function loadChatConversations() {
  const r = await apiGet('/api/chat/conversations');
  if (!r?.ok) return [];
  const list = r.conversations || [];
  setChatConversations(list);
  if (chatTab === 'team') {
    const team = list.find((c) => c.kind === 'team');
    if (team?.id && String(chatActiveCid) !== String(team.id)) {
      setChatDmPeer(null);
      setChatActiveCid(team.id);
      setChatMessages([]);
      chatLastMessageIdRef.current = 0;
    }
  }
  if (chatTab === 'dm' && chatActiveCid) {
    const exists = list.some((c) => String(c.id) === String(chatActiveCid) && c.kind === 'dm');
    if (!exists) {
      setChatActiveCid(null);
      setChatMessages([]);
      chatLastMessageIdRef.current = 0;
    }
  }
  return list;
}
async function loadChatMessages({ cid = chatActiveCid, reset = false } = {}) {
  if (!cid) return;
  if (chatLoadInFlightRef.current) return;
  const targetCid = Number(cid);
  const afterId = reset ? 0 : Number(chatLastMessageIdRef.current || 0);
  chatLoadInFlightRef.current = true;
  try {
    const r = await apiGet(`/api/chat/messages?cid=${targetCid}&after_id=${afterId}&limit=60`);
    if (!r?.ok) return;
    const incoming = r.messages || [];
    if (reset) {
      setChatMessages(incoming);
      chatLastMessageIdRef.current = Number(incoming[incoming.length - 1]?.id || 0);
    } else if (incoming.length) {
      setChatMessages((prev) => {
        const seen = new Set((prev || []).map((x) => Number(x.id)));
        const append = incoming.filter((x) => !seen.has(Number(x.id)));
        return append.length ? [...prev, ...append] : prev;
      });
      chatLastMessageIdRef.current = Number(incoming[incoming.length - 1]?.id || chatLastMessageIdRef.current || 0);
    }
    if (incoming.length) {
      const lastId = incoming[incoming.length - 1]?.id;
      if (lastId) apiPost('/api/chat/read', { cid: targetCid, last_read_id: lastId }).catch(() => {});
    }
  } finally {
    chatLoadInFlightRef.current = false;
  }
}
async function sendChatMessage() {
  const cid = Number(chatActiveCid);
  const body = String(chatDraft || '').replace(/\r\n/g, '\n').trim();
  if (!cid || !body || body.length > 800) return;
  setChatBusy(true);
  try {
    const r = await apiPost('/api/chat/messages', { cid, body });
    if (r?.ok && r.message) {
      setChatDraft('');
      setChatMessages((prev) => [...prev, r.message]);
      chatLastMessageIdRef.current = Number(r.message?.id || chatLastMessageIdRef.current || 0);
      await Promise.all([loadChatConversations(), loadChatUnreadTotal()]);
    }
  } finally {
    setChatBusy(false);
  }
}
async function openDmWithPeer(peerTgId) {
  const r = await apiPost('/api/chat/dm/open', { peer_tg_id: Number(peerTgId) });
  if (!r?.ok || !r.conversation_id) return;
  const picked = (playersDir || []).find((x) => String(x.tg_id) === String(peerTgId)) || null;
  setChatDmPeer(picked);
  setChatDmMenuOpen(false);
  setChatTab('dm');
  setChatActiveCid(Number(r.conversation_id));
  setChatMessages([]);
  chatLastMessageIdRef.current = 0;
  await loadChatConversations();
  await loadChatMessages({ cid: Number(r.conversation_id), reset: true });
}
async function selectChatConversation(cid) {
  const conv = (chatConversations || []).find((x) => String(x.id) === String(cid));
  setChatDmPeer(conv?.peer || null);
  setChatDmMenuOpen(false);
  setChatActiveCid(Number(cid));
  setChatMessages([]);
  chatLastMessageIdRef.current = 0;
  await loadChatMessages({ cid: Number(cid), reset: true });
}
async function deleteChatMessage(messageId) {
  const id = Number(messageId);
  if (!id) return;
  const ok = confirm('Удалить сообщение?');
  if (!ok) return;

  await apiDelete(`/api/chat/messages/${id}`);
  setChatMessages((prev) => (prev || []).filter((m) => Number(m.id) !== id));
  await Promise.all([loadChatConversations(), loadChatUnreadTotal()]);
}

async function toggleChatReaction(messageId, emoji, on) {
  await apiPost(`/api/chat/messages/${messageId}/react`, { emoji, on });
  await loadChatMessages({ cid: chatActiveCid, reset: true });
}
async function openChatReactors(messageId) {
  setChatReactPickFor(messageId);
  setChatReactWhoLoading(true);
  setChatReactWhoList([]);
  setChatReactWhoCanView(true);
  try {
    const r = await apiGet(`/api/chat/messages/${messageId}/reactors`);
    if (r?.ok) {
      setChatReactWhoCanView(r.can_view !== false);
      setChatReactWhoList(r.reactors || []);
    }
  } finally {
    setChatReactWhoLoading(false);
  }
}
async function clearActiveDm() {
  const cid = Number(chatActiveCid);
  if (!cid) return;
  const ok = confirm('Очистить историю личного чата у обоих?');
  if (!ok) return;
  await apiPost(`/api/chat/dm/${cid}/clear`, {});
  setChatDmMenuOpen(false);
  setChatActiveCid(null);
  setChatDmPeer(null);
  setChatMessages([]);
  chatLastMessageIdRef.current = 0;
  await Promise.all([loadChatConversations(), loadChatUnreadTotal()]);
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
async function refreshCommentsOnly(gameId, { silent = false } = {}) {
  if (!gameId) return;
  if (!silent) setCommentsLoading(true);
  try {
    const r = await apiGet(`/api/game-comments?game_id=${gameId}`);
    const next = r.comments || [];
    const h = commentsHash(next);
    if (h !== commentsHashRef.current) {
      commentsHashRef.current = h;
      setComments(next);
      patchCommentsCount(gameId, next.length);
    }
  } finally {
    if (!silent) setCommentsLoading(false);
  }
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
// async function refreshUpcomingGamesOnly() {
//   const gl = await apiGet("/api/games?scope=upcoming&limit=365&offset=0");
//   if (gl?.ok === false) {
//     setGamesError(gl);
//     setGames([]);
//     return null;
//   }
//   setGamesError(null);
//   setGames(gl.games || []);
//   setTalismanHolder(gl.talisman_holder || null);
//   return gl.games || [];
// }
async function refreshUpcomingGamesOnly() {
  const [gl, pl] = await Promise.allSettled([
    apiGet("/api/games?scope=upcoming&limit=365&offset=0"),
    apiGet("/api/games?scope=past&limit=20&offset=0"),
  ]);
  if (gl.status === "rejected") throw gl.reason;
  const up = gl.value;
  if (up?.ok === false) {
    setGamesError(up);
    setGames([]);
    return null;
  }
  const past = pl.status === "fulfilled" ? (pl.value?.games || []) : [];
  const todayFromPast = past.filter((g) => !gameFlags(g?.starts_at).isPast); // сегодня/не ушла за 00:00
  const merged = mergeUniqueById(up.games || [], todayFromPast);
  setGamesError(null);
  setGames(merged);
  setTalismanHolder(up.talisman_holder || null);
  return merged;
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
  // function isPastGame(g) {
  //   if (!g?.starts_at) return false;
  //   const t = new Date(g.starts_at).getTime();
  //   // прошла, если начало было больше чем 3 часа назад
  //   return t < Date.now() - 3 * 60 * 60 * 1000;
  // }
function gameFlags(starts_at) {
  if (!starts_at) return { isPast: false, isFinished: false, isLive: false };
  const startMs = new Date(starts_at).getTime();
  const now = Date.now();
  // 00:00 сегодняшнего дня (локальное время клиента)
  const today00 = new Date();
  today00.setHours(0, 0, 0, 0);
  const isPast = startMs < today00.getTime();                 // в "прошедшие" после 00:00 следующего дня
  const isFinished = now >= startMs + 2 * 60 * 60 * 1000;     // "прошла" через 2 часа
  const isLive = now >= startMs && now < startMs + 2 * 60 * 60 * 1000; // "идёт" первые 2 часа
  return { isPast, isFinished, isLive };
}
function isPastGame(g) {
  return gameFlags(g?.starts_at).isPast;
}
function uiStatus(game) {
  if (!game) return "—";
  if (game.status === "cancelled") return "Отменена";
  const { isFinished, isLive } = gameFlags(game.starts_at);
  if (isFinished) return "Прошла";
  if (isLive) return "Идёт";
  return "Запланирована";
}
// function uiStatus(game) {
//   if (!game) return "—";
//   if (game.status === "cancelled") return "Отменена";
//   const { isFinished } = gameFlags(game.starts_at);
//   if (isFinished) return "Прошла";
//   // дальше твоя логика для будущей/идёт/набор
//   return "Скоро"; 
// }
  // function uiStatus(g) {
  //   if (!g) return "";
  //   if (g.status === "cancelled") return "Отменена";
  //   if (isPastGame(g)) return "Прошла";
  //   return "Запланирована";
  // }
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
    if (m?.ok === false && (m?.reason === "not_member" || m?.reason === "access_chat_not_set" || m?.reason === "player_deleted")) {
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
      if (m.player.disabled && !m?.is_admin) {
        setTab("profile");
        setGames([]);
        setSelectedGameId(null);
        setGame(null);
        setRsvps([]);
        setTeams(null);
        setAccessReason("profile_only");
        setIsAdmin(!!m?.is_admin);
        return;
      }
    } else if (initialMeProp?.player || initialMeProp?.tg_id) {
      setMe(initialMeProp?.player ?? initialMeProp);
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
    const gamesUrl = hasWebAuth && !inTelegramWebApp
      ? "/api/games?scope=all&limit=365&offset=0"
      : "/api/games?scope=upcoming&limit=365&offset=0";
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
    let todayFromPast = [];
    try {
      const p = await apiGet("/api/games?scope=past&limit=20&offset=0");
      todayFromPast = (p?.games || []).filter((g) => !gameFlags(g?.starts_at).isPast);
    } catch {}
    let list = mergeUniqueById(gl.games || [], todayFromPast);
    setGames(list);
    setTalismanHolder(gl.talisman_holder || null);
    if (hasWebAuth && !inTelegramWebApp) {
      const hasUpcoming = (list || []).some((g) => !isPastGame(g));
      if (!hasUpcoming) {
        try {
          const all = await apiGet("/api/games?scope=all&limit=365&offset=0");
          if (all?.games?.length) {
            list = all.games || [];
            setGames(list);
            setTalismanHolder(all.talisman_holder || null);
          }
        } catch (e) {
          console.error("fallback all games failed", e);
        }
      }
    }
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
      if (pastLoadLockRef.current) return;
      pastLoadLockRef.current = true;
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
      pastLoadLockRef.current = false;
      setPastLoading(false);
    }
  }
  useEffect(() => {
  if (!showPast) return;
  const el = pastSentinelRef.current;
  if (!el) return;
  const hasMore = pastPage.length < pastTotal;
  if (!hasMore) return;
  const io = new IntersectionObserver(
    (entries) => {
      const hit = entries.some((e) => e.isIntersecting);
      if (!hit) return;
      if (pastLoadLockRef.current) return;
      if (pastPage.length >= pastTotal) return;
      loadPast(false);
    },
    {
      root: null,
      rootMargin: "400px 0px", // начинаем грузить заранее, пока не “упёрся” в низ
      threshold: 0,
    }
  );
  io.observe(el);
  return () => io.disconnect();
}, [showPast, pastTotal, pastPage.length, pastFrom, pastTo, pastQ]);
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
useEffect(() => {
  // стартуем только в деталке
  if (gameView !== "detail" || !selectedGameId) return;
  // сразу подгружаем (тихо)
  refreshCommentsOnly(selectedGameId, { silent: true }).catch(() => {});
  // чистим старый таймер
  if (commentsPollRef.current) clearInterval(commentsPollRef.current);
  commentsPollRef.current = setInterval(() => {
    // если вкладка скрыта — реже/не надо
    if (document.hidden) return;
    refreshCommentsOnly(selectedGameId, { silent: true }).catch(() => {});
  }, 7000); // 7 сек — норм
  return () => {
    if (commentsPollRef.current) clearInterval(commentsPollRef.current);
    commentsPollRef.current = null;
  };
}, [gameView, selectedGameId]);
useEffect(() => {
  loadChatUnreadTotal().catch(() => {});
  const t = setInterval(() => {
    if (document.hidden) return;
    loadChatUnreadTotal().catch(() => {});
  }, 10000);
  return () => clearInterval(t);
}, []);
useEffect(() => {
  if (!chatVisible) {
    if (chatPollRef.current) clearInterval(chatPollRef.current);
    chatPollRef.current = null;
    return;
  }
  if (!playersDir?.length) {
    refreshPlayersDirOnly().catch(() => {});
  }
  loadChatConversations().catch(() => {});
  if (chatActiveCid) loadChatMessages({ cid: chatActiveCid, reset: true }).catch(() => {});
  if (chatPollRef.current) clearInterval(chatPollRef.current);
  chatPollRef.current = setInterval(() => {
    if (document.hidden) return;
    loadChatConversations().catch(() => {});
    if (chatActiveCid) loadChatMessages({ cid: chatActiveCid, reset: false }).catch(() => {});
    loadChatUnreadTotal().catch(() => {});
  }, 2500);
  return () => {
    if (chatPollRef.current) clearInterval(chatPollRef.current);
    chatPollRef.current = null;
  };
}, [chatVisible, chatActiveCid]);
useEffect(() => {
  if (!chatVisible) return;
  if (chatTab === 'team') {
    const team = chatConversations.find((c) => c.kind === 'team');
    if (team?.id && String(chatActiveCid) !== String(team.id)) {
      setChatDmPeer(null);
      setChatActiveCid(team.id);
      setChatMessages([]);
      chatLastMessageIdRef.current = 0;
      loadChatMessages({ cid: team.id, reset: true }).catch(() => {});
    }
  } else if (chatTab === 'dm') {
    const activeIsDm = (chatConversations || []).some((c) => c.kind === 'dm' && String(c.id) === String(chatActiveCid));
    if (activeIsDm) return;
    setChatDmPeer(null);
    setChatActiveCid(null);
    setChatMessages([]);
    chatLastMessageIdRef.current = 0;
  }
}, [chatTab, chatVisible, chatConversations]);
useEffect(() => {
  if (!chatVisible) return;
  const onKey = (e) => {
    if (e.key === 'Escape') closeChatDrawer();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [chatVisible]);
useEffect(() => {
  return () => {
    if (chatCloseTimerRef.current) {
      clearTimeout(chatCloseTimerRef.current);
      chatCloseTimerRef.current = null;
    }
  };
}, []);
function clipText(s, max = 70) {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}
  // init
  useEffect(() => {
  // ждём, пока появится авторизация: либо TG, либо web-token
  if (!inTelegramWebApp && !hasWebAuth) {
    setLoading(false);
    return;
  }
  // чтобы не запускать init повторно
  if (initStartedRef.current) return;
  initStartedRef.current = true;
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
  const readStartParam = () => {
    const rawA = String(window.Telegram?.WebApp?.initDataUnsafe?.start_param || "").trim();
    const rawB = String(new URLSearchParams(window.location.search).get("tgWebAppStartParam") || "").trim();
    const raw = rawA || rawB || "";
    try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); }
  };
  const sp = readStartParam();
  let forceGameId = null;
  if (sp) {
    if (sp === "jersey") {
      setTab("profile");
      setProfileView("me");
      setTimeout(() => {
        jerseyCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } else {
      let m = sp.match(/^game_(\d+)(?:_(comments))?$/);
      if (m) {
        const gid = Number(m[1]);
        const focus = m[2] ? "comments" : null;
        if (Number.isFinite(gid) && gid > 0) {
          forceGameId = gid;
          setTab("game");
          setGameView("detail");
          setSelectedGameId(gid);
          setDetailFocus(focus);
        }
      } else {
        m = sp.match(/^teams_(\d+)$/);
        if (m) {
          const gid = Number(m[1]);
          if (Number.isFinite(gid) && gid > 0) {
            forceGameId = gid;
            setSelectedGameId(gid);
            setTab("teams");
            setTeamsBack?.({ tab: "game", gameView: "detail" });
          }
        }
      }
    }
  }
  (async () => {
    try {
      setLoading(true);
      // TG-специфичные штуки — только если реально внутри Telegram
      if (inTelegramWebApp) {
        tg?.ready?.();
        tg?.expand?.();
        applyTheme();
        tg?.onEvent?.("themeChanged", applyTheme);
      }
      await refreshAll(forceGameId);
    } finally {
      setLoading(false);
    }
  })();
  return () => {
    if (inTelegramWebApp) tg?.offEvent?.("themeChanged", applyTheme);
  };
}, [inTelegramWebApp, hasWebAuth]);
//   useEffect(() => {
//     if (!inTelegramWebApp) {
//       setLoading(false);
//       return;
//     }
//     const applyTheme = () => {
//       if (!tg) return;
//       const scheme = tg.colorScheme || "light";
//       document.documentElement.dataset.tg = scheme;
//       document.documentElement.dataset.theme = scheme;
//       const p = tg.themeParams || {};
//       for (const [k, v] of Object.entries(p)) {
//         if (typeof v === "string" && v) {
//           document.documentElement.style.setProperty(`--tg-${k}`, v);
//         }
//       }
//     };
//     const readStartParam = () => {
//   const rawA = String(window.Telegram?.WebApp?.initDataUnsafe?.start_param || "").trim();
//   const rawB = String(new URLSearchParams(window.location.search).get("tgWebAppStartParam") || "").trim();
//   const raw = rawA || rawB || "";
//   try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); }
// };
//     const sp = readStartParam();
//     // заранее решаем, какую игру открыть (если пришли из чата)
//     let forceGameId = null;
//     if (sp) {
//       if (sp === "jersey") {
//         setTab("profile");
//         setProfileView("me");
//         setTimeout(() => {
//           jerseyCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
//         }, 50);
//       } else {
//         let m = sp.match(/^game_(\d+)(?:_(comments))?$/);
//         if (m) {
//           const gid = Number(m[1]);
//           const focus = m[2] ? "comments" : null;
//           if (Number.isFinite(gid) && gid > 0) {
//             forceGameId = gid;
//             setTab("game");
//             setGameView("detail");
//             setSelectedGameId(gid);
//             setDetailFocus(focus);
//           }
//         } else {
//           m = sp.match(/^teams_(\d+)$/);
//           if (m) {
//             const gid = Number(m[1]);
//             if (Number.isFinite(gid) && gid > 0) {
//               forceGameId = gid;
//               setSelectedGameId(gid);
//               setTab("teams");
//               setTeamsBack?.({ tab: "game", gameView: "detail" });
//             }
//           }
//         }
//       }
//     }
//     (async () => {
//       try {
//         setLoading(true);
//         tg?.ready?.();
//         tg?.expand?.();
//         applyTheme();
//         tg?.onEvent?.("themeChanged", applyTheme);
//         await refreshAll(forceGameId);
//       } finally {
//         setLoading(false);
//       }
//     })();
//     return () => tg?.offEvent?.("themeChanged", applyTheme);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);
  
// useEffect(() => {
//   const raw = String(window.Telegram?.WebApp?.initDataUnsafe?.start_param || "");
//   const sp = (() => {
//     try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); }
//   })();
//   if (!sp) return;
//   // 1) teams_<id>
//   let m = sp.match(/^teams_(\d+)$/);
//   if (m) {
//     const gid = Number(m[1]);
//     if (!Number.isFinite(gid) || gid <= 0) return;
//     setSelectedGameId(gid);
//     setTab("teams");
//     setTeamsBack?.({ tab: "game", gameView: "detail" });
//     (async () => {
//       setDetailLoading(true);
//       try {
//         await Promise.all([
//           refreshUpcomingGamesOnly(),
//           refreshGameOnly(gid),
//         ]);
//       } finally {
//         setDetailLoading(false);
//       }
//     })();
//     return;
//   }
//   // 2) game_<id> or game_<id>_comments
//   m = sp.match(/^game_(\d+)(?:_(comments))?$/);
//   if (m) {
//     const gid = Number(m[1]);
//     const focus = m[2] ? "comments" : null;
//     if (!Number.isFinite(gid) || gid <= 0) return;
//     openGameDetail(gid, focus);
//     return;
//   }
//   // 3) просто число: "485" (у тебя reminder так делает)
//   if (/^\d+$/.test(sp)) {
//     const gid = Number(sp);
//     if (!Number.isFinite(gid) || gid <= 0) return;
//     openGameDetail(gid, null);
//     return;
//   }
// }, []);
  useEffect(() => {
  if (gameView !== "detail") return;
  if (detailLoading) return;
  if (!game?.id) return;
  if (detailFocus !== "comments") return;
  const t = setTimeout(() => {
    commentsCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setDetailFocus(null); // ✅ чтобы не скроллило снова при рендерах
  }, 50);
  return () => clearTimeout(t);
}, [detailFocus, detailLoading, game?.id, gameView]);
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
  if (me?.disabled && !isAdmin && tab !== "profile") {
    setTab("profile");
  }
}, [me?.disabled, isAdmin, tab]);
useEffect(() => {
  if (tab === "profile" && profileView === "thanks") loadFunStatus();
}, [tab, profileView]);
useEffect(() => {
  if (tab === "profile" && profileView === "me") loadJerseyRequests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
async function togglePin(commentId, on) {
  if (!game?.id) return;
  setCommentBusy(true);
  try {
    const r = await apiPost(`/api/game-comments/${commentId}/pin`, { on });
    if (r?.ok) setComments(r.comments || []);
  } finally {
    setCommentBusy(false);
  }
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
        setTeamsSendMsg(r2?.edited ? "✅ Составы в чате обновлены" : "✅ Составы отправлены в чат");
        return;
      }
      setTeamsSendMsg(`❌ Не удалось отправить: ${r?.reason || r?.error || "unknown"}`);
      return;
    }
    setTeamsSendMsg(r?.edited ? "✅ Составы в чате обновлены" : "✅ Составы отправлены в чат");
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
function logoutWeb() {
  clearAuthToken();
  setMe(null);
  setIsAdmin(false);
  setAccessReason(null);
  window.location.reload();
}
  const logoutWebConfirmed = () => {
    setConfirmOpen(false);
    logoutWeb(); // твоя реальная функция очистки токена/редиректа
  };
function fmtDt(v) {
  if (!v) return "";
  const d = new Date(v);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toggleArr(arr, val) {
  const a = Array.isArray(arr) ? [...arr] : [];
  const i = a.indexOf(val);
  if (i >= 0) a.splice(i, 1);
  else a.push(val);
  return a;
}
function pickJerseyReq(req) {
  if (!req) return;
  setJerseyActiveId(req.id);
  setJerseyActiveStatus(req.status || "draft");
  setJerseyEditingSent(false);
  setJerseyDraft({
    name_on_jersey: req.name_on_jersey || "",
    jersey_colors: Array.isArray(req.jersey_colors) ? req.jersey_colors : [],
    jersey_number: req.jersey_number == null ? "" : String(req.jersey_number),
    jersey_size: req.jersey_size || "",
    socks_needed: !!req.socks_needed,
    socks_colors: Array.isArray(req.socks_colors) ? req.socks_colors : [],
    socks_size: req.socks_size || "adult",
  });
  setJerseyUpdatedAt(req.updated_at || null);
  setJerseySentAt(req.sent_at || null);
}
function newJerseyReq() {
  setJerseyActiveId("new");
  setJerseyActiveStatus("draft");
  setJerseyEditingSent(false);
  setJerseyDraft((prev) => ({ ...prev, ...{
    name_on_jersey: "",
    jersey_colors: [],
    jersey_number: "",
    jersey_size: "",
    socks_needed: false,
    socks_colors: [],
    socks_size: "adult",
  }}));
  setJerseyUpdatedAt(null);
  setJerseySentAt(null);
}
useEffect(() => {
  setEmailDraft(me?.pending_email || me?.email || "");
  setEmailEditMode(false);
}, [me?.email, me?.pending_email]);
async function loadJerseyRequests() {
  setJerseyBusy(true);
  setJerseyMsg("");
  try {
    const r = await apiGet("/api/jersey/requests");
    if (!r?.ok) throw new Error(r?.reason || "load_failed");
    setJerseyOpenBatch(r.batch || null);
    const list = r.requests || [];
    setJerseyReqs(list);
    setJerseyHistory(r.history || []);
    // сохраняем выбор, если он ещё существует
    const keep =
      jerseyActiveId !== "new" && list.some((x) => String(x.id) === String(jerseyActiveId))
        ? list.find((x) => String(x.id) === String(jerseyActiveId))
        : (list.find((x) => x.status === "draft") || null);
    if (keep) pickJerseyReq(keep);
    else newJerseyReq();
  } catch (e) {
    console.error(e);
    setJerseyMsg("❌ Не удалось загрузить заявки");
  } finally {
    setJerseyBusy(false);
  }
}
function jerseyPayloadFromDraft(d) {
  return {
    name_on_jersey: String(d.name_on_jersey || "").trim(),
    jersey_colors: Array.isArray(d.jersey_colors) ? d.jersey_colors : [],
    jersey_number:
      d.jersey_number === "" || d.jersey_number == null ? null : Number(d.jersey_number),
    jersey_size: String(d.jersey_size || "").trim(),
    socks_needed: !!d.socks_needed,
    socks_colors: Array.isArray(d.socks_colors) ? d.socks_colors : [],
    socks_size: d.socks_size || "adult",
  };
}
async function saveActiveJersey() {
  if (jerseyActiveStatus === "sent" && !jerseyEditingSent) return;
  if (jerseyActiveStatus === "sent" && !jerseyOpenBatch?.id) {
    setJerseyMsg("⚠️ Сбор закрыт — редактирование отправленных заявок недоступно");
    return;
  }
  setJerseyBusy(true);
  setJerseyMsg("");
  try {
    const payload = jerseyPayloadFromDraft(jerseyDraft);
    if (jerseyActiveId === "new") {
      const r = await apiPost("/api/jersey/requests", payload);
      if (!r?.ok) throw new Error(r?.reason || "save_failed");
    } else {
      const r = await apiPatch(`/api/jersey/requests/${jerseyActiveId}`, payload);
      if (!r?.ok) throw new Error(r?.reason || "save_failed");
    }
    setJerseyMsg("✅ Черновик сохранён");
    await loadJerseyRequests();
  } catch (e) {
    console.error(e);
    setJerseyMsg("❌ Не удалось сохранить");
  } finally {
    setJerseyBusy(false);
  }
}
async function deleteActiveJersey() {
  if (jerseyActiveStatus === "sent") return;
  if (jerseyActiveId === "new") {
    newJerseyReq();
    return;
  }
  const ok = confirm("Удалить эту заявку? (если не отправлена)");
  if (!ok) return;
  setJerseyBusy(true);
  setJerseyMsg("");
  try {
    const r = await apiDelete(`/api/jersey/requests/${jerseyActiveId}`);
    if (!r?.ok) throw new Error(r?.reason || "delete_failed");
    setJerseyMsg("🗑 Заявка удалена");
    await loadJerseyRequests();
  } catch (e) {
    console.error(e);
    setJerseyMsg("❌ Не удалось удалить");
  } finally {
    setJerseyBusy(false);
  }
}
async function sendEmailVerification() {
  const nextEmail = String(emailDraft || "").trim();
  if (!nextEmail) return;
  setEmailBusy(true);
  setEmailMsg("");
  try {
    await apiPost("/api/me/email/start", { email: nextEmail });
    setMe((prev) => ({ ...(prev || {}), pending_email: nextEmail }));
    setEmailMsg("✅ Ссылка для подтверждения новой почты отправлена");
    setEmailEditMode(false);
  } catch (e) {
    const reason = e?.response?.data?.reason;
    if (reason === "email_in_use") setEmailMsg("❌ Эта почта уже используется");
    else if (reason === "same_as_current") setEmailMsg("⚠️ Это уже ваша текущая почта");
    else setEmailMsg("❌ Не удалось отправить письмо");
  } finally {
    setEmailBusy(false);
  }
}
// async function sendActiveJersey() {
//   if (!jerseyOpenBatch?.id) {
//     setJerseyMsg("⚠️ Сбор закрыт — заявки не принимаются");
//     return;
//   }
//   if (jerseyActiveStatus === "sent") return;
//   setJerseyBusy(true);
//   setJerseyMsg("");
//   try {
//     // если новая — сначала создаём, потом отправляем
//     let id = jerseyActiveId;
//     if (id === "new") {
//       const payload = jerseyPayloadFromDraft(jerseyDraft);
//       const cr = await apiPost("/api/jersey/requests", payload);
//       if (!cr?.ok) throw new Error(cr?.reason || "create_failed");
//       id = cr.request?.id;
//       if (!id) throw new Error("no_request_id");
//     }
//     const r = await apiPost(`/api/jersey/requests/${id}/send`, {});
//     if (!r?.ok) throw new Error(r?.reason || "send_failed");
//     setJerseyMsg("📨 Заявка отправлена!");
//     await loadJerseyRequests();
//   } catch (e) {
//     console.error(e);
//     setJerseyMsg("❌ Не удалось отправить");
//   } finally {
//     setJerseyBusy(false);
//   }
// }
async function sendActiveJersey() {
  if (!jerseyOpenBatch?.id) {
    await tgAlert({ title: "Сбор закрыт", message: "Сейчас заявки не принимаются." });
    return;
  }
  if (jerseyActiveStatus === "sent") {
    await tgAlert({ title: "Заявка уже отправлена", message: "Сначала нажми «Изменить», если нужно обновить данные." });
    return;
  }
  if (!jerseyActiveId || jerseyActiveId === "new") {
    await tgAlert({ title: "Нет заявки", message: "Сначала создай заявку и заполни данные." });
    return;
  }
  // 1) confirm
  const ok = await tgConfirm({
    title: "Отправить заявку?",
    message: "Проверь данные:\n\n" + formatJerseySummary(jerseyDraft),
    okText: "📨 Отправить",
    cancelText: "Не отправлять",
  });
  if (!ok) return;
  // 2) send + success message
  await runOp(
    "Отправляю заявку…",
    async () => {
      const r = await apiPost(`/api/jersey/requests/${jerseyActiveId}/send`, {});
      if (!r?.ok) throw new Error(r?.reason || "send_failed");
      // обновим список, чтобы статус стал sent и появилось время
      await loadJerseyRequests();
      setJerseyMsg("✅ Заявка успешно отправлена");
      // если у тебя есть jerseySentAt / jerseyActiveStatus — они подтянутся после loadJerseyRequests()
    },
    { successText: "✅ Отправлено", errorText: "❌ Не удалось отправить" }
  );
  // 3) “ещё одну?”
  const more = await tgConfirm({
    title: "Сделать ещё одну заявку?",
    message: "Можно создать ещё одну заявку в этом сборе.",
    okText: "➕ Да, новая",
    cancelText: "Нет",
  });
  if (more) {
    await newJerseyReq();
    setJerseyMsg("📝 Создана новая заявка (черновик). Заполни и отправь.");
  }
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
    async function toggleTeamsLock(nextLocked) {
      if (!selectedGameId) return;
      await runOp(
        nextLocked ? "Фиксирую составы…" : "Разблокирую составы…",
        async () => {
          setTeamsBusy(true);
          try {
            const res = await apiPost("/api/teams/manual", {
              game_id: selectedGameId,
              op: "lock",
              locked: !!nextLocked,
            });
            if (res?.ok) {
              setTeams(normalizeTeams(res));
              if (nextLocked) {
                setEditTeams(false);
                setPicked(null);
              }
            }
          } finally {
            setTeamsBusy(false);
          }
        },
        {
          successText: nextLocked ? "🔒 Составы зафиксированы" : "🔓 Составы разблокированы",
          errorText: "❌ Не удалось изменить статус замка",
          sync: false,
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
              return;
            }
            if (res?.reason === "teams_locked") {
              setEditTeams(false);
              setPicked(null);
              setTeamsLockModalOpen(true);
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
              return;
            }
            if (res?.reason === "teams_locked") {
              setEditTeams(false);
              setPicked(null);
              setTeamsLockModalOpen(true);
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
function mergeUniqueById(primary = [], extra = []) {
  const m = new Map();
  // extra сначала, primary (upcoming) поверх — чтобы данные upcoming приоритетнее
  for (const g of extra) m.set(String(g.id), g);
  for (const g of primary) m.set(String(g.id), g);
  return Array.from(m.values());
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
  const mentionCandidates = useMemo(() => {
    const seen = new Set();
    const q = String(mentionQuery || "").trim().toLowerCase();
    const list = [];
    for (const p of rsvps || []) {
      const tgId = Number(p?.tg_id);
      if (!Number.isFinite(tgId) || seen.has(String(tgId))) continue;
      seen.add(String(tgId));
      const name = displayName(p);
      const hay = `${name} ${(p?.username || "")}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      list.push({ tg_id: tgId, name });
    }
    return list.slice(0, 8);
  }, [rsvps, mentionQuery]);
  function onCommentDraftChange(nextValue) {
    setCommentDraft(nextValue);
    const head = nextValue.slice(0, nextValue.length);
    const match = head.match(/(?:^|\s)@([^\s@]{0,32})$/);
    if (match) {
      setMentionQuery(match[1] || "");
      setShowMentionDropdown(true);
    } else {
      setShowMentionDropdown(false);
      setMentionQuery("");
    }
  }
  function applyMention(candidate) {
    const src = String(commentDraft || "");
    const replaced = src.replace(/(?:^|\s)@([^\s@]{0,32})$/, (m) => {
      const lead = m.startsWith(" ") ? " " : "";
      return `${lead}@${candidate.name} `;
    });
    setCommentDraft(replaced);
    setCommentMentionIds((prev) => Array.from(new Set([...(prev || []), Number(candidate.tg_id)])).slice(0, 10));
    setShowMentionDropdown(false);
    setMentionQuery("");
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
const yesPosById = React.useMemo(() => {
  const m = new Map();
  for (const x of rsvps || []) {
    if ((x?.status || "maybe") !== "yes") continue;
    m.set(String(x.tg_id), String(x.position || x.profile_position || "F").toUpperCase());
  }
  return m;
}, [rsvps]);
const teamsWithActualPos = React.useMemo(() => {
  if (!teams?.ok) return teams;
  const patchPos = (p) => {
    const id = String(p?.tg_id ?? "");
    const livePos = yesPosById.get(id);
    if (!livePos) return p;
    return { ...p, position: livePos };
  };
  return {
    ...teams,
    teamA: (teams.teamA || []).map(patchPos),
    teamB: (teams.teamB || []).map(patchPos),
  };
}, [teams, yesPosById]);
const teamsLocked = !!teamsWithActualPos?.meta?.locked;
  // ВНИМАНИЕ: прошедшие теперь показываем не из games, а из pastPage (загружаем постранично)
  const listToShow = showPast ? pastPage : upcomingGames;
  useEffect(() => {
    if (tab !== "game" || gameView !== "list") return;
    const cards = Array.from(document.querySelectorAll('.gameCard[data-scroll-enter="1"]'));
    if (!cards.length) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      cards.forEach((card) => card.classList.add("isVisible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("isVisible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" }
    );
    cards.forEach((card) => {
      if (card.classList.contains("isVisible")) return;
      observer.observe(card);
    });
    return () => observer.disconnect();
  }, [tab, gameView, showPast, games, pastPage]);
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
  function tgConfirm({ title, message, okText = "OK", cancelText = "Отмена" }) {
  const tg = window.Telegram?.WebApp;
  // вне Telegram — рисуем свой модал
  if (!inTelegramWebApp || !tg?.showPopup) {
    return openWebPopup({
      title,
      message,
      buttons: [
        { id: "cancel", type: "cancel", text: cancelText },
        { id: "ok", type: "default", text: okText },
      ],
    }).then((r) => r?.id === "ok");
  }
  return new Promise((resolve) => {
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
  });
}
function tgAlert({ title, message, okText = "OK" }) {
  const tg = window.Telegram?.WebApp;
  // вне Telegram — рисуем свой модал
  if (!inTelegramWebApp || !tg?.showPopup) {
    return openWebPopup({
      title,
      message,
      buttons: [{ id: "ok", type: "ok", text: okText }],
    }).then(() => {});
  }
  return new Promise((resolve) => {
    tg.showPopup(
      { title, message, buttons: [{ id: "ok", type: "ok", text: okText }] },
      () => resolve()
    );
  });
}
function formatJerseySummary(d) {
  const name = (d?.name_on_jersey || "").trim() || "без надписи";
  const num = d?.jersey_number ?? "без номера";
  const size = (d?.jersey_size || "").trim() || "—";
  const colors = (d?.jersey_colors || []).join(" + ") || "—";
  const socks = d?.socks_needed
    ? `\nГамаши: ${(d?.socks_colors || []).join(" + ") || "—"} · ${d?.socks_size || "adult"}`
    : "";
  return `Надпись: ${name}\nНомер: ${num}\nРазмер: ${size}\nЦвет: ${colors}${socks}`;
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
  if (!inTelegramWebApp && !hasWebAuth) {
    return (
      <div className="container">
        <h1 className="mainTitle">🏒 Хоккей: отметки и составы</h1>
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
    {!inTelegramWebApp && (
      <div className="webThemeDock" role="region" aria-label="Тема (веб)">
        <div className="webThemeDock__panel">
          <button
            type="button"
            className={`themeSwitch themeSwitch--compact ${webTheme === "dark" ? "is-dark" : "is-light"}`}
            role="switch"
            aria-checked={webTheme === "dark"}
            aria-label={webTheme === "dark" ? "Переключить на светлую тему" : "Переключить на тёмную тему"}
            onClick={() => setWebTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            <span className="themeSwitch__track" aria-hidden="true">
              <span className="themeSwitch__icon themeSwitch__icon--sun" aria-hidden="true">☀️</span>
              <span className="themeSwitch__icon themeSwitch__icon--moon" aria-hidden="true">🌙</span>
              <span className="themeSwitch__thumb" aria-hidden="true">
                <span className="themeSwitch__thumbIcon" aria-hidden="true">
                  {webTheme === "dark" ? "🌙" : "☀️"}
                </span>
              </span>
            </span>
          </button>
        </div>
      </div>
    )}
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
                    <div className="bulkRsvpRow" style={{ marginTop: 10 }}>
                      <button
                        className="bulkRsvpBtn in"
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
                        👍 IN на все
                      </button>
                      
                      <button
                        className="bulkRsvpBtn out"
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
                        🚫 OUT на все
                      </button>
                    </div>
                  )}
                    {listToShow.map((g, idx) => {
                      const { isPast, isFinished } = gameFlags(g.starts_at);
                    const past = isPast; // для класса/стайла "прошедшая" (после 00:00)
                    const lockRsvp = isFinished && !isAdmin; // блокируем RSVP через 2 часа после начала
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
                          className={`card gameCard scrollEnter ${tone} status-${status} ${isNext ? "isNext" : ""} ${past ? "isPast" : ""}`}
                          style={{
                            "--enter-delay": `${Math.min(idx, 10) * 70}ms`,
                            cursor: "pointer",
                            opacity: past ? 0.85 : 1,
                            backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,.65)), url(${bgUrl})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            backgroundRepeat: "no-repeat",
                          }}
                          data-scroll-enter="1"
                          onClick={() => openGameDetail(g.id)}
                            // onClick={() => {
                            //   const id = g.id;
                            //   setSelectedGameId(id);
                            //   setGameView("detail");
                            //   // Сброс "хвостов" прежней деталки (чтобы не мигало старым)
                            //   setGame(null);
                            //   setRsvps([]);
                            //   setTeams(null);
                            //   setDetailLoading(true);
                            //  Promise.all([refreshGameOnly(id)])
                            //       .then(() => refreshCommentsOnly(id))
                            //       .catch(console.error)
                            //       .finally(() => setDetailLoading(false));
                            // }}
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
                                {(() => {
                                  const cc = g.comments_count ?? 0;
                                  return (
                                    <span
                                      className="gameCard__pill"
                                      title={cc > 0 ? "Комментарии" : "Обсудить"}
                                      style={{ cursor: "pointer" }}
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openGameDetail(g.id, "comments");
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          openGameDetail(g.id, "comments");
                                        }
                                      }}
                                    >
                                      💬 {cc > 0 ? cc : "Обсудить"}
                                    </span>
                                  );
                                })()}
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
                              {g.notice_text ? (
                                <div className="gameNoticeInline" onClick={(e) => e.stopPropagation()}>
                                  <span className="gameNoticeInline__icon" aria-hidden="true">ℹ️</span>
                                  <span className="gameNoticeInline__text">{g.notice_text}</span>
                                  {isAdmin ? (
                                    <button
                                      className="iconBtn gameNoticeInline__edit"
                                      type="button"
                                      title="Изменить важную заметку"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openGameSheet(g);
                                      }}
                                    >
                                      ✏️
                                    </button>
                                  ) : null}
                                </div>
                              ) : isAdmin ? (
                                <button
                                  className="btn secondary"
                                  style={{ marginTop: 10 }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openGameSheet(g);
                                  }}
                                  title="Добавить важную заметку"
                                >
                                  ➕ Важно
                                </button>
                              ) : null}
                        </div>
                      );
                    })}
                      {showPast ? (
                        <div style={{ marginTop: 8 }}>
                          {/* Лоадер снизу при автоподгрузке */}
                          {pastLoading ? (
                            <div className="small" style={{ opacity: 0.8, textAlign: "center", padding: "6px 0" }}>
                              Загружаю…
                            </div>
                          ) : null}
                          {/* Кнопка как fallback (если auto-load не сработал/не хочется скроллить) */}
                          {!pastLoading && pastPage.length < pastTotal ? (
                            <div className="row" style={{ justifyContent: "center" }}>
                              <button className="btn secondary" onClick={() => loadPast(false)}>
                                Показать ещё 10
                              </button>
                            </div>
                          ) : null}
                          {/* Сообщение “больше нет” */}
                          {!pastLoading && pastTotal > 0 && pastPage.length >= pastTotal ? (
                            <div className="small" style={{ opacity: 0.7, textAlign: "center", padding: "8px 0" }}>
                              Игр больше нет.
                            </div>
                          ) : null}
                          {/* Sentinel для IntersectionObserver */}
                          <div ref={pastSentinelRef} style={{ height: 1 }} />
                        </div>
                      ) : null}
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
                  const { isPast, isFinished } = gameFlags(game?.starts_at);
                  const past = isPast; // если где-то дальше понадобится для UI
                  const lockRsvp = isFinished && !isAdmin;
                  const bestCandidates = (rsvps || []).filter((p) => p.status === "yes");
                  return (
                    <>
                        <div className="gameHero">
                          <div className="gameHero__top">
                            <div className="gameHero__when">
                              <span className="gameHero__whenIcon" aria-hidden="true">🗓</span>
                              <span>{formatWhen(game.starts_at)}</span>
                            </div>
                            {isAdmin ? (
                              <button
                                className="iconBtn gameHero__settings"
                                type="button"
                                title="Настройки игры"
                                onClick={() => openGameSheet(game)}
                              >
                                <span aria-hidden="true">⚙️</span>
                              </button>
                            ) : null}
                          </div>
                          <div className="gameHero__mid">
                            <div className="gameHero__where">
                              <span className="gameHero__whereIcon" aria-hidden="true">📍</span>
                              <span className="gameHero__whereText">{game.location || "—"}</span>
                            </div>
                            <span className="gameHero__status">
                              {uiStatus(game)}
                            </span>
                          </div>
                          {(game.geo_lat != null && game.geo_lon != null) || game.video_url ? (
                            <div className="gameHero__actions">
                              {game.geo_lat != null && game.geo_lon != null ? (
                                <button
                                  className="btn secondary gameHero__actionBtn"
                                  onClick={() => openYandexRoute(game.geo_lat, game.geo_lon)}
                                  title="Построить маршрут"
                                >
                                  <img className="yandexNavIcon" src={yandexNavIcon} alt="" aria-hidden="true" />
                                  Маршрут
                                </button>
                              ) : null}
                              {game.video_url ? (
                                <button
                                  className="btn secondary gameHero__actionBtn"
                                  onClick={() => (tg?.openLink ? tg.openLink(game.video_url) : window.open(game.video_url, "_blank"))}
                                >
                                  ▶️ Видео
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {myRsvp ? (
                            <div className="gameHero__my">
                              <span className="gameHero__myLabel">Мой статус</span>
                              <span className="gameHero__myValue">{statusLabel(myRsvp)}</span>
                            </div>
                          ) : null}
                        </div>
                        {game.notice_text ? (
                          <div className="gameNoticeBlock">
                            <span className="gameNoticeBlock__icon" aria-hidden="true">⚠️</span>
                            <div className="gameNoticeBlock__body">
                              <div className="gameNoticeBlock__title">Важно</div>
                              <div className="gameNoticeBlock__text">{game.notice_text}</div>
                            </div>
                          {isAdmin ? (
                                  <button
                                    className="iconBtn"
                                    type="button"
                                    title="Редактировать"
                                    onClick={() => openGameSheet(game)}
                                  >
                                    ✏️
                                  </button>
                                ) : null}
                              </div>
                            ) : isAdmin ? (
                              <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => openGameSheet(game)}>
                                ➕ Добавить “Важно”
                              </button>
                            ) : null}
                            {game.info_text ? (
                              <div className="card" style={{ marginTop: 12 }}>
                                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                                  <h3 style={{ margin: 0 }}>ℹ️ Важная информация</h3>
                                  {isAdmin ? (
                                    <button className="iconBtn" type="button" title="Редактировать" onClick={() => openGameSheet(game)}>
                                      ✏️
                                    </button>
                                  ) : null}
                                </div>
                                <div className="small" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                                  {game.info_text}
                                </div>
                              </div>
                            ) : isAdmin ? (
                              <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => openGameSheet(game)}>
                                ➕ Добавить подробности
                              </button>
                            ) : null}
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
                      <hr />
                                  <div ref={commentsBlockRef} />
                                  <div className="card" ref={commentsCardRef}>
                                    <div className="rowBetween">
                                      <h3 style={{ margin: 0 }}>💬 Комментарии</h3>
                                      <span className="badgeMini">{comments.length}</span>
                                    </div>
                                    {commentsLoading ? (
                                      <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>Загружаю комментарии…</div>
                                    ) : null}
                                    {commentReplyTo ? (
                                      <div className="commentReplyBar">
                                        <div>
                                          ↪️ Ответ: <b>{commentReplyTo?.author?.display_name || commentReplyTo?.author?.first_name || "Игрок"}</b>
                                          <div className="small">{String(commentReplyTo?.body || "").slice(0, 120)}</div>
                                        </div>
                                        <button className="iconBtn" type="button" onClick={() => setCommentReplyTo(null)}>✕</button>
                                      </div>
                                    ) : null}
                                    {commentMentionIds.length ? (
                                      <div className="commentMentionChips">
                                        {commentMentionIds.map((id) => {
                                          const p = (rsvps || []).find((x) => String(x.tg_id) === String(id));
                                          const nm = p ? displayName(p) : String(id);
                                          return (
                                            <span key={id} className="reactChip on" style={{ cursor: "pointer" }} onClick={() => setCommentMentionIds((prev) => prev.filter((x) => String(x) !== String(id)))}>
                                              @{nm} ✕
                                            </span>
                                          );
                                        })}
                                      </div>
                                    ) : null}
                                    <div className="commentComposer" style={{ marginTop: 10 }}>
                                      <textarea
                                        className="commentComposer__input"
                                        rows={1}
                                        value={commentDraft}
                                        onChange={(e) => onCommentDraftChange(e.target.value)}
                                        onInput={(e) => {
                                          e.currentTarget.style.height = "0px";
                                          e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 140)}px`;
                                        }}
                                        placeholder={commentEditId ? "Редактируешь…" : "Сообщение…"}
                                        maxLength={800}
                                      />
                                      <button
                                        className="commentComposer__send"
                                        disabled={commentBusy || !String(commentDraft || "").trim()}
                                        onClick={submitComment}
                                        type="button"
                                        title={commentEditId ? "Сохранить" : "Отправить"}
                                      >
                                        {commentBusy ? "⏳" : (commentEditId ? "✅" : "➤")}
                                      </button>
                                    </div>
                                    {showMentionDropdown && !commentEditId ? (
                                      <div className="commentMentionDropdown">
                                        {mentionCandidates.length === 0 ? (
                                          <div className="small" style={{ padding: 8 }}>Никого не нашёл</div>
                                        ) : mentionCandidates.map((cand) => (
                                          <button key={cand.tg_id} className="commentMentionItem" type="button" onClick={() => applyMention(cand)}>
                                            @{cand.name}
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                    {commentEditId ? (
                                      <div className="commentEditBar">
                                        <span>Редактирование комментария</span>
                                        <button
                                          className="btn secondary"
                                          disabled={commentBusy}
                                          onClick={() => { setCommentEditId(null); setCommentDraft(""); setCommentReplyTo(null); setCommentMentionIds([]); }}
                                          type="button"
                                        >
                                          Отмена
                                        </button>
                                      </div>
                                    ) : null}
                                    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                                      {!commentsLoading && comments.length === 0 ? (
                                        <div className="small" style={{ opacity: 0.8 }}>Комментариев пока нет.</div>
                                      ) : comments.map((c, idx) => {
                                          const myId = String(me?.id ?? me?.tg_id ?? "");
                                          const isMine = String(c.author_tg_id) === myId;
                                          const author = c.author || {};
                                          const canEdit = isMine;
                                          const canDelete = isAdmin || isMine;
                                          
                                          const authorName =
                                            author?.display_name ||
                                            author?.first_name ||
                                            (author?.username ? `@${author.username}` : String(c.author_tg_id));
                                          
                                          const avatarUrl = (author.photo_url || "").trim();
                                          const createdMs = c.created_at ? new Date(c.created_at).getTime() : 0;
                                          const updatedMs = c.updated_at ? new Date(c.updated_at).getTime() : 0;
                                          const edited = !!(updatedMs && createdMs && updatedMs - createdMs > 5000);
                                          const GROUP_MS = 5 * 60 * 1000; // окно группировки (5 минут)
                                          const prev = comments[idx - 1];
                                          const next = comments[idx + 1];
                                          const canGroupWith = (a, b) => {
                                            if (!a || !b) return false;
                                            // закреплённые не группируем, чтобы не ломать логику
                                            if (a.is_pinned || b.is_pinned) return false;
                                            const aId = String(a.author_tg_id ?? "");
                                            const bId = String(b.author_tg_id ?? "");
                                            if (!aId || aId !== bId) return false;
                                            const am = a.created_at ? new Date(a.created_at).getTime() : 0;
                                            const bm = b.created_at ? new Date(b.created_at).getTime() : 0;
                                            if (!am || !bm) return false;
                                            return Math.abs(am - bm) <= GROUP_MS;
                                          };
                                          const prevSame = canGroupWith(prev, c);
                                          const nextSame = canGroupWith(c, next);
                                          // Telegram-like: аватар + хвостик на последнем сообщении блока
                                          const showAvatar = !prevSame;
                                          const showHead = !prevSame; // имя/время показываем только в начале блока
                                          const showTail = !prevSame;
                                          const reactions = Array.isArray(c.reactions) ? c.reactions : [];
                                          return (
                                            <div
                                              key={c.id}
                                              className={`cmtRow ${isMine ? "mine" : ""} ${prevSame ? "contPrev" : ""} ${nextSame ? "contNext" : ""} ${showTail ? "tail" : ""} ${c._pending ? "pending" : ""} ${flashId === c.id ? "flash" : ""} ${c.is_pinned ? "pinned" : ""}`}
                                            >
                                              {/* AVATAR LEFT for others */}
                                              {!isMine ? (
                                                <div className={`cmtAvatar ${showAvatar ? "" : "ghost"}`}>
                                                  {showAvatar ? <AvatarCircle url={avatarUrl} name={authorName} /> : null}
                                                </div>
                                              ) : null}
                                              {/* BUBBLE */}
                                              <div className="cmtBubble">
                                                {c.is_pinned ? <span className="cmtPinTag">📌 закреплено</span> : null}
                                                  {showHead || c.is_pinned ? (
                                                    <div className="cmtHead">
                                                      <div className="cmtAuthor">{isMine ? "Я" : authorName}</div>
                                                      <div className="cmtMeta">
                                                        {new Date(c.created_at).toLocaleString("ru-RU", {
                                                          day: "2-digit",
                                                          month: "2-digit",
                                                          hour: "2-digit",
                                                          minute: "2-digit",
                                                        })}
                                                        {edited ? " · изменено" : ""}
                                                      </div>
                                                    </div>
                                                  ) : (
                                                    <div className="cmtMetaOnly">
                                                      {new Date(c.created_at).toLocaleString("ru-RU", {
                                                        day: "2-digit",
                                                        month: "2-digit",
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                      })}
                                                      {edited ? " · изменено" : ""}
                                                    </div>
                                                  )}
                                                {c.reply_to_preview ? (
                                                  <div className="cmtReplyPreview">
                                                    <b>{c.reply_to_preview.author_name}</b>: {c.reply_to_preview.excerpt}
                                                  </div>
                                                ) : null}
                                                <div className="cmtText">{c.body}</div>
                                                <div className="cmtActions">
                                                  {isAdmin ? (
                                                        <button
                                                          className="iconBtn"
                                                          type="button"
                                                          title={c.is_pinned ? "Открепить" : "Закрепить"}
                                                          disabled={commentBusy}
                                                          onClick={() => togglePin(c.id, !c.is_pinned)}
                                                        >
                                                          {c.is_pinned ? "📌" : "📍"}
                                                        </button>
                                                      ) : null}
                                                  {reactions.map((r) => (
                                                    <button
                                                      key={r.emoji}
                                                      className={r.my ? "reactChip on" : "reactChip"}
                                                      disabled={commentBusy}
                                                      onClick={() => toggleReaction(c.id, r.emoji, !r.my)}
                                                      type="button"
                                                    >
                                                      {r.emoji} <b>{r.count}</b>
                                                    </button>
                                                  ))}
                                                  <button
                                                    className="reactChip add"
                                                    type="button"
                                                    onClick={() => openReactPicker(c.id)}
                                                    disabled={commentBusy}
                                                    title="Добавить реакцию"
                                                  >
                                                    ➕
                                                  </button>
                                                  <button
                                                    className="iconBtn"
                                                    type="button"
                                                    title="Ответить"
                                                    onClick={() => {
                                                      setCommentReplyTo(c);
                                                      setCommentEditId(null);
                                                      setCommentDraft("");
                                                    }}
                                                  >
                                                    ↪️
                                                  </button>
                                                  <div style={{ flex: 1 }} />
                                                  {canEdit ? (
                                                    <button
                                                      className="iconBtn"
                                                      type="button"
                                                      title="Редактировать"
                                                      onClick={() => {
                                                        setCommentEditId(c.id);
                                                        setCommentDraft(c.body || "");
                                                        setCommentReplyTo(null);
                                                        setCommentMentionIds([]);
                                                      }}
                                                    >
                                                      ✏️
                                                    </button>
                                                  ) : null}
                                                  {canDelete ? (
                                                    <button
                                                      className="iconBtn"
                                                      type="button"
                                                      title="Удалить"
                                                      onClick={() => removeComment(c.id)}
                                                    >
                                                      🗑️
                                                    </button>
                                                  ) : null}
                                                </div>
                                              </div>
                                              {/* AVATAR RIGHT for mine */}
                                                {isMine ? (
                                                  <div className={`cmtAvatar ${showAvatar ? "" : "ghost"}`}>
                                                    {showAvatar ? (
                                                      <AvatarCircle
                                                        url={avatarUrl}
                                                        fallbackUrl={(author?.photo_url_fallback || "").trim()}
                                                        name={authorName}
                                                      />
                                                    ) : null}
                                                  </div>
                                                ) : null}
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </div>
                                          {reactPickFor ? (
                                            <div className="reactOverlay" onClick={() => setReactPickFor(null)}>
                                              <div className="reactModal" onClick={(e) => e.stopPropagation()}>
                                                 <div className="reactWhoBlock">
                                                    <div className="reactWhoTitle">Кто поставил реакции
                                                      <button
                                                        className="reactCloseBtn"
                                                        type="button"
                                                        onClick={() => setReactPickFor(null)}
                                                        aria-label="Close"
                                                        title="Закрыть"
                                                      >
                                                        ✕
                                                      </button>
                                                    </div>
                                                    {!reactWhoCanView ? (
                                                      <div className="reactLock">
                                                        <div className="small" style={{ opacity: 0.85 }}>
                                                          🔒 Доступно только для <b>🌟 Премиум</b>
                                                        </div>
                                                        <button
                                                          className="btn secondary"
                                                          style={{ marginTop: 8, width: "100%" }}
                                                          onClick={() => {
                                                            setReactPickFor(null);
                                                            setTab("profile");
                                                            setProfileView("thanks");
                                                          }}
                                                          type="button"
                                                        >
                                                          Получить Премиум 😄
                                                        </button>
                                                      </div>
                                                    ) : reactWhoLoading ? (
                                                      <div className="small" style={{ opacity: 0.8 }}>Загружаю…</div>
                                                    ) : reactWhoList.length === 0 ? (
                                                      <div className="small" style={{ opacity: 0.8 }}>Реакций на комментарий нет.</div>
                                                    ) : (
                                                      <div className="reactWhoList">
                                                        {reactWhoList.map((it) => {
                                                          const u = it.user || {};
                                                          const name =
                                                            u.display_name || u.first_name || (u.username ? `@${u.username}` : String(u.tg_id || ""));
                                                          return (
                                                            <div key={String(u.tg_id)} className="reactWhoRow">
                                                              <AvatarCircle url={(u.photo_url || "").trim()} name={name} />
                                                              <div className="reactWhoName">{name}</div>
                                                              <div className="reactEmojiStack" title={(it.emojis || []).join(" ")}>
                                                                {(it.emojis || []).map((e, idx) => (
                                                                  <span
                                                                    key={`${e}-${idx}`}
                                                                    className="reactEmoji"
                                                                    style={{ zIndex: 50 - idx }}
                                                                  >
                                                                    {e}
                                                                  </span>
                                                                ))}
                                                              </div>
                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    )}
                                                  </div>
                                                  <div className="reactDivider" />
                                                <div className="reactGrid">
                                                  {REACTIONS.map((emo) => (
                                                    <button
                                                      key={emo}
                                                      className="reactPickBtn"
                                                      onClick={() => {
                                                        const c = comments.find(x => x.id === reactPickFor);
                                                        const found = (c?.reactions || []).find(r => r.emoji === emo);
                                                        toggleReaction(reactPickFor, emo, !(found?.my));
                                                        setReactPickFor(null);
                                                      }}
                                                    >
                                                      {emo}
                                                    </button>
                                                  ))}
                                                </div>
                                                <button className="btn secondary" style={{ marginTop: 10, width: "100%" }} onClick={() => setReactPickFor(null)}>
                                                  Закрыть
                                                </button>
                                              </div>
                                            </div>
                                          ) : null}
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
          {!!me?.disabled && !isAdmin && (
            <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
              ⚠️ Ваш аккаунт сейчас неактивен. Доступен только раздел профиля.
            </div>
          )}
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
                  placeholder={me?.first_name || "Например: ALEXANDER"}
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
                  placeholder="Например: 8"
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
              <div className="card" style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 800 }}>📧 Почта для входа</div>
                <div className="small" style={{ opacity: 0.85, marginTop: 6 }}>
                  {me?.email
                    ? (me?.email_verified ? "Текущая почта подтверждена" : "Текущая почта не подтверждена")
                    : "Почта не привязана"}
                </div>
                {me?.email ? (
                  <div className="small" style={{ marginTop: 8 }}>
                    Активная почта: <b>{me.email}</b>
                  </div>
                ) : null}
                {me?.pending_email ? (
                  <div className="small" style={{ marginTop: 6 }}>
                    Ожидает подтверждения: <b>{me.pending_email}</b> (до подтверждения вход остаётся по старой почте)
                  </div>
                ) : null}
                {(!me?.email || emailEditMode) ? (
                  <div style={{ marginTop: 10 }}>
                    <label>{me?.email ? "Новая почта" : "Почта"}</label>
                    <input
                      className="input"
                      type="email"
                      placeholder="name@example.com"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      disabled={emailBusy}
                    />
                  </div>
                ) : null}
                {emailMsg ? <div className="small" style={{ marginTop: 8 }}>{emailMsg}</div> : null}
                <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                  {me?.email && !emailEditMode ? (
                    <button
                      className="btn secondary"
                      onClick={() => {
                        setEmailEditMode(true);
                        setEmailDraft("");
                        setEmailMsg("");
                      }}
                      disabled={emailBusy}
                    >
                      Изменить почту
                    </button>
                  ) : (
                    <>
                      <button className="btn secondary" onClick={sendEmailVerification} disabled={emailBusy || !emailDraft.trim()}>
                        {me?.email ? "Подтвердить новую почту" : "Отправить подтверждение"}
                      </button>
                      {me?.email ? (
                        <button
                          className="btn ghost"
                          onClick={() => {
                            setEmailEditMode(false);
                            setEmailDraft(me?.pending_email || me?.email || "");
                            setEmailMsg("");
                          }}
                          disabled={emailBusy}
                        >
                          Отмена
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
                <>
                      {!inTelegramWebApp && getAuthToken() ? (
                        <div className="card" style={{ marginTop: 12 }}>
                          <div style={{ fontWeight: 800 }}>🌐 Веб-версия</div>
                          <div className="small" style={{ opacity: 0.85, marginTop: 6 }}>
                            Вы вошли через браузер. При выходе токен будет удалён.
                            В следующий раз потребуется вход по коду.
                          </div>
                          <div className="row" style={{ marginTop: 10 }}>
                            <button className="btn secondary" onClick={() => setConfirmOpen(true)}>
                              🚪 Выйти
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {confirmOpen ? (
                        <div
                          role="dialog"
                          aria-modal="true"
                          onClick={() => setConfirmOpen(false)}
                          style={{
                            position: "fixed",
                            inset: 0,
                            background: "rgba(0,0,0,0.55)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 16,
                            zIndex: 9999,
                          }}
                        >
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: "min(520px, 100%)",
                              borderRadius: 16,
                              background: "rgba(20, 24, 40, 0.98)",
                              border: "1px solid rgba(255,255,255,0.10)",
                              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
                              padding: 16,
                            }}
                          >
                            <div style={{ fontWeight: 900, fontSize: 16 }}>Выйти из веб-версии?</div>
                            <div style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.4 }}>
                              Токен будет удалён с этого устройства.
                              <br />
                              <b>В следующий раз нужно будет войти по 6-значному коду.</b>
                            </div>
                            <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
                              <button className="btn secondary" onClick={() => setConfirmOpen(false)}>
                                Отмена
                              </button>
                              <button className="btn" onClick={logoutWebConfirmed}>
                                Выйти
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={saveProfile} disabled={saving}>
                  {saving ? "Сохраняю..." : "Сохранить"}
                </button>
              </div>
              <div className="card jerseyCard">
                        <div className="jerseyHeader">
                          <div className="jerseyTitle">
                            <h2>👕 Командная форма</h2>
                            <div className="jerseySub small">
                              {jerseyOpenBatch?.id ? (
                                <span className="badge badge--ok">
                                  🟢 Сбор открыт{jerseyOpenBatch.title ? `: ${jerseyOpenBatch.title}` : ""}
                                </span>
                              ) : (
                                <span className="badge badge--off">🔴 Сбор закрыт</span>
                              )}
                            </div>
                            {jerseyMsg ? <div className="jerseyNotice small">{jerseyMsg}</div> : null}
                          </div>
                          <div className="jerseyActions">
                            <button className="btn secondary" onClick={loadJerseyRequests} disabled={jerseyBusy}>
                              Обновить
                            </button>
                            <button className="btn" onClick={newJerseyReq} disabled={jerseyBusy}>
                              ➕ Новая заявка
                            </button>
                          </div>
                        </div>
                        <div className="jerseyBody">
                          {/* ===== LEFT: список заявок ===== */}
                          <section className="jerseySection">
                            <div className="jerseySectionHead">
                              <h3>Мои заявки</h3>
                              <div className="small" style={{ opacity: 0.8 }}>
                                {jerseyReqs.length ? `Всего: ${jerseyReqs.length}` : ""}
                              </div>
                            </div>
                            {jerseyReqs.length === 0 ? (
                              <div className="small" style={{ opacity: 0.8 }}>Пока заявок нет.</div>
                            ) : (
                              <div className="jerseyReqGrid">
                                {jerseyReqs.map((r) => {
                                  const active = String(jerseyActiveId) === String(r.id);
                                  const colorStr = (r.jersey_colors || []).join(" + ") || "—";
                                  const dt = r.sent_at || r.updated_at;
                                  return (
                                    <button
                                      key={r.id}
                                      type="button"
                                      onClick={() => pickJerseyReq(r)}
                                      className={`jerseyReqItem ${active ? "isActive" : ""}`}
                                    >
                                      <div className="jerseyReqTop">
                                        <div className="left">
                                          #{r.id} · {r.status === "sent" ? "📨 отправлено" : "📝 черновик"}
                                        </div>
                                        <div className="right small">
                                          {dt ? new Date(dt).toLocaleString("ru-RU") : ""}
                                        </div>
                                      </div>
                                      <div className="jerseyReqText small">
                                        <b>{r.name_on_jersey || "без надписи"}</b> · № <b>{r.jersey_number ?? "без номера"}</b> · размер{" "}
                                        <b>{r.jersey_size || "—"}</b>
                                        <br />
                                        цвет: <b>{colorStr}</b>
                                        {r.socks_needed ? (
                                          <>
                                            <br />
                                            гамаши: <b>{(r.socks_colors || []).join(" + ") || "—"}</b> ·{" "}
                                            <b>{r.socks_size || "adult"}</b>
                                          </>
                                        ) : null}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                          {/* ===== RIGHT: форма ===== */}
                          <section className="jerseySection">
                            <div className="jerseySectionHead">
                              <h3>
                                {jerseyActiveId === "new" ? "Новая заявка" : `Заявка #${jerseyActiveId}`}
                                {jerseyActiveStatus === "sent" ? " (история)" : ""}
                              </h3>
                              {jerseyActiveStatus === "sent" ? (
                                jerseyCanEditSent ? (
                                  <span className="badge">🟢 Редактирование</span>
                                ) : (
                                  <span className="badge">📦 Архив</span>
                                )
                              ) : jerseyOpenBatch?.id ? (
                                <span className="badge">🟢 Редактирование</span>
                              ) : (
                                <span className="badge">🔴 Черновик</span>
                              )}
                            </div>
                            {!jerseyOpenBatch?.id ? (
                              <div className="small" style={{ opacity: 0.8 }}>
                                Сбор закрыт — можно подготовить черновик. Отправка появится, когда сбор откроют.
                              </div>
                            ) : null}
                            <div className="jerseyForm">
                              <div className="field">
                                <label>Имя на джерси</label>
                                <input
                                  className="input"
                                  value={jerseyDraft.name_on_jersey}
                                  onChange={(e) => setJerseyDraft((s) => ({ ...s, name_on_jersey: e.target.value }))}
                                  disabled={jerseyInputsDisabled}
                                  placeholder={`Например: ${jerseyNamePlaceholder}`}
                                />
                              </div>
                              <div className="field">
                                <label>Цвет джерси</label>
                                <div className="colorBtns">
                                  {JERSEY_COLOR_OPTS.map((c) => {
                                    const on = jerseyDraft.jersey_colors.includes(c.code);
                                    return (
                                      <button
                                        key={c.code}
                                        type="button"
                                        className={`colorBtn ${on ? "isActive" : ""}`}
                                        aria-pressed={on}
                                        onClick={() =>
                                          setJerseyDraft((s) => ({
                                            ...s,
                                            jersey_colors: toggleArr(s.jersey_colors, c.code),
                                          }))
                                        }
                                        disabled={jerseyInputsDisabled}
                                      >
                                        {c.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="form2">
                                <div className="field">
                                  <label>Номер</label>
                                  <input
                                    className="input"
                                    value={jerseyDraft.jersey_number}
                                    onChange={(e) => setJerseyDraft((s) => ({ ...s, jersey_number: e.target.value }))}
                                    disabled={jerseyInputsDisabled}
                                    placeholder={`Например: ${jerseyNumberPlaceholder}`}
                                  />
                                </div>
                                <div className="field">
                                  <label>Размер</label>
                                  <input
                                    className="input"
                                    value={jerseyDraft.jersey_size}
                                    onChange={(e) => setJerseyDraft((s) => ({ ...s, jersey_size: e.target.value }))}
                                    disabled={jerseyInputsDisabled}
                                    placeholder="Например: 50"
                                  />
                                </div>
                              </div>
                              <div className="field">
                                <label className="pill" style={{ width: "fit-content" }}>
                                  <input
                                    type="checkbox"
                                    checked={jerseyDraft.socks_needed}
                                    onChange={(e) => setJerseyDraft((s) => ({ ...s, socks_needed: e.target.checked }))}
                                    disabled={jerseyInputsDisabled}
                                  />
                                  Гамаши нужны
                                </label>
                              </div>
                              {jerseyDraft.socks_needed ? (
                                <>
                                  <div className="field">
                                    <label>Цвет гамаш</label>
                                    <div className="colorBtns">
                                      {JERSEY_COLOR_OPTS.map((c) => {
                                        const on = jerseyDraft.socks_colors.includes(c.code);
                                        return (
                                          <button
                                            key={c.code}
                                            type="button"
                                            className={`colorBtn ${on ? "isActive" : ""}`}
                                            aria-pressed={on}
                                            onClick={() =>
                                              setJerseyDraft((s) => ({
                                                ...s,
                                                socks_colors: toggleArr(s.socks_colors, c.code),
                                              }))
                                            }
                                            disabled={jerseyInputsDisabled}
                                          >
                                            {c.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <div className="field">
                                    <label>Размер гамаш</label>
                                    <select
                                      className="input"
                                      value={jerseyDraft.socks_size}
                                      onChange={(e) => setJerseyDraft((s) => ({ ...s, socks_size: e.target.value }))}
                                      disabled={jerseyInputsDisabled}
                                    >
                                      {SOCKS_SIZE_OPTS.map((x) => (
                                        <option key={x.code} value={x.code}>
                                          {x.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </>
                              ) : null}
                              <div className="jerseyBtnRow">
                                <button
                                  className="btn secondary"
                                  onClick={saveActiveJersey}
                                  disabled={jerseyInputsDisabled}
                                >
                                  💾 Сохранить
                                </button>
                                <button
                                  className="btn"
                                  onClick={sendActiveJersey}
                                  disabled={!jerseyOpenBatch?.id || jerseyActiveStatus === "sent" || jerseyBusy || jerseyActiveId === "new"}
                                >
                                  📨 Отправить
                                </button>
                                <button
                                  className="btn secondary"
                                  onClick={deleteActiveJersey}
                                  disabled={jerseyActiveStatus === "sent" || jerseyBusy}
                                >
                                  🗑 Удалить
                                </button>
                                {jerseyActiveStatus === "sent" && jerseyOpenBatch?.id ? (
                                  jerseyEditingSent ? (
                                    <button
                                      className="btn secondary"
                                      onClick={() => loadJerseyRequests()}
                                      disabled={jerseyBusy}
                                    >
                                      ↩️ Отмена
                                    </button>
                                  ) : (
                                    <button
                                      className="btn secondary"
                                      onClick={() => setJerseyEditingSent(true)}
                                      disabled={jerseyBusy}
                                    >
                                      ✏️ Изменить
                                    </button>
                                  )
                                ) : null}
                              </div>
                              {jerseySentAt ? (
                                <div className="small jerseyHint">
                                  Отправлено: {new Date(jerseySentAt).toLocaleString("ru-RU")}
                                </div>
                              ) : jerseyUpdatedAt ? (
                                <div className="small jerseyHint">
                                  Обновлено: {new Date(jerseyUpdatedAt).toLocaleString("ru-RU")}
                                </div>
                              ) : null}
                              {jerseyHistory?.length ? (
                                <details className="jerseyHistory" style={{ marginTop: 8 }}>
                                  <summary className="small" style={{ opacity: 0.9 }}>
                                    История прошлых сборов
                                  </summary>
                                  <div className="jerseyHistoryGrid">
                                    {jerseyHistory.map((b) => (
                                      <div key={b.batch_id} className="card" style={{ margin: 0 }}>
                                        <div style={{ fontWeight: 800 }}>
                                          {b.title || `Сбор #${b.batch_id}`}
                                        </div>
                                        <div className="small" style={{ opacity: 0.85, marginTop: 6 }}>
                                          {b.items?.map((it) => (
                                            <div key={it.id}>
                                              #{it.id}: <b>{it.name_on_jersey || "без надписи"}</b> · №{" "}
                                              <b>{it.jersey_number ?? "без номера"}</b> ·{" "}
                                              <b>{(it.jersey_colors || []).join(" + ")}</b>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              ) : null}
                            </div>
                          </section>
                        </div>
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
                      <h3 style={{ margin: 0 }}>Задонатить (шутка)</h3>
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
            title={!teams?.ok ? "Сначала сформируй составы" : "Изменить отправленный состав или отправить новый в чат"}
          >
            {teamsSendBusy ? "…" : "📣 Изменить/отправить составы в чат"}
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
      игроков изменилась позиция на эту игру. В списке составов ниже показаны уже актуальные
      позиции.
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
  </div>
)}
    {teamsWithActualPos?.ok ? (
      <>
        <hr />
        {/* если эти метрики тебе больше не нужны — просто удали этот блок */}
        <div className="row">
          <span className="badge">ΣA {Number(teamsWithActualPos.meta?.sumA ?? 0).toFixed(1)}</span>
          <span className="badge">ΣB {Number(teamsWithActualPos.meta?.sumB ?? 0).toFixed(1)}</span>
          <span className="badge">
            diff {Number(teamsWithActualPos.meta?.diff ?? 0).toFixed(1)}
            {Number(teamsWithActualPos.meta?.diff ?? 0) >= 3 ? " ⚠️" : ""}
          </span>
        </div>
        {isAdmin && (
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className={teamsLocked ? "btn" : "btn secondary"}
              onClick={() => toggleTeamsLock(!teamsLocked)}
              disabled={teamsBusy}
              title={teamsLocked ? "Составы зафиксированы" : "Составы можно менять"}
            >
              {teamsLocked ? "🔒" : "🔓"}
            </button>
            <button
              className={editTeams ? "btn" : "btn secondary"}
              onClick={() => {
                if (teamsLocked) {
                  setTeamsLockModalOpen(true);
                  return;
                }
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
        {renderTeam("A", "⬜ Белые", teamsWithActualPos.teamA || [])}
        <hr />
        {renderTeam("B", "🟦 Синие", teamsWithActualPos.teamB || [])}
      </>
    ) : (
      <div className="small" style={{ marginTop: 10 }}>
        Составов пока нет. Нажми “Сформировать сейчас”.
      </div>
    )}
  </div>
)}
{teamsLockModalOpen && (
  <div className="modalOverlay" onClick={() => setTeamsLockModalOpen(false)}>
    <div className="modalCard" onClick={(e) => e.stopPropagation()}>
      <h3 style={{ marginTop: 0 }}>Составы зафиксированы</h3>
      <div className="small" style={{ opacity: 0.95 }}>
        Составы сформированы окончательно. Для изменения составов разблокируй замок.
      </div>
      <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => setTeamsLockModalOpen(false)}>
          Понятно
        </button>
      </div>
    </div>
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
                          <Avatar
                            p={p}
                            big
                            fallbackUrl={player}
                            onClick={() => openPhotoModal(p)}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 900 }}>{showName(p)}</div>
                            <div className="small" style={{ opacity: 0.8 }}>
                              {posHuman(p.position)}
                            </div>
                          </div>
                        </div>
                        {isAdmin && p.last_seen_at ? (
                          <div className="row" style={{marginTop: 2 }}>
                              <div
                                className="small"
                                style={{
                                  marginTop: 6,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  border: "1px solid var(--border)",
                                  borderRadius: 999,
                                  padding: "3px 9px",
                                  opacity: 0.9,
                                }}
                              >
                                🕒 {formatLastSeenLabel(p.last_seen_at)}
                              </div>
                              </div>
                            ) : null}
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
                        <JerseyBadge number={showNum(selectedPlayer)} variant={selectedPlayer.position === "Вратарь" ? "goalie" : "classic"} striped size={34} />
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
                  {isOwner && Number(selectedPlayer.tg_id) > 0 && (
                    <PmBox player={selectedPlayer} />
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
{/* ===== WEB POPUP (fallback for tgPopup / tgSafeAlert outside Telegram) ===== */}
{webPopup && (
  <div
    className="modalOverlay"
    style={{ zIndex: 10050 }}
    onClick={() => {
                    const cancelId = (webPopup.buttons || []).find((b) => b?.type === "cancel")?.id;
                    closeWebPopup(cancelId || (webPopup.buttons || [])[0]?.id || "cancel");
                  }}
  >
    <div className="modalCard" onClick={(e) => e.stopPropagation()}>
      {webPopup.title ? <h3 style={{ margin: 0 }}>{webPopup.title}</h3> : null}
      <div
        className="small"
        style={{
          opacity: 0.92,
          marginTop: webPopup.title ? 6 : 0,
          whiteSpace: "pre-wrap",
        }}
      >
        {webPopup.message}
      </div>
      <div
        className="row"
        style={{
          marginTop: 14,
          gap: 8,
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        {(webPopup.buttons || []).map((b) => {
          const isCancel = b?.type === "cancel";
          return (
            <button
              key={b.id}
              className={`btn ${isCancel ? "secondary" : ""}`}
              onClick={() => closeWebPopup(b.id)}
            >
              {b.text}
            </button>
          );
        })}
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
              <button className="chatFab" type="button" onClick={openChatDrawer}>
                <span className="chatFabIcon" aria-hidden="true">💬</span>
                {chatUnreadTotal > 0 ? <span className="chatFabBadge">{chatUnreadTotal > 99 ? '99+' : chatUnreadTotal}</span> : null}
              </button>
              {chatVisible ? (
                <div
                  className={`chatDrawerOverlay ${chatOpen ? "isOpen" : ""}`}
                  onClick={closeChatDrawer}
                >
                  <div
                    className={`chatDrawer ${chatOpen ? "isOpen" : ""}`}
                    role="dialog"
                    aria-modal="true"
                    onClick={(e) => e.stopPropagation()}
                    onTransitionEnd={onChatDrawerTransitionEnd}
                  >
                    <div className="chatDrawerHead">
                      <div style={{ fontWeight: 900 }}>Чат</div>
                      <button type="button" className="btn secondary" onClick={closeChatDrawer}>✕</button>
                    </div>

                    <div className="chatTabs">
                      <button type="button" className={`btn ${chatTab === 'team' ? '' : 'secondary'}`} onClick={() => {
                        setChatTab('team');
                        setChatDmMenuOpen(false);
                      }}>Общий</button>
                      <button type="button" className={`btn ${chatTab === 'dm' ? '' : 'secondary'}`} onClick={() => setChatTab('dm')}>Личный</button>
                    </div>

                    {chatTab === 'team' ? (
                      <div className="chatSectionTitle">Общий чат команды</div>
                    ) : null}

                    {chatTab === 'dm' && !chatActiveCid ? (
                      <>
                        <div className="chatSectionTitle">Контакты</div>
                        <input
                          className="input"
                          placeholder="Поиск игрока по имени или @username"
                          value={chatPeerQuery}
                          onChange={(e) => setChatPeerQuery(e.target.value)}
                        />
                        <div className="chatDmList">
                          {(playersDir || [])
                            .filter((p) => String(p.tg_id) !== String(me?.tg_id))
                            .filter((p) => chatPeerSearchValue(p).includes(String(chatPeerQuery || '').trim().toLowerCase()))
                            .map((p) => {
                              const conv = (chatConversations || []).find((c) => c.kind === 'dm' && String(c?.peer?.tg_id) === String(p.tg_id));
                              const unread = Number(conv?.unread_count || 0);
                              const lastId = Number(conv?.last_message?.id || 0);
                              return { p, unread, lastId, conv };
                            })
                            .sort((a, b) => {
                              if (a.unread !== b.unread) return b.unread - a.unread;
                              if (a.lastId !== b.lastId) return b.lastId - a.lastId;
                              return showName(a.p).localeCompare(showName(b.p), 'ru', { sensitivity: 'base' });
                            })
                            .slice(0, 100)
                            .map(({ p, unread, conv }) => {
                              const lastText = String(conv?.last_message?.body || '').trim();
                              const hasLast = !!lastText;
                              return (
                                <button key={p.tg_id} className="chatDmItem" type="button" onClick={() => openDmWithPeer(p.tg_id)}>
                                  <div className="chatDmItemMain">
                                    <AvatarCircle tgId={p.tg_id} url={(p.photo_url || "").trim()} name={showName(p)} size={42} />
                                    <div className="chatDmMeta">
                                      <div className="chatDmTop">
                                        <span className="chatDmName">{showName(p)}</span>
                                        {conv?.last_message?.created_at ? <span className="chatDmTime">{formatChatMsgTime(conv.last_message.created_at)}</span> : null}
                                      </div>
                                      <div className="chatDmSubline">
                                        <span className="small" style={{ opacity: 0.75 }}>{p.username ? `@${p.username}` : ''}</span>
                                        {hasLast ? <span className="chatDmPreview">{lastText}</span> : null}
                                      </div>
                                    </div>
                                  </div>
                                  {unread > 0 ? (
                                    <span className="chip active chatUnreadChip">{unread}</span>
                                  ) : null}
                                </button>
                              );
                            })}
                        </div>
                      </>
                    ) : null}

                    {chatTab === 'dm' && chatActiveCid ? (
                      <div className="chatDmHeaderWrap">
                        <div className="chatDmHeaderMain">
                          <AvatarCircle tgId={chatDmPeer?.tg_id} url={(chatDmPeer?.photo_url || '').trim()} name={showName(chatDmPeer || {})} size={42} />
                          <div className="chatDmHeaderTitleWrap">
                            <div className="chatDmHeaderName">{showName(chatDmPeer || {})}</div>
                            {isAdmin && chatDmPeer?.last_seen_at ? (
                              <div className="chatDmHeaderSeen">{formatLastSeenLabel(chatDmPeer.last_seen_at)}</div>
                            ) : null}
                          </div>
                          <button type="button" className="btn secondary" onClick={() => {
                            setChatDmMenuOpen(false);
                            setChatActiveCid(null);
                            setChatDmPeer(null);
                            setChatMessages([]);
                            chatLastMessageIdRef.current = 0;
                          }}>
                            ← Назад
                          </button>
                        </div>
                        <div className="chatDmHeaderActions">
                          <button type="button" className="chatMenuBtn" onClick={() => setChatDmMenuOpen((v) => !v)}>⋯</button>
                          {chatDmMenuOpen ? (
                            <div className="chatDmMenu">
                              <button type="button" className="btn secondary" onClick={clearActiveDm}>Очистить историю</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="chatMessages">
                      {chatMessages.map((m) => {
                        const mine = String(m.sender_tg_id) === String(me?.tg_id);
                        const senderName = mine ? 'Вы' : showName(m.sender || {});
                        const senderPhoto = (m?.sender?.photo_url || '').trim();
                        return (
                          <div key={m.id} className={`cmtRow ${mine ? 'mine' : ''}`}>
                            {!mine ? (
                              <div className="chatMsgAvatar">
                                <AvatarCircle tgId={m.sender_tg_id} url={senderPhoto} name={senderName} size={30} />
                              </div>
                            ) : null}
                            <div className="cmtBubble">
                              <div className="chatMsgHead">
                                <div className="small" style={{ opacity: 0.85 }}>{senderName}</div>
                                <div className="small" style={{ opacity: 0.65 }}>{formatChatMsgTime(m.created_at)}</div>
                              </div>
                              <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                              {m.edited_at ? <div className="small" style={{ opacity: 0.6 }}>изменено</div> : null}
                              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                {(m.reactions || []).map((r) => {
                                  const hasMine = (m.my_reactions || []).includes(r.emoji);
                                  return (
                                    <button
                                      key={r.emoji}
                                      className={`chip ${hasMine ? 'active' : ''}`}
                                      type="button"
                                      onClick={() => toggleChatReaction(m.id, r.emoji, !hasMine)}
                                    >
                                      {r.emoji} {r.count}
                                    </button>
                                  );
                                })}
                                <button type="button" className="chip" onClick={() => setChatReactPickFor(m.id)}>➕</button>
                                <button type="button" className="chip" onClick={() => openChatReactors(m.id)}>👥</button>
                                {mine || isAdmin ? (
                                  <button type="button" className="chip" onClick={() => deleteChatMessage(m.id)}>🗑</button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="commentComposer chatComposer" style={{ marginTop: 10 }}>
                      {chatTab === 'dm' && chatActiveCid ? (
                        <button type="button" className="chatMenuBtn" onClick={() => setChatDmMenuOpen((v) => !v)} title="Меню">⋯</button>
                      ) : null}
                      <textarea
                        className="commentComposer__input"
                        value={chatDraft}
                        onChange={(e) => setChatDraft(e.target.value)}
                        placeholder={chatTab === 'dm' && !chatActiveCid ? 'Сначала выберите контакт…' : 'Сообщение...'}
                        disabled={chatTab === 'dm' && !chatActiveCid}
                      />
                      <button
                        type="button"
                        className="commentComposer__send"
                        disabled={chatBusy || !String(chatDraft || '').trim() || (chatTab === 'dm' && !chatActiveCid)}
                        onClick={sendChatMessage}
                      >
                        ➤
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

{chatReactPickFor ? (
                <div className="modalOverlay" onClick={() => setChatReactPickFor(null)}>
                  <div className="modalCard" onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontWeight: 900 }}>Реакция</div>
                    <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
                      {REACTIONS.map((emo) => (
                        <button key={emo} className="btn secondary" onClick={() => {
                          const msg = chatMessages.find((x) => x.id === chatReactPickFor);
                          const has = (msg?.my_reactions || []).includes(emo);
                          toggleChatReaction(chatReactPickFor, emo, !has).catch(() => {});
                          setChatReactPickFor(null);
                        }}>{emo}</button>
                      ))}
                    </div>
                    {chatReactWhoLoading ? <div className="small" style={{ marginTop: 10 }}>Загрузка...</div> : null}
                    {!chatReactWhoLoading && !chatReactWhoCanView ? <div className="small" style={{ marginTop: 10 }}>🔒 Только premium/админ.</div> : null}
                    {!chatReactWhoLoading && chatReactWhoCanView ? (
                      <div className="reactWhoList" style={{ marginTop: 10 }}>
                        {chatReactWhoList.map((it, i) => (
                          <div key={i} className="reactWhoItem">
                            <span>{showName(it.user || {})}</span>
                            <span>{(it.emojis || []).join(' ')}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
      <BottomNav tab={tab} onSelectTab={handleBottomNavSelect} isAdmin={isAdmin} profileOnly={!!me?.disabled && !isAdmin} />
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
function formatChatMsgTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const t = d.getTime();
  if (!Number.isFinite(t)) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLastSeenLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const t = d.getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin <= 0) return "Был только что";
  if (diffMin <= 5) {
    return `Был ${diffMin} ${
      diffMin === 1 ? "минуту" : diffMin < 5 ? "минуты" : "минут"
    } назад`;
  }
  // новое: если тот же календарный день (локально), пишем "сегодня в ..."
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    const time = d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Был сегодня в ${time}`;
  }
  // иначе — как раньше (дата + время)
  return `Заходил ${d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
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
// function Avatar({ p, big = false, onClick }) {
//   const size = big ? 84 : 52; // было 72/44 — чуть крупнее
//   const url = (p?.photo_url || "").trim();
//   const clickable = typeof onClick === "function";
//   const handleClick = (e) => {
//     if (!clickable) return;
//     e.stopPropagation(); // важно: не даём сработать клику по карточке игрока
//     onClick(e);
//   };
//   const handleKeyDown = (e) => {
//     if (!clickable) return;
//     if (e.key === "Enter" || e.key === " ") {
//       e.preventDefault();
//       handleClick(e);
//     }
//   };
//   const wrapStyle = {
//     width: size,
//     height: size,
//     borderRadius: 999,
//     overflow: "hidden",
//     display: "grid",
//     placeItems: "center",
//     cursor: clickable ? "zoom-in" : "default",
//     border: "1px solid rgba(255,255,255,0.10)",
//     background: "rgba(255,255,255,0.06)",
//     flex: "0 0 auto",
//   };
//   if (url) {
//     return (
//       <div
//         style={wrapStyle}
//         onClick={handleClick}
//         onKeyDown={handleKeyDown}
//         role={clickable ? "button" : undefined}
//         tabIndex={clickable ? 0 : undefined}
//         title={clickable ? "Открыть фото" : ""}
//       >
//         <img
//           src={url}
//           alt=""
//           style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
//           draggable={false}
//         />
//       </div>
//     );
//   }
//   const letter = (showName(p)[0] || "•").toUpperCase();
//   return (
//     <div
//       style={{
//         ...wrapStyle,
//         fontWeight: 900,
//       }}
//       onClick={handleClick}
//       onKeyDown={handleKeyDown}
//       role={clickable ? "button" : undefined}
//       tabIndex={clickable ? 0 : undefined}
//       title={clickable ? "Открыть фото" : ""}
//     >
//       {letter}
//     </div>
//   );
// }
function Avatar({ p, big = false, onClick, fallbackUrl = player }) {
  const size = big ? 84 : 52;
  const url = (p?.photo_url || "").trim();
  const clickable = typeof onClick === "function";
  const [broken, setBroken] = useState(false);
  const letter = useMemo(() => (showName(p)?.[0] || "•").toUpperCase(), [p]);
  // если photo_url нет -> используем заглушку
  // если заглушка не загрузилась -> покажем букву
  const src = !broken ? (url || fallbackUrl) : "";
  const handleClick = (e) => {
    if (!clickable) return;
    e.stopPropagation();
    onClick(e);
  };
  const handleKeyDown = (e) => {
    if (!clickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick(e);
    }
  };
  return (
    <div
      className={`avatar ${clickable ? "isClickable" : ""}`}
      style={{ "--av-size": `${size}px` }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? "Открыть фото" : ""}
    >
      {src ? (
        <img
          className="avatarImg"
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="avatarLetter">{letter}</span>
      )}
    </div>
  );
}
function AvatarCircle({ tgId = "", fallbackUrl = "", url = "", name = "", size = 34 }) {
  const primary = tgId ? `/api/players/${tgId}/avatar` : (url || "");
  const secondary = (fallbackUrl || url || "");
  const [src, setSrc] = React.useState(primary || secondary || "");
  React.useEffect(() => {
    setSrc(primary || secondary || "");
  }, [primary, secondary]);
  const letter = (String(name).trim()[0] || "•").toUpperCase();
  return (
    <div
      className="cmtAvatarCircle"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
        border: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--tg-text) 8%, transparent)",
        flex: "0 0 auto",
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          onError={() => {
            // 1) если упал primary — пробуем secondary
            if (src === primary && secondary && secondary !== primary) setSrc(secondary);
            else setSrc("");
          }}
        />
      ) : (
        <span style={{ fontWeight: 900 }}>{letter}</span>
      )}
    </div>
  );
}
function PmBox({ player }) {
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [items, setItems] = React.useState([]);
  const [loadingHist, setLoadingHist] = React.useState(false);
  const templates = React.useMemo(
    () => [
      {
        label: "⏰ Напоминание",
        text: `Напоминание: отметься по игре в мини-приложении 🙌`,
      },
      {
        label: "🏒 Привет",
        text: `Привет! Напоминаю про игру — загляни в мини-приложение 🙂`,
      },
      {
        label: "✅ Профиль",
        text: `Можешь, пожалуйста, заполнить профиль (имя/номер/позиция) — так удобнее собирать состав.`,
      },
      {
        label: "🎉 Спасибо",
        text: `Спасибо! 🔥`,
      },
      {
        label: "⚠️ Важно",
        text: `Есть важный момент по игре — напиши мне в ответ, пожалуйста.`,
      },
    ],
    []
  );
  async function loadHistory() {
    setLoadingHist(true);
    try {
      const r = await apiGet(`/api/admin/pm/history?tg_id=${player.tg_id}`);
      setItems(r?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoadingHist(false);
    }
  }
  React.useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.tg_id]);
  async function sendNow(msg) {
    const m = (msg || "").trim();
    if (!m) return;
    setSending(true);
    setStatus("");
    try {
      const r = await apiPost("/api/admin/pm", { tg_id: player.tg_id, text: m });
      if (r?.ok) {
        setText("");
        setStatus(`✅ Отправлено (id: ${r.message_id})`);
        await loadHistory();
      } else {
        setStatus(`❌ Не отправилось: ${r?.reason || "unknown"}`);
      }
    } catch {
      setStatus("❌ Ошибка отправки (см. backend log)");
    } finally {
      setSending(false);
    }
  }
  async function delMsg(message_id) {
    setSending(true);
    setStatus("");
    try {
      const r = await apiPost("/api/admin/pm/delete", { tg_id: player.tg_id, message_id });
      if (r?.ok) {
        setStatus(`🗑 Удалено (id: ${message_id})`);
        await loadHistory();
      } else {
        setStatus(`❌ Не удалилось: ${r?.reason || "unknown"}`);
      }
    } catch {
      setStatus("❌ Ошибка удаления (возможно Telegram уже не позволяет удалить по времени)");
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>✉️ Личное сообщение игроку</div>
      <div className="small" style={{ opacity: 0.8, marginTop: 6 }}>
        Получатель: <b>{showName(player)}</b> · tg_id: {player.tg_id}
      </div>
      {/* шаблоны */}
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {templates.map((t) => (
          <button
            key={t.label}
            className="btn secondary"
            style={{ padding: "8px 10px" }}
            disabled={sending}
            onClick={() => setText(t.text)}
          >
            {t.label}
          </button>
        ))}
        <button
          className="btn secondary"
          style={{ padding: "8px 10px" }}
          disabled={sending || !text.trim()}
          onClick={() => sendNow(text)}
        >
          🚀 Отправить текст
        </button>
      </div>
      {/* поле ввода */}
      <div style={{ marginTop: 10 }}>
        <textarea
          className="input"
          rows={4}
          placeholder="Напиши сообщение…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="row" style={{ gap: 10, marginTop: 10 }}>
        <button className="btn" disabled={sending || !text.trim()} onClick={() => sendNow(text)}>
          {sending ? "Отправляем…" : "Отправить"}
        </button>
        <button className="btn secondary" disabled={sending} onClick={loadHistory}>
          {loadingHist ? "Обновляем…" : "↻ Обновить историю"}
        </button>
      </div>
      {!!status && (
        <div className="small" style={{ marginTop: 10, opacity: 0.9 }}>
          {status}
        </div>
      )}
      <hr />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 900 }}>История</div>
        <div className="small" style={{ opacity: 0.7 }}>
          последние 25
        </div>
      </div>
      {loadingHist ? (
        <div className="small" style={{ opacity: 0.8, marginTop: 8 }}>
          Загружаем историю…
        </div>
      ) : items.length === 0 ? (
        <div className="small" style={{ opacity: 0.8, marginTop: 8 }}>
          Пока пусто.
        </div>
      ) : (
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          {items.map((it) => {
            const when = it.created_at ? new Date(it.created_at).toLocaleString() : "";
            const deleted = !!it.deleted_at;
            return (
              <div key={it.message_id} className="card" style={{ borderRadius: 12 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                  <div className="small" style={{ opacity: 0.75 }}>
                    {when} · id: {it.message_id}
                    {deleted ? " · 🗑 удалено" : ""}
                  </div>
                  {!deleted && (
                    <button
                      className="btn secondary"
                      style={{ padding: "6px 10px" }}
                      disabled={sending}
                      onClick={() => delMsg(it.message_id)}
                      title="Удалить это сообщение у игрока"
                    >
                      🗑
                    </button>
                  )}
                </div>
                <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{it.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
function posHuman(posRaw) {
  const pos = String(posRaw || "F").toUpperCase();
  return pos === "G" ? "🥅 Вратарь" : pos === "D" ? "🛡️ Защитник" : "🏒 Нападающий";
}
function BottomNav({ tab, onSelectTab, isAdmin, profileOnly = false }) {
  const items = profileOnly
    ? [{ key: "profile", label: "Профиль", icon: "👤" }]
    : [
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
            onClick={() => onSelectTab(it.key)}
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
