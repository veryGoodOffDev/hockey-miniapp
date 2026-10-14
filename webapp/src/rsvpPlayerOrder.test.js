import test from "node:test";
import assert from "node:assert/strict";
import { groupRsvpPlayers } from "./rsvpPlayerOrder.js";
test("positions stay grouped and earlier status changes come first, independently of skill or position edit", () => {
  const groups = groupRsvpPlayers(
    [
      {
        tg_id: 1,
        position: "D",
        skill: 10,
        status_changed_at: "2026-10-15T10:02:00Z",
      },
      { tg_id: 2, position: "F", status_changed_at: "2026-10-15T10:00:00Z" },
      {
        tg_id: 3,
        position: "D",
        skill: 2,
        status_changed_at: "2026-10-15T10:01:00Z",
        last_interaction_at: "2026-10-15T12:00:00Z",
      },
      { tg_id: 4, position: "G", status_changed_at: "2026-10-15T11:00:00Z" },
    ],
    "yes",
  );
  assert.deepEqual(
    groups.map((g) => g.position),
    ["G", "D", "F"],
  );
  assert.deepEqual(
    groups[1].players.map((p) => p.tg_id),
    [3, 1],
  );
});
test("missing timestamps follow dated players; unknown positions and empty/unmarked lists are safe", () => {
  const list = [
    { tg_id: 1, display_name: "Борис", position: "D" },
    {
      tg_id: 2,
      display_name: "Антон",
      position: "D",
      status_changed_at: "bad",
    },
    {
      tg_id: 3,
      display_name: "Яков",
      position: "D",
      status_changed_at: "2026-10-15T11:00:00Z",
    },
  ];
  assert.deepEqual(
    groupRsvpPlayers(list, "no")[0].players.map((p) => p.tg_id),
    [3, 2, 1],
  );
  assert.deepEqual(
    groupRsvpPlayers(list, "maybe")[0].players.map((p) => p.tg_id),
    [2, 1, 3],
  );
  assert.equal(
    groupRsvpPlayers([{ tg_id: 5, position: "X" }], "yes")[0].position,
    "F",
  );
  assert.deepEqual(groupRsvpPlayers([], "yes"), []);
});
