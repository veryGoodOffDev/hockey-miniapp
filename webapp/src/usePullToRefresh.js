import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function getScrollableTop(el) {
  if (el && el instanceof HTMLElement) return el.scrollTop;
  if (typeof window === "undefined") return 0;
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

export default function usePullToRefresh({
  enabled,
  onRefresh,
  threshold = 70,
  maxPull = 120,
  containerRef,
}) {
  const [pull, setPull] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const dragRef = useRef({ active: false, startY: 0, pointerId: null });
  const refreshingRef = useRef(false);
  const pullRef = useRef(0);

  const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : null;

  const resetPull = useCallback(() => {
    pullRef.current = 0;
    setPull(0);
    setIsReady(false);
  }, []);

  const triggerRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);

    try {
      tg?.HapticFeedback?.impactOccurred?.("light");
      await onRefresh?.();
    } finally {
      setIsRefreshing(false);
      refreshingRef.current = false;
      resetPull();
    }
  }, [onRefresh, resetPull, tg]);

  useEffect(() => {
    tg?.disableVerticalSwipes?.();
  }, [tg]);

  useEffect(() => {
    if (!enabled) {
      dragRef.current = { active: false, startY: 0, pointerId: null };
      resetPull();
    }
  }, [enabled, resetPull]);

  useEffect(() => {
    const target = containerRef?.current;
    if (!target || !enabled) return undefined;

    const canStart = () => !refreshingRef.current && getScrollableTop(target) === 0;

    const onStart = (y, pointerId = null) => {
      if (!canStart()) return;
      dragRef.current = { active: true, startY: y, pointerId };
    };

    const onMove = (y, evt) => {
      if (!dragRef.current.active) return;
      if (refreshingRef.current) return;
      if (getScrollableTop(target) > 0) {
        dragRef.current.active = false;
        resetPull();
        return;
      }

      const delta = y - dragRef.current.startY;
      if (delta <= 0) {
        resetPull();
        return;
      }

      const nextPull = Math.min(maxPull, delta * 0.55);
      pullRef.current = nextPull;
      setPull(nextPull);
      setIsReady(nextPull >= threshold);

      if (evt?.cancelable) evt.preventDefault();
    };

    const onEnd = async () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      if (pullRef.current >= threshold) {
        setPull(Math.min(maxPull, threshold));
        pullRef.current = Math.min(maxPull, threshold);
        await triggerRefresh();
      } else {
        resetPull();
      }
    };

    const pointerDown = (e) => {
      if (e.pointerType === "mouse") return;
      onStart(e.clientY, e.pointerId);
    };
    const pointerMove = (e) => {
      if (!dragRef.current.active) return;
      if (dragRef.current.pointerId != null && e.pointerId !== dragRef.current.pointerId) return;
      onMove(e.clientY, e);
    };
    const pointerEnd = async (e) => {
      if (dragRef.current.pointerId != null && e.pointerId !== dragRef.current.pointerId) return;
      await onEnd();
    };

    const touchStart = (e) => {
      if (e.touches.length !== 1) return;
      onStart(e.touches[0].clientY);
    };
    const touchMove = (e) => {
      if (e.touches.length !== 1) return;
      onMove(e.touches[0].clientY, e);
    };
    const touchEnd = async () => {
      await onEnd();
    };

    target.addEventListener("pointerdown", pointerDown, { passive: true });
    target.addEventListener("pointermove", pointerMove, { passive: false });
    target.addEventListener("pointerup", pointerEnd, { passive: true });
    target.addEventListener("pointercancel", pointerEnd, { passive: true });

    target.addEventListener("touchstart", touchStart, { passive: true });
    target.addEventListener("touchmove", touchMove, { passive: false });
    target.addEventListener("touchend", touchEnd, { passive: true });
    target.addEventListener("touchcancel", touchEnd, { passive: true });

    return () => {
      target.removeEventListener("pointerdown", pointerDown);
      target.removeEventListener("pointermove", pointerMove);
      target.removeEventListener("pointerup", pointerEnd);
      target.removeEventListener("pointercancel", pointerEnd);

      target.removeEventListener("touchstart", touchStart);
      target.removeEventListener("touchmove", touchMove);
      target.removeEventListener("touchend", touchEnd);
      target.removeEventListener("touchcancel", touchEnd);
    };
  }, [containerRef, enabled, maxPull, resetPull, threshold, triggerRefresh]);

  const statusText = useMemo(() => {
    if (isRefreshing) return "Обновляем…";
    if (isReady) return "Отпустите для обновления";
    return "Потяните вниз для обновления";
  }, [isReady, isRefreshing]);

  return {
    pull,
    isReady,
    isRefreshing,
    statusText,
  };
}
