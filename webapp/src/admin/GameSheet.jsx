// src/admin/GameSheet.jsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import GameSettingsDialog from "./GameSettingsDialog.jsx";
import GameGuestEditor from "./GameGuestEditor.jsx";
import GameParticipants from "./GameParticipants.jsx";
import "./GameSettings.css";
import MapPickModal from "./MapPickModal.jsx";
import {
  toLocal,
  toIsoFromLocal,
  showName,
  showNum,
  posLabel,
  GUEST_DEFAULT,
} from "./adminUtils.js";

function SettingsIcon({ name }) {
  const shapes = {
    game: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18m-13 5h3m3 0h2" />
      </>
    ),
    players: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v3" />
      </>
    ),
    guests: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8m-4-4h8" />
      </>
    ),
    reminders: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        <path d="M12 2V1" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="21"
      height="21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}

export default function GameSheet({
  open,
  game, // объект игры, по которому открываем
  onClose,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  onReload, // например: () => load({silent:true})
  onChanged, // твой onChanged
}) {
  const [gameDraft, setGameDraft] = useState(null);
  const [activeTab, setActiveTab] = useState("game");
  const [guestQuery, setGuestQuery] = useState("");

  // info blocks (notice + info)
  const [noticeText, setNoticeText] = useState("");
  const [infoText, setInfoText] = useState("");

  // reminder
  // reminders (list)
  const [reminders, setReminders] = useState([]);
  const [remLoading, setRemLoading] = useState(false);
  const [postgameEnabled, setPostgameEnabled] = useState(true);
  const [postgameSaving, setPostgameSaving] = useState(false);

  function isoToLocalDT(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  function localDTToIso(local) {
    if (!local) return null;
    const [date, time] = String(local).split("T");
    if (!date || !time) return null;
    return toIsoFromLocal(date, time);
  }

  function keyOfRem(r) {
    return r.id ?? r._key;
  }

  function updateReminderRow(row, patch) {
    const k = keyOfRem(row);
    setReminders((prev) =>
      prev.map((x) => (keyOfRem(x) === k ? { ...x, ...patch } : x)),
    );
  }

  function toggleReminderExpanded(row) {
    const k = keyOfRem(row);
    setReminders((prev) =>
      prev.map((x) =>
        keyOfRem(x) === k ? { ...x, expanded: !x.expanded } : x,
      ),
    );
  }

  // guests
  const [guestsState, setGuestsState] = useState({ loading: false, list: [] });
  const [guestPoolState, setGuestPoolState] = useState({
    loading: false,
    list: [],
  });
  const [guestFormOpen, setGuestFormOpen] = useState(false);
  const [guestEditingId, setGuestEditingId] = useState(null);
  const [guestDraft, setGuestDraft] = useState({ ...GUEST_DEFAULT });

  // video
  const [videoOpen, setVideoOpen] = useState(false);

  const [videoNotifySilent, setVideoNotifySilent] = useState(false);

  // attendance
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [attLoading, setAttLoading] = useState(false);

  // token ui
  const [tokenMsg, setTokenMsg] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenUrl, setTokenUrl] = useState("");
  const [tokenValue, setTokenValue] = useState("");
  const [tokenForId, setTokenForId] = useState(null);

  // geo picker (edit)
  const [geoPickOpen, setGeoPickOpen] = useState(false);

  // busy
  const [opBusy, setOpBusy] = useState(false);

  const [toast, setToast] = useState(null); // { text, kind }
  const toastTimerRef = useRef(null);

  function pushToast(text, kind = "ok") {
    setToast({ text, kind });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1800);
  }

  function askConfirm(message) {
    const tg = window.Telegram?.WebApp;
    if (tg?.showConfirm) {
      return new Promise((resolve) => {
        try {
          tg.showConfirm(String(message || ""), (ok) => resolve(!!ok));
        } catch {
          resolve(false);
        }
      });
    }
    return Promise.resolve(window.confirm(String(message || "")));
  }

  const isOpen = !!open && !!game;

  function notify(text) {
    const tg = window.Telegram?.WebApp;
    if (tg?.showAlert) tg.showAlert(text);
    else alert(text);
  }

  async function runOp(label, fn) {
    setOpBusy(true);
    try {
      await fn();
      return true;
    } catch (e) {
      console.error(label, e);
      pushToast("Не удалось сохранить. Попробуйте ещё раз.", "err");
      notify(
        "Не удалось выполнить действие. Проверьте соединение и попробуйте ещё раз.",
      ); // можешь потом убрать, если не хочешь модалки

      return false;
    } finally {
      setOpBusy(false);
    }
  }

  /** init draft on open */
  useEffect(() => {
    if (!isOpen) return;

    setActiveTab("game");
    setGuestQuery("");
    const dt = toLocal(game.starts_at);

    setGameDraft({
      id: game.id,
      status: game.status || "scheduled",
      location: game.location || "",
      date: dt.date,
      time: dt.time,
      video_url: game.video_url || "",
      geo_lat: game.geo_lat == null ? "" : String(game.geo_lat),
      geo_lon: game.geo_lon == null ? "" : String(game.geo_lon),
      geo_address: game.geo_address || "",
      raw: game,
    });
    // init info blocks
    setNoticeText(game.notice_text || "");
    setInfoText(game.info_text || "");

    setVideoOpen(false);
    setGuestsState({ loading: false, list: [] });
    setGuestPoolState({ loading: false, list: [] });
    setGuestFormOpen(false);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT, email: "" });

    setAttendanceRows([]);
    setAttLoading(false);

    setTokenMsg("");
    setTokenBusy(false);
    setTokenUrl("");
    setTokenValue("");
    setTokenForId(null);

    // загрузки
    loadGuestsForGame(game.id);
    loadGuestPool();
    loadAttendanceForGame(game.id);
    loadRemindersForGame(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, game?.id]);

  useEffect(() => {
    if (!isOpen || !game) return;
    setNoticeText(game.notice_text || "");
    setInfoText(game.info_text || "");
    setPostgameEnabled(game.postgame_enabled !== false);
  }, [isOpen, game?.id, game?.notice_text, game?.info_text]);

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

  async function sendVideoNotify() {
    if (!gameDraft?.id) return;

    const videoUrl = String(gameDraft.video_url || "").trim();
    if (!videoUrl) return notify("Ссылка на видео пустая");

    const ok = await runOp("send video notify", async () => {
      const r = await apiPost("/api/admin/games/video/send", {
        game_id: gameDraft.id,
        video_url: videoUrl,
        silent: !!videoNotifySilent,
      });
      if (!r?.ok) throw new Error(r?.reason || "video_send_failed");
    });

    if (ok) notify("✅ Отправлено в чат");
  }

  async function savePostgameSettings() {
    if (!gameDraft?.id) return;

    setPostgameSaving(true);
    try {
      const ok = await runOp("save postgame settings", async () => {
        const r = await apiPatch(`/api/admin/games/${gameDraft.id}/reminder`, {
          postgame_enabled: !!postgameEnabled,
        });
        if (!r?.ok)
          throw new Error(r?.reason || r?.error || "postgame_save_failed");
      });

      if (!ok) return;

      await onReload?.(gameDraft.id);
      await onChanged?.({
        action: "keep_open",
        label: "✅ Послеигровое сообщение сохранено — обновляю приложение…",
        gameId: gameDraft.id,
      });
      notify("✅ Послеигровое сообщение сохранено");
    } finally {
      setPostgameSaving(false);
    }
  }

  async function loadRemindersForGame(gameId) {
    setRemLoading(true);
    try {
      const r = await apiGet(`/api/admin/games/${gameId}/reminders`);
      if (!r?.ok) throw new Error(r?.reason || "reminders_load_failed");

      const list = (r.reminders || []).map((x) => ({
        ...x,
        _key: x.id, // для React key
        local_at: isoToLocalDT(x.remind_at),
        __orig: { enabled: !!x.enabled, pin: !!x.pin, remind_at: x.remind_at },
        expanded: false,
        saving: false,
      }));

      setReminders(list);
    } catch (e) {
      console.error(e);
      pushToast("❌ Не удалось загрузить напоминания", "err");
      setReminders([]);
    } finally {
      setRemLoading(false);
    }
  }

  function addReminderRow() {
    const k = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setReminders((prev) => [
      ...prev,
      {
        id: null,
        _key: k,
        enabled: true,
        pin: true,
        remind_at: null,
        local_at: "",
        sent_at: null,
        message_id: null,
        attempts: 0,
        last_error: null,
        __orig: { enabled: true, pin: true, remind_at: null },
        expanded: true,
        saving: false,
      },
    ]);
  }

  async function saveReminderRow(row) {
    if (row.enabled && !row.local_at) {
      notify("Укажи дату/время напоминания");
      return;
    }

    const remind_at = row.local_at ? localDTToIso(row.local_at) : null;
    if (row.enabled && !remind_at) {
      notify("Некорректная дата/время");
      return;
    }

    // reset_sent только если уже было отправлено и ты реально меняешь время/вкл
    const changedTime = remind_at !== row.__orig?.remind_at;
    const changedEnabled = !!row.enabled !== !!row.__orig?.enabled;
    const reset_sent = !!row.sent_at && (changedTime || changedEnabled);

    updateReminderRow(row, { saving: true });

    const ok = await runOp("save reminder row", async () => {
      if (!row.id) {
        const r = await apiPost(`/api/admin/games/${gameDraft.id}/reminders`, {
          enabled: !!row.enabled,
          pin: !!row.pin,
          remind_at,
        });
        if (!r?.ok) throw new Error(r?.reason || "reminder_create_failed");
      } else {
        const r = await apiPatch(`/api/admin/reminders/${row.id}`, {
          enabled: !!row.enabled,
          pin: !!row.pin,
          remind_at,
          reset_sent,
        });
        if (!r?.ok) throw new Error(r?.reason || "reminder_update_failed");
      }
    });

    updateReminderRow(row, { saving: false });

    if (ok) {
      pushToast("✅ Напоминание сохранено");
      await loadRemindersForGame(gameDraft.id);
    }
  }

  async function deleteReminderRow(row) {
    const confirmed = await askConfirm("Удалить напоминание?");
    if (!confirmed) return;

    if (!row.id) {
      setReminders((prev) => prev.filter((x) => keyOfRem(x) !== keyOfRem(row)));
      return;
    }

    const ok = await runOp("delete reminder row", async () => {
      const r = await apiDelete(`/api/admin/reminders/${row.id}`);
      if (!r?.ok) throw new Error(r?.reason || "reminder_delete_failed");
    });

    if (ok) {
      pushToast("🗑️ Удалено");
      await loadRemindersForGame(gameDraft.id);
    }
  }

  async function resetReminderSent(row) {
    if (!row?.id) return;

    const ok = await runOp("reset reminder sent", async () => {
      const r = await apiPatch(`/api/admin/reminders/${row.id}`, {
        reset_sent: true,
      });
      if (!r?.ok) throw new Error(r?.reason || "reminder_reset_failed");
    });

    if (ok) {
      pushToast("↻ Сброшено");
      await loadRemindersForGame(gameDraft.id);
    }
  }

  function close() {
    setGameDraft(null);
    setGuestsState({ loading: false, list: [] });
    setGuestFormOpen(false);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT, email: "" });
    setVideoOpen(false);
    setVideoNotifySilent(false);

    setAttendanceRows([]);
    setAttLoading(false);

    setTokenMsg("");
    setTokenBusy(false);
    setTokenUrl("");
    setTokenValue("");
    setTokenForId(null);

    setGeoPickOpen(false);
    setToast(null);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;

    onClose?.();
  }

  /** attendance */
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

  function attendLabel(st) {
    if (st === "yes") return pastGame ? "был" : "будет";
    if (st === "no") return pastGame ? "не был" : "не будет";
    return "⭕ не отмечено";
  }

  async function setAttend(pOrId, nextStatus) {
    if (!gameDraft?.id) return;

    const tg_id = typeof pOrId === "object" ? pOrId.tg_id : pOrId;
    const row =
      typeof pOrId === "object"
        ? pOrId
        : attendanceRows.find((x) => String(x.tg_id) === String(tg_id));

    const cur = row?.status || "maybe";
    if (cur === nextStatus) {
      pushToast(`Уже: ${attendLabel(cur)}`, "warn");
      return;
    }

    const name = row ? `${showName(row)}${showNum(row)}` : `ID ${tg_id}`;

    const ok = await askConfirm(
      `Изменить статус для ${name} на "${attendLabel(nextStatus)}"?`,
    );
    if (!ok) return;

    const success = await runOp("save attend", async () => {
      await apiPost("/api/admin/rsvp", {
        game_id: gameDraft.id,
        tg_id,
        status: nextStatus,
      });

      setAttendanceRows((prev) =>
        prev.map((x) =>
          String(x.tg_id) === String(tg_id) ? { ...x, status: nextStatus } : x,
        ),
      );
    });

    if (success) {
      pushToast(`✅ ${name}: ${attendLabel(nextStatus)}`, "ok");
      // sheet НЕ закрываем
      // если нужно обновлять внешние данные — лучше onReload, а не onChanged (чтобы не закрывало)
      await onReload?.(gameDraft.id);
    }
  }

  /** tokens */
  async function createRsvpLink(tg_id) {
    if (!gameDraft?.id || !tg_id) return;

    setActiveTab("players");
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
        setTokenMsg(
          `❌ Не удалось создать ссылку: ${r?.reason || r?.error || "unknown"}`,
        );
        setTokenForId(null);
        return;
      }

      const token = r?.token?.token || r?.token || "";
      setTokenValue(token);

      const url =
        r?.url ||
        (token
          ? `${window.location.origin}/rsvp?t=${encodeURIComponent(token)}`
          : "");
      if (!url) {
        setTokenMsg(
          "❌ Токен создан, но URL пустой (проверь PUBLIC_WEB_URL/WEB_APP_URL на бэке)",
        );
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
      const r = await apiPost("/api/admin/rsvp-tokens/revoke", {
        token: tokenValue,
      });
      if (!r?.ok) {
        setTokenMsg(
          `❌ Не удалось отозвать: ${r?.reason || r?.error || "unknown"}`,
        );
        return;
      }
      setTokenMsg("🚫 Ссылка отозвана");
    } finally {
      setTokenBusy(false);
    }
  }

  /** guests */
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

  async function loadGuestPool() {
    setGuestPoolState({ loading: true, list: [] });
    try {
      const r = await apiGet("/api/admin/players");
      const list = (r.players || [])
        .filter((p) => p.player_kind === "guest" && !p.disabled)
        .sort((a, b) => showName(a).localeCompare(showName(b), "ru"));
      setGuestPoolState({ loading: false, list });
    } catch (e) {
      console.error("loadGuestPool failed", e);
      setGuestPoolState({ loading: false, list: [] });
    }
  }

  async function setGuestForGame(tgId, status = "yes") {
    if (!gameDraft?.id || !tgId) return;

    await runOp("set guest rsvp", async () => {
      await apiPost("/api/admin/rsvp", {
        game_id: gameDraft.id,
        tg_id: tgId,
        status,
      });
      await loadGuestsForGame(gameDraft.id);
      await loadGuestPool();
      await loadAttendanceForGame(gameDraft.id);
      await onReload?.();
      await onChanged?.({
        action: "keep_open",
        label: "✅ Гость отмечен на игру — обновляю приложение…",
        gameId: gameDraft.id,
      });
    });
  }

  function openAddGuest() {
    if (!gameDraft) return;
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT, email: "" });
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
      email: guestRow.email || "",
      status: guestRow.status || "yes",
    });
    setGuestFormOpen(true);
  }

  async function saveGuest() {
    if (!gameDraft) return;

    if (!String(guestDraft.display_name || "").trim())
      return notify("Укажите имя гостя");
    const saved = await runOp("save guest", async () => {
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

      if (guestEditingId) {
        await apiPatch(`/api/admin/players/${guestEditingId}`, payload);
        await apiPost("/api/admin/rsvp", {
          game_id: gameDraft.id,
          tg_id: guestEditingId,
          status: payload.status,
        });
      } else {
        await apiPost("/api/admin/guests", payload);
      }

      setGuestFormOpen(false);
      setGuestEditingId(null);
      setGuestDraft({ ...GUEST_DEFAULT, email: "" });

      await loadGuestsForGame(gameDraft.id);
      await loadGuestPool();
      await loadAttendanceForGame(gameDraft.id);
      await onReload?.();
      await onChanged?.({
        action: "keep_open",
        label: "✅ Гости обновлены — обновляю приложение…",
        gameId: gameDraft.id,
      });
    });

    if (saved) notify("✅ Гость сохранён");
  }

  async function deleteGuest(tgId) {
    const ok = confirm("Удалить гостя? (Он исчезнет из списков и состава)");
    if (!ok) return;

    const deleted = await runOp("delete guest", async () => {
      await apiDelete(`/api/admin/players/${tgId}`);

      if (gameDraft) {
        await loadGuestsForGame(gameDraft.id);
        await loadGuestPool();
        await loadAttendanceForGame(gameDraft.id);
      }
      await onReload?.();
      await onChanged?.({
        action: "keep_open",
        label: "✅ Гость удалён — обновляю приложение…",
        gameId: gameDraft?.id,
      });
    });

    if (deleted) {
      if (String(guestEditingId) === String(tgId)) setGuestFormOpen(false);
      notify("✅ Гость удалён");
    }
  }

  async function promoteGuestToManual(
    tg_id,
    guestName = "",
    emailFromForm = "",
  ) {
    const ok = confirm(
      "Сделать этого гостя постоянным игроком команды (manual)?",
    );
    if (!ok) return;

    let email = String(emailFromForm || "")
      .trim()
      .toLowerCase();
    if (!email) {
      const emailInput = prompt(
        `Укажите email для игрока ${guestName ? `«${guestName}»` : ""} (обязательно):`,
        "",
      );
      if (emailInput == null) return;
      email = String(emailInput || "")
        .trim()
        .toLowerCase();
    }

    if (!email || !email.includes("@")) {
      notify("❌ Укажите корректный email");
      return;
    }

    await runOp("promote guest", async () => {
      const r = await apiPost(`/api/admin/players/${tg_id}/promote`, { email });
      if (!r?.ok) {
        const reason = r?.reason || r?.error || "unknown";
        if (reason === "email_in_use")
          notify("❌ Такой email уже используется");
        else notify(`❌ Не удалось перевести гостя: ${reason}`);
        return;
      }

      setTokenMsg("⭐ Гость переведён в постоянные игроки (manual)");

      if (gameDraft?.id) {
        await loadGuestsForGame(gameDraft.id);
        await loadGuestPool();
        await loadAttendanceForGame(gameDraft.id);
      }
      await onReload?.();
      await onChanged?.({
        action: "keep_open",
        label: "✅ Состав игроков обновлён — обновляю приложение…",
        refreshPlayers: true,
        gameId: gameDraft?.id,
      });

      setGuestFormOpen(false);
      notify("✅ Гость переведён в постоянные игроки");
    });
  }

  /** game ops */
  async function saveGame() {
    if (!gameDraft) return;

    if (!gameDraft.date || !gameDraft.time)
      return notify("Укажите дату и время игры");
    const notice = String(noticeText || "").trim();
    const info = String(infoText || "").trim();
    if (notice.length > 240)
      return notify("Короткое объявление должно быть до 240 символов");
    const saved = await runOp("save game", async () => {
      const starts_at = toIsoFromLocal(gameDraft.date, gameDraft.time);

      const latStr = String(gameDraft.geo_lat ?? "")
        .replace(",", ".")
        .trim();
      const lonStr = String(gameDraft.geo_lon ?? "")
        .replace(",", ".")
        .trim();

      const geo_lat = latStr === "" ? null : Number(latStr);
      const geo_lon = lonStr === "" ? null : Number(lonStr);

      if (
        (geo_lat !== null && !Number.isFinite(geo_lat)) ||
        (geo_lon !== null && !Number.isFinite(geo_lon))
      ) {
        throw new Error("invalid_coordinates");
      }
      if ((geo_lat === null) !== (geo_lon === null)) {
        throw new Error("incomplete_coordinates");
      }

      await apiPatch(`/api/games/${gameDraft.id}`, {
        starts_at,
        location: gameDraft.location,
        status: gameDraft.status,
        video_url: gameDraft.video_url || "",
        notice_text: notice,
        info_text: info,
        geo_lat,
        geo_lon,
      });

      await onReload?.();
      await onChanged?.({
        action: "keep_open",
        label: "✅ Игра сохранена — обновляю приложение…",
        gameId: gameDraft.id,
      });
    });

    if (saved) {
      notify("✅ Игра сохранена");
      close();
    }
  }

  async function setGameStatus(status) {
    if (!gameDraft) return;

    if (
      !(await askConfirm(
        status === "cancelled"
          ? "Отменить эту игру? Игроки увидят статус «Отменена»."
          : "Восстановить эту игру?",
      ))
    )
      return;
    const saved = await runOp("set status", async () => {
      await apiPost(`/api/games/${gameDraft.id}/status`, { status });
      setGameDraft((d) => ({ ...d, status }));

      await onReload?.();
      await onChanged?.({
        action: "keep_open",
        label: "✅ Статус обновлён — обновляю приложение…",
        gameId: gameDraft.id,
      });
    });

    if (saved) notify("✅ Статус обновлён");
  }

  async function deleteGame() {
    if (!gameDraft) return;
    const ok = confirm(`Удалить игру #${gameDraft.id}?`);
    if (!ok) return;

    const deleted = await runOp("delete game", async () => {
      await apiDelete(`/api/games/${gameDraft.id}`);

      await onReload?.();
      await onChanged?.({
        action: "keep_open",
        label: "✅ Игра удалена — обновляю приложение…",
        gameId: gameDraft.id,
      });
    });

    if (deleted) {
      notify("✅ Игра удалена");
      close();
    }
  }

  function GuestPill({ g }) {
    const status = g.status || "yes";

    return (
      <div className={`gsGuest gsGuest--${status}`}>
        <div className="gsGuest__main">
          <span className="gsGuest__tag">ГОСТЬ</span>
          <span className="gsGuest__name">
            {showName(g)}
            {showNum(g)}
          </span>
          <span className="gsGuest__meta">
            ({posLabel((g.position || "F").toUpperCase())})
          </span>
          <span className="gsGuest__status">
            {status === "yes"
              ? "✅ будет"
              : status === "maybe"
                ? "❓ под вопросом"
                : "❌ не будет"}
          </span>
        </div>
        <div className="gsGuest__actions">
          <button
            className="gsIconButton"
            aria-label={`Ссылка на отметку: ${showName(g)}`}
            title="Ссылка на отметку"
            disabled={tokenBusy}
            onClick={() => createRsvpLink(g.tg_id)}
          >
            🔗
          </button>
          <button
            className="gsIconButton"
            aria-label={`Перевести в постоянные игроки: ${showName(g)}`}
            title="Сделать постоянным игроком"
            onClick={() =>
              promoteGuestToManual(g.tg_id, showName(g), g.email || "")
            }
          >
            ⭐
          </button>
          <button
            className="gsIconButton"
            aria-label={`Изменить гостя: ${showName(g)}`}
            title="Изменить"
            onClick={() => openEditGuest(g)}
          >
            ✏️
          </button>
          <button
            className="gsIconButton gsDangerButton"
            aria-label={`Удалить гостя: ${showName(g)}`}
            title="Удалить"
            onClick={() => deleteGuest(g.tg_id)}
          >
            🗑️
          </button>
        </div>
      </div>
    );
  }

  const title = gameDraft ? `Игра #${gameDraft.id}` : "Игра";
  const tabs = [
    ["game", "Игра"],
    ["players", "Игроки"],
    ["guests", "Гости"],
    ["reminders", "Напоминания"],
  ];
  const pastGame =
    game?.status === "finished" ||
    Date.now() >= new Date(game?.starts_at).getTime() + 2 * 60 * 60 * 1000;
  const statusName = {
    scheduled: "Запланирована",
    cancelled: "Отменена",
    finished: "Прошла",
  };
  const matchingGuests = guestPoolState.list.filter((g) =>
    `${showName(g)} ${showNum(g)}`
      .toLocaleLowerCase("ru")
      .includes(guestQuery.trim().toLocaleLowerCase("ru")),
  );
  if (!isOpen || !gameDraft || gameDraft.id !== game.id) return null;

  const navigation = (
    <nav className="gsTabs" role="tablist" aria-label="Настройки игры">
      {tabs.map(([key, label], index) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={`gs-tab-${key}`}
          aria-controls={`gs-panel-${key}`}
          aria-selected={activeTab === key}
          tabIndex={activeTab === key ? 0 : -1}
          disabled={opBusy}
          onClick={() => setActiveTab(key)}
          onKeyDown={(event) => {
            let next;
            if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
            if (event.key === "ArrowLeft")
              next = (index + tabs.length - 1) % tabs.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = tabs.length - 1;
            if (next !== undefined) {
              event.preventDefault();
              setActiveTab(tabs[next][0]);
              event.currentTarget.parentElement.children[next]?.focus();
            }
          }}
        >
          <span aria-hidden="true">
            <SettingsIcon name={key} />
          </span>
          {label}
        </button>
      ))}
    </nav>
  );
  return (
    <>
      <GameSettingsDialog
        title={title}
        subtitle={`${formatWhen(game.starts_at)} · ${game.location || "Арена не указана"}`}
        onClose={close}
        navigation={navigation}
        pageKey={activeTab}
        suspended={guestFormOpen || geoPickOpen}
        busy={opBusy}
        footer={
          activeTab === "game" ? (
            <>
              <button
                className="btn secondary"
                type="button"
                onClick={close}
                disabled={opBusy}
              >
                Закрыть
              </button>
              <button
                className="btn"
                form="game-settings-form"
                type="submit"
                disabled={opBusy}
              >
                {opBusy ? "Сохраняем…" : "Сохранить игру"}
              </button>
            </>
          ) : null
        }
      >
        {toast && (
          <div
            className={`gsToast ${toast.kind}`}
            role="status"
            aria-live="polite"
          >
            {toast.text}
          </div>
        )}
        <div
          role="tabpanel"
          id={`gs-panel-${activeTab}`}
          aria-labelledby={`gs-tab-${activeTab}`}
          className="gsTabPanel"
        >
          {activeTab === "game" && (
            <form
              id="game-settings-form"
              className="gsStack"
              onSubmit={(event) => {
                event.preventDefault();
                if (!opBusy) saveGame();
              }}
            >
              <section className="gsSection">
                <div className="gsSection__heading">
                  <div>
                    <h3>Когда и где</h3>
                    <p className="gsHint">Дата, время и место встречи</p>
                  </div>
                  <span
                    className={`gsGameStatus gsGameStatus--${gameDraft.status}`}
                  >
                    {pastGame && gameDraft.status !== "cancelled"
                      ? "Прошла"
                      : statusName[gameDraft.status] || gameDraft.status}
                  </span>
                </div>
                <div className="gsFieldGrid">
                  <label className="gsField">
                    Дата
                    <input
                      className="input"
                      type="date"
                      required
                      value={gameDraft.date}
                      onChange={(e) =>
                        setGameDraft((d) => ({ ...d, date: e.target.value }))
                      }
                    />
                  </label>
                  <label className="gsField">
                    Время
                    <input
                      className="input"
                      type="time"
                      required
                      value={gameDraft.time}
                      onChange={(e) =>
                        setGameDraft((d) => ({ ...d, time: e.target.value }))
                      }
                    />
                  </label>
                </div>
                <label className="gsField">
                  Арена
                  <input
                    className="input"
                    value={gameDraft.location}
                    placeholder="Название ледовой арены"
                    onChange={(e) =>
                      setGameDraft((d) => ({ ...d, location: e.target.value }))
                    }
                  />
                </label>
                <div className="gsMapPoint">
                  <span aria-hidden="true">📍</span>
                  <div>
                    <strong>
                      {gameDraft.geo_lat && gameDraft.geo_lon
                        ? "Точка на карте выбрана"
                        : "Точка на карте не выбрана"}
                    </strong>
                    <small>
                      {gameDraft.geo_address ||
                        (gameDraft.geo_lat && gameDraft.geo_lon
                          ? `${Number(gameDraft.geo_lat).toFixed(5)}, ${Number(gameDraft.geo_lon).toFixed(5)}`
                          : "Помогает игрокам построить маршрут")}
                    </small>
                  </div>
                </div>
                <div className="gsActions">
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => setGeoPickOpen(true)}
                  >
                    Выбрать на карте
                  </button>
                  {gameDraft.geo_lat && gameDraft.geo_lon && (
                    <button
                      className="gsTextButton"
                      type="button"
                      onClick={() =>
                        setGameDraft((d) => ({
                          ...d,
                          geo_lat: "",
                          geo_lon: "",
                          geo_address: "",
                        }))
                      }
                    >
                      Убрать точку
                    </button>
                  )}
                </div>
              </section>
              <section className="gsSection">
                <h3>Информация для игроков</h3>
                <label className="gsField">
                  Важное
                  <input
                    className="input"
                    maxLength={240}
                    value={noticeText}
                    onChange={(e) => setNoticeText(e.target.value)}
                    placeholder="Короткое объявление на карточке игры"
                  />
                  <small className="gsField__hint">
                    В списке игр · {noticeText.length}/240
                  </small>
                </label>
                <label className="gsField">
                  Подробности
                  <textarea
                    className="input"
                    rows={4}
                    value={infoText}
                    onChange={(e) => setInfoText(e.target.value)}
                    placeholder="Оплата, время сбора, форма и детали игры"
                  />
                  <small className="gsField__hint">
                    Внутри игры. Пустые блоки не отображаются.
                  </small>
                </label>
              </section>
              <details
                className="gsSection gsDisclosure"
                open={videoOpen}
                onToggle={(e) => setVideoOpen(e.currentTarget.open)}
              >
                <summary>
                  <span>
                    Видео игры
                    <small>
                      {gameDraft.video_url
                        ? "Ссылка добавлена"
                        : "Добавить запись и отправить её в чат"}
                    </small>
                  </span>
                </summary>
                <div className="gsDisclosure__body">
                  <label className="gsField">
                    Ссылка на видео
                    <input
                      className="input"
                      type="url"
                      value={gameDraft.video_url}
                      placeholder="https://www.youtube.com/watch?v=…"
                      onChange={(e) =>
                        setGameDraft((d) => ({
                          ...d,
                          video_url: e.target.value,
                        }))
                      }
                    />
                    <small className="gsField__hint">
                      Чтобы убрать видео, очистите ссылку и сохраните игру.
                    </small>
                  </label>
                  <label className="gsCheck">
                    <input
                      type="checkbox"
                      checked={videoNotifySilent}
                      onChange={(e) => setVideoNotifySilent(e.target.checked)}
                    />
                    Отправить без звука
                  </label>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={sendVideoNotify}
                    disabled={opBusy || !gameDraft.video_url.trim()}
                  >
                    Отправить видео в чат
                  </button>
                </div>
              </details>
              <details className="gsSection gsDisclosure gsDanger">
                <summary>
                  <span>
                    Управление игрой
                    <small>Отмена, восстановление и удаление</small>
                  </span>
                </summary>
                <div className="gsDisclosure__body">
                  <p className="gsHint">
                    Отменённую игру можно восстановить. Удаление игры
                    необратимо.
                  </p>
                  <div className="gsActions">
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={opBusy}
                      onClick={() =>
                        setGameStatus(
                          gameDraft.status === "cancelled"
                            ? "scheduled"
                            : "cancelled",
                        )
                      }
                    >
                      {gameDraft.status === "cancelled"
                        ? "Восстановить игру"
                        : "Отменить игру"}
                    </button>
                    <button
                      className="btn secondary gsDangerButton"
                      type="button"
                      onClick={deleteGame}
                      disabled={opBusy}
                    >
                      Удалить игру
                    </button>
                  </div>
                </div>
              </details>
            </form>
          )}
          {activeTab === "players" && (
            <GameParticipants
              rows={attendanceRows}
              loading={attLoading}
              busy={opBusy}
              past={pastGame}
              onRefresh={() => loadAttendanceForGame(gameDraft.id)}
              onAttend={setAttend}
              onLink={createRsvpLink}
              token={{
                forId: tokenForId,
                url: tokenUrl,
                value: tokenValue,
                message: tokenMsg,
                busy: tokenBusy,
              }}
              onRevoke={revokeToken}
              onTokenMessage={setTokenMsg}
              onHideToken={() => {
                setTokenForId(null);
                setTokenUrl("");
                setTokenValue("");
                setTokenMsg("");
              }}
            />
          )}
          {activeTab === "guests" && (
            <div className="gsStack">
              <section className="gsSection">
                <div className="gsSection__heading">
                  <div>
                    <h3>
                      Гости этой игры{" "}
                      <span className="gsCount">{guestsState.list.length}</span>
                    </h3>
                    <p className="gsHint">Игроки без аккаунта Telegram</p>
                  </div>
                  <button
                    className="gsIconButton"
                    type="button"
                    aria-label="Обновить гостей"
                    disabled={guestsState.loading || opBusy}
                    onClick={() => {
                      loadGuestsForGame(gameDraft.id);
                      loadGuestPool();
                    }}
                  >
                    ↻
                  </button>
                </div>
                <button
                  className="btn gsFullButton"
                  type="button"
                  disabled={opBusy}
                  onClick={openAddGuest}
                >
                  + Новый гость
                </button>
                {guestsState.loading ? (
                  <p className="gsHint" role="status">
                    Загружаем гостей…
                  </p>
                ) : !guestsState.list.length ? (
                  <p className="gsEmpty">
                    На эту игру гостей пока не добавляли.
                  </p>
                ) : (
                  <div className="gsStack">
                    {guestsState.list.map((g) => (
                      <GuestPill key={g.tg_id} g={g} />
                    ))}
                  </div>
                )}
              </section>
              <section className="gsSection">
                <h3>Сохранённые гости</h3>
                <p className="gsHint">
                  Выберите знакомого игрока, чтобы добавить его на эту игру.
                </p>
                <label className="gsField gsSearch">
                  <span className="gsSrOnly">Поиск гостя</span>
                  <input
                    className="input"
                    type="search"
                    value={guestQuery}
                    onChange={(e) => setGuestQuery(e.target.value)}
                    placeholder="Найти по имени или номеру"
                  />
                </label>
                {guestPoolState.loading ? (
                  <p className="gsHint" role="status">
                    Загружаем список…
                  </p>
                ) : (
                  <div className="gsStack">
                    {!matchingGuests.length && (
                      <p className="gsEmpty">
                        {guestQuery
                          ? "Гости не найдены."
                          : "Список пока пуст. Добавьте первого гостя."}
                      </p>
                    )}
                    {matchingGuests.map((g) => {
                      const current = guestsState.list.find(
                        (x) => String(x.tg_id) === String(g.tg_id),
                      );
                      return (
                        <article className="gsParticipant" key={g.tg_id}>
                          <div className="gsParticipant__heading">
                            <div>
                              <strong>
                                {showName(g)}
                                <span className="gsJerseyNumber">
                                  {showNum(g)}
                                </span>
                              </strong>
                              <span className="gsHint">
                                {posLabel((g.position || "F").toUpperCase())}
                                {current
                                  ? " · уже в списке игры"
                                  : " · не добавлен на игру"}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="gsIconButton"
                              aria-label={`Изменить гостя: ${showName(g)}`}
                              disabled={opBusy}
                              onClick={() =>
                                openEditGuest({
                                  ...g,
                                  status: current?.status || "yes",
                                })
                              }
                            >
                              ✎
                            </button>
                          </div>
                          <div
                            className="gsStatusChoices"
                            role="group"
                            aria-label={`Участие гостя: ${showName(g)}`}
                          >
                            {[
                              ["yes", "✓", "Будет"],
                              ["no", "✕", "Не будет"],
                              ["maybe", "?", "Под вопросом"],
                            ].map(([value, icon, label]) => (
                              <button
                                type="button"
                                key={value}
                                className={`gsStatusChoice gsStatusChoice--${value}`}
                                aria-pressed={current?.status === value}
                                disabled={opBusy}
                                onClick={() => setGuestForGame(g.tg_id, value)}
                              >
                                <b aria-hidden="true">{icon}</b>
                                <span>{label}</span>
                              </button>
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
          {activeTab === "reminders" && (
            <div className="gsStack">
              {" "}
              <div className="gsSection">
                <div className="rowBetween">
                  <h3 style={{ margin: 0 }}>Напоминания об игре</h3>

                  <button
                    className="iconBtn"
                    type="button"
                    title="Добавить напоминание"
                    onClick={addReminderRow}
                    disabled={opBusy}
                  >
                    ➕
                  </button>
                </div>

                {remLoading ? (
                  <div
                    className="small"
                    style={{ marginTop: 8, opacity: 0.85 }}
                  >
                    Загрузка…
                  </div>
                ) : null}

                {!remLoading && reminders.length === 0 ? (
                  <div
                    className="small"
                    style={{ marginTop: 8, opacity: 0.85 }}
                  >
                    Пока нет напоминаний
                  </div>
                ) : null}

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {reminders.map((r) => (
                    <div key={keyOfRem(r)} className="gsRemCard">
                      <div className="gsRemHead">
                        <label
                          className="gsSwitch"
                          title="Включить напоминание"
                        >
                          <input
                            type="checkbox"
                            checked={!!r.enabled}
                            onChange={(e) =>
                              updateReminderRow(r, {
                                enabled: e.target.checked,
                              })
                            }
                          />
                          <span className="gsSwitchTrack" />
                          <span className="gsSwitchText">
                            {r.enabled ? "Вкл" : "Выкл"}
                          </span>
                        </label>

                        <div className="gsRemDt">
                          <span className="gsRemStatusIcon" aria-hidden="true">
                            {r.sent_at ? "✅" : "⏰"}
                          </span>
                          <span>
                            {r.local_at
                              ? formatWhen(localDTToIso(r.local_at))
                              : "Дата не указана"}
                          </span>
                        </div>

                        <button
                          type="button"
                          className="gsRemExpand"
                          aria-expanded={!!r.expanded}
                          aria-label={
                            r.expanded
                              ? "Свернуть детали напоминания"
                              : "Развернуть детали напоминания"
                          }
                          onClick={() => toggleReminderExpanded(r)}
                        >
                          {r.expanded ? "▲" : "▼"}
                        </button>
                      </div>

                      {r.expanded ? (
                        <div className="gsRemBody">
                          <input
                            className="input"
                            type="datetime-local"
                            value={r.local_at || ""}
                            onChange={(e) =>
                              updateReminderRow(r, { local_at: e.target.value })
                            }
                            aria-label="Дата и время напоминания"
                            disabled={!r.enabled}
                          />

                          <label
                            className="gsSwitch"
                            title="Закрепить сообщение напоминания"
                          >
                            <input
                              type="checkbox"
                              checked={r.pin !== false}
                              onChange={(e) =>
                                updateReminderRow(r, { pin: e.target.checked })
                              }
                              disabled={!r.enabled}
                            />
                            <span className="gsSwitchTrack" />
                            <span className="gsSwitchText">Закрепить</span>
                          </label>

                          <div className="gsRemMeta">
                            {r.sent_at ? (
                              <>
                                ✅ Отправлено: <b>{formatWhen(r.sent_at)}</b>
                              </>
                            ) : (
                              <>⏳ Запланировано, ещё не отправлено</>
                            )}
                            {r.last_error ? (
                              <div style={{ marginTop: 4, opacity: 0.9 }}>
                                ⚠️ {String(r.last_error).slice(0, 140)}
                              </div>
                            ) : null}
                          </div>

                          <div className="gsRemActions">
                            {r.id && r.sent_at ? (
                              <button
                                className="btn secondary"
                                type="button"
                                onClick={() => resetReminderSent(r)}
                                disabled={r.saving || opBusy}
                              >
                                ↻ Сбросить
                              </button>
                            ) : null}

                            <button
                              className="btn"
                              type="button"
                              onClick={() => saveReminderRow(r)}
                              disabled={r.saving || opBusy}
                            >
                              {r.saving ? "…" : "Сохранить"}
                            </button>

                            <button
                              className="iconBtn"
                              type="button"
                              title="Удалить"
                              onClick={() => deleteReminderRow(r)}
                              disabled={r.saving || opBusy}
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="gsSection">
                <div className="rowBetween" style={{ gap: 10 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Послеигровое сообщение</h3>
                    <div
                      className="small"
                      style={{ marginTop: 4, opacity: 0.85 }}
                    >
                      Отправка сообщения после завершения этой игры.
                    </div>
                  </div>

                  <label
                    className="gsSwitch"
                    title="Включить послеигровое сообщение"
                  >
                    <input
                      type="checkbox"
                      checked={!!postgameEnabled}
                      onChange={(e) => setPostgameEnabled(e.target.checked)}
                      disabled={opBusy || postgameSaving}
                    />
                    <span className="gsSwitchTrack" />
                    <span className="gsSwitchText">
                      {postgameEnabled ? "Вкл" : "Выкл"}
                    </span>
                  </label>
                </div>

                <div className="gsRemActions" style={{ marginTop: 10 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={savePostgameSettings}
                    disabled={opBusy || postgameSaving}
                  >
                    {postgameSaving ? "…" : "Сохранить"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </GameSettingsDialog>
      {guestFormOpen && (
        <GameGuestEditor
          draft={guestDraft}
          setDraft={setGuestDraft}
          editingId={guestEditingId}
          busy={opBusy}
          onClose={() => setGuestFormOpen(false)}
          onSave={saveGuest}
          onPromote={() =>
            promoteGuestToManual(
              guestEditingId,
              guestDraft.display_name,
              guestDraft.email || "",
            )
          }
          onDelete={() => deleteGuest(guestEditingId)}
        />
      )}
      {geoPickOpen &&
        createPortal(
          <MapPickModal
            open
            initial={{
              lat: gameDraft.geo_lat ? Number(gameDraft.geo_lat) : null,
              lon: gameDraft.geo_lon ? Number(gameDraft.geo_lon) : null,
            }}
            onClose={() => setGeoPickOpen(false)}
            onPick={(value) => {
              setGameDraft((draft) => ({
                ...draft,
                geo_lat: value.lat != null ? String(value.lat) : "",
                geo_lon: value.lon != null ? String(value.lon) : "",
                geo_address: value.address || "",
              }));
              setGeoPickOpen(false);
            }}
          />,
          document.body,
        )}
    </>
  );
}
