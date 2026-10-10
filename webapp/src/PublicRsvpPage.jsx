import { useEffect, useMemo, useState } from "react";
import { celebrateRsvp } from "./rsvpFeedback.js";

function getTokenFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get("t") || sp.get("token") || "").trim();
}

function fmtWhen(starts_at) {
  try {
    return new Date(starts_at).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function PublicRsvpPage({ apiGet, apiPost }) {
  const token = useMemo(() => getTokenFromUrl(), []);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!token) {
        setErr("Нет токена в ссылке.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr("");
      try {
        const r = await apiGet(`/api/public/rsvp/info?t=${encodeURIComponent(token)}`);
        if (!alive) return;

        if (!r?.ok) {
          setErr(`Ошибка: ${r?.reason || r?.error || "unknown"}`);
          setInfo(null);
        } else {
          setInfo(r);
        }
      } catch (e) {
        if (!alive) return;
        setErr("Не удалось загрузить данные по ссылке.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => { alive = false; };
  }, [apiGet, token]);

  async function vote(status, event) {
    const origin = event?.currentTarget?.getBoundingClientRect();
    if (!token || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await apiPost("/api/public/rsvp", { token, status });
      if (!r?.ok) {
        setErr(`Ошибка: ${r?.reason || r?.error || "unknown"}`);
        return;
      }
      celebrateRsvp(status, origin);
      setDone(true);
    } catch {
      setErr("Не удалось отправить отметку.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        <h2>Отметка на игру</h2>
        <div>Загружаю…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        <h2>Отметка на игру</h2>
        <div style={{ opacity: 0.9 }}>{err}</div>
      </div>
    );
  }

  const game = info?.game;
  const player = info?.player;
  const current = info?.current_status || "maybe";

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", maxWidth: 520, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>Отметка на игру</h2>

      <div style={{ border: "1px solid rgba(0,0,0,.12)", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800 }}>
          {player?.name || "Игрок"} {player?.jersey_number != null ? `#${player.jersey_number}` : ""}
        </div>
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          📅 {game?.starts_at ? fmtWhen(game.starts_at) : "—"}
        </div>
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          📍 {game?.location || "—"}
        </div>

        <div style={{ marginTop: 10, opacity: 0.85 }}>
          Текущая отметка: <b>{current}</b>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <button
          onClick={e => vote("yes", e)}
          disabled={busy || done}
          style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,.12)", fontWeight: 800 }}
        >
          ✅ Буду
        </button>

        <button
          onClick={e => vote("no", e)}
          disabled={busy || done}
          style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,.12)", fontWeight: 800 }}
        >
          ❌ Не буду
        </button>

        <button
          onClick={() => vote("maybe")}
          disabled={busy || done}
          style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,.12)", fontWeight: 800, opacity: 0.9 }}
        >
          ⭕ Сбросить (не отмечено)
        </button>
      </div>

      {done ? (
        <div style={{ marginTop: 12, opacity: 0.9 }}>
          ✅ Готово! Отметка сохранена.
        </div>
      ) : null}

      {err ? (
        <div style={{ marginTop: 12, opacity: 0.9 }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}
