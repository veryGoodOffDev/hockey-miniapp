// AuthLanding.jsx
import { useEffect, useState } from "react";
import { apiPost, setAuthToken } from "./api.js";

export default function AuthLanding({ telegramUrl, onDone }) {
  const [mode, setMode] = useState("landing"); // landing | email
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("email"); // email | code | pending
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "email") {
      setStep("email");
      setMsg("");
      setCode("");
    }
  }, [mode]);

  async function sendCode() {
    setBusy(true);
    setMsg("");
    try {
      await apiPost("/api/auth/email/start", { email });
      setStep("code");
      setMsg("✅ Код отправлен на почту");
    } catch (e) {
      setMsg("❌ Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setBusy(true);
    setMsg("");
    try {
      const r = await apiPost("/api/auth/email/verify", { email, code });
      if (r?.token) {
        setAuthToken(r.token);
        onDone?.();
        return;
      }
      if (r?.status === "pending") {
        setStep("pending");
        setMsg("⏳ Заявка на вступление отправлена. Дождитесь подтверждения администратора.");
        return;
      }
      setMsg("❌ Не удалось войти");
    } catch (e) {
      const reason = e?.data?.reason || "";
      if (reason === "rejected") {
        setMsg("🚫 Заявка отклонена администратором");
      } else {
        setMsg("❌ Неверный код или срок действия истёк");
      }
    } finally {
      setBusy(false);
    }
  }

  if (mode === "email") {
    return (
      <div className="card">
        <h2>Email вход</h2>
        <div className="small">Войдите по коду из письма.</div>

        <div style={{ marginTop: 12 }}>
          <label>Почта</label>
          <input
            className="input"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || step === "pending"}
          />
        </div>

        {step === "code" ? (
          <div style={{ marginTop: 12 }}>
            <label>Код из письма</label>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
              disabled={busy}
            />
          </div>
        ) : null}

        {msg ? <div className="small" style={{ marginTop: 10 }}>{msg}</div> : null}

        <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
          {step === "email" ? (
            <button className="btn" onClick={sendCode} disabled={busy || !email}>
              Отправить код
            </button>
          ) : step === "code" ? (
            <>
              <button className="btn" onClick={verifyCode} disabled={busy || code.length < 4}>
                Войти
              </button>
              <button className="btn secondary" onClick={sendCode} disabled={busy}>
                Отправить код ещё раз
              </button>
            </>
          ) : null}
        </div>

        <button className="btn secondary" onClick={() => setMode("landing")} style={{ marginTop: 8 }}>
          Назад
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Вход</h2>
      <div className="small">
        Вы открыли приложение в браузере. Войдите одним из способов:
      </div>

      <div className="segRow" style={{ marginTop: 12 }}>
        <button className="segBtn active" onClick={() => setMode("email")}>
          Email (код)
        </button>

        <button className="segBtn" disabled title="В разработке">
          Google (скоро)
        </button>

        <button className="segBtn" disabled title="В разработке">
          SMS (скоро)
        </button>
      </div>

      {telegramUrl ? (
        <>
          <div className="small" style={{ marginTop: 14 }}>
            Или откройте через Telegram:
          </div>
          <a className="btn secondary" href={telegramUrl} target="_blank" rel="noreferrer">
            Открыть в Telegram
          </a>
        </>
      ) : (
        <div className="small" style={{ marginTop: 14 }}>
          Не задан VITE_BOT_USERNAME
        </div>
      )}
    </div>
  );
}
