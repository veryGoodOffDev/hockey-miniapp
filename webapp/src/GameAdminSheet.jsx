import { useEffect, useMemo, useState } from "react";

function pad(n) { return String(n).padStart(2, "0"); }

function toLocalParts(iso) {
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function toIsoFromLocal(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}`);
  return d.toISOString();
}

function toDatetimeLocalValue(isoOrNull) {
  if (!isoOrNull) return "";
  const d = new Date(isoOrNull);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="sheetBackdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheetHeader">
          <button className="sheetBtn" onClick={onClose}>← Назад</button>
          <div className="sheetTitle">{title}</div>
          <button className="sheetBtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheetBody">{children}</div>
      </div>
    </div>
  );
}

export default function GameAdminSheet({
  open,
  game,
  onClose,
  apiPost,
  apiPatch,
  apiDelete,
  onSaved,
}) {
  const [draft, setDraft] = useState(null);

  // reminders local state
  const [remEnabled, setRemEnabled] = useState(false);
  const [remAt, setRemAt] = useState(""); // datetime-local string
  const [remPin, setRemPin] = useState(true);
  const [busy, setBusy] = useState(false);

  // init when opened / game changed
  useEffect(() => {
    if (!open || !game) return;

    const dt = toLocalParts(game.starts_at);

    setDraft({
      id: game.id,
      status: game.status || "scheduled",
      location: game.location || "",
      date: dt.date,
      time: dt.time,
      video_url: game.video_url || "",
      geo_lat: game.geo_lat == null ? "" : String(game.geo_lat),
      geo_lon: game.geo_lon == null ? "" : String(game.geo_lon),
    });

    setRemEnabled(!!game.reminder_enabled);
    setRemPin(game.reminder_pin === undefined ? true : !!game.reminder_pin);
    setRemAt(toDatetimeLocalValue(game.reminder_at));
  }, [open, game?.id]);

  const title = useMemo(() => (draft ? `Игра #${draft.id}` : "Игра"), [draft]);

  if (!open || !draft) return null;

  async function saveGameOnly() {
    setBusy(true);
    try {
      const starts_at = toIsoFromLocal(draft.date, draft.time);

      const latStr = String(draft.geo_lat ?? "").replace(",", ".").trim();
      const lonStr = String(draft.geo_lon ?? "").replace(",", ".").trim();

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

      await apiPatch(`/api/games/${draft.id}`, {
        starts_at,
        location: draft.location,
        status: draft.status,
        video_url: draft.video_url || "",
        geo_lat,
        geo_lon,
      });

      await onSaved?.(draft.id);
      alert("✅ Игра сохранена");
      onClose?.();
    } finally {
      setBusy(false);
    }
  }

  async function saveReminderOnly() {
    setBusy(true);
    try {
      const reminder_at = remEnabled && remAt ? new Date(remAt).toISOString() : null;

      if (remEnabled && !reminder_at) {
        alert("❌ Укажи дату/время напоминания");
        return;
      }

      await apiPatch(`/api/admin/games/${draft.id}/reminder`, {
        reminder_enabled: remEnabled,
        reminder_at,
        reminder_pin: remPin,
        reset_sent: true,
      });

      await onSaved?.(draft.id);
      alert("✅ Напоминание сохранено");
      onClose?.();
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    setBusy(true);
    try {
      const next = draft.status === "cancelled" ? "scheduled" : "cancelled";
      await apiPost(`/api/games/${draft.id}/status`, { status: next });
      setDraft((d) => ({ ...d, status: next }));
      await onSaved?.(draft.id);
    } finally {
      setBusy(false);
    }
  }

  async function deleteGame() {
    const ok = confirm(`Удалить игру #${draft.id}?`);
    if (!ok) return;

    setBusy(true);
    try {
      await apiDelete(`/api/games/${draft.id}`);
      await onSaved?.(draft.id);
      alert("✅ Игра удалена");
      onClose?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      {/* ВАЖНО: если раньше эти стили были в AdminPanel, а ты его уберёшь — перенеси стили сюда */}
      <style>{`
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
        .sheetBtn{
          border:1px solid var(--border);
          background: transparent;
          border-radius: 12px;
          padding: 6px 10px;
          cursor:pointer;
          font-weight: 900;
        }
      `}</style>

      {/* ОСНОВНОЕ */}
      <div className="card">
        <div className="rowBetween">
          <div className="small" style={{ opacity: 0.9 }}>
            Статус: <b>{draft.status}</b>
          </div>
          <span className="badge">{draft.status}</span>
        </div>

        <label>Дата</label>
        <input className="input" type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />

        <label>Время</label>
        <input className="input" type="time" value={draft.time} onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))} />

        <label>Арена</label>
        <input className="input" value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} />

        <label>Геоточка (lat/lon)</label>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="lat" value={draft.geo_lat}
            onChange={(e) => setDraft((d) => ({ ...d, geo_lat: e.target.value.replace(",", ".") }))} />
          <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="lon" value={draft.geo_lon}
            onChange={(e) => setDraft((d) => ({ ...d, geo_lon: e.target.value.replace(",", ".") }))} />
        </div>

        <label>Видео (YouTube)</label>
        <input
          className="input"
          value={draft.video_url}
          placeholder="https://www.youtube.com/watch?v=..."
          onChange={(e) => setDraft((d) => ({ ...d, video_url: e.target.value }))}
        />

        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={saveGameOnly} disabled={busy}>{busy ? "…" : "Сохранить игру"}</button>
          <button className="btn secondary" onClick={toggleStatus} disabled={busy}>
            {draft.status === "cancelled" ? "Вернуть (scheduled)" : "Отменить"}
          </button>
          <button className="btn secondary" onClick={deleteGame} disabled={busy}>{busy ? "…" : "Удалить"}</button>
        </div>
      </div>

      {/* НАПОМИНАНИЕ */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ margin: 0 }}>⏰ Напоминание по этой игре</h3>

        <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={remEnabled} onChange={(e) => setRemEnabled(e.target.checked)} />
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
            <input type="checkbox" checked={remPin} onChange={(e) => setRemPin(e.target.checked)} disabled={!remEnabled} />
            <span>Закрепить</span>
          </label>

          <button className="btn" onClick={saveReminderOnly} disabled={busy}>
            {busy ? "…" : "Сохранить напоминание"}
          </button>
        </div>

        {game?.reminder_sent_at ? (
          <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
            Уже отправлено: <b>{new Date(game.reminder_sent_at).toLocaleString("ru-RU")}</b>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
