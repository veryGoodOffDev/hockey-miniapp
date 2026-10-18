const VPN_HINT =
  "Если используешь VPN, попробуй отключить его или сменить сервер, затем нажми «Повторить».";

// Classify observable failures, without guessing that VPN is their cause.
export function describeConnectionError(
  error,
  { online = globalThis.navigator?.onLine } = {},
) {
  const data = error?.data || error || {};
  const reason = String(data.reason || data.error || error?.message || "");
  const status = Number(
    data.status || error?.status || reason.match(/^HTTP_(\d+)$/)?.[1],
  );
  if (reason === "not_member")
    return {
      kind: "access",
      title: "Нет доступа",
      message:
        "Ты не состоишь в чате команды. Попроси организатора добавить тебя, затем повтори вход.",
    };
  if (
    [
      "access_chat_not_set",
      "access_chat_invalid",
      "bot_forbidden",
      "no_bot_token",
    ].includes(reason)
  )
    return {
      kind: "configuration",
      title: "Доступ к команде не настроен",
      message:
        "Администратору нужно проверить настройки бота и командного чата.",
    };
  if (["telegram_unavailable", "member_check_failed"].includes(reason))
    return {
      kind: "telegram",
      title: "Не удалось проверить доступ через Telegram",
      message:
        "Сервер приложения не смог проверить участие в чате. Подожди немного и повтори попытку.",
    };
  if (reason === "player_deleted")
    return {
      kind: "access",
      title: "Профиль недоступен",
      message: "Профиль игрока не найден. Обратись к администратору команды.",
    };
  if (
    [
      "no_init_data",
      "invalid_init_data",
      "expired_init_data",
      "invalid_token",
      "BOT_INVALID",
      "no_hash",
      "no_user",
    ].includes(reason) ||
    status === 401
  )
    return {
      kind: "auth",
      title: "Не удалось подтвердить вход",
      message:
        "Закрой мини-приложение и открой его заново через бота в Telegram. Данные входа могли устареть или не передаться.",
    };
  if (status === 429)
    return {
      kind: "server",
      title: "Слишком много попыток",
      message: "Подожди немного перед следующей попыткой входа.",
    };
  if (status >= 500 || reason === "server_error")
    return {
      kind: "server",
      title: "Сервер временно недоступен",
      message:
        "Сервер приложения вернул ошибку. Возможно, он перезапускается или перегружен. Подожди немного и повтори попытку.",
    };
  const network =
    ["network_error", "request_timeout"].includes(reason) ||
    error?.name === "TimeoutError" ||
    error instanceof TypeError;
  if (network && online === false)
    return {
      kind: "offline",
      title: "Нет подключения к интернету",
      message:
        "Устройство сообщает, что соединение отсутствует. Подключись к Wi-Fi или мобильной сети и повтори попытку.",
    };
  if (reason === "request_timeout" || error?.name === "TimeoutError")
    return {
      kind: "timeout",
      title: "Сервер не ответил вовремя",
      message:
        "Не удалось дождаться ответа. Это может быть связано с нестабильной сетью или временной недоступностью сервера.",
      hint: VPN_HINT,
    };
  if (network)
    return {
      kind: "network",
      title: "Не удалось связаться с сервером",
      message:
        "Соединение прервалось или запрос не дошёл до сервера. Проверь интернет и повтори попытку.",
      hint: VPN_HINT,
    };
  if (["non_json_response", "invalid_response"].includes(reason))
    return {
      kind: "response",
      title: "Не удалось получить данные приложения",
      message:
        "Пришёл неполный или неожиданный ответ. Проверь соединение и повтори попытку. Если это повторяется, сообщи администратору.",
      hint: VPN_HINT,
    };
  return {
    kind: "unknown",
    title: "Не удалось завершить загрузку",
    message:
      "Причину сбоя определить не удалось. Повтори попытку. Если ошибка повторяется, сообщи администратору команды.",
  };
}
