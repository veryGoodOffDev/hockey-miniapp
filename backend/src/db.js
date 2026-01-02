import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

export async function initDb() {
  await pool.query("SELECT 1");
}

import { performance } from "node:perf_hooks";

const LOG_DB = process.env.LOG_DB === "1";
const SLOW_MS = Number(process.env.LOG_DB_SLOW_MS || 200);

function shortSql(sql) {
  return String(sql)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export async function q(text, params) {
  const t0 = performance.now();
  try {
    const res = await pool.query(text, params);
    const ms = performance.now() - t0;

    if (LOG_DB && ms >= SLOW_MS) {
      console.log(
        `[DB slow] ${ms.toFixed(1)}ms rows=${res.rowCount ?? "?"} sql="${shortSql(text)}"`
      );
    }

    return res;
  } catch (err) {
    const ms = performance.now() - t0;
    console.log(
      `[DB error] ${ms.toFixed(1)}ms sql="${shortSql(text)}" err=${err?.message || err}`
    );
    throw err;
  }
}

