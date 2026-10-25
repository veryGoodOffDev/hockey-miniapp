export function teamPostError(error) {
  const reason = error?.data?.reason || error?.reason || error?.message;
  const messages = {
    jersey_images_not_configured:
      "На сервере не настроен адрес приложения для картинок джерси.",
    jersey_photo_unavailable:
      "Telegram не смог загрузить картинку джерси. Проверь, что фронтенд с jersey-white.jpg и jersey-blue.jpg уже задеплоен.",
    teams_caption_too_long:
      "Список команды не помещается в подпись к фото (1024 символа). Выбери таблицу в две колонки.",
    teams_message_too_long: "Составы не помещаются в одно сообщение Telegram.",
    teams_message_not_editable:
      "Telegram не разрешил изменить публикацию. Удали устаревшее сообщение и повтори отправку нужного формата.",
    teams_send_failed:
      "Не удалось завершить публикацию. Повтори попытку: сохранённые сообщения будут обновлены.",
    chat_not_set: "Командный чат не настроен.",
    game_cancelled: "Игра отменена.",
    game_not_found: "Игра не найдена.",
    no_teams: "Сначала сформируй составы.",
    network_error:
      "Не удалось связаться с сервером. Проверь соединение и повтори попытку.",
    request_timeout: "Сервер не ответил вовремя. Повтори попытку.",
  };
  return (
    "❌ " +
    (messages[reason] || "Не удалось опубликовать составы. Повтори попытку.")
  );
}
export function teamPostSuccess(result) {
  return result?.edited
    ? "✅ Составы в чате актуальны"
    : result?.format === "jerseys"
      ? "✅ Обе команды опубликованы с джерси"
      : "✅ Таблица составов опубликована";
}
