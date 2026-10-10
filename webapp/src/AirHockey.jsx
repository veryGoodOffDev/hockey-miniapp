import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiGet, apiPost } from "./api.js";
import { moveBot, stepPuck, MAX_PUCK_SPEED } from "./airHockeyPhysics.js";

export const AIR_HOCKEY_REWARDS = Object.freeze({ easy: 6, normal: 12, hard: 20, pro: 32 });
const DIFFICULTIES = [
  { id:"easy", name:"Лёгкий" }, { id:"normal", name:"Средний" },
  { id:"hard", name:"Сложный" }, { id:"pro", name:"Профи" },
];
const SHOP_ITEMS = [
  { id:"easy", title:"Открыть лёгкий уровень", cost:120 },
  { id:"premium1", title:"Premium на 1 день", cost:180, days:1 },
  { id:"premium3", title:"Premium на 3 дня", cost:420, days:3 },
];

export function SheepCoin({ value, compact=false }) { return <span className="sheepCoin"><i>SC</i>{value != null && <b>{value}{compact ? "" : " SC"}</b>}</span>; }

function Rink({ running, difficulty, onScore, malletRadius }) {
  const canvasRef = useRef(null), stateRef = useRef(null), frameRef = useRef(0);
  const pointerRef = useRef(null), scoreRef = useRef(onScore);
  scoreRef.current = onScore;
  const radiusRef = useRef(malletRadius);
  radiusRef.current = malletRadius;
  const reducedMotion = useRef(false);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => { reducedMotion.current = !!media?.matches; };
    update(); media?.addEventListener?.("change", update);
    return () => media?.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!ctx) return;
    let previousSize = null;
    const resize = () => {
      const r = canvas.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * d));
      canvas.height = Math.max(1, Math.round(r.height * d));
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const s = stateRef.current;
      if (s && previousSize) {
        for (const m of [s.p, s.u, s.b]) {
          m.x *= r.width / previousSize.width;
          m.y *= r.height / previousSize.height;
        }
        s.brain = null;
        s.u.vx = 0; s.u.vy = 0;
      }
      previousSize = { width: r.width, height: r.height };
    };
    resize();
    if (typeof window.ResizeObserver === "function") {
      const ro = new window.ResizeObserver(resize); ro.observe(canvas);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!ctx) return;
    let active = true, last = performance.now();
    const reset = (W, H, serve = 1) => ({
      p: { x: W / 2, y: H / 2, vx: (Math.random() - .5) * 130, vy: serve * 160, r: 10 },
      u: { x: W / 2, y: H - 58, vx: 0, vy: 0, r: radiusRef.current },
      b: { x: W / 2, y: 58, vx: 0, vy: 0, r: 22 },
      goal: null,
    });
    stateRef.current = null;
    const draw = (s, W, H) => {
      const left = W * .34, right = W * .66;
      ctx.clearRect(0, 0, W, H);
      const ice = ctx.createLinearGradient(0, 0, W, H);
      ice.addColorStop(0, "#f4fbff"); ice.addColorStop(1, "#dceffc");
      ctx.fillStyle = ice; ctx.fillRect(0, 0, W, H);
      // Side boards and end boards leave a visible opening for each goal.
      ctx.strokeStyle = "#2381c4"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(2, H - 2);
      ctx.moveTo(W - 2, 2); ctx.lineTo(W - 2, H - 2);
      for (const y of [2, H - 2]) {
        ctx.moveTo(2, y); ctx.lineTo(left, y);
        ctx.moveTo(right, y); ctx.lineTo(W - 2, y);
      }
      ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = "#e5484d";
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
      ctx.moveTo(W / 2 + 44, H / 2); ctx.arc(W / 2, H / 2, 44, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#3478d4";
      for (const y of [H * .31, H * .69]) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      for (const [top, color, label] of [[true, "#dc4351", "ВОРОТА БОТА"], [false, "#1674dc", "ТВОИ ВОРОТА"]]) {
        const y = top ? 2 : H - 2, depth = top ? 20 : -20;
        const scored = s.goal && (top ? s.goal.who === "player" : s.goal.who === "bot");
        const glow = scored && !reducedMotion.current ? .55 + .3 * Math.sin(s.goal.elapsed * 20) : .18;
        ctx.fillStyle = scored ? `rgba(255,190,35,${glow})` : (top ? "#f9dce1" : "#c7e3fc");
        ctx.fillRect(left, top ? y : y + depth, right - left, Math.abs(depth));
        ctx.strokeStyle = scored ? "#e6a014" : color; ctx.lineWidth = 1;
        // A mesh behind the opening, two posts and a dashed goal line.
        ctx.beginPath();
        for (let x = left + 7; x < right; x += 9) { ctx.moveTo(x, y); ctx.lineTo(x, y + depth); }
        for (let offset = 5; offset < 20; offset += 5) { ctx.moveTo(left, y + Math.sign(depth) * offset); ctx.lineTo(right, y + Math.sign(depth) * offset); }
        ctx.stroke(); ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left, y + depth);
        ctx.lineTo(right, y + depth); ctx.lineTo(right, y); ctx.stroke();
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = .15; ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(W / 2, y, 48, top ? 0 : Math.PI, top ? Math.PI : Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = color; ctx.font = "700 9px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(label, W / 2, top ? 35 : H - 29);
      }
      for (const [m, color] of [[s.u, "#2684ff"], [s.b, "#ed4b55"]]) {
        ctx.fillStyle = "#173b5425"; ctx.beginPath(); ctx.arc(m.x, m.y + 3, m.r + 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r * .55, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.stroke();
      }
      if (!s.goal) {
        ctx.fillStyle = "#17212b"; ctx.beginPath(); ctx.arc(s.p.x, s.p.y, s.p.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffff80"; ctx.lineWidth = 1; ctx.stroke();
      } else {
        const progress = Math.min(1, s.goal.elapsed / .9), goalY = s.goal.who === "player" ? 22 : H - 22;
        if (!reducedMotion.current) {
          ctx.fillStyle = "#ffb521"; ctx.globalAlpha = 1 - progress;
          for (let i = 0; i < 14; i++) {
            const angle = i / 14 * Math.PI * 2, radius = 18 + progress * 95;
            const x = W / 2 + Math.cos(angle) * radius;
            const y = goalY + (s.goal.who === "player" ? 1 : -1) * Math.abs(Math.sin(angle)) * radius;
            ctx.save(); ctx.translate(x, y); ctx.rotate(angle + progress * 3);
            ctx.beginPath();
            for (let k = 0; k < 10; k++) {
              const a = k * Math.PI / 5, r = k % 2 ? 3 : 7;
              if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
              else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            }
            ctx.closePath(); ctx.fill(); ctx.restore();
          }
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = "#17314be8"; ctx.fillRect(W / 2 - 95, H / 2 - 37, 190, 74);
        ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "800 28px sans-serif";
        ctx.fillText("ГОЛ!", W / 2, H / 2 - 3);
        ctx.font = "600 13px sans-serif"; ctx.fillStyle = "#ffe18c";
        ctx.fillText(s.goal.who === "player" ? "Ты забиваешь" : "Бот забивает", W / 2, H / 2 + 22);
      }
    };
    const tick = (now) => {
      if (!active) return;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const dt = Math.min(Math.max((now - last) / 1000, 0), .033); last = now;
      let s = stateRef.current ||= reset(W, H);
      s.u.r = Math.min(radiusRef.current, W / 2 - 2, H / 4 - 2);
      s.u.x = Math.max(s.u.r, Math.min(W - s.u.r, s.u.x));
      s.u.y = Math.max(H / 2 + s.u.r, Math.min(H - s.u.r, s.u.y));
      if (running && s.goal) {
        s.goal.elapsed += dt;
        if (s.goal.elapsed >= .9) {
          const who = s.goal.who;
          s = stateRef.current = reset(W, H, who === "player" ? 1 : -1);
          pointerRef.current = null;
          scoreRef.current(who);
        }
      } else if (running) {
        // Expire pointer velocity: a held mallet must not keep striking at
        // the speed of the last swipe. Small steps prevent puck tunnelling.
        if (!s.u.t || now - s.u.t > 65) { s.u.vx = 0; s.u.vy = 0; }
        const steps = Math.max(1, Math.ceil(dt / (1 / 240))), step = dt / steps;
        for (let i = 0; i < steps && step > 0; i++) {
          moveBot(s, W, H, step, difficulty);
          const who = stepPuck(s, W, H, step);
          if (who) { s.goal = { who, elapsed: 0 }; s.u.vx = 0; s.u.vy = 0; break; }
        }
      }
      draw(s, W, H);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { active = false; cancelAnimationFrame(frameRef.current); pointerRef.current = null; };
  }, [running, difficulty]);

  const move = (e) => {
    if (!running || pointerRef.current !== e.pointerId) return;
    const c = canvasRef.current, r = c.getBoundingClientRect(), s = stateRef.current;
    if (!s || s.goal) return;
    const now = performance.now(), x = Math.max(s.u.r, Math.min(r.width - s.u.r, e.clientX - r.left));
    const y = Math.max(r.height / 2 + s.u.r, Math.min(r.height - s.u.r, e.clientY - r.top));
    const dt = Math.max((now - (s.u.t || now)) / 1000, .008);
    const vx = (x - s.u.x) / dt, vy = (y - s.u.y) / dt, speed = Math.hypot(vx, vy);
    const scale = Math.min(1, MAX_PUCK_SPEED / (speed || 1));
    s.u.vx = vx * scale; s.u.vy = vy * scale; s.u.x = x; s.u.y = y; s.u.t = now;
  };
  const release = (e) => {
    if (pointerRef.current !== e.pointerId) return;
    pointerRef.current = null;
    if (stateRef.current) { stateRef.current.u.vx = 0; stateRef.current.u.vy = 0; }
  };
  return <canvas ref={canvasRef} className="airRink" aria-label="Аэрохоккей: ворота бота сверху, твои снизу"
    onPointerDown={e => { if (!running || pointerRef.current !== null) return; pointerRef.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
    onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} />;
}

export default function AirHockey({ onClose, onProfileChange }) {
  const [malletRadius, setMalletRadius] = useState(() => {
    try { const saved = Number(localStorage.getItem("airHockeyMalletRadius")); return saved >= 24 && saved <= 42 ? saved : 32; } catch { return 32; }
  });
  const changeMalletSize = (e) => {
    const radius = Number(e.target.value); setMalletRadius(radius);
    try { localStorage.setItem("airHockeyMalletRadius", String(radius)); } catch {}
  };
  const [profile,setProfile]=useState(null),[difficulty,setDifficulty]=useState("normal"),[game,setGame]=useState(null),[score,setScore]=useState([0,0]),[result,setResult]=useState(null),[shop,setShop]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{
    const root=document.getElementById("root"),previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    root?.setAttribute("aria-hidden","true");
    return()=>{
      document.body.style.overflow=previousOverflow;
      root?.removeAttribute("aria-hidden");
    };
  },[]);
  const load=useCallback(async()=>{try{setProfile(await apiGet("/api/game/profile"));}catch{setMessage("Не удалось загрузить игровой профиль");}},[]);useEffect(()=>{load();},[load]);
  const start=async()=>{setBusy(true);setMessage("");try{const r=await apiPost("/api/game/air-hockey/start",{difficulty});setGame(r);setScore([0,0]);setResult(null);setProfile(p=>({...p,gamesLeftToday:r.gamesLeft,gamesPlayedToday:p.dailyLimit-r.gamesLeft}));}catch(e){setMessage(e.data?.reason==='daily_limit'?"Матчи на сегодня закончились":"Не удалось начать матч");}finally{setBusy(false);}};
  const finish=useCallback(async(next)=>{const win=next[0]===7;try{const r=await apiPost(`/api/game/air-hockey/${game.gameId}/finish`,{result:win?'win':'loss',playerScore:next[0],botScore:next[1]});setResult({win,reward:r.reward,balance:r.sheepCoins});setProfile(p=>({...p,sheepCoins:r.sheepCoins}));onProfileChange?.();}catch{setMessage("Не удалось сохранить результат");}setGame(null);},[game,onProfileChange]);
  const scored=useCallback(who=>setScore(old=>{const n=who==='player'?[old[0]+1,old[1]]:[old[0],old[1]+1];if(n[0]===7||n[1]===7)setTimeout(()=>finish(n),0);return n;}),[finish]);
  const buy=async item=>{if(item.id==='easy'&&!confirm("Открыть лёгкий уровень?\n\nСтоимость: 120 Sheep Coins\nУровень останется доступен навсегда."))return;setBusy(true);setMessage("");try{const r=item.id==='easy'?await apiPost('/api/game/shop/unlock-easy'):await apiPost('/api/game/shop/premium',{days:item.days});setProfile(p=>({...p,...r}));onProfileChange?.();}catch(e){setMessage(e.data?.reason==='insufficient_coins'?"Недостаточно Sheep Coins":"Покупка не выполнена");}finally{setBusy(false);}};
  const premium=profile?.premiumLifetime?"навсегда":profile?.premiumUntil?`до ${new Date(profile.premiumUntil).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}`:"нет";
  return createPortal(<div className="airScreen" role="dialog" aria-modal="true" aria-label="Air Hockey"><header><button className="btn secondary" onClick={onClose}>← Назад</button><h2>Air Hockey</h2><button className="btn secondary" onClick={()=>setShop(true)}>Магазин</button></header>
    <div className="airStats"><SheepCoin value={profile?.sheepCoins??0}/><span>Матчей: <b>{profile?.gamesLeftToday??'—'} / {profile?.dailyLimit??10}</b></span><span>Premium: <b>{premium}</b></span></div>
    <label className="airMalletSetting">Размер клюшки <input aria-label="Размер клюшки" type="range" min="24" max="42" step="1" value={malletRadius} onChange={changeMalletSize}/><output>{malletRadius * 2} px</output></label>
    <div className="airScore"><span>Ты</span><b>{score[0]} : {score[1]}</b><span>Бот</span></div>
    {!game&&!result&&<><div className="airDifficulty">{DIFFICULTIES.map(d=><button key={d.id} className={difficulty===d.id?'active':''} onClick={()=>d.id==='easy'&&!profile?.easyUnlocked?setShop(true):setDifficulty(d.id)}>{d.id==='easy'&&!profile?.easyUnlocked?'🔒 ':''}{d.name}<small>{d.id==='easy'&&!profile?.easyUnlocked?'открыть за 120 SC':`Победа +${AIR_HOCKEY_REWARDS[d.id]} SC`}</small></button>)}</div><button className="btn airStart" disabled={busy||!profile?.gamesLeftToday} onClick={start}>Начать матч</button>{profile?.gamesLeftToday===0&&<p className="airNotice">Матчи на сегодня закончились<br/>Новые игры будут доступны после ежедневного обновления</p>}</>}
    {result&&<div className="airResult"><h2>{result.win?'🏆 Победа':'Матч окончен'}</h2><strong>{score[0]} : {score[1]}</strong><p>{result.win?`+${result.reward} Sheep Coins`:'Награда: 0 SC'}</p><p>Баланс: {result.balance} SC</p><button className="btn" onClick={()=>setResult(null)}>Играть ещё</button><button className="btn secondary" onClick={onClose}>В профиль</button></div>}
    <Rink running={!!game && score[0] < 7 && score[1] < 7} difficulty={difficulty} onScore={scored} malletRadius={malletRadius}/>{message&&<div className="airNotice">{message}</div>}
    {shop&&<div className="airModal" onClick={()=>setShop(false)}><div className="airShop" onClick={e=>e.stopPropagation()}><h2>Магазин Sheep Coins</h2>{SHOP_ITEMS.map(i=><div className="airShopItem" key={i.id}><div><b>{i.title}</b><SheepCoin value={i.cost}/></div><button className="btn" disabled={busy||(i.id==='easy'&&profile?.easyUnlocked)} onClick={()=>buy(i)}>{i.id==='easy'&&profile?.easyUnlocked?'Открыто':`Купить за ${i.cost} SC`}</button></div>)}<button className="btn secondary" onClick={()=>setShop(false)}>Закрыть</button></div></div>}
  </div>,document.body);
}
