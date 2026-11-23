import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { command } from "./inspection-test-runtime.mjs";
import { ThingsBoardApi } from "../../thingsboard/lib/api.mjs";

export async function waitUntil(check, timeoutMs = 20000, label = "software evidence") {
  const end = performance.now() + timeoutMs;
  let last;
  while (performance.now() < end) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error.message; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}${last ? ": " + last : ""}`);
}

export async function jsonRequest(url, body, timeoutMs = 20000) {
  const response = await fetch(url, { ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs) });
  return { httpStatus: response.status, body: await response.json() };
}

export class SoftwareValidationClient {
  constructor({ accounts, auditConfig, auditToken }) {
    this.accounts = accounts; this.auditConfig = auditConfig; this.auditToken = auditToken;
    this.messages = [];
    this.api = new ThingsBoardApi(accounts.origin);
  }
  async connect() {
    await this.api.login(this.accounts.admin.username, this.accounts.admin.password);
    this.socket = new WebSocket("ws://127.0.0.1:8081/detections");
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.type === "detections") this.messages.push(message);
    });
    await new Promise((accept, reject) => {
      this.socket.addEventListener("open", accept, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }
  async latestTelemetry() {
    const raw = await this.api.request(`/api/plugins/telemetry/DEVICE/${this.accounts.deviceId}/values/timeseries`);
    return Object.fromEntries(Object.entries(raw).map(([key, points]) => [key, points[0]?.value]));
  }
  async telemetryFor(item) {
    return waitUntil(async () => {
      const values = await this.latestTelemetry();
      return values.controller_session === item.controller_session && values.item_id === item.item_id ? values : null;
    }, 20000, "ThingsBoard item event");
  }
  async rows(table, filters) {
    const response = await fetch(this.auditConfig.supabaseBaseUrl + "/rest/v1/" + table + "?" + new URLSearchParams({ select: "*", ...filters }), {
      headers: { apikey: this.auditToken, Authorization: "Bearer " + this.auditToken }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Audit ${table} read: HTTP ${response.status}`);
    return response.json();
  }
  async recordsFor(item) {
    const filters = { controller_session: "eq." + item.controller_session, item_id: "eq." + item.item_id };
    const inspection = await waitUntil(async () => (await this.rows("inspection_results", filters))[0], 20000, "Inspection Result");
    const action = await waitUntil(async () => (await this.rows("control_actions", { inspection_id: "eq." + inspection.id }))[0], 20000, "Control Action");
    const hud = await waitUntil(() => this.messages.find(message => message.frame?.sessionId === inspection.camera_session && message.frame?.sequence === inspection.frame_sequence),
      20000, "HUD detection payload");
    return { inspection, action, hud };
  }
  async executionFor(item, container = "cn360-software-n8n") {
    // Decode n8n's flatted execution data in its own container. Only selected
    // output JSON is returned: no workflow parameters or stored credentials.
    const script = `
const db=new(require('node:sqlite').DatabaseSync)('/home/node/.n8n/database.sqlite',{readOnly:true});
const rows=db.prepare("SELECT e.id,e.status,d.data FROM execution_entity e JOIN execution_data d ON d.executionId=e.id WHERE e.workflowId='rBfAR3HgczhHFlui' ORDER BY e.id DESC LIMIT 20").all();
function unpack(text){const p=JSON.parse(text);if(!Array.isArray(p))return p;const cache=new Map();function entry(i){if(cache.has(i))return cache.get(i);const v=p[i];if(!v||typeof v!=='object')return v;const out=Array.isArray(v)?[]:{};cache.set(i,out);for(const [k,x]of Object.entries(v))out[k]=typeof x==='string'&&/^\\d+$/.test(x)?entry(Number(x)):x;return out;}return entry(0);}
const target=${JSON.stringify(item)};
const results=rows.map(row=>{const root=unpack(row.data);const runs=root.resultData?.runData??{};const get=name=>runs[name]?.at(-1)?.data?.main?.[0]?.[0]?.json;const base=get('capture-esp32-response');return {id:row.id,status:row.status,item:base?.itemContext,frame:base?.frameContext,decision:base?.decision,control:base?.esp32,requestedAt:base?.requestedAt,controlCompletedAt:base?.controlCompletedAt,response:get('build-inspection-response')?.inspectionResponse,modelResponse:get('detect-defects'),modelMs:runs['detect-defects']?.at(-1)?.executionTime};}).filter(row=>row.item?.controller_session===target.controller_session&&row.item?.item_id===target.item_id);
console.log(JSON.stringify(results[0]??null));`;
    return waitUntil(async () => {
      const row = JSON.parse(await command("docker", ["exec", container, "node", "--disable-warning=ExperimentalWarning", "-e", script]));
      return row && ["success", "error", "canceled", "crashed"].includes(row.status) ? row : null;
    }, 20000, "matching n8n execution");
  }
  close() { this.socket?.close(); }
}

export function loadValidationConfiguration(root) {
  const accounts = JSON.parse(readFileSync(root + "/thingsboard/accounts.local.json", "utf8"));
  const auditConfig = JSON.parse(readFileSync(root + "/n8n/runtime.local.json", "utf8"));
  const settings = JSON.parse(readFileSync(root + "/n8n/software-bench.local.json", "utf8"));
  const keys = [...new Set(readFileSync(settings.keyFile, "utf8").match(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [])];
  if (keys.length !== 1) throw new Error("The audit key file must contain exactly one backend credential");
  return { accounts, auditConfig, auditToken: keys[0] };
}
