// AuthLanding.jsx
import { useState } from "react";

export default function AuthLanding({ telegramUrl, onDone }) {
  const [mode, setMode] = useState("landing"); // landing | email

  if (mode === "email") {
    // сюда позже вставишь EmailOtpLogin
    return (
      <div className="card">
        <h2>Email вход</h2>
        <div className="small">Тут будет OTP (код на почту).</div>

        {/* временная кнопка, чтобы проверить интеграцию */}
        <button className="btn" onClick={onDone}>Я вошёл (тест)</button>

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
