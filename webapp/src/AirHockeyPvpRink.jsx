import React, { useEffect, useRef } from "react";
export function toScreen(point, slot, width, height) {
  return slot === 0
    ? {
        ...point,
        x: width - point.x,
        y: height - point.y,
        vx: -point.vx,
        vy: -point.vy,
      }
    : { ...point };
}
export function toWorld(point, slot, width, height) {
  return slot === 0 ? { x: width - point.x, y: height - point.y } : point;
}
export default function AirHockeyPvpRink({ state, send }) {
  const canvasRef = useRef(null),
    stateRef = useRef(state),
    sendRef = useRef(send),
    local = useRef(null),
    pointer = useRef(null);
  stateRef.current = state;
  sendRef.current = send;
  useEffect(() => {
    const canvas = canvasRef.current,
      ctx = canvas.getContext("2d");
    let frame,
      last = performance.now(),
      lastSend = 0,
      match = null,
      display = null;
    const draw = (now) => {
      const s = stateRef.current;
      if (!s?.physics) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const { width: w, height: h, slot } = s,
        delta = Math.min(60, now - last);
      last = now;
      const alpha = 1 - Math.exp(-delta / 55);
      const own = toScreen(slot === 0 ? s.physics.b : s.physics.u, slot, w, h),
        opponent = toScreen(slot === 0 ? s.physics.u : s.physics.b, slot, w, h),
        puck = toScreen(s.physics.p, slot, w, h);
      if (match !== s.matchId) {
        match = s.matchId;
        local.current = { x: own.x, y: own.y };
        display = { puck: { ...puck }, opponent: { ...opponent } };
      }
      if (s.status !== "playing" || s.goal != null) {
        local.current = { x: own.x, y: own.y };
      } else if (
        pointer.current === null ||
        Math.hypot(local.current.x - own.x, local.current.y - own.y) > 90
      ) {
        local.current.x += (own.x - local.current.x) * alpha * 0.5;
        local.current.y += (own.y - local.current.y) * alpha * 0.5;
      }
      for (const [key, target] of [
        ["puck", puck],
        ["opponent", opponent],
      ]) {
        display[key].x += (target.x - display[key].x) * alpha;
        display[key].y += (target.y - display[key].y) * alpha;
      }
      if (s.status === "playing" && s.goal == null && now - lastSend >= 40) {
        lastSend = now;
        sendRef.current("paddle_move", {
          ...toWorld(local.current, slot, w, h),
          timestamp: Date.now(),
        });
      }
      const rect = canvas.getBoundingClientRect(),
        d = Math.min(devicePixelRatio || 1, 2);
      if (
        canvas.width !== Math.round(rect.width * d) ||
        canvas.height !== Math.round(rect.height * d)
      ) {
        canvas.width = Math.round(rect.width * d);
        canvas.height = Math.round(rect.height * d);
      }
      ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, "#142736");
      gradient.addColorStop(1, "#0a1821");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#ffffff25";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 55, 0, Math.PI * 2);
      ctx.stroke();
      for (const [y, color] of [
        [2, "#ff767e"],
        [h - 20, "#62b8ff"],
      ]) {
        ctx.fillStyle = color + "33";
        ctx.fillRect(w * 0.34, y, w * 0.32, 18);
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.strokeRect(w * 0.34, y, w * 0.32, 18);
        ctx.lineWidth = 1;
        for (let x = w * 0.34 + 8; x < w * 0.66; x += 10) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 18);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = "#7096ae";
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = "#9eafbd";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("СОПЕРНИК", w / 2, 42);
      ctx.fillText("ВЫ", w / 2, h - 34);
      for (const [m, r, color] of [
        [display.opponent, own.r, "#f46d76"],
        [local.current, own.r, "#58b5ff"],
        [display.puck, puck.r, "#f3f8ff"],
      ]) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 9;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#ffffff55";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (s.goal != null) {
        ctx.fillStyle = "#ffe898";
        ctx.font = "bold 34px system-ui";
        ctx.fillText("★ ГОЛ! ★", w / 2, h / 2);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  const move = (e) => {
    const s = stateRef.current;
    if (
      pointer.current !== e.pointerId ||
      s?.status !== "playing" ||
      s.goal != null
    )
      return;
    const rect = e.currentTarget.getBoundingClientRect(),
      r = s.physics.u.r;
    local.current = {
      x: Math.max(
        r,
        Math.min(s.width - r, ((e.clientX - rect.left) / rect.width) * s.width),
      ),
      y: Math.max(
        s.height / 2 + r,
        Math.min(
          s.height - r,
          ((e.clientY - rect.top) / rect.height) * s.height,
        ),
      ),
    };
  };
  const release = (e) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <canvas
      ref={canvasRef}
      className="airPvpRink"
      aria-label="Аэрохоккей PvP: ваша бита снизу"
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={() => {
        pointer.current = null;
      }}
    />
  );
}
