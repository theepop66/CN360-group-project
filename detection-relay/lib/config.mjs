// Reads the relay settings from the environment. Every value has a default
// that works on the machine that also runs n8n, so a bare `npm start` is a
// usable relay with the ingest token switched off.

const DEFAULTS = Object.freeze({
  host: "0.0.0.0",
  port: 8081,
  path: "/detections",
  ingestToken: "",
  heartbeatMs: 15000
});

const MIN_HEARTBEAT_MS = 1000;

export function readConfig(env = process.env) {
  return {
    host: readHost(env.RELAY_BIND),
    port: readPort(env.RELAY_PORT),
    path: readPath(env.RELAY_PATH),
    ingestToken: readToken(env.RELAY_INGEST_TOKEN),
    heartbeatMs: readHeartbeat(env.RELAY_HEARTBEAT_MS)
  };
}

function present(value) {
  return typeof value === "string" && value.trim() !== "";
}

function readHost(value) {
  return present(value) ? value.trim() : DEFAULTS.host;
}

function readPort(value) {
  if (!present(value)) return DEFAULTS.port;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`RELAY_PORT must be an integer from 1 to 65535, got "${value}".`);
  }
  return port;
}

function readPath(value) {
  if (!present(value)) return DEFAULTS.path;
  const path = value.trim();
  if (!path.startsWith("/") || /[\s?#]/.test(path)) {
    throw new Error(`RELAY_PATH must start with "/" and contain no spaces, "?" or "#", got "${value}".`);
  }
  return path;
}

function readToken(value) {
  // Empty means the token check is off. That is the default for a relay that
  // only n8n on the same machine posts to.
  if (value === undefined || value === "") return DEFAULTS.ingestToken;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("RELAY_INGEST_TOKEN must not contain whitespace or control characters.");
  }
  return value;
}

function readHeartbeat(value) {
  if (!present(value)) return DEFAULTS.heartbeatMs;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < MIN_HEARTBEAT_MS) {
    throw new Error(`RELAY_HEARTBEAT_MS must be an integer of at least ${MIN_HEARTBEAT_MS}, got "${value}".`);
  }
  return ms;
}
