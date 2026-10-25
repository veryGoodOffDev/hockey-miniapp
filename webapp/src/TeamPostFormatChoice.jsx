import React from "react";
export default function TeamPostFormatChoice({ value, onChange, disabled }) {
  return (
    <div className="teamPostFormat">
      <label htmlFor="teamPostFormat">Публикация составов в чат</label>
      <select
        id="teamPostFormat"
        className="input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="columns">2 колонки — 1 сообщение</option>
        <option value="jerseys">Джерси — 2 сообщения</option>
      </select>
      <p>
        Можно опубликовать оба варианта. Уже отправленные составы будут
        обновляться автоматически.
      </p>
    </div>
  );
}
