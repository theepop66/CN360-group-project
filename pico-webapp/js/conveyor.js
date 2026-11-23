// Commands are serialized so an older held direction cannot overtake a stop.
export function createConveyorSender({ servoUrl, fetchImpl = fetch, onError = () => {}, now = () => performance.now() }) {
  const base = new URL(servoUrl, globalThis.location?.href);
  const endpoint = (name) => {
    const url = new URL(base);
    url.pathname = url.pathname.replace(/\/[^/]*\/?$/, `/${name}`);
    url.search = "";
    url.hash = "";
    return url.href;
  };
  let direction = null;
  let session = null;
  let sequence = 0;
  let lease = 0;
  let generation = 0;
  let inputAt = 0;
  let busy = false;
  let stopped = false;
  let needsNeutral = true;

  function expireStaleInput() {
    if (direction !== null && now() - inputAt >= 200) {
      direction = null;
      generation += 1;
      needsNeutral = true;
      session = null;
    }
  }

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 250);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function tick() {
    expireStaleInput();
    if (busy || stopped || direction === null) return;
    busy = true;
    const currentGeneration = generation;
    try {
      if (!session) {
        const status = await request(endpoint("conveyor/lease"));
        expireStaleInput();
        if (generation !== currentGeneration || stopped) return;
        if (typeof status.controller_session !== "string" || !Number.isInteger(status.conveyor_sequence) || !Number.isInteger(status.lease) || status.lease === 0) {
          throw new Error("Invalid conveyor status");
        }
        session = status.controller_session;
        sequence = status.conveyor_sequence;
        lease = status.lease;
      }
      if (stopped || direction === null) return;
      // If firmware needs a neutral handshake, send 0 regardless of current direction
      // so the user doesn't have to hold neutral while the lease request is in flight.
      const sentDirection = needsNeutral ? 0 : direction;
      const result = await request(endpoint("conveyor"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: sentDirection, controller_session: session, sequence: ++sequence, lease })
      });
      expireStaleInput();
      if (generation !== currentGeneration || stopped) return;
      if (result.controller_session !== session || result.conveyor_sequence !== sequence || !Number.isInteger(result.lease) || result.lease === 0 || result.lease === lease) {
        throw new Error("Conveyor session changed");
      }
      lease = result.lease;
      if (sentDirection === 0 && result.accepted === true) needsNeutral = false;
    } catch (error) {
      needsNeutral = true;
      session = null;
      onError(error);
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void tick(), 100);
  return {
    setDirection(value) {
      expireStaleInput();
      if (value === null && direction !== null) {
        generation += 1;
        needsNeutral = true;
        session = null;
      }
      direction = value;
      inputAt = now();
    },
    stop() { stopped = true; direction = null; clearInterval(timer); }
  };
}
