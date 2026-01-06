// src/admin/PlayerSheet.jsx
import React, { useEffect, useState } from "react";
import Sheet from "./Sheet.jsx";
import { showName, showNum, SKILLS, clampSkill } from "./adminUtils.js";

export default function PlayerSheet({
  open,
  player,
  isSuperAdmin,
  onClose,
  apiPatch,
  apiPost,
  onReload,
  onChanged,
}) {
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!open || !player) return;

    setDraft({
      tg_id: player.tg_id,
      display_name: player.display_name || "",
      player_kind: player.player_kind || "tg",
      jersey_number: player.jersey_number ?? "",
      position: (player.position || "F").toUpperCase(),
      skill: Number(player.skill ?? 5),
      skating: Number(player.skating ?? 5),
      iq: Number(player.iq ?? 5),
      stamina: Number(player.stamina ?? 5),
      passing: Number(player.passing ?? 5),
      shooting: Number(player.shooting ?? 5),
      notes: player.notes || "",
      disabled: !!player.disabled,
      is_admin: !!player.is_admin,
      is_guest: !!player.is_guest,
      username: player.username || "",
      first_name: player.first_name || "",
      is_env_admin: !!player.is_env_admin,
    });
  }, [open, player?.tg_id]);

  function notify(text) {
    const tg = window.Telegram?.WebApp;
    if (tg?.showAlert) tg.showAlert(text);
    else alert(text);
  }

  if (!open || !draft) return null;

  async function savePlayer() {
    const body = {
      display_name: (draft.display_name ?? "").trim(),
      jersey_number:
        draft.jersey_number === "" || draft.jersey_number == null
          ? null
          : Number(String(draft.jersey_number).replace(/[^\d]/g, "").slice(0, 2)),
      position: (draft.position || "F").toUpperCase(),
      notes: draft.notes ?? "",
      disabled: !!draft.disabled,
    };

    for (const k of SKILLS) body[k] = clampSkill(draft[k]);

    await apiPatch(`/api/admin/players/${draft.tg_id}`, body);

    await onReload?.();
    await onChanged?.({ label: "✅ Игрок сохранён — обновляю приложение…", refreshPlayers: true });
    notify("✅ Игрок сохранён");
    onClose?.();
  }

  async function toggleAdmin() {
    await apiPost(`/api/admin/players/${draft.tg_id}/admin`, { is_admin: !draft.is_admin });
    setDraft((d) => ({ ...d, is_admin: !d.is_admin }));

    await onReload?.();
    await onChanged?.({ label: "✅ Права обновлены — обновляю приложение…", refreshPlayers: true });
    notify("✅ Права обновлены");
  }

  return (
    <Sheet title={`Игрок: ${showName(draft)}${showNum(draft)}`} onClose={onClose}>
      <div className="card">
        <div className="small" style={{ opacity: 0.9 }}>
          tg_id: <b>{draft.tg_id}</b>
          {draft.username ? ` · @${draft.username}` : ""}
          {draft.player_kind === "manual" ? " · 👤 manual" : ""}
          {draft.is_env_admin ? " · 🔒 env-админ" : ""}
        </div>

        <label>Отображаемое имя</label>
        <input className="input" value={draft.display_name} onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))} />

        <label>Номер (0–99)</label>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="Например: 17"
          value={draft.jersey_number == null ? "" : String(draft.jersey_number)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, "");
            if (raw === "") return setDraft((d) => ({ ...d, jersey_number: null }));
            const n = Math.max(0, Math.min(99, parseInt(raw, 10)));
            setDraft((d) => ({ ...d, jersey_number: n }));
          }}
        />

        <label>Позиция</label>
        <select className="input" value={draft.position} onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value }))}>
          <option value="F">F</option>
          <option value="D">D</option>
          <option value="G">G</option>
        </select>

        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          {SKILLS.map((k) => (
            <div key={k} style={{ flex: 1, minWidth: 120 }}>
              <label>{k}</label>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="1–10"
                value={draft?.[k] == null ? "" : String(draft[k])}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, "");
                  if (raw === "") return setDraft((d) => ({ ...d, [k]: "" }));
                  const n = Math.max(1, Math.min(10, parseInt(raw, 10)));
                  setDraft((d) => ({ ...d, [k]: n }));
                }}
              />
            </div>
          ))}
        </div>

        <label>Заметки</label>
        <textarea className="input" rows={2} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />

        <div className="row" style={{ alignItems: "center" }}>
          <label style={{ margin: 0 }}>Отключить</label>
          <input type="checkbox" checked={!!draft.disabled} onChange={(e) => setDraft((d) => ({ ...d, disabled: e.target.checked }))} />
        </div>

        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={savePlayer}>Сохранить</button>

          {isSuperAdmin && !draft.is_guest && (
            <button className="btn secondary" onClick={toggleAdmin}>
              {draft.is_admin ? "Снять админа" : "Сделать админом"}
            </button>
          )}

          <button className="btn secondary" onClick={onClose}>Готово</button>
        </div>
      </div>
    </Sheet>
  );
}
