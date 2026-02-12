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
  apiDelete,
  onReload,
  onChanged,
}) {
  const [draft, setDraft] = useState(null);
  const [premBusy, setPremBusy] = useState(false);

function fmtUntil(ts) {
  try {
    if (!ts) return "";
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  } catch { return ""; }
}

async function setPremium(op, extra = {}) {
  if (!player?.tg_id) return;
  setPremBusy(true);
  try {
    const r = await apiPost(`/api/admin/players/${player.tg_id}/joke-premium`, { op, ...extra });
    if (r?.ok) {
      // обновим player в sheet локально
      setDraft((d) => ({
        ...d,
        joke_premium: !!r.premium_lifetime,
        joke_premium_until: r.premium_until || null,
        joke_premium_active: !!r.premium,
      }));

      await onReload?.();
      await onChanged?.({ label: "✅ Премиум обновлён", refreshPlayers: true });
    }
  } finally {
    setPremBusy(false);
  }
}


useEffect(() => {
  if (!open || !player) return;

  const until = player.joke_premium_until ? new Date(player.joke_premium_until).getTime() : 0;
  const active = !!player.joke_premium || (until && until > Date.now());

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
    email: player.email || "",
    email_verified: !!player.email_verified,


    joke_premium: !!player.joke_premium,
    joke_premium_until: player.joke_premium_until || null,
    joke_premium_active: active,
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
      email: (draft.email || "").trim(),
      email_verified: !!draft.email_verified,
    };

    for (const k of SKILLS) body[k] = clampSkill(draft[k]);

    await apiPatch(`/api/admin/players/${draft.tg_id}`, body);

    await onReload?.();
    await onChanged?.({ label: "✅ Игрок сохранён — обновляю приложение…", refreshPlayers: true });
    notify("✅ Игрок сохранён");
    onClose?.();
  }


  async function deleteNonTgPlayer() {
    if (!draft?.tg_id) return;
    const ok = confirm("Удалить игрока из приложения? Вход по email для него будет недоступен.");
    if (!ok) return;

    try {
      const r = await apiDelete(`/api/admin/players/${draft.tg_id}`);
      if (!r?.ok) {
        notify(`❌ Не удалось удалить: ${r?.reason || "unknown"}`);
        return;
      }
      await onReload?.();
      await onChanged?.({ label: "✅ Игрок удалён", refreshPlayers: true });
      notify("✅ Игрок удалён");
      onClose?.();
    } catch (e) {
      notify("❌ Не удалось удалить игрока");
    }
  }


  async function promoteGuestToManual() {
    if (!draft?.tg_id) return;
    const ok = confirm("Перевести гостя в постоянные игроки (manual)?");
    if (!ok) return;

    const email = String(draft.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      notify("❌ Для перевода укажите корректный email");
      return;
    }

    try {
      const r = await apiPost(`/api/admin/players/${draft.tg_id}/promote`, { email });
      if (!r?.ok) {
        const reason = r?.reason || "unknown";
        if (reason === "email_in_use") notify("❌ Такой email уже используется");
        else if (reason === "not_guest") notify("⚠️ Этот игрок уже не гость");
        else notify(`❌ Не удалось перевести: ${reason}`);
        return;
      }

      setDraft((d) => ({
        ...d,
        player_kind: "manual",
        is_guest: false,
        email,
        email_verified: false,
      }));

      await onReload?.();
      await onChanged?.({ label: "✅ Гость переведён в постоянные игроки", refreshPlayers: true });
      notify("✅ Гость переведён в постоянные игроки");
    } catch (e) {
      notify("❌ Не удалось перевести гостя");
    }
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

        <label>Почта</label>
        <input
          className="input"
          type="email"
          placeholder="name@example.com"
          value={draft.email}
          onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
        />

        <div className="row" style={{ alignItems: "center" }}>
          <label style={{ margin: 0 }}>Почта подтверждена</label>
          <input type="checkbox" checked={!!draft.email_verified} onChange={(e) => setDraft((d) => ({ ...d, email_verified: e.target.checked }))} />
        </div>

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
          {isSuperAdmin && !draft?.is_guest ? (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="rowBetween">
                <div style={{ fontWeight: 900 }}>🌟 Премиум (реакции)</div>
                <span className="badgeMini">
                  {draft.joke_premium ? "lifetime" : (draft.joke_premium_active ? "active" : "off")}
                </span>
              </div>

              <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                {draft.joke_premium ? (
                  "Пожизненный премиум"
                ) : draft.joke_premium_until ? (
                  <>До: <b>{fmtUntil(draft.joke_premium_until)}</b></>
                ) : (
                  "Премиум не выдан"
                )}
              </div>

              <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                <button className="btn secondary" disabled={premBusy} onClick={() => setPremium("grant_days", { days: 1 })}>
                  +1 день
                </button>
                <button className="btn secondary" disabled={premBusy} onClick={() => setPremium("grant_days", { days: 7 })}>
                  +7 дней
                </button>
                <button className="btn secondary" disabled={premBusy} onClick={() => setPremium("grant_days", { days: 30 })}>
                  +30 дней
                </button>

                <button className="btn secondary" disabled={premBusy} onClick={() => setPremium("set_lifetime", { on: !draft.joke_premium })}>
                  {draft.joke_premium ? "Снять lifetime" : "Сделать lifetime"}
                </button>

                <button className="btn secondary" disabled={premBusy} onClick={() => setPremium("revoke_all")}>
                  🚫 Снять премиум
                </button>
              </div>
            </div>
          ) : null}


          {draft.player_kind === "guest" ? (
            <button className="btn secondary" onClick={promoteGuestToManual}>
              ⭐ Перевести в постоянные игроки
            </button>
          ) : null}

          {(["guest", "web", "manual"].includes(draft.player_kind)) ? (
            <button className="btn secondary" onClick={deleteNonTgPlayer}>
              🗑️ Удалить игрока из приложения
            </button>
          ) : null}

          <button className="btn secondary" onClick={onClose}>Готово</button>

        </div>
      </div>
    </Sheet>
  );
}
