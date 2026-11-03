import { randomUUID } from "node:crypto";

export const summaryHtml = `<section class="cn360">
<header><div><small>CN360 · QUALITY MONITOR</small><h1>Inspection overview</h1></div><span data-ref="freshness" class="badge">Waiting for data</span></header>
<p data-ref="profile" class="muted">Waiting for inspection results</p>
<div class="metrics">
<article><small>Latest verdict</small><strong data-ref="verdict">—</strong><span data-ref="verdict_reason">—</span></article>
<article><small>Defect coverage</small><strong data-ref="defect_coverage_display">—</strong><span>Fraction of the captured frame</span></article>
<article><small>Processing time</small><strong data-ref="processing_ms">—</strong><span>Trigger to control response</span></article>
<article><small>Inspection failures</small><strong data-ref="failure_count">0</strong><span>Includes forced rejects and control errors</span></article>
<article><small>Inspections</small><strong data-ref="inspection_count">0</strong><span>Unique events in the local delivery journal</span></article>
<article><small>Pass verdicts</small><strong data-ref="pass_count">0</strong><span>AI inspection verdicts</span></article>
<article><small>Reject verdicts</small><strong data-ref="reject_count">0</strong><span>Includes failure fallback</span></article>
<article><small>Reject rate</small><strong data-ref="reject_rate_percent">—</strong><span>Reject verdicts / inspections</span></article>
</div>
<div class="details"><div><small>Inspection target</small><p data-ref="inspection_target">—</p></div><div><small>Latest failure</small><p data-ref="failure_reason">—</p></div><div><small>Controller response</small><p data-ref="control_outcome">—</p></div><div><small>Last inspection</small><p data-ref="inspection_at">—</p></div></div>
<p data-ref="validation" hidden></p>
<footer><span data-ref="health">Waiting for health checks</span><span data-ref="queue">—</span><span>Controller acceptance does not confirm physical sorting.</span></footer>
</section>`;

export const summaryCss = `.cn360{font-family:Roboto,Arial,sans-serif;background:#f7f8fa;color:#17212e;padding:22px;box-sizing:border-box;height:100%;overflow:auto}.cn360 header{display:flex;justify-content:space-between;align-items:center;gap:12px}.cn360 h1{font-size:26px;line-height:1.2;margin:6px 0}.cn360 small{font-size:12px;letter-spacing:.04em;color:#607080}.cn360 .muted{font-size:13px;color:#607080}.cn360 .badge{font-size:12px;padding:8px 12px;border-radius:20px;background:#e3e8ed;white-space:nowrap}.cn360 .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.cn360 article{background:white;border:1px solid #e2e7ed;border-radius:10px;padding:16px}.cn360 strong{display:block;font-size:29px;line-height:1.5;overflow-wrap:anywhere}.cn360 article span{font-size:11px;color:#6c7885}.cn360 .details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.cn360 .details p{font-size:14px;margin:5px 0;overflow-wrap:anywhere}.cn360 footer{display:flex;flex-wrap:wrap;gap:10px 24px;margin-top:20px;font-size:12px;color:#607080}@media(max-width:650px){.cn360 .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.cn360 header{flex-direction:column;align-items:flex-start;gap:8px}.cn360 h1{font-size:22px}}`;

// All telemetry is rendered as text; operator/model strings cannot become HTML.
export const summaryScript = `
self.onInit = function() {
  self.values = {};
  self.render = function() {
    var root = self.ctx.$container[0];
    var v = self.values;
    function put(key, text) { var el = root.querySelector('[data-ref="' + key + '"]'); if(el) el.textContent = text; }
    ['verdict','verdict_reason','defect_coverage_display','failure_count','inspection_count','pass_count','reject_count','inspection_target','failure_reason','control_outcome'].forEach(function(k){if(v[k] !== undefined) { var text = String(v[k]); if(['verdict','verdict_reason','failure_reason','control_outcome'].indexOf(k)>=0) text = text.replace(/_/g,' ').replace(/^./,function(c){return c.toUpperCase();}); put(k,text); }});
    if(v.processing_ms !== undefined) put('processing_ms', Number(v.processing_ms).toLocaleString() + ' ms');
    if(v.reject_rate_percent !== undefined) put('reject_rate_percent', Number(v.reject_rate_percent).toFixed(1) + '%');
    if(v.inspection_at) put('inspection_at', new Date(v.inspection_at).toLocaleString());
    var age = v.bridge_heartbeat ? Date.now() - Number(v.bridge_heartbeat) : Infinity;
    var fresh = age < 25000;
    put('freshness', fresh ? 'Monitoring connected' : 'STALE · monitoring disconnected');
    var badge = root.querySelector('[data-ref="freshness"]');
    if(badge) { badge.style.background = fresh ? '#dff2e8' : '#ffe6dd'; badge.style.color = fresh ? '#176441' : '#a33a21'; }
    var profile = v.profile || '';
    put('profile', profile.indexOf('controlled') >= 0 ? 'Software test · saved image · controlled model response · no physical hardware' + (profile.indexOf('offline') >= 0 ? ' · cloud audit disabled' : '') : profile.indexOf('native') >= 0 ? 'Software test · saved image · native LocateAnything · no physical hardware' : (profile || 'Waiting for inspection results'));
    var validation = root.querySelector('[data-ref="validation"]');
    if(validation && v.validation_status) {
      validation.hidden = false;
      validation.style.color = v.validation_status === 'passed' ? '#176441' : '#a83225';
      validation.textContent = 'Latest sample-set validation: ' + String(v.validation_status).toUpperCase() + ' · missed defects: ' + v.validation_missed_defects + ' · false rejects: ' + v.validation_false_rejects + ' · quality: ' + v.validation_quality_gate + ' · production timing: ' + v.validation_timing_gate + ' · consistency: ' + v.validation_consistency_gate;
    }
    var names = ['model','capture','relay','n8n'];
    var labels = {model:'Vision model',capture:'Image source',relay:'HUD connection',n8n:'Inspection workflow'};
    put('health', names.filter(function(k){return v[k+'_healthy']!==undefined;}).map(function(k){return labels[k] + ': ' + (fresh ? (v[k+'_healthy'] === true || v[k+'_healthy'] === 'true' ? 'healthy' : 'unavailable') : 'unknown');}).join(' · '));
    put('queue', v.pending_events !== undefined ? String(v.pending_events) + ' monitoring records waiting' : '');
    var verdict = root.querySelector('[data-ref="verdict"]');
    if(verdict) verdict.style.color = v.verdict === 'pass' ? '#176441' : '#b33332';
  };
  self.timer = setInterval(self.render, 1000);
  self.render();
};
self.onDataUpdated = function() {
  (self.ctx.data || []).forEach(function(series){if(series.data && series.data.length) self.values[series.dataKey.name] = series.data[series.data.length-1][1];});
  if(self.render) self.render();
};
self.onDestroy = function() { clearInterval(self.timer); };
`;

export const summaryKeys = ["verdict", "verdict_reason", "defect_coverage_display", "processing_ms", "failure_count", "inspection_count",
  "pass_count", "reject_count", "reject_rate_percent", "inspection_target", "failure_reason", "control_outcome", "inspection_at", "profile",
  "bridge_heartbeat", "pending_events", "model_healthy", "capture_healthy", "relay_healthy", "n8n_healthy", "validation_status",
  "validation_missed_defects", "validation_false_rejects", "validation_quality_gate", "validation_timing_gate", "validation_consistency_gate"];

export function summaryWidgetType() {
  return { fqn: "cn360_supervisor", name: "CN360 supervisor", deprecated: false,
    descriptor: { type: "latest", sizeX: 12, sizeY: 8, resources: [], templateHtml: summaryHtml, templateCss: summaryCss,
      controllerScript: summaryScript, settingsSchema: "{}", dataKeySettingsSchema: "{}",
      defaultConfig: JSON.stringify({ datasources: [], showTitle: false, padding: "0px", settings: {} }) } };
}

export function buildDashboard(deviceId, widgetTypeFqn, { chartDefault = {}, alarmsDefault = {} } = {}) {
  const alias = randomUUID();
  const source = keys => ({ type: "entity", entityAliasId: alias, dataKeys: keys.map((name, index) => ({ name, label: name.replaceAll("_", " "), type: "timeseries",
    color: ["#186f91", "#b33332"][index % 2], settings: {}, aggregationType: "NONE" })) });
  const widgets = {}; const layouts = {};
  function widget(fqn, type, title, config, row, col, sizeX, sizeY) {
    const id = randomUUID();
    widgets[id] = { id, typeFullFqn: fqn, type, sizeX, sizeY,
      config: { showTitle: true, title, backgroundColor: "#fff", color: "#17212e", padding: "8px", dropShadow: false, enableFullscreen: true,
        ...config } };
    layouts[id] = { row, col, sizeX, sizeY };
  }
  widget(widgetTypeFqn, "latest", "Inspection overview", { datasources: [source(summaryKeys)], showTitle: false, padding: "0px", settings: {} }, 0, 0, 24, 13);
  const chart = (key, title, units, row, col) => widget("system.time_series_chart", "timeseries", title,
    { ...structuredClone(chartDefault), title, datasources: [source([key])], units, decimals: 2, useDashboardTimewindow: true }, row, col, 12, 7);
  chart("defect_coverage_percent", "Defect coverage history", "%", 13, 0);
  chart("processing_ms", "Processing time history", "ms", 13, 12);
  widget("system.alarm_widgets.alarms_table", "alarm", "Operational alarms", { ...structuredClone(alarmsDefault), title: "Operational alarms",
    alarmSource: { type: "entity", entityAliasId: alias, dataKeys: [
      { name: "createdTime", type: "alarm", label: "Created", settings: {} }, { name: "type", type: "alarm", label: "Alarm", settings: {} },
      { name: "severity", type: "alarm", label: "Severity", settings: {} }, { name: "status", type: "alarm", label: "Status", settings: {} }
    ] }, settings: { ...alarmsDefault.settings, allowAcknowledgment: true, allowClear: false, allowAssign: false, displayDetails: true },
    alarmSearchStatus: "ANY", alarmsPollingInterval: 5 }, 20, 0, 24, 8);
  return { title: "CN360 · Inspection monitor", configuration: { description: "Local inspection monitoring. Software test data is labelled. No machine control widgets.",
    widgets, entityAliases: { [alias]: { id: alias, alias: "CN360 inspection station", filter: { type: "singleEntity", singleEntity: { entityType: "DEVICE", id: deviceId }, resolveMultiple: false } } },
    states: { default: { name: "Inspection monitor", root: true, layouts: { main: { widgets: layouts,
      gridSettings: { columns: 24, margin: 12, outerMargin: true, backgroundColor: "#edf1f5", autoFillHeight: false } } } } },
    timewindow: { displayValue: "Last hour", selectedTab: 0, realtime: { realtimeType: 0, timewindowMs: 3600000, interval: 1000 }, aggregation: { type: "NONE", limit: 1000 } },
    settings: { stateControllerId: "entity", showTitle: true, showDashboardsSelect: false, showDashboardTimewindow: true, showDashboardExport: false,
      toolbarAlwaysOpen: true }, filters: {} } };
}
