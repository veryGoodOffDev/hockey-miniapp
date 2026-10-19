import { useEffect, useMemo, useRef, useState } from "react";
import { apiPatch } from "./api.js";
import { createRsvpViewPreference } from "./rsvpViewPreference.js";

export default function useRsvpView(playerId, serverView, onSaved) {
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  const store = useMemo(() => {
    let storage;
    try {
      storage = window.localStorage;
    } catch {
      /* Optional fallback. */
    }
    return createRsvpViewPreference({
      playerId,
      serverView,
      storage,
      save: (view, signal) =>
        apiPatch("/api/me/preferences", { rsvp_view: view }, { signal }),
      onSaved: (view) => savedCallback.current?.(view),
    });
    // Profile refreshes synchronize below without replacing an in-flight save.
  }, [playerId]);
  const [result, setResult] = useState(() => ({
    store,
    value: store.getSnapshot(),
  }));
  useEffect(() => {
    store.activate();
    const unsubscribe = store.subscribe((value) => setResult({ store, value }));
    setResult({ store, value: store.getSnapshot() });
    return () => {
      unsubscribe();
      store.dispose();
    };
  }, [store]);
  useEffect(() => {
    store.syncServer(serverView);
  }, [store, serverView]);
  return {
    ...(result.store === store ? result.value : store.getSnapshot()),
    setView: store.setView,
    retry: store.retry,
  };
}
