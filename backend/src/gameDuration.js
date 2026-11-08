export const DEFAULT_GAME_DURATION_MINUTES = 75;
export const MAX_GAME_DURATION_MINUTES = 1440;
export function parseGameDuration(value = DEFAULT_GAME_DURATION_MINUTES) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_GAME_DURATION_MINUTES
  )
    throw Object.assign(new Error("bad_duration_minutes"), { status: 400 });
  return value;
}
export function gameEndSql(alias = "") {
  if (alias && !/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(alias))
    throw new Error("invalid_sql_alias");
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}starts_at + ${prefix}duration_minutes * INTERVAL '1 minute')`;
}
export async function ensureGameDurationSchema(q) {
  // PostgreSQL's default also fills every existing game the first time the column is added.
  await q(
    `ALTER TABLE games ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 75`,
  );
  await q(
    `UPDATE games SET duration_minutes=75 WHERE duration_minutes IS NULL`,
  );
  await q(`ALTER TABLE games ALTER COLUMN duration_minutes SET DEFAULT 75,
    ALTER COLUMN duration_minutes SET NOT NULL`);
  await q(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='games'::regclass AND conname='games_duration_minutes_check') THEN
      ALTER TABLE games ADD CONSTRAINT games_duration_minutes_check CHECK(duration_minutes BETWEEN 1 AND 1440);
    END IF;
  END $$`);
}
