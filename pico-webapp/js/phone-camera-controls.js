// This client sends source-camera commands; it never changes image geometry.
export function createPhoneCameraControls({ isActive, getCode, onState, fetchImpl = fetch }) {
  let state = { available: false, supported: false, status: "offline" };
  let stopped = false;
  let refreshing = false;
  let busy = false;
  let version = 0;
  const requests = new Set();
  const emit = () => { if (!stopped) onState({ ...state, active: isActive(), authorized: Boolean(getCode().trim()), busy }); };
  async function api(options = {}) {
    const controller = new AbortController();
    requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetchImpl("/phone-camera/zoom", { ...options, signal: controller.signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "phone_camera_control_failed");
      return result;
    } finally { clearTimeout(timer); requests.delete(controller); }
  }
  async function refresh() {
    if (stopped || refreshing || busy) return;
    if (!isActive()) { state = { available: false, supported: false, status: "inactive" }; emit(); return; }
    refreshing = true;
    const before = version;
    try {
      const result = await api();
      if (!stopped && before === version) { state = result; emit(); }
    } catch {
      if (!stopped && before === version) { state = { available: false, supported: false, status: "offline" }; emit(); }
    } finally { refreshing = false; }
  }
  return {
    refresh,
    async send(action) {
      if (stopped || busy || !isActive() || !getCode().trim() || !state.available || !state.supported || state.status === "pending") { emit(); return false; }
      busy = true; version++; emit();
      try {
        const result = await api({ method: "POST", headers: { Authorization: `Bearer ${getCode().trim()}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, sessionId: state.sessionId }) });
        if (!stopped) state = result;
        return true;
      } catch (error) {
        if (!stopped) state = { ...state, error: error.message };
        return false;
      } finally { busy = false; emit(); }
    },
    render: emit,
    stop() { stopped = true; version++; for (const request of requests) request.abort(); }
  };
}
