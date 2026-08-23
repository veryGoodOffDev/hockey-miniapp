import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "./api.js";

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
const MAX_PUCK_SPEED=900, MIN_PUCK_SPEED=145, FRICTION=0.995, BOARD_RESTITUTION=0.93;

export function SheepCoin({ value, compact=false }) { return <span className="sheepCoin"><i>SC</i>{value != null && <b>{value}{compact ? "" : " SC"}</b>}</span>; }

function Rink({ running, difficulty, onScore }) {
  const canvasRef=useRef(null), stateRef=useRef(null), frameRef=useRef(0), pointerRef=useRef(false);
  useEffect(()=>{
    const canvas=canvasRef.current, ctx=canvas.getContext("2d");
    const resize=()=>{const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=r.width*d;canvas.height=r.height*d;ctx.setTransform(d,0,0,d,0,0);stateRef.current=null;};
    resize(); const ro=new ResizeObserver(resize);ro.observe(canvas);return()=>ro.disconnect();
  },[]);
  useEffect(()=>{
    if(!running){cancelAnimationFrame(frameRef.current);return;}
    let last=performance.now();
    const tick=(now)=>{const W=canvasRef.current.clientWidth,H=canvasRef.current.clientHeight,dt=Math.min((now-last)/1000,.025);last=now;
      let s=stateRef.current;if(!s){s={p:{x:W/2,y:H/2,vx:85,vy:145,r:10},u:{x:W/2,y:H-58,px:W/2,py:H-58,vx:0,vy:0,r:22},b:{x:W/2,y:58,vx:0,vy:0,r:22},corner:0};stateRef.current=s;}
      const p=s.p,u=s.u,b=s.b, goal=W*.32, left=(W-goal)/2,right=(W+goal)/2;
      const cfg={normal:[250,.20,.13],hard:[330,.12,.08],pro:[410,.07,.045],easy:[185,.30,.2]}[difficulty];
      const danger=p.y<100, target=p.y<H/2 ? (danger?{x:p.x+(p.x<W/2?45:-45),y:Math.max(28,p.y-42)}:{x:p.x,y:p.y-46}):{x:W/2,y:58};
      const mistake=Math.sin(now/7300)>1-cfg[2]*2; if(mistake){target.x+=55*Math.sin(now/410);target.y-=25;}
      const dx=target.x-b.x,dy=target.y-b.y,len=Math.hypot(dx,dy)||1,step=Math.min(cfg[0]*dt,len);b.vx=dx/len*cfg[0];b.vy=dy/len*cfg[0];b.x+=dx/len*step;b.y+=dy/len*step;b.x=Math.max(b.r,Math.min(W-b.r,b.x));b.y=Math.max(b.r,Math.min(H/2-b.r,b.y));
      for(const m of [u,b]){const dx=p.x-m.x,dy=p.y-m.y,d=Math.hypot(dx,dy)||.01,min=p.r+m.r;if(d<min){const nx=dx/d,ny=dy/d; p.x=m.x+nx*min;p.y=m.y+ny*min;const impact=Math.max(MIN_PUCK_SPEED,Math.hypot(m.vx,m.vy)*.82+170);p.vx=nx*impact+m.vx*.35;p.vy=ny*impact+m.vy*.35;}}
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=Math.pow(FRICTION,dt*60);p.vy*=Math.pow(FRICTION,dt*60);
      if(p.x<p.r){p.x=p.r;p.vx=Math.abs(p.vx)*BOARD_RESTITUTION;}if(p.x>W-p.r){p.x=W-p.r;p.vx=-Math.abs(p.vx)*BOARD_RESTITUTION;}
      const inGoal=p.x>left&&p.x<right;if(p.y<p.r&&!inGoal){p.y=p.r;p.vy=Math.abs(p.vy)*BOARD_RESTITUTION;}if(p.y>H-p.r&&!inGoal){p.y=H-p.r;p.vy=-Math.abs(p.vy)*BOARD_RESTITUTION;}
      if(p.y < -p.r){onScore("player");stateRef.current=null;} else if(p.y>H+p.r){onScore("bot");stateRef.current=null;}
      const corner=(p.x<42||p.x>W-42)&&(p.y<55||p.y>H-55);s.corner=corner?s.corner+dt:0;if(s.corner>.12){const dx=W/2-p.x,dy=H/2-p.y,l=Math.hypot(dx,dy);p.vx=dx/l*Math.max(MIN_PUCK_SPEED,Math.hypot(p.vx,p.vy));p.vy=dy/l*Math.max(MIN_PUCK_SPEED,Math.hypot(p.vx,p.vy));s.corner=0;}
      let speed=Math.hypot(p.vx,p.vy);if(speed<MIN_PUCK_SPEED){const nx=speed?p.vx/speed:0,ny=speed?p.vy/speed:1;p.vx=nx*MIN_PUCK_SPEED;p.vy=ny*MIN_PUCK_SPEED;}else if(speed>MAX_PUCK_SPEED){p.vx=p.vx/speed*MAX_PUCK_SPEED;p.vy=p.vy/speed*MAX_PUCK_SPEED;}
      ctx.clearRect(0,0,W,H);ctx.fillStyle="#eaf7ff";ctx.fillRect(0,0,W,H);ctx.strokeStyle="#2381c4";ctx.lineWidth=4;ctx.strokeRect(2,2,W-4,H-4);ctx.lineWidth=2;ctx.strokeStyle="#e5484d";ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.stroke();ctx.beginPath();ctx.arc(W/2,H/2,48,0,Math.PI*2);ctx.stroke();ctx.strokeStyle="#3478d4";for(const y of [H*.31,H*.69]){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}ctx.lineWidth=5;ctx.strokeStyle="#d44";for(const y of [2,H-2]){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}for(const [m,c] of [[u,"#2684ff"],[b,"#ed4b55"]]){ctx.fillStyle=c;ctx.beginPath();ctx.arc(m.x,m.y,m.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=3;ctx.stroke();}ctx.fillStyle="#17212b";ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
      frameRef.current=requestAnimationFrame(tick);};frameRef.current=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frameRef.current);
  },[running,difficulty,onScore]);
  const move=(e)=>{if(!running||!pointerRef.current)return;const c=canvasRef.current,r=c.getBoundingClientRect(),s=stateRef.current;if(!s)return;const now=performance.now(),x=Math.max(22,Math.min(r.width-22,e.clientX-r.left)),y=Math.max(r.height/2+22,Math.min(r.height-22,e.clientY-r.top)),dt=Math.max((now-(s.u.t||now))/1000,.008);s.u.vx=(x-s.u.x)/dt;s.u.vy=(y-s.u.y)/dt;s.u.x=x;s.u.y=y;s.u.t=now;};
  return <canvas ref={canvasRef} className="airRink" onPointerDown={e=>{pointerRef.current=true;e.currentTarget.setPointerCapture(e.pointerId);move(e);}} onPointerMove={move} onPointerUp={()=>pointerRef.current=false} />;
}

export default function AirHockey({ onClose, onProfileChange }) {
  const [profile,setProfile]=useState(null),[difficulty,setDifficulty]=useState("normal"),[game,setGame]=useState(null),[score,setScore]=useState([0,0]),[result,setResult]=useState(null),[shop,setShop]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const load=useCallback(async()=>{try{setProfile(await apiGet("/api/game/profile"));}catch{setMessage("Не удалось загрузить игровой профиль");}},[]);useEffect(()=>{load();},[load]);
  const start=async()=>{setBusy(true);setMessage("");try{const r=await apiPost("/api/game/air-hockey/start",{difficulty});setGame(r);setScore([0,0]);setResult(null);setProfile(p=>({...p,gamesLeftToday:r.gamesLeft,gamesPlayedToday:p.dailyLimit-r.gamesLeft}));}catch(e){setMessage(e.data?.reason==='daily_limit'?"Матчи на сегодня закончились":"Не удалось начать матч");}finally{setBusy(false);}};
  const finish=useCallback(async(next)=>{const win=next[0]===7;try{const r=await apiPost(`/api/game/air-hockey/${game.gameId}/finish`,{result:win?'win':'loss',playerScore:next[0],botScore:next[1]});setResult({win,reward:r.reward,balance:r.sheepCoins});setProfile(p=>({...p,sheepCoins:r.sheepCoins}));onProfileChange?.();}catch{setMessage("Не удалось сохранить результат");}setGame(null);},[game,onProfileChange]);
  const scored=useCallback(who=>setScore(old=>{const n=who==='player'?[old[0]+1,old[1]]:[old[0],old[1]+1];if(n[0]===7||n[1]===7)setTimeout(()=>finish(n),0);return n;}),[finish]);
  const buy=async item=>{if(item.id==='easy'&&!confirm("Открыть лёгкий уровень?\n\nСтоимость: 120 Sheep Coins\nУровень останется доступен навсегда."))return;setBusy(true);setMessage("");try{const r=item.id==='easy'?await apiPost('/api/game/shop/unlock-easy'):await apiPost('/api/game/shop/premium',{days:item.days});setProfile(p=>({...p,...r}));onProfileChange?.();}catch(e){setMessage(e.data?.reason==='insufficient_coins'?"Недостаточно Sheep Coins":"Покупка не выполнена");}finally{setBusy(false);}};
  const premium=profile?.premiumLifetime?"навсегда":profile?.premiumUntil?`до ${new Date(profile.premiumUntil).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}`:"нет";
  return <div className="airScreen"><header><button className="btn secondary" onClick={onClose}>← Назад</button><h2>Air Hockey</h2><button className="btn secondary" onClick={()=>setShop(true)}>Магазин</button></header>
    <div className="airStats"><SheepCoin value={profile?.sheepCoins??0}/><span>Матчей: <b>{profile?.gamesLeftToday??'—'} / {profile?.dailyLimit??10}</b></span><span>Premium: <b>{premium}</b></span></div>
    <div className="airScore"><span>Ты</span><b>{score[0]} : {score[1]}</b><span>Бот</span></div>
    {!game&&!result&&<><div className="airDifficulty">{DIFFICULTIES.map(d=><button key={d.id} className={difficulty===d.id?'active':''} onClick={()=>d.id==='easy'&&!profile?.easyUnlocked?setShop(true):setDifficulty(d.id)}>{d.id==='easy'&&!profile?.easyUnlocked?'🔒 ':''}{d.name}<small>{d.id==='easy'&&!profile?.easyUnlocked?'открыть за 120 SC':`Победа +${AIR_HOCKEY_REWARDS[d.id]} SC`}</small></button>)}</div><button className="btn airStart" disabled={busy||!profile?.gamesLeftToday} onClick={start}>Начать матч</button>{profile?.gamesLeftToday===0&&<p className="airNotice">Матчи на сегодня закончились<br/>Новые игры будут доступны после ежедневного обновления</p>}</>}
    {result&&<div className="airResult"><h2>{result.win?'🏆 Победа':'Матч окончен'}</h2><strong>{score[0]} : {score[1]}</strong><p>{result.win?`+${result.reward} Sheep Coins`:'Награда: 0 SC'}</p><p>Баланс: {result.balance} SC</p><button className="btn" onClick={()=>setResult(null)}>Играть ещё</button><button className="btn secondary" onClick={onClose}>В профиль</button></div>}
    <Rink running={!!game} difficulty={difficulty} onScore={scored}/>{message&&<div className="airNotice">{message}</div>}
    {shop&&<div className="airModal" onClick={()=>setShop(false)}><div className="airShop" onClick={e=>e.stopPropagation()}><h2>Магазин Sheep Coins</h2>{SHOP_ITEMS.map(i=><div className="airShopItem" key={i.id}><div><b>{i.title}</b><SheepCoin value={i.cost}/></div><button className="btn" disabled={busy||(i.id==='easy'&&profile?.easyUnlocked)} onClick={()=>buy(i)}>{i.id==='easy'&&profile?.easyUnlocked?'Открыто':`Купить за ${i.cost} SC`}</button></div>)}<button className="btn secondary" onClick={()=>setShop(false)}>Закрыть</button></div></div>}
  </div>;
}
