// src/admin/adminUtils.js

export function toLocal(starts_at) {
  const d = new Date(starts_at);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function toIsoFromLocal(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}`);
  return d.toISOString();
}

export function showName(p) {
  const n = (p.display_name || "").trim();
  if (n) return n;
  const fn = (p.first_name || "").trim();
  if (fn) return fn;
  if (p.username) return `@${p.username}`;
  return String(p.tg_id);
}

export function showNum(p) {
  const n = p.jersey_number;
  if (n === null || n === undefined || n === "") return "";
  return ` #${n}`;
}

export function posHuman(pos) {
  if (pos === "G") return "Вратарь (G)";
  if (pos === "D") return "Защитник (D)";
  return "Нападающий (F)";
}

export function posLabel(pos) {
  if (pos === "G") return "G";
  if (pos === "D") return "D";
  return "F";
}

export const SKILLS = ["skill", "skating", "iq", "stamina", "passing", "shooting"];
export const DEFAULT_SKILL = 5;

export function clampSkill(v) {
  if (v === "" || v == null) return DEFAULT_SKILL;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SKILL;
  return Math.max(1, Math.min(10, Math.round(n)));
}

export const GUEST_DEFAULT = {
  display_name: "",
  jersey_number: "",
  position: "F",
  skill: 5,
  skating: 5,
  iq: 5,
  stamina: 5,
  passing: 5,
  shooting: 5,
  notes: "",
  status: "yes",
};
