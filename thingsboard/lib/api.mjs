export class ThingsBoardApi {
  constructor(origin) { this.origin = origin; }
  async request(path, { method = "GET", body, auth = true } = {}) {
    const response = await fetch(new URL(path, this.origin), { method,
      headers: { "content-type": "application/json", ...(auth && this.token ? { "X-Authorization": "Bearer " + this.token } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`ThingsBoard ${method} ${path.split("?")[0]}: HTTP ${response.status}: ${text.slice(0, 400)}`);
    if (!text) return null;
    return response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text;
  }
  async login(username, password) {
    const result = await this.request("/api/auth/login", { method: "POST", body: { username, password }, auth: false });
    this.token = result.token;
    return this;
  }
}

export function booleanAlarm(entityId, name, key, unhealthyValue = true) {
  const rule = value => ({ condition: { type: "SIMPLE", expression: { type: "TBEL", expression: `return value == ${value};` } } });
  return { entityId, name, configurationVersion: 0, configuration: { type: "ALARM",
    arguments: { value: { refEntityKey: { type: "TS_LATEST", key } } },
    createRules: { MAJOR: rule(unhealthyValue) }, clearRule: rule(!unhealthyValue),
    propagate: false, propagateToOwner: true, propagateToTenant: true } };
}
