// src/admin/GameSheet.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Sheet from "./Sheet.jsx";
import MapPickModal from "./MapPickModal.jsx";
import { toLocal, toIsoFromLocal, showName, showNum, posLabel, GUEST_DEFAULT } from "./adminUtils.js";

export default function GameSheet({
  open,
  game, // объект игры, по которому открываем
  onClose,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  onReload,  // например: () => load({silent:true})
  onChanged, // твой onChanged
}) {
  const [gameDraft, setGameDraft] = useState(null);

    // info blocks (notice + info)
  const [noticeText, setNoticeText] = useState("");
  const [infoText, setInfoText] = useState("");
  const [infoSaving, setInfoSaving] = useState(false);

  // reminder
// reminders (list)
const [reminders, setReminders] = useState([]);
const [remLoading, setRemLoading] = useState(false);

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
  setReminders((prev) => prev.map((x) => (keyOfRem(x) === k ? { ...x, ...patch } : x)));
}



  // guests
  const [guestsState, setGuestsState] = useState({ loading: false, list: [] });
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
      try { tg.showConfirm(String(message || ""), (ok) => resolve(!!ok)); }
      catch { resolve(false); }
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
      pushToast("❌ Ошибка", "err");
      notify("❌ Ошибка"); // можешь потом убрать, если не хочешь модалки

      return false;
    } finally {
      setOpBusy(false);
    }
  }

  /** init draft on open */
  useEffect(() => {
    if (!isOpen) return;

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
    setGuestFormOpen(false);
    setGuestEditingId(null);
    setGuestDraft({ ...GUEST_DEFAULT });

    setAttendanceRows([]);
    setAttLoading(false);

    setTokenMsg("");
    setTokenBusy(false);
    setTokenUrl("");
    setTokenValue("");
    setTokenForId(null);

    // загрузки
    loadGuestsForGame(game.id);
    loadAttendanceForGame(game.id);
    loadRemindersForGame(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, game?.id]);

    useEffect(() => {
    if (!isOpen || !game) return;
    setNoticeText(game.notice_text || "");
    setInfoText(game.info_text || "");
  }, [isOpen, game?.id, game?.notice_text, game?.info_text]);

//   useEffect(() => {
//   if (!isOpen || !game) return;

//   setRemEnabled(!!game.reminder_enabled);
//   setRemPin(game.reminder_pin !== false);

//   // reminder_at (timestamptz) -> datetime-local
//   if (game.reminder_at) {
//     const d = new Date(game.reminder_at);
//     const pad = (n) => String(n).padStart(2, "0");
//     const local =
//       `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
//       `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
//     setRemAt(local);
//   } else {
//     setRemAt("");
//   }
// }, [
//   isOpen,
//   game?.id,
//   game?.reminder_enabled,
//   game?.reminder_pin,
//   game?.reminder_at,
// ]);

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

async function saveReminderSettings() {
  if (!gameDraft?.id) return;

  if (remEnabled && !remAt) {
    alert("Укажи дату/время напоминания");
    return;
  }

  let reminder_at = null;
  if (remEnabled && remAt) {
    const [d, t] = remAt.split("T");
    if (!d || !t) {
      alert("Некорректная дата/время напоминания");
      return;
    }
    reminder_at = toIsoFromLocal(d, t);
  }

  setRemSaving(true);
  try {
    const ok = await runOp("save reminder", async () => {
      const r = await apiPatch(`/api/admin/games/${gameDraft.id}/reminder`, {
        reminder_enabled: remEnabled,
        reminder_at,
        reminder_pin: remPin,
        reset_sent: true, // чтобы отправилось заново при изменении времени
      });

      // ВАЖНО: иначе можно "успешно" сохранить в никуда и не заметить
      if (!r?.ok) throw new Error(r?.reason || r?.error || "reminder_save_failed");
    });

    if (!ok) return;

    await onReload?.(gameDraft.id); // <-- передай id, у тебя onReload умеет его принять
    await onChanged?.({ label: "✅ Напоминание сохранено — обновляю приложение…", gameId: gameDraft.id });

    notify("✅ Напоминание сохранено");
  } finally {
    setRemSaving(false);
  }
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


async function saveInfoBlocks() {
  if (!gameDraft?.id) return;

  const notice = String(noticeText ?? "").replace(/\r\n/g, "\n").trim();
  const info = String(infoText ?? "").replace(/\r\n/g, "\n").trim();

  if (notice && notice.length > 240) {
    alert("❌ Короткая заметка должна быть до 240 символов");
    return;
  }

  setInfoSaving(true);
  try {
    const ok = await runOp("save info blocks", async () => {
      const r = await apiPatch(`/api/games/${gameDraft.id}`, {
        notice_text: notice,     // пустое -> сервер сам положит null (у тебя так сделано)
        info_text: info,
      });
      if (!r?.ok) throw new Error(r?.reason || r?.error || "info_save_failed");
    });

    if (!ok) return;

    await onReload?.(gameDraft.id);
    await onChanged?.({ label: "✅ Информация по игре сохранена — обновляю приложение…", gameId: gameDraft.id });

    notify("✅ Информация сохранена");
  } finally {
    setInfoSaving(false);
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
    const r = await apiPatch(`/api/admin/reminders/${row.id}`, { reset_sent: true });
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
    setGuestDraft({ ...GUEST_DEFAULT });
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
  if (st === "yes") return "✅ был";
  if (st === "no") return "❌ не был";
  return "⭕ не отмечено";
}

async function setAttend(pOrId, nextStatus) {
  if (!gameDraft?.id) return;

  const tg_id = typeof pOrId === "object" ? pOrId.tg_id : pOrId;
  const row = typeof pOrId === "object"
    ? pOrId
    : attendanceRows.find(x => String(x.tg_id) === String(tg_id));

  const cur = (row?.status || "maybe");
  if (cur === nextStatus) {
    pushToast(`Уже: ${attendLabel(cur)}`, "warn");
    return;
  }

  const name = row ? `${showName(row)}${showNum(row) ? ` #${showNum(row)}` : ""}` : `ID ${tg_id}`;

  const ok = await askConfirm(`Изменить статус для ${name} на "${attendLabel(nextStatus)}"?`);
  if (!ok) return;

  const success = await runOp("save attend", async () => {
    await apiPost("/api/admin/rsvp", { game_id: gameDraft.id, tg_id, status: nextStatus });

    setAttendanceRows((prev) =>
      prev.map((x) => (String(x.tg_id) === String(tg_id) ? { ...x, status: nextStatus } : x))
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

      const url = r?.url || (token ? `${window.location.origin}/rsvp?t=${encodeURIComponent(token)}` : "");
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

    await runOp("save guest", async () => {
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
      await onReload?.();
      await onChanged?.({ label: "✅ Гости обновлены — обновляю приложение…", gameId: gameDraft.id });
    });

    notify("✅ Сохранено");
  }

  async function deleteGuest(tgId) {
    const ok = confirm("Удалить гостя? (Он исчезнет из списков и состава)");
    if (!ok) return;

    await runOp("delete guest", async () => {
      await apiDelete(`/api/admin/players/${tgId}`);

      if (gameDraft) {
        await loadGuestsForGame(gameDraft.id);
        await loadAttendanceForGame(gameDraft.id);
      }
      await onReload?.();
      await onChanged?.({ label: "✅ Гость удалён — обновляю приложение…", gameId: gameDraft?.id });
    });

    notify("✅ Удалено");
  }

  async function promoteGuestToManual(tg_id) {
    const ok = confirm("Сделать этого гостя постоянным игроком команды (без Telegram)?");
    if (!ok) return;

    await runOp("promote guest", async () => {
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
      await onReload?.();
      await onChanged?.({ label: "✅ Состав игроков обновлён — обновляю приложение…", refreshPlayers: true, gameId: gameDraft?.id });
    });

    notify("✅ Переведено");
  }

  /** game ops */
  async function saveGame() {
    if (!gameDraft) return;

    await runOp("save game", async () => {
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
        geo_lon,
      });

      await onReload?.();
      await onChanged?.({ label: "✅ Игра сохранена — обновляю приложение…", gameId: gameDraft.id });
    });

    notify("✅ Игра сохранена");
    close();
  }

  async function setGameStatus(status) {
    if (!gameDraft) return;

    await runOp("set status", async () => {
      await apiPost(`/api/games/${gameDraft.id}/status`, { status });
      setGameDraft((d) => ({ ...d, status }));

      await onReload?.();
      await onChanged?.({ label: "✅ Статус обновлён — обновляю приложение…", gameId: gameDraft.id });
    });

    notify("✅ Статус обновлён");
  }

  async function deleteGame() {
    if (!gameDraft) return;
    const ok = confirm(`Удалить игру #${gameDraft.id}?`);
    if (!ok) return;

    await runOp("delete game", async () => {
      await apiDelete(`/api/games/${gameDraft.id}`);

      await onReload?.();
      await onChanged?.({ label: "✅ Игра удалена — обновляю приложение…", gameId: gameDraft.id });
    });

    notify("✅ Игра удалена");
    close();
  }

  function GuestPill({ g }) {
    const status = g.status || "yes";
    const tone = status === "yes" ? "guestPill yes" : status === "maybe" ? "guestPill maybe" : "guestPill no";

    return (
      <div className={tone}>
        <div className="guestPillMain">
          <span className="guestTag">ГОСТЬ</span>
          <span className="guestName">
            {showName(g)}
            {showNum(g)}
          </span>
          <span className="guestMeta">({posLabel((g.position || "F").toUpperCase())})</span>
          <span className="guestStatus">
            {status === "yes" ? "✅ будет" : status === "maybe" ? "❓ под вопросом" : "❌ не будет"}
          </span>
        </div>
        <div className="guestPillActions">
          <button className="iconBtn" title="Ссылка на отметку" disabled={tokenBusy} onClick={() => createRsvpLink(g.tg_id)}>
            🔗
          </button>
          <button className="iconBtn" title="Сделать игроком команды (manual)" onClick={() => promoteGuestToManual(g.tg_id)}>
            ⭐
          </button>
          <button className="iconBtn" title="Изменить" onClick={() => openEditGuest(g)}>
            ✏️
          </button>
          <button className="iconBtn" title="Удалить" onClick={() => deleteGuest(g.tg_id)}>
            🗑️
          </button>
        </div>
      </div>
    );
  }

  // список для админки: предстоящие/прошедшие у тебя снаружи, здесь не надо
  const title = gameDraft ? `Игра #${gameDraft.id}` : "Игра";

  if (!isOpen || !gameDraft) return null;

  return (
    <>
      <style>{`
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

      <Sheet title={title} onClose={close}>
        {toast ? (
          <div className={`gsToast ${toast.kind}`} role="status" aria-live="polite">
            {toast.text}
          </div>
        ) : null}

        <div className="card">
          <div className="card" style={{ marginTop: 12 }}>
            <div className="rowBetween">
              <h3 style={{ margin: 0 }}>⏰ Напоминания по этой игре</h3>

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
              <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>Загрузка…</div>
            ) : null}

            {!remLoading && reminders.length === 0 ? (
              <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
                Пока нет напоминаний
              </div>
            ) : null}

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {reminders.map((r) => (
                <div
                  key={keyOfRem(r)}
                  className="row"
                  style={{
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 10,
                    background: "var(--card-bg)",
                  }}
                >
                  <label className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!r.enabled}
                      onChange={(e) => updateReminderRow(r, { enabled: e.target.checked })}
                    />
                    <span>Вкл</span>
                  </label>

                  <input
                    className="input"
                    type="datetime-local"
                    value={r.local_at || ""}
                    onChange={(e) => updateReminderRow(r, { local_at: e.target.value })}
                    style={{ minWidth: 220 }}
                    disabled={!r.enabled}
                  />

                  <label className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={r.pin !== false}
                      onChange={(e) => updateReminderRow(r, { pin: e.target.checked })}
                      disabled={!r.enabled}
                    />
                    <span>Закрепить</span>
                  </label>

                  <div className="small" style={{ opacity: 0.85 }}>
                    {r.sent_at ? (
                      <>✅ Отправлено: <b>{formatWhen(r.sent_at)}</b></>
                    ) : (
                      <>⏳ Не отправлено</>
                    )}
                    {r.last_error ? (
                      <div style={{ marginTop: 4, opacity: 0.9 }}>⚠️ {String(r.last_error).slice(0, 140)}</div>
                    ) : null}
                  </div>

                  <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
                    {r.id && r.sent_at ? (
                      <button className="btn secondary" type="button" onClick={() => resetReminderSent(r)} disabled={r.saving || opBusy}>
                        ↻ Сбросить
                      </button>
                    ) : null}

                    <button className="btn" type="button" onClick={() => saveReminderRow(r)} disabled={r.saving || opBusy}>
                      {r.saving ? "…" : "Сохранить"}
                    </button>

                    <button className="iconBtn" type="button" title="Удалить" onClick={() => deleteReminderRow(r)} disabled={r.saving || opBusy}>
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>


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
              style={{ paddingRight: 20 }}
              type="date"
              value={gameDraft.date}
              onChange={(e) => setGameDraft((d) => ({ ...d, date: e.target.value }))}
            />
          </div>

          <label>Время</label>
          <div className="iosField">
            <input
              className="input"
              style={{ paddingRight: 20 }}
              type="time"
              value={gameDraft.time}
              onChange={(e) => setGameDraft((d) => ({ ...d, time: e.target.value }))}
            />
          </div>

          <label>Арена</label>
          <input className="input" value={gameDraft.location} onChange={(e) => setGameDraft((d) => ({ ...d, location: e.target.value }))} />
                    {/* ====== INFO / NOTICE ====== */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="rowBetween">
              <h3 style={{ margin: 0 }}>ℹ️ Информация по игре</h3>

              <button
                className="btn"
                onClick={saveInfoBlocks}
                disabled={infoSaving || opBusy}
                title="Сохранить важную информацию"
              >
                {infoSaving ? "…" : "Сохранить"}
              </button>
            </div>

            <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
              Коротко (видно в списке игр), до 240 символов
            </div>

            <input
              className="input"
              value={noticeText}
              maxLength={240}
              onChange={(e) => setNoticeText(e.target.value)}
              placeholder="Напр: Внимание! Игра в ВС в 7:30, просьба быть вовремя."
            />

            <div className="small" style={{ marginTop: 6, opacity: 0.7 }}>
              {String(noticeText || "").trim().length}/240
            </div>

            <div className="small" style={{ marginTop: 10, opacity: 0.85 }}>
              Подробно (видно в деталке)
            </div>

            <textarea
              className="input"
              rows={4}
              value={infoText}
              onChange={(e) => setInfoText(e.target.value)}
              placeholder="Оплата, сбор, форма, нюансы льда, что взять и т.д."
              style={{ resize: "vertical", whiteSpace: "pre-wrap" }}
            />

            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn secondary"
                type="button"
                onClick={() => { setNoticeText(""); setInfoText(""); }}
                disabled={infoSaving || opBusy}
                title="Очистить поля (и нажать Сохранить)"
              >
                Очистить
              </button>

              {(noticeText || infoText) ? (
                <span className="badge" title="Будет видно в списке/деталке">✅ будет показано</span>
              ) : (
                <span className="small" style={{ opacity: 0.8 }}>Поля пустые — блоки не отображаются</span>
              )}
            </div>
          </div>

          <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <button className="btn secondary" onClick={() => setGeoPickOpen(true)} disabled={!gameDraft}>
              🗺️ Выбрать на карте
            </button>

            <button className="btn secondary" onClick={() => setGameDraft((d) => ({ ...d, geo_lat: "", geo_lon: "" }))} disabled={!gameDraft}>
              🗑 Убрать точку
            </button>

            {gameDraft?.geo_lat && gameDraft?.geo_lon ? (
              <span className="badge">📍 {gameDraft.geo_lat}, {gameDraft.geo_lon}</span>
            ) : (
              <span className="small" style={{ opacity: 0.8 }}>Геоточка не выбрана</span>
            )}
          </div>

          <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={saveGame} disabled={opBusy}>
              {opBusy ? "…" : "Сохранить"}
            </button>

            {gameDraft.status === "cancelled" ? (
              <button className="btn secondary" onClick={() => setGameStatus("scheduled")} disabled={opBusy}>
                Вернуть (заплан.)
              </button>
            ) : (
              <button className="btn secondary" onClick={() => setGameStatus("cancelled")} disabled={opBusy}>
                Отменить
              </button>
            )}

            <button className="btn secondary" onClick={deleteGame} disabled={opBusy}>
              {opBusy ? "…" : "Удалить"}
            </button>
          </div>

          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button className="btn secondary" onClick={() => setVideoOpen((v) => !v)}>
              {videoOpen ? "Скрыть видео" : gameDraft.video_url ? "Изменить видео" : "Добавить видео"}
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
              <div className="row" style={{ marginTop: 10, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label className="row" style={{ gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={videoNotifySilent}
                  onChange={(e) => setVideoNotifySilent(e.target.checked)}
                />
                <span className="small" style={{ opacity: 0.9 }}>Отправить без звука</span>
              </label>

              <button
                className="btn"
                type="button"
                onClick={sendVideoNotify}
                disabled={!String(gameDraft.video_url || "").trim()}
                title="Отправить сообщение в командный чат"
              >
                🎬 Отправить в чат
              </button>
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
              <button className="btn secondary" onClick={() => loadAttendanceForGame(gameDraft.id)}>Обновить</button>
            </div>

            {tokenMsg && <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>{tokenMsg}</div>}

            {attLoading ? (
              <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>Загружаю игроков…</div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {attendanceRows.map((p) => {
                  const st = p.status || "maybe";
                  return (
                    <div
                      key={p.tg_id}
                      className="listItem"
                      ref={(el) => {
                        if (el && tokenForId === p.tg_id) {
                          setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
                        }
                      }}
                    >
                      <div className="rowBetween">
                        <div style={{ fontWeight: 900 }}>
                          {showName(p)}
                          {showNum(p)}
                        </div>

                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <span className="badgeMini">{st}</span>
                          <button className="iconBtn" type="button" title="Ссылка на отметку" disabled={tokenBusy} onClick={() => createRsvpLink(p.tg_id)}>
                            🔗
                          </button>
                        </div>
                      </div>

                      <div className="segRow segRow--icons" role="radiogroup" aria-label="Посещаемость">
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

                              <button className="btn secondary" type="button" disabled={tokenBusy || !tokenValue} onClick={revokeToken}>
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

                            {tokenMsg && <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>{tokenMsg}</div>}
                          </div>
                        )}

                      <button
                        className={`segBtn segIcon ${st === "yes" ? "on" : ""}`}
                        onClick={() => setAttend(p, "yes")}
                        type="button"
                        title="Был"
                        aria-label="Был"
                        aria-pressed={st === "yes"}
                      >
                        ✅
                      </button>

                      <button
                        className={`segBtn segIcon ${st === "no" ? "on" : ""}`}
                        onClick={() => setAttend(p, "no")}
                        type="button"
                        title="Не был"
                        aria-label="Не был"
                        aria-pressed={st === "no"}
                      >
                        ❌
                      </button>

                      <button
                        className={`segBtn segIcon ${st === "maybe" ? "on" : ""}`}
                        onClick={() => setAttend(p, "maybe")}
                        type="button"
                        title="Не отмечено"
                        aria-label="Не отмечено"
                        aria-pressed={st === "maybe"}
                      >
                        ❓
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
                <div style={{ fontWeight: 900 }}>{guestEditingId ? "Редактировать гостя" : "Добавить гостя"}</div>
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
                  <select className="input" value={guestDraft.position} onChange={(e) => setGuestDraft((d) => ({ ...d, position: e.target.value }))}>
                    <option value="F">F (нападающий)</option>
                    <option value="D">D (защитник)</option>
                    <option value="G">G (вратарь)</option>
                  </select>
                </div>

                <div className="full">
                  <label>Статус на игру</label>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className={guestDraft.status === "yes" ? "btn" : "btn secondary"} onClick={() => setGuestDraft((d) => ({ ...d, status: "yes" }))}>
                      ✅ Будет
                    </button>
                    <button className={guestDraft.status === "maybe" ? "btn" : "btn secondary"} onClick={() => setGuestDraft((d) => ({ ...d, status: "maybe" }))}>
                      ❓ Под вопросом
                    </button>
                    <button className={guestDraft.status === "no" ? "btn" : "btn secondary"} onClick={() => setGuestDraft((d) => ({ ...d, status: "no" }))}>
                      ❌ Не будет
                    </button>
                  </div>
                </div>

                <div className="row full" style={{ gap: 10, flexWrap: "wrap" }}>
                  {["skill", "skating", "iq", "stamina", "passing", "shooting"].map((k) => (
                    <div key={k} style={{ flex: 1, minWidth: 130 }}>
                      <label>{k}</label>
                      <input className="input" type="number" min={1} max={10} value={guestDraft[k]} onChange={(e) => setGuestDraft((d) => ({ ...d, [k]: Number(e.target.value || 5) }))} />
                    </div>
                  ))}
                </div>

                <div className="full">
                  <label>Заметки</label>
                  <textarea className="input" rows={2} value={guestDraft.notes} onChange={(e) => setGuestDraft((d) => ({ ...d, notes: e.target.value }))} />
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

      <MapPickModal
        open={geoPickOpen}
        initial={{
          lat: gameDraft?.geo_lat ? Number(gameDraft.geo_lat) : null,
          lon: gameDraft?.geo_lon ? Number(gameDraft.geo_lon) : null,
        }}
        onClose={() => setGeoPickOpen(false)}
        onPick={(v) => {
          const lat = v.lat != null ? String(v.lat) : "";
          const lon = v.lon != null ? String(v.lon) : "";
          setGameDraft((d) => (d ? { ...d, geo_lat: lat, geo_lon: lon, geo_address: v.address || "" } : d));
          setGeoPickOpen(false);
        }}
      />
    </>
  );
}
