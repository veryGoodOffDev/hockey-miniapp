export function canViewPlayerBotStatus(userId, ownerId) {
  const owner = String(ownerId || "").trim();
  return owner !== "" && owner !== "0" && String(userId) === owner;
}

export function presentAdminPlayers(
  rows,
  { envAdmins, canViewBotStatus, avatarUrl },
) {
  return rows.map((row) => {
    const {
      avatar_file_id,
      pm_started,
      pm_started_at,
      pm_last_seen,
      ...player
    } = row;
    return {
      ...player,
      avatar_url: avatarUrl(row),
      is_admin: player.is_admin || envAdmins.has(String(player.tg_id)),
      is_env_admin: envAdmins.has(String(player.tg_id)),
      ...(canViewBotStatus
        ? {
            bot_pm: {
              started: pm_started === true,
              started_at: pm_started_at || null,
              last_interaction_at: pm_last_seen || null,
            },
          }
        : {}),
    };
  });
}
