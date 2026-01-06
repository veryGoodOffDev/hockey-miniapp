// src/admin/Sheet.jsx
import React from "react";

export default function Sheet({ title, onClose, children }) {
  return (
    <div className="sheetBackdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheetHeader">
          <button className="sheetBtn" onClick={onClose}>
            ← Назад
          </button>

          <div className="sheetTitle">{title}</div>

          <button className="sheetBtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="sheetBody">{children}</div>
      </div>
    </div>
  );
}
