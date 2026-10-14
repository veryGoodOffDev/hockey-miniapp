import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  initialLineup,
  moveLineupPlayer,
  isGoalie,
  playerId,
} from "./teamLineup.js";
const nameOf = (p) =>
  p?.name_on_jersey ||
  p?.display_name ||
  [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
  p?.username ||
  "Игрок";
export default function TeamLineup({
  teamA,
  teamB,
  lineup,
  revision = 0,
  canEdit,
  onSave,
}) {
  const teams = useMemo(() => ({ A: teamA, B: teamB }), [teamA, teamB]);
  const base = useMemo(() => initialLineup(teams, lineup), [teams, lineup]);
  const [draft, setDraft] = useState(null),
    [selected, setSelected] = useState(null),
    [ghost, setGhost] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const drag = useRef(null),
    originRevision = useRef(revision),
    working = draft || base;
  const rosterKey = JSON.stringify([teamA.map(playerId), teamB.map(playerId)]);
  useEffect(() => {
    setDraft(null);
    setSelected(null);
    setMessage("");
  }, [rosterKey]);
  useEffect(() => {
    if (!canEdit) {
      setDraft(null);
      setSelected(null);
    }
  }, [canEdit]);
  useEffect(() => () => clearTimeout(drag.current?.timer), []);
  const apply = (key, id, destination, point) => {
    if (!canEdit || busy) return;
    const next = moveLineupPlayer(working, teams, key, id, destination, point);
    if (next === working) {
      setMessage("Нет запасного игрока для замены этой позиции.");
      return;
    }
    if (!draft) originRevision.current = revision;
    setDraft(next);
    setSelected(null);
    setMessage("Изменения ещё не сохранены");
  };
  const pointIn = (zone, x, y) => {
    const rect = zone.getBoundingClientRect();
    let px = (x - rect.left) / rect.width,
      py = (y - rect.top) / rect.height;
    if (zone.dataset.team === "B") {
      px = 1 - px;
      py = 1 - py;
    }
    return {
      x: Math.max(0.14, Math.min(0.86, px)),
      y: Math.max(0.2, Math.min(0.8, py)),
    };
  };
  const drop = (key, id, x, y) => {
    const zone = document.elementFromPoint(x, y)?.closest("[data-lineup-zone]");
    if (!zone || zone.dataset.team !== key) {
      setMessage("Перемещение доступно только внутри своей команды");
      return;
    }
    apply(
      key,
      id,
      zone.dataset.lineupZone,
      zone.dataset.lineupZone === "ice" ? pointIn(zone, x, y) : undefined,
    );
  };
  const down = (e, key, id) => {
    if (!canEdit || busy) return;
    if (drag.current) return;
    const target = e.currentTarget,
      entry = {
        key,
        id,
        pointer: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };
    entry.timer = setTimeout(
      () => {
        if (drag.current !== entry) return;
        entry.active = true;
        target.setPointerCapture(entry.pointer);
        setGhost({ key, id, x: entry.startX, y: entry.startY });
      },
      e.pointerType === "mouse" ? 0 : 240,
    );
    drag.current = entry;
  };
  const move = (e) => {
    const entry = drag.current;
    if (!entry || entry.pointer !== e.pointerId) return;
    if (!entry.active) {
      if (Math.hypot(e.clientX - entry.startX, e.clientY - entry.startY) > 9) {
        clearTimeout(entry.timer);
        drag.current = null;
      }
      return;
    }
    e.preventDefault();
    setGhost({ key: entry.key, id: entry.id, x: e.clientX, y: e.clientY });
  };
  const end = (e, cancel = false) => {
    const entry = drag.current;
    if (!entry || entry.pointer !== e.pointerId) return;
    clearTimeout(entry.timer);
    drag.current = null;
    setGhost(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (entry.active && !cancel) {
      drop(entry.key, entry.id, e.clientX, e.clientY);
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
  };
  const suppressClick = useRef(false);
  const chip = (key, id, item, ghosting = false) => {
    const p = teams[key].find((p) => playerId(p) === id);
    if (!p) return null;
    return (
      <button
        key={id}
        type="button"
        className={`lineupChip team${key} ${selected?.id === id && selected?.key === key ? "isSelected" : ""} ${ghosting ? "lineupGhost" : ""}`}
        style={
          ghosting
            ? { left: ghost.x, top: ghost.y }
            : item
              ? {
                  left: `${(key === "B" ? 1 - item.x : item.x) * 100}%`,
                  top: `${(key === "B" ? 1 - item.y : item.y) * 100}%`,
                }
              : undefined
        }
        disabled={!canEdit || busy || ghosting}
        title={nameOf(p)}
        aria-label={`${nameOf(p)}, ${isGoalie(p) ? "вратарь" : "полевой игрок"}, ${item ? "на льду" : "на скамейке"}`}
        onPointerDown={(e) => down(e, key, id)}
        onPointerMove={move}
        onPointerUp={(e) => end(e)}
        onPointerCancel={(e) => end(e, true)}
        onLostPointerCapture={(e) => end(e, true)}
        onClick={(e) => {
          e.stopPropagation();
          if (!suppressClick.current) setSelected({ key, id });
        }}
      >
        <span className="lineupJersey">
          <span aria-hidden="true">
            {p.jersey_number ?? (isGoalie(p) ? "🥅" : "🏒")}
          </span>
        </span>
        <span className="lineupName">
          {isGoalie(p) ? "ВР · " : ""}
          {nameOf(p)}
        </span>
      </button>
    );
  };
  const zoneClick = (e) => {
    if (selected && e.currentTarget.dataset.team === selected.key)
      apply(
        selected.key,
        selected.id,
        e.currentTarget.dataset.lineupZone,
        e.currentTarget.dataset.lineupZone === "ice"
          ? pointIn(e.currentTarget, e.clientX, e.clientY)
          : undefined,
      );
  };
  const save = async () => {
    setBusy(true);
    setMessage("Сохраняю…");
    try {
      await onSave(draft, originRevision.current);
      setDraft(null);
      setMessage("Расстановка сохранена для всей команды");
    } catch (e) {
      setMessage(
        e.data?.reason === "lineup_conflict"
          ? "Расстановка уже изменена другим админом. Обновите данные и повторите правку."
          : e.data?.reason === "teams_locked"
            ? "Составы зафиксированы — сначала разблокируйте их."
            : "Не удалось сохранить расстановку. Изменения остались на экране.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="teamLineup" aria-label="Расстановка игроков на льду">
      <div className="lineupHeading">
        <h3>На льду</h3>
        <span>⬜ Белые · 🟦 Синие</span>
      </div>
      <p className="small">
        {canEdit
          ? "Удерживайте фишку и перетаскивайте. Игрок со скамейки заменяет ближайшего полевого игрока, вратарь — вратаря. Можно также выбрать игрока и нажать место на поле."
          : "Расстановка команд: по пять полевых игроков и вратарь при наличии."}
      </p>
      <div className="lineupRink">
        <svg
          className="lineupIce"
          viewBox="0 0 1000 1200"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect
            x="4"
            y="4"
            width="992"
            height="1192"
            rx="85"
            fill="#e8f3fa"
            stroke="#84a6bb"
            strokeWidth="8"
          />
          <path d="M0 600H1000" stroke="#e5767c" strokeWidth="6" />
          <path d="M0 360H1000 M0 840H1000" stroke="#5f9ec9" strokeWidth="6" />
          <circle
            cx="500"
            cy="600"
            r="120"
            fill="none"
            stroke="#d97d83"
            strokeWidth="4"
          />
          <path
            d="M420 20H580V62H420Z M420 1180H580V1138H420Z"
            fill="#cce2f1"
            stroke="#da6b78"
            strokeWidth="6"
          />
          {[220, 780].flatMap((x) =>
            [210, 990].map((y) => (
              <circle
                key={`${x}-${y}`}
                cx={x}
                cy={y}
                r="62"
                fill="none"
                stroke="#c68b93"
                strokeWidth="3"
              />
            )),
          )}
        </svg>
        {["B", "A"].map((key) => (
          <div
            key={key}
            className={`lineupHalf half${key}`}
            data-lineup-zone="ice"
            data-team={key}
            onClick={zoneClick}
          >
            {working[key].ice.map((item) => chip(key, item.id, item))}
          </div>
        ))}
      </div>
      <div className="lineupBenches">
        {["A", "B"].map((key) => (
          <div
            key={key}
            className={`lineupBench bench${key}`}
            data-lineup-zone="bench"
            data-team={key}
            onClick={zoneClick}
          >
            <h4>{key === "A" ? "⬜ Белые" : "🟦 Синие"} — скамейка</h4>
            <p className="small">
              На льду:{" "}
              {
                working[key].ice.filter(
                  (item) =>
                    !isGoalie(teams[key].find((p) => playerId(p) === item.id)),
                ).length
              }{" "}
              +{" "}
              {
                working[key].ice.filter((item) =>
                  isGoalie(teams[key].find((p) => playerId(p) === item.id)),
                ).length
              }{" "}
              вр.
            </p>
            <div className="lineupBenchPlayers">
              {working[key].bench.map((id) => chip(key, id))}
              {!working[key].bench.length && (
                <span className="small">Все игроки на льду</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="lineupToolbar">
          {selected && (
            <>
              <span className="small">
                Выбран:{" "}
                {nameOf(
                  teams[selected.key].find((p) => playerId(p) === selected.id),
                )}
              </span>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => apply(selected.key, selected.id, "ice")}
              >
                На лёд
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => apply(selected.key, selected.id, "bench")}
              >
                На скамейку
              </button>
            </>
          )}
          <button
            type="button"
            className="btn"
            disabled={!draft || busy}
            onClick={save}
          >
            Сохранить расстановку
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={!draft || busy}
            onClick={() => {
              setDraft(null);
              setSelected(null);
              setMessage("");
            }}
          >
            Отменить правку
          </button>
        </div>
      )}
      {message && (
        <p className="small lineupMessage" role="status">
          {message}
        </p>
      )}
      {ghost && chip(ghost.key, ghost.id, null, true)}
    </section>
  );
}
