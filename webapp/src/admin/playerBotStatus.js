export function playerBotStatus(player) {
  const telegram =
    Number(player.tg_id) > 0 &&
    !player.is_guest &&
    (player.player_kind || "tg") === "tg";
  if (!telegram) return "unavailable";
  return player.bot_pm?.started === true ? "started" : "unconfirmed";
}
export function botLaunchSummary(players) {
  const eligible = players.filter(
    (player) => !player.disabled && playerBotStatus(player) !== "unavailable",
  );
  return {
    total: eligible.length,
    started: eligible.filter((player) => playerBotStatus(player) === "started")
      .length,
  };
}
