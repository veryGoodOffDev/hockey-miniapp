import { useEffect, useRef, useState } from "react";
import "./AppFeatureSettings.css";

const controls = [
  [
    "chat",
    "💬",
    "Чат приложения",
    "Общий чат и личные переписки внутри приложения. На сообщения бота в Telegram не влияет.",
  ],
  [
    "game_comments",
    "🗨️",
    "Комментарии к играм",
    "Обсуждения, ответы и реакции под карточкой игры.",
  ],
  [
    "air_hockey",
    "🏒",
    "Air Hockey в профиле",
    "Игра против бота и PvP. Начатые матчи можно завершить, новые игры и реванши будут недоступны.",
  ],
];

export default function AppFeatureSettings({
  apiGet,
  apiPatch,
  features,
  onFeaturesChange,
}) {
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let active = true;
    apiGet("/api/features")
      .then((result) => {
        if (active && result.features) {
          onFeaturesChange(result.features);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active)
          setError("Не удалось загрузить настройки. Откройте раздел ещё раз.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, []);
  async function toggle(key, title) {
    if (saving || loading) return;
    setSaving(key);
    setError("");
    setNotice("");
    try {
      const result = await apiPatch("/api/admin/features", {
        [key]: !features[key],
      });
      if (alive.current) {
        onFeaturesChange(result.features);
        setNotice(
          `${title}: ${result.features[key] ? "включено" : "выключено"}`,
        );
      }
    } catch {
      if (alive.current)
        setError(
          "Не удалось сохранить настройку. Проверьте соединение и попробуйте снова.",
        );
    } finally {
      if (alive.current) setSaving(null);
    }
  }
  return (
    <section className="card appFeatures" aria-busy={loading || !!saving}>
      <h2>Функции приложения</h2>
      <p className="small">
        Настройки действуют для всех, включая администраторов. При отключении
        данные сохраняются. После включения функция снова доступна.
      </p>
      {loading && (
        <p className="small" role="status">
          Загружаем настройки…
        </p>
      )}
      <div className="appFeatures__list">
        {controls.map(([key, icon, title, description]) => (
          <div className="appFeatures__row" key={key}>
            <span className="appFeatures__icon" aria-hidden="true">
              {icon}
            </span>
            <div className="appFeatures__text">
              <strong>{title}</strong>
              <span>{description}</span>
              <small>
                {saving === key
                  ? "Сохраняем…"
                  : features[key]
                    ? "Включено"
                    : "Выключено"}
              </small>
            </div>
            <button
              type="button"
              role="switch"
              className="appFeatures__switch"
              aria-label={title}
              aria-checked={features[key]}
              disabled={!loaded || loading || !!saving}
              onClick={() => toggle(key, title)}
            >
              <span />
            </button>
          </div>
        ))}
      </div>
      <p className="small">
        На уже открытых устройствах изменения появятся в течение минуты или при
        возвращении в приложение.
      </p>
      {error && (
        <p className="appFeatures__error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
