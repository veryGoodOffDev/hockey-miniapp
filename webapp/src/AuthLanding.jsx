import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost, setAuthToken } from "./api.js";

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function maskEmail(email) {
  const s = String(email || "");
  const [u, d] = s.split("@");
  if (!u || !d) return s;
  const head = u.slice(0, 2);
  return `${head}${u.length > 2 ? "••••" : ""}@${d}`;
}

function OTP6({ value, onChange, disabled, autoFocus }) {
  const refs = useRef([]);
  const digits = useMemo(() => {
    const clean = String(value || "").replace(/\D/g, "").slice(0, 6);
    return Array.from({ length: 6 }, (_, i) => clean[i] || "");
  }, [value]);

  const setAt = (idx, ch) => {
    const arr = digits.slice();
    arr[idx] = ch;
    onChange(arr.join("").replace(/\D/g, "").slice(0, 6));
  };

  const focus = (i) => {
    const el = refs.current[i];
    if (el) {
      el.focus();
      el.select?.();
    }
  };

  useEffect(() => {
    if (autoFocus) focus(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const handleChange = (idx, e) => {
    if (disabled) return;
    const raw = e.target.value ?? "";
    const cleaned = String(raw).replace(/\D/g, "");

    // если вставили/ввели сразу много цифр — распределяем
    if (cleaned.length > 1) {
      const next = digits.slice();
      let j = 0;
      for (let i = idx; i < 6 && j < cleaned.length; i++, j++) {
        next[i] = cleaned[j];
      }
      onChange(next.join("").replace(/\D/g, "").slice(0, 6));
      focus(Math.min(5, idx + cleaned.length));
      return;
    }

    const ch = cleaned.slice(0, 1);
    setAt(idx, ch);
    if (ch && idx < 5) focus(idx + 1);
  };

  const handleKeyDown = (idx, e) => {
    if (disabled) return;

    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[idx]) {
        setAt(idx, "");
        return;
      }
      if (idx > 0) {
        setAt(idx - 1, "");
        focus(idx - 1);
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (idx > 0) focus(idx - 1);
      return;
    }

    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (idx < 5) focus(idx + 1);
      return;
    }

    // разрешаем только цифры
    if (e.key.length === 1 && /\D/.test(e.key)) {
      e.preventDefault();
    }
  };

  const handlePaste = (idx, e) => {
    if (disabled) return;
    const text = e.clipboardData?.getData("text") ?? "";
    const cleaned = String(text).replace(/\D/g, "").slice(0, 6);
    if (!cleaned) return;

    e.preventDefault();
    const next = digits.slice();
    let j = 0;
    for (let i = idx; i < 6 && j < cleaned.length; i++, j++) {
      next[i] = cleaned[j];
    }
    onChange(next.join("").replace(/\D/g, "").slice(0, 6));
    focus(Math.min(5, idx + cleaned.length - 1));
  };

  return (
    <div className="otpRow" role="group" aria-label="Код из 6 цифр">
      {digits.map((d, idx) => (
        <input
          key={idx}
          ref={(el) => (refs.current[idx] = el)}
          className="otpBox"
          value={d}
          onChange={(e) => handleChange(idx, e)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={(e) => handlePaste(idx, e)}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={idx === 0 ? "one-time-code" : "off"}
          enterKeyHint={idx === 5 ? "done" : "next"}
          maxLength={1}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

export default function AuthLanding({
  telegramUrl,
  onDone,

  // брендинг (просто прокинь строки-пути)
  teamName = "Mighty Sheep",
  teamSubtitle = "Вход в приложение",
  teamCoverSrc = "/brand/cover.jpg",
  teamLogoSrc = "/brand/logo.png",
}) {
  const [screen, setScreen] = useState("landing"); // landing | email
  const [step, setStep] = useState("email"); // email | code | pending
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [otpShake, setOtpShake] = useState(0);
  const [otpError, setOtpError] = useState(false);

  const lastAutoVerifyRef = useRef("");

  const canSend = isValidEmail(email) && !busy && step !== "pending" && cooldown === 0;
  const otpClean = otp.replace(/\D/g, "").slice(0, 6);
  const canVerify = otpClean.length === 6 && !busy && step === "code";

  useEffect(() => {
    if (screen !== "email") {
      setStep("email");
      setOtp("");
      setMsg("");
      setBusy(false);
      setCooldown(0);
      setOtpError(false);
      lastAutoVerifyRef.current = "";
    }
  }, [screen]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // авто-верификация, как только введены 6 цифр
  useEffect(() => {
    if (step !== "code") return;
    if (busy) return;
    if (otpClean.length !== 6) return;

    if (lastAutoVerifyRef.current === otpClean) return;
    lastAutoVerifyRef.current = otpClean;

    // небольшая задержка для “ощущения” завершения ввода
    const t = setTimeout(() => {
      verifyCode(otpClean);
    }, 120);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpClean, step, busy]);

  async function sendCode() {
    setBusy(true);
    setMsg("");
    setOtp("");
    setOtpError(false);
    lastAutoVerifyRef.current = "";

    try {
      await apiPost("/api/auth/email/start", { email: String(email).trim() });
      setStep("code");
      setCooldown(30);
      setMsg("Код отправлен на почту. Введите 6 цифр из письма.");
    } catch (e) {
      setMsg("Не удалось отправить код. Проверьте почту и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(codeArg) {
    const code = (codeArg ?? otpClean).replace(/\D/g, "").slice(0, 6);

    setBusy(true);
    setMsg("");
    setOtpError(false);

    try {
      const r = await apiPost("/api/auth/email/verify", { email: String(email).trim(), code });

      if (r?.token) {
        setAuthToken(r.token);
        onDone?.();
        return;
      }

      if (r?.status === "pending") {
        setStep("pending");
        setMsg("Заявка отправлена. Дождитесь подтверждения администратора.");
        return;
      }

      // на всякий случай
      setOtpError(true);
      setOtpShake((x) => x + 1);
      setMsg("Не удалось войти. Попробуйте запросить код ещё раз.");
    } catch (e) {
      const reason = e?.data?.reason || "";
      if (reason === "rejected") {
        setMsg("Заявка отклонена администратором.");
        setStep("pending");
      } else {
        setMsg("Неверный код или срок действия истёк.");
        setOtpError(true);
        setOtpShake((x) => x + 1);
        // чуть приятнее UX: очищаем код и даём ввести заново
        setOtp("");
        lastAutoVerifyRef.current = "";
      }
    } finally {
      setBusy(false);
    }
  }

  const styles = `
  .authPage{
    min-height: 100dvh;
    padding: 0 14px calc(18px + env(safe-area-inset-bottom));
    display:flex; justify-content:center; align-items:stretch;
    background:
      radial-gradient(900px 600px at 20% 0%, rgba(37,99,235,.25), transparent 60%),
      radial-gradient(900px 600px at 90% 30%, rgba(16,185,129,.18), transparent 55%),
      radial-gradient(900px 600px at 50% 120%, rgba(168,85,247,.20), transparent 60%),
      var(--tg-bg, #0b1020);
    color: var(--tg-text, #fff);
  }
  .authPhone{
    width: 100%;
    max-width: 420px;
    display:flex;
    flex-direction: column;
    gap: 12px;
    padding-top: calc(14px + env(safe-area-inset-top));
  }

  .hero{
    position: relative;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--tg-text, #fff) 10%, transparent);
    box-shadow: 0 18px 50px rgba(0,0,0,.25);
  }
  .heroImg{
    width: 100%;
    height: 228px;
    object-fit: cover;
    display:block;
    filter: saturate(1.05) contrast(1.02);
  }
  .heroOverlay{
    position:absolute; inset:0;
    background:
      linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.70)),
      radial-gradient(700px 260px at 20% 20%, rgba(37,99,235,.35), transparent 55%);
  }
  .heroInner{
    position:absolute; inset:0;
    display:flex; align-items:flex-end;
    padding: 12px;
    gap: 12px;
  }
  .teamLogo{
    width: 56px; height: 56px;
    border-radius: 18px;
    background: rgba(255,255,255,.08);
    border: 1px solid rgba(255,255,255,.16);
    overflow:hidden;
    display:flex; align-items:center; justify-content:center;
    flex: 0 0 auto;
  }
  .teamLogo img{ width:100%; height:100%; object-fit:cover; display:block; }
  .teamMeta{ min-width: 0; padding-bottom: 2px; }
  .teamName{
    font-size: 18px;
    font-weight: 900;
    letter-spacing: .2px;
    line-height: 1.1;
    margin: 0;
    color:#fff;
  }
  .teamSub{ margin: 4px 0 0; font-size: 12px; color: rgba(255,255,255,.75); }

  .panel{
    background: color-mix(in srgb, var(--tg-section-bg, rgba(255,255,255,.08)) 92%, transparent);
    border: 1px solid color-mix(in srgb, var(--tg-text, #fff) 12%, transparent);
    border-radius: 18px;
    padding: 16px;
    box-shadow: 0 18px 50px rgba(0,0,0,.22);
    backdrop-filter: blur(10px);
  }
  .topRow{
    display:flex; align-items:center; justify-content:space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .backBtn{
    width:auto; padding: 10px 12px;
  }

  .titleRow{ display:flex; align-items:center; gap:10px; }
  .title{
    margin: 0;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: .2px;
  }
  .spinner{
    width: 16px; height: 16px;
    border-radius: 999px;
    border: 2px solid color-mix(in srgb, var(--tg-text, #fff) 25%, transparent);
    border-top-color: var(--tg-btn, #2563eb);
    animation: spin .9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .hint{ color: var(--tg-hint, rgba(255,255,255,.7)); font-size: 13px; line-height: 1.35; }
  .field{ display:flex; flex-direction:column; gap:8px; margin-top: 12px; }
  .label{ font-size: 13px; color: var(--tg-hint, rgba(255,255,255,.7)); }

  .inputX{
    width: 100%;
    border-radius: 14px;
    padding: 13px 14px;
    font-size: 16px;
    outline: none;
    border: 1px solid color-mix(in srgb, var(--tg-text, #fff) 14%, transparent);
    background: color-mix(in srgb, var(--tg-bg, #0b1020) 55%, transparent);
    color: var(--tg-text, #fff);
  }
  .inputX:focus{
    border-color: color-mix(in srgb, var(--tg-btn, #2563eb) 70%, transparent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--tg-btn, #2563eb) 22%, transparent);
  }

  .actions{ display:flex; flex-direction:column; gap:10px; margin-top: 14px; }
  .btnX{
    width: 100%;
    padding: 13px 14px;
    border-radius: 14px;
    font-size: 15px;
    font-weight: 900;
    border: 1px solid transparent;
    cursor: pointer;
    user-select: none;
  }
  .btnPrimary{
    background: var(--tg-btn, #2563eb);
    color: var(--tg-btn-text, #fff);
    box-shadow: 0 12px 30px rgba(0,0,0,.25);
  }
  .btnGhost{
    background: transparent;
    color: var(--tg-text, #fff);
    border-color: color-mix(in srgb, var(--tg-text, #fff) 14%, transparent);
  }
  .btnX:disabled{ opacity: .55; cursor: not-allowed; }

  .divider{
    display:flex; align-items:center; gap:10px;
    color: var(--tg-hint, rgba(255,255,255,.65));
    font-size: 12px;
    margin: 10px 0 2px;
  }
  .divider:before, .divider:after{
    content:"";
    flex:1;
    height:1px;
    background: color-mix(in srgb, var(--tg-text, #fff) 14%, transparent);
  }

  .otpWrap{ margin-top: 10px; }
  .otpRow{
    display:grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 10px;
  }
  .otpBox{
    text-align:center;
    height: 52px;
    border-radius: 14px;
    font-size: 20px;
    font-weight: 900;
    outline: none;
    border: 1px solid color-mix(in srgb, var(--tg-text, #fff) 14%, transparent);
    background: color-mix(in srgb, var(--tg-bg, #0b1020) 55%, transparent);
    color: var(--tg-text, #fff);
  }
  .otpBox:focus{
    border-color: color-mix(in srgb, var(--tg-btn, #2563eb) 70%, transparent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--tg-btn, #2563eb) 22%, transparent);
  }

  .otpError .otpBox{
    border-color: rgba(239,68,68,.85);
    box-shadow: 0 0 0 4px rgba(239,68,68,.18);
  }
  .shake{
    animation: shake .35s ease-in-out;
  }
  @keyframes shake{
    0%{ transform: translateX(0); }
    20%{ transform: translateX(-6px); }
    40%{ transform: translateX(6px); }
    60%{ transform: translateX(-4px); }
    80%{ transform: translateX(4px); }
    100%{ transform: translateX(0); }
  }

  .row2{ display:flex; gap:10px; }
  .row2 > * { flex: 1; }

  .msg{
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 14px;
    font-size: 13px;
    line-height: 1.35;
    background: color-mix(in srgb, var(--tg-bg, #0b1020) 40%, transparent);
    border: 1px solid color-mix(in srgb, var(--tg-text, #fff) 10%, transparent);
    color: var(--tg-text, #fff);
  }

  .footerHint{ text-align:center; margin-top: 2px; color: var(--tg-hint, rgba(255,255,255,.65)); font-size: 12px; }
  `;

  const Hero = () => (
    <div className="hero">
      <img className="heroImg" src={teamCoverSrc} alt="" />
      <div className="heroOverlay" />
      <div className="heroInner">
        <div className="teamLogo" aria-hidden="true">
          <img src={teamLogoSrc} alt="" />
        </div>
        <div className="teamMeta">
          <p className="teamName">{teamName}</p>
          <p className="teamSub">{teamSubtitle}</p>
        </div>
      </div>
    </div>
  );

  // LANDING
  if (screen === "landing") {
    return (
      <div className="authPage">
        <style>{styles}</style>

        <div className="authPhone">
          <Hero />

          <div className="panel">
            <h1 className="title">Продолжить</h1>
            <div className="hint">
              Приложение рассчитано на мобильный. В браузере тоже работает — но всегда в мобильной верстке.
            </div>

            <div className="actions">
              {telegramUrl ? (
                <a className="btnX btnPrimary" href={telegramUrl} target="_blank" rel="noreferrer">
                  Открыть в Telegram
                </a>
              ) : (
                <button className="btnX btnPrimary" disabled>
                  Открыть в Telegram (не задан bot username)
                </button>
              )}

              <div className="divider">или</div>

              <button className="btnX btnGhost" onClick={() => setScreen("email")}>
                Войти по email (код)
              </button>
            </div>

            <div className="footerHint">Если письма не приходят — проверь “Спам/Промоакции”.</div>
          </div>
        </div>
      </div>
    );
  }

  // EMAIL FLOW
  return (
    <div className="authPage">
      <style>{styles}</style>

      <div className="authPhone">
        <Hero />

        <div className="panel">
          <div className="topRow">
            <button
              className="btnX btnGhost backBtn"
              onClick={() => setScreen("landing")}
              disabled={busy}
            >
              ← Назад
            </button>

            <div className="hint">
              {step === "code" ? "Введите код" : step === "pending" ? "Ожидание" : "Email"}
            </div>
          </div>

          <div className="titleRow">
            <h1 className="title">Вход по email</h1>
            {busy ? <div className="spinner" aria-label="Загрузка" /> : null}
          </div>

          <div className="hint" style={{ marginTop: 6 }}>
            Мы отправим одноразовый код на вашу почту. Введите 6 цифр — и вы внутри.
          </div>

          <div className="field">
            <div className="label">Почта</div>
            <input
              className="inputX"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy || step === "pending" || step === "code"}
              autoFocus
            />
          </div>

          {step === "email" ? (
            <div className="actions">
              <button className="btnX btnPrimary" onClick={sendCode} disabled={!canSend}>
                {busy ? "Отправляем..." : "Отправить код"}
              </button>

              <button className="btnX btnGhost" onClick={() => setScreen("landing")} disabled={busy}>
                Выбрать другой способ
              </button>
            </div>
          ) : null}

          {step === "code" ? (
            <>
              <div className="field" style={{ marginTop: 14 }}>
                <div className="label">Код из письма для {maskEmail(email)}</div>

                <div
                  className={[
                    "otpWrap",
                    otpError ? "otpError" : "",
                    // ключ чтобы анимация шейка всегда срабатывала
                    `shakeKey${otpShake}`,
                  ].join(" ")}
                >
                  <div className={otpShake ? "shake" : ""} key={otpShake}>
                    <OTP6
                      value={otp}
                      onChange={(v) => {
                        setOtpError(false);
                        setOtp(v);
                      }}
                      disabled={busy}
                      autoFocus
                    />
                  </div>
                </div>
              </div>

              <div className="hint" style={{ marginTop: 10 }}>
                {busy ? "Входим..." : "Кнопка не нужна — вход произойдёт автоматически после 6 цифр."}
              </div>

              <div className="actions">
                <div className="row2">
                  <button
                    className="btnX btnGhost"
                    onClick={() => {
                      setStep("email");
                      setOtp("");
                      setMsg("");
                      setOtpError(false);
                      lastAutoVerifyRef.current = "";
                    }}
                    disabled={busy}
                  >
                    Сменить email
                  </button>

                  <button className="btnX btnGhost" onClick={sendCode} disabled={!canSend}>
                    {cooldown > 0 ? `Повтор через ${cooldown}s` : "Отправить снова"}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {step === "pending" ? (
            <div className="actions">
              <button className="btnX btnPrimary" disabled>
                Ожидайте подтверждения администратора
              </button>
              <button className="btnX btnGhost" onClick={() => setScreen("landing")} disabled={busy}>
                На главную
              </button>
            </div>
          ) : null}

          {msg ? <div className="msg">{msg}</div> : null}
        </div>
      </div>
    </div>
  );
}
