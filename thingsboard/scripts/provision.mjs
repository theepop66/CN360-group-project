import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { ThingsBoardApi, booleanAlarm } from "../lib/api.mjs";
import { buildDashboard, summaryWidgetType } from "../lib/dashboard.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const privatePath = join(here, "accounts.local.json");
const origin = process.env.CN360_TB_ORIGIN ?? "http://127.0.0.1:9090";
const api = new ThingsBoardApi(origin);
let accounts;
async function createUser(user, password, existing) {
  const saved = existing ?? await api.request("/api/user?sendActivationMail=false", { method: "POST", body: user });
  const link = await api.request(`/api/user/${saved.id.id}/activationLink`);
  const activateToken = new URL(link).searchParams.get("activateToken");
  if (!activateToken) throw new Error("Missing local account activation token");
  await api.request("/api/noauth/activate?sendActivationMail=false", { method: "POST", body: { activateToken, password }, auth: false });
  return saved;
}
if (existsSync(privatePath)) {
  accounts = JSON.parse(readFileSync(privatePath, "utf8"));
  await api.login(accounts.admin.username, accounts.admin.password);
} else {
  await api.login("sysadmin@thingsboard.org", "sysadmin");
  const tenant = (await api.request("/api/tenants?pageSize=100&page=0")).data.find(item => item.title === "CN360")
    ?? await api.request("/api/tenant", { method: "POST", body: { title: "CN360" } });
  accounts = { origin, tenantId: tenant.id.id,
    admin: { username: "admin@cn360.local", password: randomBytes(18).toString("base64url") },
    viewer: { username: "operator@cn360.local", password: randomBytes(18).toString("base64url") } };
  const admins = (await api.request(`/api/tenant/${tenant.id.id}/users?pageSize=100&page=0`)).data;
  await createUser({ email: accounts.admin.username, authority: "TENANT_ADMIN", tenantId: tenant.id, firstName: "CN360", lastName: "Administrator" }, accounts.admin.password,
    admins.find(item => item.email === accounts.admin.username));
  writeFileSync(privatePath, JSON.stringify(accounts, null, 2) + "\n");
  await api.login(accounts.admin.username, accounts.admin.password);
}
let customer = (await api.request("/api/customers?pageSize=100&page=0")).data.find(item => item.title === "CN360 operators");
customer ??= await api.request("/api/customer", { method: "POST", body: { title: "CN360 operators" } });
const users = await api.request(`/api/customer/${customer.id.id}/users?pageSize=100&page=0`);
if (!users.data.some(user => user.email === accounts.viewer.username)) {
  await createUser({ email: accounts.viewer.username, authority: "CUSTOMER_USER", customerId: customer.id,
    tenantId: { entityType: "TENANT", id: accounts.tenantId }, firstName: "CN360", lastName: "Operator" }, accounts.viewer.password);
}
let profile = (await api.request("/api/deviceProfiles?pageSize=100&page=0")).data.find(item => item.name === "CN360 monitoring");
if (!profile) {
  const defaults = (await api.request("/api/deviceProfiles?pageSize=100&page=0")).data.find(item => item.default);
  const base = await api.request(`/api/deviceProfile/${defaults.id.id}`);
  profile = await api.request("/api/deviceProfile", { method: "POST", body: { name: "CN360 monitoring", type: "DEFAULT", transportType: "DEFAULT",
    defaultRuleChainId: base.defaultRuleChainId, profileData: { configuration: { type: "DEFAULT" }, transportConfiguration: { type: "DEFAULT" } } } });
}
let device = (await api.request("/api/tenant/devices?pageSize=100&page=0&textSearch=CN360")).data.find(item => item.name === "CN360 inspection station");
device ??= await api.request("/api/device", { method: "POST", body: { name: "CN360 inspection station", type: "CN360 monitoring", deviceProfileId: profile.id } });
await api.request(`/api/customer/${customer.id.id}/device/${device.id.id}`, { method: "POST" });
const existingRules = (await api.request(`/api/alarm/rules/DEVICE/${device.id.id}?pageSize=100&page=0`)).data;
for (const definition of [booleanAlarm(device.id, "Inspection failure", "inspection_failed"), booleanAlarm(device.id, "Service unavailable", "system_healthy", false)]) {
  const existingRule = existingRules.find(rule => rule.name === definition.name);
  if (existingRule) definition.id = existingRule.id;
  await api.request("/api/alarm/rule", { method: "POST", body: definition });
}
const credentials = await api.request(`/api/device/${device.id.id}/credentials`);
const oldWidget = await api.request("/api/widgetType?fqn=tenant.cn360_supervisor").catch(error => {
  if (error.message.includes("HTTP 404")) return null;
  throw error;
});
const widgetBody = summaryWidgetType();
if (oldWidget) widgetBody.id = oldWidget.id;
let widget = await api.request("/api/widgetType", { method: "POST", body: widgetBody });
const chartType = await api.request("/api/widgetType?fqn=system.time_series_chart");
const alarmType = await api.request("/api/widgetType?fqn=system.alarm_widgets.alarms_table");
const dashboard = buildDashboard(device.id.id, "tenant." + widget.fqn, {
  chartDefault: JSON.parse(chartType.descriptor.defaultConfig), alarmsDefault: JSON.parse(alarmType.descriptor.defaultConfig)
});
const dashboards = (await api.request("/api/tenant/dashboards?pageSize=100&page=0")).data;
const existing = dashboards.find(item => item.title === dashboard.title);
if (existing) dashboard.id = existing.id;
const savedDashboard = await api.request("/api/dashboard", { method: "POST", body: dashboard });
await api.request(`/api/customer/${customer.id.id}/dashboard/${savedDashboard.id.id}`, { method: "POST" });
accounts.dashboardUrl = origin + "/dashboard/" + savedDashboard.id.id;
accounts.deviceId = device.id.id; accounts.dashboardId = savedDashboard.id.id;
writeFileSync(privatePath, JSON.stringify(accounts, null, 2) + "\n");
const runtimePath = join(here, "runtime.local.json");
const previous = existsSync(runtimePath) ? JSON.parse(readFileSync(runtimePath, "utf8")) : {};
const runtime = { port: 8106, host: "0.0.0.0", database: ".runtime/events.sqlite",
  probes: { model: "http://127.0.0.1:8105/health", capture: "http://127.0.0.1:8104/health", relay: "http://127.0.0.1:8081/health", n8n: "http://127.0.0.1:5680/healthz/readiness" },
  ...previous, origin, deviceToken: credentials.credentialsId };
writeFileSync(runtimePath, JSON.stringify(runtime, null, 2) + "\n");
mkdirSync(join(here, ".runtime"), { recursive: true });
writeFileSync(join(here, ".runtime/dashboard.json"), JSON.stringify(savedDashboard, null, 2) + "\n");
console.log("Provisioned CN360 dashboard: " + accounts.dashboardUrl);
console.log("Operator and administrator login details: thingsboard/accounts.local.json (ignored by Git).");
