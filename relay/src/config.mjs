// Environment-driven settings for the detection relay. Every value has a
// default that works on a trusted prototype LAN; see relay/README.md.

const DEFAULTS = Object.freeze({
  // Empty = every interface, IPv4 and IPv6 (Node's default listen). A HUD
  // opened at an IPv6 address derives an IPv6 socket URL, which 0.0.0.0
  // would refuse.
  host: "",
  port: 8081,
  path: "/detections",
  // The HUD accepts single-frame image data URLs up to 8 MiB
  // (pico-webapp/js/camera-message.js), so the ingest limit leaves room for
  // one of those plus its JSON envelope.
  maxBodyBytes: 9 * 1024 * 1024,
  heartbeatIntervalMs: 10_000,
  // A HUD that stops draining its socket is dropped instead of letting the
  // relay buffer an unbounded backlog for it.
  maxClientBufferBytes: 4 * 1024 * 1024,
  ingestToken: "",
  allowedOrigins: []
});

function readInteger(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a whole number.`);
  }
  const value = Number(raw.trim());
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function readPath(env) {
  const raw = (env.RELAY_PATH ?? DEFAULTS.path).trim();
  if (!raw.startsWith("/") || /[?#\s]/.test(raw)) {
    throw new Error("RELAY_PATH must start with '/' and contain no query, fragment, or spaces.");
  }
  return raw;
}

// Browsers send a normalized Origin (lowercase host, no default port, no
// trailing slash), so configured entries are normalized the same way; a
// copied address-bar URL such as "http://HUD.local:8080/" still matches.
export function normalizeOrigin(value) {
  if (value === "null") return "null";
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function readOrigins(env) {
  const raw = env.RELAY_ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const origin = normalizeOrigin(entry);
      if (!origin) throw new Error(`RELAY_ALLOWED_ORIGINS has an invalid origin: ${entry}`);
      return origin;
    });
}

export function readConfig(env = process.env) {
  const host = (env.RELAY_HOST ?? DEFAULTS.host).trim();

  return Object.freeze({
    host,
    port: readInteger(env, "RELAY_PORT", DEFAULTS.port, { min: 0, max: 65_535 }),
    path: readPath(env),
    maxBodyBytes: readInteger(env, "RELAY_MAX_BODY_BYTES", DEFAULTS.maxBodyBytes, {
      min: 1024,
      max: 64 * 1024 * 1024
    }),
    heartbeatIntervalMs: readInteger(env, "RELAY_HEARTBEAT_MS", DEFAULTS.heartbeatIntervalMs, {
      min: 1000,
      max: 300_000
    }),
    maxClientBufferBytes: readInteger(
      env,
      "RELAY_MAX_CLIENT_BUFFER_BYTES",
      DEFAULTS.maxClientBufferBytes,
      { min: 64 * 1024, max: 256 * 1024 * 1024 }
    ),
    ingestToken: (env.RELAY_INGEST_TOKEN ?? DEFAULTS.ingestToken).trim(),
    allowedOrigins: Object.freeze(readOrigins(env))
  });
}

export { DEFAULTS };
