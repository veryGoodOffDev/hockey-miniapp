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

test("capsules sort short names first inside each position; rows retain chronological order and source data", () => {
  const players = [
    {
      tg_id: 1,
      display_name: "Александр",
      position: "D",
      status_changed_at: "2026-10-19T10:00:00Z",
    },
    {
      tg_id: 2,
      display_name: "Ли",
      position: "D",
      status_changed_at: "2026-10-19T12:00:00Z",
    },
    {
      tg_id: 3,
      display_name: "Иван",
      position: "D",
      status_changed_at: "2026-10-19T11:00:00Z",
    },
    { tg_id: 4, display_name: "Длинное имя вратаря", position: "G" },
    { tg_id: 5, display_name: "Ян", position: "F" },
  ];
  const original = structuredClone(players);
  for (const tone of ["yes", "no", "maybe"]) {
    const chips = groupRsvpPlayers(players, tone, "chips");
    assert.deepEqual(
      chips.map((group) => group.position),
      ["G", "D", "F"],
    );
    assert.deepEqual(
      chips[1].players.map((player) => player.tg_id),
      [2, 3, 1],
    );
  }
  for (const tone of ["yes", "no"]) {
    assert.deepEqual(
      groupRsvpPlayers(players, tone, "list")[1].players.map(
        (player) => player.tg_id,
      ),
      [1, 3, 2],
    );
    assert.deepEqual(
      groupRsvpPlayers(players, tone),
      groupRsvpPlayers(players, tone, "list"),
    );
  }
  assert.deepEqual(players, original);
});

test("equal-length names keep time/alphabet ties and Unicode characters are not counted as UTF-16 halves", () => {
  const list = [
    {
      tg_id: 1,
      display_name: "Олег",
      status_changed_at: "2026-10-19T10:00:00Z",
    },
    {
      tg_id: 2,
      display_name: "Иван",
      status_changed_at: "2026-10-19T11:00:00Z",
    },
    { tg_id: 3, first_name: "Ян" },
    { tg_id: 4, display_name: "😀" },
    { tg_id: 5, username: "xy" },
    { tg_id: 6 },
  ];
  assert.deepEqual(
    groupRsvpPlayers(list, "yes", "chips")[0].players.map(
      (player) => player.tg_id,
    ),
    [4, 6, 3, 5, 1, 2],
  );
  assert.deepEqual(
    groupRsvpPlayers(list.slice(0, 2), "maybe", "chips")[0].players.map(
      (player) => player.tg_id,
    ),
    [2, 1],
  );
  assert.deepEqual(groupRsvpPlayers([], "yes", "chips"), []);
});

test("current match winner comes first without changing the relative order or group metadata of other players", async () => {
  const { rsvpPlayersForDisplay } = await import("./rsvpPlayerOrder.js");
  const list = [
    { tg_id: 1, position: "G", display_name: "Вратарь" },
    {
      tg_id: 2,
      position: "D",
      display_name: "Александр",
      status_changed_at: "2026-10-25T10:00:00Z",
    },
    {
      tg_id: 3,
      position: "D",
      display_name: "Ли",
      status_changed_at: "2026-10-25T11:00:00Z",
    },
    { tg_id: 4, position: "F", display_name: "Победитель" },
  ];
  const original = structuredClone(list);
  for (const view of ["list", "chips"]) {
    const base = rsvpPlayersForDisplay(list, "yes", view);
    const result = rsvpPlayersForDisplay(list, "yes", view, "4");
    assert.equal(result[0].player.tg_id, 4);
    assert.equal(result[0].group.position, "F");
    assert.deepEqual(
      result.slice(1),
      base.filter((entry) => entry.player.tg_id !== 4),
    );
    assert.deepEqual(rsvpPlayersForDisplay(list, "yes", view, null), base);
    assert.deepEqual(rsvpPlayersForDisplay(list, "yes", view, 999), base);
    assert.deepEqual(rsvpPlayersForDisplay(list, "yes", view, 1), base);
    assert.equal(
      rsvpPlayersForDisplay(list, "yes", view, 2)[0].player.tg_id,
      2,
    );
  }
  assert.deepEqual(list, original);
  assert.deepEqual(rsvpPlayersForDisplay([], "no", "chips", 4), []);
});
