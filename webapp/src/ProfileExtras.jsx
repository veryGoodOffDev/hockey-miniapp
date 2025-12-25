import React, { useEffect, useState } from "react";
import { apiGet } from "./api.js";
import { apiUpload } from "./api.js";
import HockeyLoader from "./HockeyLoader.jsx";
import { useMemo } from "react";
import { CHANGELOG } from "./changelog.js";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "";

export function SupportForm() {
  const [category, setCategory] = useState("bug");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [sentId, setSentId] = useState(null);
  const [err, setErr] = useState(null);

  async function submit() {
    setErr(null);
    setSentId(null);

    if (!message.trim()) {
      setErr("Напиши текст обращения.");
      return;
    }

    setSending(true);
    try {
      const fd = new FormData();
      fd.append("category", category);
      fd.append("message", message.trim());
      fd.append("app_version", APP_VERSION);
      fd.append("platform", detectPlatform());

      for (const f of files.slice(0, 5)) fd.append("files", f);

      const r = await apiUpload("/api/feedback", fd);
      if (r?.ok) {
        setSentId(r.id);
        setMessage("");
        setFiles([]);
      } else {
        setErr(r?.error || "Не удалось отправить.");
      }
    } catch (e) {
      setErr(e?.error || e?.message || "Ошибка отправки");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="small" style={{ opacity: 0.85, lineHeight: 1.5 }}>
        Тут можно отправить баг/идею в поддержку. Желательно: что ожидал и что произошло.
        Скрины очень помогают.
      </div>

      <div style={{ marginTop: 12 }}>
        <label>Тип обращения</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="bug">🐞 Баг</option>
          <option value="feature">✨ Идея</option>
          <option value="question">❓ Вопрос</option>
          <option value="other">🗂 Другое</option>
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        <label>Сообщение</label>
        <textarea
          className="input"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Опиши проблему / предложение..."
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label>Скриншоты (до 5)</label>
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 5))}
        />
        {files.length ? (
          <div className="small" style={{ opacity: 0.85, marginTop: 6 }}>
            Прикреплено: {files.map((f) => f.name).join(", ")}
          </div>
        ) : null}
      </div>

      {err ? (
        <div className="small" style={{ marginTop: 10, color: "rgba(255,100,100,0.95)" }}>
          {err}
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 12, gap: 10, flexWrap: "wrap" }}>
        <button className="btn" onClick={submit} disabled={sending}>
          {sending ? "Отправляю..." : "Отправить"}
        </button>
        {sentId ? <span className="badge">✅ Отправлено · тикет #{sentId}</span> : null}
      </div>
    </div>
  );
}


export function AboutBlock() {
  const updates = useMemo(() => {
    const toKey = (s) => {
      const [dd, mm, yy] = String(s || "").split(".");
      return Number(`${yy}${mm}${dd}`) || 0; // YYYYMMDD
    };
    return [...(CHANGELOG || [])].sort((a, b) => toKey(b.released_at) - toKey(a.released_at));
  }, []);

  const current = updates[0] || null;                 // ✅ самая свежая запись
  const currentVersion = current?.version || "—";     // ✅ версия из changelog
  const currentDate = current?.released_at || "—";

  return (
    <div>
      <div className="small" style={{ lineHeight: 1.6 }}>
        <b>HockeyLineUp</b> — мини-приложение для отметок на игру, составов и статистики.
        <br />
        Версия: <b>v{currentVersion}</b> <span style={{ opacity: 0.8 }}>({currentDate})</span>
      </div>

      <hr />

      <div style={{ fontWeight: 900 }}>📦 История обновлений</div>

      {updates.length === 0 ? (
        <div className="small" style={{ opacity: 0.85 }}>Пока апдейтов нет.</div>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {updates.map((u) => (
            <div key={`${u.version}-${u.released_at}`} className="card" style={{ borderRadius: 12 }}>
              <div style={{ fontWeight: 900 }}>
                v{u.version} · {u.released_at}
              </div>

              {u.title ? (
                <div className="small" style={{ opacity: 0.85, marginTop: 4 }}>
                  {u.title}
                </div>
              ) : null}

              {u.body_md ? (
                <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                  {u.body_md}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad")) return "ios";
  if (ua.includes("android")) return "android";
  return "desktop";
}
