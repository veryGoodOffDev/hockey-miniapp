import { InlineKeyboard } from "grammy";

export function buildReminderKeyboard({ deepLink }) {
  return new InlineKeyboard().url("Открыть приложение", deepLink);
}
