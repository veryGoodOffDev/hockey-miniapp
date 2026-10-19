export const isRsvpView = (value) => value === "list" || value === "chips";
export const rsvpViewKey = (playerId) => `rsvp-view:v1:${playerId}`;
export function resolveRsvpView(playerId, serverView, storage) {
  if (isRsvpView(serverView)) return serverView;
  if (playerId != null) {
    try {
      const cached = storage?.getItem(rsvpViewKey(playerId));
      if (isRsvpView(cached)) return cached;
    } catch {
      /* Local storage is optional. */
    }
  }
  return "list";
}

// Serialize writes and coalesce rapid clicks, so an older response cannot win.
export function createRsvpViewPreference({
  playerId,
  serverView,
  storage,
  save,
  onSaved = () => {},
}) {
  let state = {
    view: resolveRsvpView(playerId, serverView, storage),
    saving: false,
    error: false,
  };
  let persisted = isRsvpView(serverView) ? serverView : null;
  let controller = new AbortController();
  let active = true;
  const listeners = new Set();
  const publish = (patch) => {
    state = { ...state, ...patch };
    if (active) listeners.forEach((listener) => listener(state));
  };
  const cache = () => {
    if (playerId == null) return;
    try {
      storage?.setItem(rsvpViewKey(playerId), state.view);
    } catch {
      /* Server preference still works. */
    }
  };
  async function flush() {
    if (!active || state.saving || playerId == null) return;
    const signal = controller.signal;
    publish({ saving: true, error: false });
    try {
      while (!signal.aborted && state.view !== persisted) {
        const target = state.view;
        const response = await save(target, signal);
        if (signal.aborted) return;
        if (!response?.ok || response.preferences?.rsvp_view !== target)
          throw new Error("preference_not_saved");
        persisted = target;
        if (state.view === target) onSaved(target);
      }
    } catch {
      if (signal.aborted) return;
      // A failed response may still have changed the server: retry must write again.
      persisted = null;
      publish({ error: true });
    } finally {
      if (!signal.aborted) publish({ saving: false });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activate() {
      active = true;
      if (controller.signal.aborted) {
        controller = new AbortController();
        state = { ...state, saving: false };
      }
      cache();
    },
    dispose() {
      active = false;
      controller.abort();
    },
    syncServer(value) {
      if (!isRsvpView(value) || state.saving || state.error) return;
      persisted = value;
      if (state.view !== value) publish({ view: value });
      cache();
    },
    setView(view) {
      if (!isRsvpView(view) || (view === state.view && !state.error)) return;
      publish({ view });
      cache();
      void flush();
    },
    retry: flush,
  };
}
