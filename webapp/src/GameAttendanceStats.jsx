import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { apiGet } from "./api.js";
import {
  attendanceBuckets,
  bucketTitle,
  currentTeamYear,
  seasonStats,
  summarizeGames,
  yearRange,
} from "./gameAttendanceData.js";
import "./GameAttendanceStats.css";

const number = (value) =>
  value == null
    ? "—"
    : value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const shortDate = (date) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });

function TrendPlot({ buckets, selectedIndex, onSelect }) {
  const host = useRef(null);
  const [width, setWidth] = useState(640);
  const gradient = "attendance-" + useId().replace(/:/g, "");
  useEffect(() => {
    const measure = () =>
      setWidth(Math.max(240, host.current?.clientWidth || 640));
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const top = Math.max(
    20,
    Math.ceil(Math.max(...buckets.map((b) => b.summary.max || 0)) / 20) * 20,
  );
  const left = 34,
    right = width - 12,
    upper = 18,
    bottom = 204;
  const x = (i) =>
    buckets.length === 1
      ? (left + right) / 2
      : left + ((right - left) * i) / (buckets.length - 1);
  const y = (value) => bottom - ((bottom - upper) * value) / top;
  const segments = [];
  buckets.forEach((b, i) => {
    if (b.summary.average == null) return;
    if (!i || buckets[i - 1].summary.average == null) segments.push([]);
    segments.at(-1).push([x(i), y(b.summary.average)]);
  });
  const labelIndices = [
    ...new Set([
      0,
      Math.round((buckets.length - 1) / 4),
      Math.round((buckets.length - 1) / 2),
      Math.round(((buckets.length - 1) * 3) / 4),
      buckets.length - 1,
    ]),
  ];
  const select = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) * width) / rect.width;
    const index = Math.max(
      0,
      Math.min(
        buckets.length - 1,
        Math.round(((px - left) / (right - left)) * (buckets.length - 1)),
      ),
    );
    onSelect(index);
  };
  const selected = buckets[selectedIndex];
  return (
    <div className="gameTrendPlot" ref={host}>
      <svg
        viewBox={`0 0 ${width} 240`}
        role="img"
        aria-label="Среднее количество игроков на игру. Выберите период на графике или в списке ниже."
        onPointerDown={select}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse") select(event);
        }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ca9ff" stopOpacity=".26" />
            <stop offset="100%" stopColor="#4ca9ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = (top * tick) / 4;
          return (
            <g key={tick}>
              <line
                x1={left}
                y1={y(value)}
                x2={right}
                y2={y(value)}
                stroke="currentColor"
                opacity=".1"
                strokeDasharray="3 5"
              />
              <text
                x={left - 9}
                y={y(value) + 4}
                textAnchor="end"
                className="gameTrendPlot__label"
              >
                {number(value)}
              </text>
            </g>
          );
        })}
        {segments.map((points, i) => (
          <g key={i}>
            <path
              d={`M ${points[0][0]} ${bottom} L ${points.map((p) => p.join(" ")).join(" L ")} L ${points.at(-1)[0]} ${bottom} Z`}
              fill={`url(#${gradient})`}
            />
            <polyline
              points={points.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke="#57b2ff"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {buckets.map(
          (b, i) =>
            b.summary.average != null && (
              <circle
                key={b.key}
                cx={x(i)}
                cy={y(b.summary.average)}
                r={i === selectedIndex ? 5 : 2.5}
                fill={i === selectedIndex ? "#85f2cb" : "#68b6ff"}
              />
            ),
        )}
        <line
          x1={x(selectedIndex)}
          y1={upper}
          x2={x(selectedIndex)}
          y2={bottom}
          stroke="#85f2cb"
          opacity=".45"
          strokeDasharray="4 4"
        />
        {labelIndices.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={228}
            className="gameTrendPlot__label"
            textAnchor={
              i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle"
            }
          >
            {shortDate(buckets[i].from)}
          </text>
        ))}
      </svg>
      <div className="gameTrendPlot__reading">
        <strong>{number(selected.summary.average)}</strong>
        <span>игроков в среднем · {selected.summary.games} игр</span>
      </div>
    </div>
  );
}

export default function GameAttendanceStats({ onOpenGame }) {
  const currentYear = currentTeamYear();
  const [year, setYear] = useState(currentYear);
  const [range, setRange] = useState(() => yearRange(currentYear));
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(range);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [mode, setMode] = useState("week");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedKey, setSelectedKey] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    setSelectedKey(null);
    const query = custom ? `from=${range.from}&to=${range.to}` : `year=${year}`;
    apiGet(`/api/stats/game-attendance?${query}`, { signal: controller.signal })
      .then((result) => {
        if (!Array.isArray(result.games) || !result.filter)
          throw new Error("invalid_response");
        if (active) setData(result);
      })
      .catch((e) => {
        if (active && !controller.signal.aborted)
          setError(
            e.data?.reason === "date_range_too_long"
              ? "Выберите диапазон не больше 10 лет."
              : "Не удалось загрузить статистику. Проверьте соединение и попробуйте ещё раз.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [year, range.from, range.to, custom, retry]);
  const games = data?.games || [];
  const summary = useMemo(() => summarizeGames(games), [data]);
  const buckets = useMemo(
    () => attendanceBuckets(games, range, mode),
    [data, range.from, range.to, mode],
  );
  const seasons = useMemo(() => seasonStats(games), [data]);
  let selectedIndex = buckets.findIndex((b) => b.key === selectedKey);
  if (selectedIndex < 0)
    selectedIndex = Math.max(
      0,
      buckets.reduce((last, b, index) => (b.summary.games ? index : last), 0),
    );
  const selected = buckets[selectedIndex];
  const chooseYear = (next) => {
    if (next < 2000 || next > 2200) return;
    setYear(next);
    setRange(yearRange(next));
    setDraft(yearRange(next));
    setCustom(false);
    setRangeError("");
  };
  const applyRange = (e) => {
    e.preventDefault();
    if (!draft.from || !draft.to || draft.from > draft.to) {
      setRangeError("Дата начала должна быть не позже даты окончания.");
      return;
    }
    if ((Date.parse(draft.to) - Date.parse(draft.from)) / 86400000 > 3660) {
      setRangeError("Выберите диапазон не больше 10 лет.");
      return;
    }
    setYear(Number(draft.from.slice(0, 4)));
    setRange(draft);
    setCustom(true);
    setRangeError("");
    setRangeOpen(false);
  };
  return (
    <section className="gameTrend" aria-label="Посещаемость игр">
      <header className="gameTrend__header">
        <span className="gameTrend__eyebrow">КОМАНДА НА ЛЬДУ</span>
        <h2>Посещаемость игр</h2>
        <p>Как меняется количество игроков в течение года</p>
      </header>
      <div className="gameTrend__year">
        <button
          type="button"
          className="btn secondary"
          aria-label="Предыдущий год"
          disabled={year <= 2000}
          onClick={() => chooseYear(year - 1)}
        >
          ‹
        </button>
        <div>
          <strong>{custom ? "Свой диапазон" : year}</strong>
          <span>
            {custom
              ? `${shortDate(range.from)} ${range.from.slice(0, 4)} — ${shortDate(range.to)} ${range.to.slice(0, 4)}`
              : "январь — декабрь"}
          </span>
        </div>
        <button
          type="button"
          className="btn secondary"
          aria-label="Следующий год"
          disabled={year >= 2200}
          onClick={() => chooseYear(year + 1)}
        >
          ›
        </button>
      </div>
      <div className="gameTrend__tools">
        <button
          type="button"
          className="gameTrend__textButton"
          aria-expanded={rangeOpen}
          onClick={() => setRangeOpen(!rangeOpen)}
        >
          Выбрать диапазон
        </button>
        <button
          type="button"
          className="gameTrend__textButton"
          disabled={loading}
          onClick={() => setRetry((n) => n + 1)}
        >
          ↻ Обновить
        </button>
        {(custom || year !== currentYear) && (
          <button
            type="button"
            className="gameTrend__textButton"
            onClick={() => chooseYear(currentYear)}
          >
            Текущий год
          </button>
        )}
      </div>
      {rangeOpen && (
        <form className="gameTrend__range" onSubmit={applyRange}>
          <label>
            С
            <input
              className="input"
              type="date"
              required
              min="2000-01-01"
              max="2200-12-31"
              value={draft.from}
              onChange={(e) =>
                setDraft((p) => ({ ...p, from: e.target.value }))
              }
            />
          </label>
          <label>
            По
            <input
              className="input"
              type="date"
              required
              min="2000-01-01"
              max="2200-12-31"
              value={draft.to}
              onChange={(e) => setDraft((p) => ({ ...p, to: e.target.value }))}
            />
          </label>
          <button className="btn" type="submit">
            Применить диапазон
          </button>
          {rangeError && <p role="alert">{rangeError}</p>}
        </form>
      )}
      {loading ? (
        <div className="gameTrend__placeholder" role="status">
          Считаем посещаемость…
        </div>
      ) : error ? (
        <div className="gameTrend__placeholder" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            Повторить
          </button>
        </div>
      ) : (
        <>
          <div className="gameTrend__metrics">
            <div>
              <span>Игр сыграно</span>
              <strong>{summary.games}</strong>
            </div>
            <div className="isAccent">
              <span>В среднем на игре</span>
              <strong>{number(summary.average)}</strong>
            </div>
            <div>
              <span>Максимум игроков</span>
              <strong>{number(summary.max)}</strong>
            </div>
            <div>
              <span>Участий за период</span>
              <strong>{summary.total}</strong>
            </div>
          </div>
          <div className="gameTrend__chartCard">
            <div className="gameTrend__chartHeading">
              <div>
                <h3>Динамика состава</h3>
                <p>Среднее количество игроков на одну игру</p>
              </div>
              <div
                className="gameTrend__mode"
                role="group"
                aria-label="Группировка посещаемости"
              >
                {[
                  ["week", "Недели"],
                  ["month", "Месяцы"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={mode === value}
                    onClick={() => {
                      setMode(value);
                      setSelectedKey(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {!summary.games ? (
              <p className="gameTrend__empty">
                За этот период нет завершённых игр. Выберите другой год или
                диапазон.
              </p>
            ) : (
              <TrendPlot
                buckets={buckets}
                selectedIndex={selectedIndex}
                onSelect={(i) => setSelectedKey(buckets[i].key)}
              />
            )}
            <p className="gameTrend__hint">
              Недели начинаются с понедельника. Периоды без игр — пропуски, а не
              нулевая посещаемость.
            </p>
          </div>
          <section className="gameTrend__details">
            <div className="gameTrend__period">
              <button
                type="button"
                aria-label="Предыдущий период"
                disabled={selectedIndex <= 0}
                onClick={() => setSelectedKey(buckets[selectedIndex - 1].key)}
              >
                ‹
              </button>
              <select
                className="input"
                aria-label="Период на графике"
                value={selected.key}
                onChange={(e) => setSelectedKey(e.target.value)}
              >
                {buckets.map((b) => (
                  <option key={b.key} value={b.key}>
                    {bucketTitle(b, mode)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Следующий период"
                disabled={selectedIndex === buckets.length - 1}
                onClick={() => setSelectedKey(buckets[selectedIndex + 1].key)}
              >
                ›
              </button>
            </div>
            <div className="gameTrend__periodStats">
              <span>
                Игр: <b>{selected.summary.games}</b>
              </span>
              <span>
                Среднее: <b>{number(selected.summary.average)}</b>
              </span>
              <span>
                Мин / макс:{" "}
                <b>
                  {number(selected.summary.min)} /{" "}
                  {number(selected.summary.max)}
                </b>
              </span>
            </div>
            {!selected.games.length ? (
              <p className="gameTrend__empty">
                В этом периоде завершённых игр нет.
              </p>
            ) : (
              selected.games.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="gameTrend__game"
                  onClick={() => onOpenGame?.(g.id)}
                >
                  <span>
                    <strong>
                      {shortDate(g.date)} {g.date.slice(0, 4)}
                    </strong>
                    <small>{g.location || "Игра"}</small>
                  </span>
                  <span className="gameTrend__players">
                    <b>{g.players}</b>
                    <small>игроков</small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))
            )}
          </section>
          <section className="gameTrend__seasons">
            <h3>Посещаемость по сезонам</h3>
            <p>Среднее на игру в пределах выбранных дат</p>
            <div>
              {seasons.map((s) => (
                <article key={s.name}>
                  <span>{s.name}</span>
                  <strong>{number(s.average)}</strong>
                  <small>{s.games} игр</small>
                  <i
                    style={{
                      "--season-fill": `${s.average == null || !summary.max ? 0 : (s.average / summary.max) * 100}%`,
                    }}
                  />
                </article>
              ))}
            </div>
          </section>
          <p className="gameTrend__hint gameTrend__footnote">
            Количество — по отметкам «Буду», включая гостей. Учтены только
            завершённые игры, без отменённых. «Участия» — сумма отметок по
            играм, не число уникальных игроков.
          </p>
        </>
      )}
    </section>
  );
}
