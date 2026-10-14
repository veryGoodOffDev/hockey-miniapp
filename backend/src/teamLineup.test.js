import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  validateTeamLineup,
  saveTeamLineup,
  lineupRosterSignature,
} from "./teamLineup.js";
import {
  initialLineup,
  moveLineupPlayer,
} from "../../webapp/src/teamLineup.js";
const make = (start, count = 8) =>
  Array.from({ length: count }, (_, i) => ({
    tg_id: start + i,
    position: i === 0 || i === 7 ? "G" : i < 3 ? "D" : "F",
  }));
const teams = { A: make(1), B: make(20) };
test("default lineup has five skaters and one goalie per team; shortage leaves empty ice spots", () => {
  const lineup = initialLineup(teams, null);
  assert.equal(lineup.A.ice.length, 6);
  assert.equal(lineup.A.bench.length, 2);
  assert.equal(lineup.A.ice.at(-1).id, "1");
  assert.deepEqual(validateTeamLineup(lineup, teams), lineup);
  const short = { A: make(1, 3), B: [] };
  assert.equal(initialLineup(short, null).A.ice.length, 3);
  validateTeamLineup(initialLineup(short, null), short);
});
test("bench replacement preserves roster and goalie role, free positions persist, no cross-team move", () => {
  const initial = initialLineup(teams, null),
    replacement = moveLineupPlayer(initial, teams, "A", "7", "ice", {
      x: 0.5,
      y: 0.3,
    });
  validateTeamLineup(replacement, teams);
  assert.ok(replacement.A.ice.some((p) => p.id === "7"));
  assert.deepEqual(replacement.B, initial.B);
  const keeper = moveLineupPlayer(replacement, teams, "A", "8", "ice", {
    x: 0.5,
    y: 0.8,
  });
  validateTeamLineup(keeper, teams);
  assert.equal(keeper.A.ice.at(-1).id, "8");
  assert.ok(keeper.A.bench.includes("1"));
  const moved = moveLineupPlayer(keeper, teams, "A", "8", "ice", {
    x: 0.42,
    y: 0.78,
  });
  assert.equal(moved.A.ice.at(-1).x, 0.42);
  assert.equal(moveLineupPlayer(initial, teams, "A", "20", "ice"), initial);
  const benched = moveLineupPlayer(initial, teams, "A", "2", "bench");
  validateTeamLineup(benched, teams);
  assert.ok(benched.A.bench.includes("2"));
});
test("backend rejects unknown/duplicate players, NaN/coordinates and incorrect ice count", () => {
  for (const mutate of [
    (x) => (x.A.ice[0].id = "20"),
    (x) => (x.A.bench[0] = x.A.ice[0].id),
    (x) => (x.A.ice[0].x = NaN),
    (x) => (x.A.ice[0].y = 2),
    (x) => x.A.bench.push(x.A.ice.pop().id),
  ]) {
    const layout = initialLineup(teams, null);
    mutate(layout);
    assert.throws(() => validateTeamLineup(layout, teams), /bad_lineup/);
  }
  const stale = initialLineup(teams, null);
  const newTeams = { ...teams, A: make(50) };
  assert.equal(initialLineup(newTeams, stale).A.ice[0].id, "51");
});
const db = process.env.RSVP_TEST_DATABASE_URL;
test(
  "PostgreSQL lineup save persists, conflicts prevent overwrite, fixed teams refuse edits",
  { skip: !db },
  async () => {
    const url = new URL(db);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_checks"),
    );
    const admin = new pg.Pool({ connectionString: db }),
      schema = `lineup_test_${process.pid}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: db,
      options: `-c search_path=${schema}`,
    });
    const q = (s, p) => pool.query(s, p);
    try {
      await q(
        `CREATE TABLE teams(game_id int PRIMARY KEY,team_a jsonb,team_b jsonb,meta jsonb,lineup jsonb,lineup_revision int DEFAULT 0);CREATE TABLE players(tg_id bigint PRIMARY KEY,position text);CREATE TABLE rsvps(game_id int,tg_id bigint,pos_override text,status text);`,
      );
      await q("INSERT INTO teams VALUES(1,$1,$2,$3,NULL,0)", [
        JSON.stringify(teams.A),
        JSON.stringify(teams.B),
        "{}",
      ]);
      const layout = initialLineup(teams, null);
      const saved = await saveTeamLineup(q, {
        gameId: 1,
        lineup: layout,
        revision: 0,
      });
      assert.equal(saved.lineup_revision, 1);
      assert.deepEqual(saved.lineup, layout);
      await assert.rejects(
        saveTeamLineup(q, { gameId: 1, lineup: layout, revision: 0 }),
        /lineup_conflict/,
      );
      await q(`UPDATE teams SET meta='{"locked":true}' WHERE game_id=1`);
      await assert.rejects(
        saveTeamLineup(q, { gameId: 1, lineup: layout, revision: 1 }),
        /teams_locked/,
      );
      await q(`UPDATE teams SET meta='{}' WHERE game_id=1`);
      const racing = await Promise.allSettled([
        saveTeamLineup(q, { gameId: 1, lineup: layout, revision: 1 }),
        saveTeamLineup(q, { gameId: 1, lineup: layout, revision: 1 }),
      ]);
      assert.equal(racing.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(racing.filter((r) => r.status === "rejected").length, 1);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);

test("roster signature preserves saved positions on repeated IN or skill changes, but detects replacement and goalie changes", () => {
  const signature = lineupRosterSignature(teams.A, teams.B);
  assert.equal(
    lineupRosterSignature(
      [...teams.A].reverse().map((p) => ({ ...p, skill: 9 })),
      teams.B,
    ),
    signature,
  );
  assert.notEqual(lineupRosterSignature(teams.A.slice(1), teams.B), signature);
  assert.notEqual(
    lineupRosterSignature(
      teams.A.map((p) => ({ ...p, position: "F" })),
      teams.B,
    ),
    signature,
  );
});
