import { useEffect, useState } from "react";
import logo from "./commandLogo.png";
export default function HockeyLoader({ text = "Загрузка..." }) {
  const [direction, setDirection] = useState("right"); // 'left' | 'right'

  useEffect(() => {
    const interval = setInterval(() => {
      setDirection((prev) => (prev === "right" ? "left" : "right"));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="hkLoader">
      <div className="hkStage">
        <div className="hkSticks">
          <div className={`hkStickWrap ${direction === "left" ? "isActive" : ""}`}>
            <svg width="80" height="80" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" className="hkStickSvg">
              <path d="M36 3c-1 1.295-3.027 3.803-4.391 5.671c-3.816 5.225-7.156 6.454-10.328 7.632c-3.172 1.178-10.407 1.029-13.88.854c-3.473-.175-5.735-.579-6.42.415c-2.102 3.053-.612 6.481 2.426 6.949c2.378.366 9.544-.32 12.899-.616c3.356-.297 7.024-1.301 8.283-1.785c1.259-.483 2.279-.88 2.597-1.644c.318-.765 1.876-2.817 3.783-5.917C32.045 12.811 35 9.55 36 8V3z"></path>
            </svg>
          </div>
          {/* LOGO */}
          <div className="hkLogoWrap" aria-hidden="true">
            <img className="hkLogo" src={logo} alt="Team logo" />
          </div>
          <div className={`hkStickWrap hkRight ${direction === "right" ? "isActive" : ""}`}>
            <svg width="80" height="80" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" className="hkStickSvg hkFlip">
              <path d="M36 3c-1 1.295-3.027 3.803-4.391 5.671c-3.816 5.225-7.156 6.454-10.328 7.632c-3.172 1.178-10.407 1.029-13.88.854c-3.473-.175-5.735-.579-6.42.415c-2.102 3.053-.612 6.481 2.426 6.949c2.378.366 9.544-.32 12.899-.616c3.356-.297 7.024-1.301 8.283-1.785c1.259-.483 2.279-.88 2.597-1.644c.318-.765 1.876-2.817 3.783-5.917C32.045 12.811 35 9.55 36 8V3z"></path>
            </svg>
          </div>
        </div>

        <div className="hkPuckRail">
          <div className={`hkPuck ${direction === "right" ? "toRight" : "toLeft"}`} />
        </div>

        <div className="hkIceLine" />
      </div>

      <div className="hkMeta">
        <div className="hkDots">
          <span />
          <span />
          <span />
        </div>
        <div className="hkText">{text}</div>
      </div>
    </div>
  );
}
