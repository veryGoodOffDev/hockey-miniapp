// src/admin/MapPickModal.jsx
import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export default function MapPickModal({ open, initial, onClose, onPick }) {
  const [pos, setPos] = useState(() => {
    if (initial?.lat != null && initial?.lon != null) return { lat: initial.lat, lon: initial.lon };
    return { lat: 55.751244, lon: 37.618423 };
  });

  const [picked, setPicked] = useState(() => ({
    lat: initial?.lat ?? null,
    lon: initial?.lon ?? null,
    address: "",
  }));

  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState("");

  useEffect(() => {
    if (!open) return;

    const lat = initial?.lat ?? null;
    const lon = initial?.lon ?? null;

    setPos(() => {
      if (lat != null && lon != null) return { lat, lon };
      return { lat: 55.751244, lon: 37.618423 };
    });

    setPicked({ lat, lon, address: "" });
    setAddr("");
    setQ("");
    setList([]);
  }, [open, initial?.lat, initial?.lon]);

  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const j = await r.json();
      const text = j?.display_name || "";
      setAddr(text);
      return text;
    } catch {
      return "";
    }
  }

  async function doSearch() {
    const s = q.trim();
    if (!s) return setList([]);
    setBusy(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(s)}&limit=6`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const j = await r.json();
      setList(Array.isArray(j) ? j : []);
    } finally {
      setBusy(false);
    }
  }

  function Recenter({ lat, lon }) {
    const map = useMap();
    useEffect(() => {
      if (lat == null || lon == null) return;
      map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lat, lon]);
    return null;
  }

  function ClickToPick() {
    useMapEvents({
      click: async (e) => {
        const lat = Number(e.latlng.lat);
        const lon = Number(e.latlng.lng);

        setPicked({ lat, lon, address: "" });
        const a = await reverseGeocode(lat, lon);
        setPicked({ lat, lon, address: a });
      },
    });

    return picked.lat != null && picked.lon != null ? <Marker position={[picked.lat, picked.lon]} /> : null;
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 14,
      }}
      onClick={onClose}
    >
      <div className={"card mapPickModal__card"} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>📍 Выберите точку на карте</h3>
          <button className="btn secondary" onClick={onClose}>
            ✖
          </button>
        </div>

        <div className="mapPickModal__body">
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="Поиск адреса/арены…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch();
              }}
            />
            <button className="btn secondary" disabled={busy} onClick={doSearch}>
              {busy ? "..." : "Найти"}
            </button>
          </div>

          {!!list.length && (
            <div className="card mapPickModal__suggest" style={{ marginTop: 10 }}>
              {list.map((x) => (
                <div
                  key={x.place_id}
                  className="row"
                  style={{ justifyContent: "space-between", cursor: "pointer", padding: "8px 6px" }}
                  onClick={async () => {
                    const lat = Number(x.lat);
                    const lon = Number(x.lon);

                    setPos({ lat, lon });
                    setPicked({ lat, lon, address: x.display_name || "" });
                    setAddr(x.display_name || "");
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{x.display_name}</div>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              marginTop: 10,
              height: "clamp(260px, 44dvh, 520px)",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <MapContainer
              center={[pos.lat, pos.lon]}
              zoom={15}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom={true}
              attributionControl={false}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Recenter lat={pos.lat} lon={pos.lon} />
              <ClickToPick />
            </MapContainer>
          </div>

          <div className="small" style={{ opacity: 0.7, marginTop: 6 }}>
            © OpenStreetMap contributors · Leaflet
          </div>
        </div>

        <div className="mapPickModal__footer">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div className="small" style={{ opacity: 0.9 }}>
              {picked.lat != null && picked.lon != null ? (
                <>
                  Координаты: <b>{picked.lat.toFixed(6)}, {picked.lon.toFixed(6)}</b>
                  {addr ? <div style={{ marginTop: 6 }}>Адрес: {addr}</div> : null}
                </>
              ) : (
                "Кликни по карте, чтобы поставить метку"
              )}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn secondary" onClick={onClose}>
                Отмена
              </button>

              <button
                className="btn"
                disabled={picked.lat == null || picked.lon == null}
                onClick={() => {
                  onPick?.({ lat: picked.lat, lon: picked.lon, address: addr || picked.address || "" });
                  onClose?.();
                }}
              >
                ✅ Выбрать
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
