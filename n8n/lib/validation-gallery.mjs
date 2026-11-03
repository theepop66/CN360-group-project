const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function validationGallery({ summary, pictures, samples }) {
  const cards = pictures.map(picture => {
    const rows = samples.filter(row => row.caseId === picture.id);
    const first = rows[0];
    const correct = rows.length > 0 && rows.every(row => row.actual === row.expected);
    const boxes = (first?.detections ?? []).map(detection => {
      const [x1, y1, x2, y2] = detection.box;
      return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="none" stroke="#e24a3b" stroke-width="3"/>`;
    }).join("");
    return `<article><div class="card-title"><h2>${escapeHtml(picture.id)}</h2><span class="${correct ? "good" : "bad"}">${correct ? "Correct" : "Mismatch"}</span></div>
<p>${escapeHtml(picture.target)}</p><svg viewBox="0 0 ${picture.width} ${picture.height}" role="img" aria-label="Native prediction boxes for ${escapeHtml(picture.id)}"><image href="${picture.dataUri}" width="${picture.width}" height="${picture.height}"/>${boxes}</svg>
<dl><div><dt>Expected</dt><dd>${escapeHtml(first?.expected ?? "unverified")}</dd></div><div><dt>Actual</dt><dd>${escapeHtml(first?.actual ?? "unverified")}</dd></div><div><dt>Coverage</dt><dd>${Number.isFinite(first?.coverage) ? (first.coverage * 100).toFixed(3) + "%" : "Unavailable"}</dd></div></dl>
<small>Repeated outcomes: ${rows.map(row => escapeHtml(row.actual)).join(", ")}. Red boxes are actual native predictions.</small></article>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CN360 native model validation</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#f2f4f7;color:#192633;margin:0;padding:28px}main{max-width:1300px;margin:auto}h1{font-size:30px;margin-bottom:6px}h2{font-size:15px;overflow-wrap:anywhere}.muted,small{color:#526274}.banner{padding:16px;background:#ffe8e2;border-left:5px solid #ba382e;border-radius:6px}.metrics,.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:22px 0}.metric,article{background:white;border:1px solid #dfe5ec;border-radius:10px;padding:18px}.metric strong{display:block;font-size:32px}article svg{display:block;width:100%;max-height:300px;background:#e8edf2}.card-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.good,.bad{font-size:12px;white-space:nowrap;padding:5px 8px;border-radius:20px}.good{background:#dff2e7;color:#176441}.bad{background:#ffe1dc;color:#a83225}dl{display:flex;justify-content:space-between;gap:12px}dt{font-size:12px;color:#526274}dd{margin:0;font-weight:650}footer{padding:20px 0;color:#526274}@media(max-width:800px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:500px){body{padding:14px}.cards,.metrics{grid-template-columns:1fr}}</style>
<main><p class="muted">CN360 · REAL LOCATEANYTHING · SAVED-IMAGE VALIDATION</p><h1>Native model assessment</h1>
<p class="banner"><strong>${summary.readyForPhysicalIntegration ? "Sample-level gates passed" : "Not ready for physical integration"}.</strong> Quality: ${escapeHtml(summary.gates.quality)}. Production timing: ${escapeHtml(summary.gates.productionTiming)}. Cross-service consistency: ${escapeHtml(summary.gates.consistency)}.</p>
<div class="metrics"><div class="metric">Native diagnostic predictions<strong>${summary.quality.evaluated}/${summary.quality.attempts}</strong>15 image/target pairs, three repetitions each</div><div class="metric">False rejects<strong>${summary.quality.falseRejects}/${summary.quality.good}</strong>Good sample attempts incorrectly rejected</div><div class="metric">Missed defects<strong>${summary.quality.missedDefects}/${summary.quality.defective}</strong>Defective sample attempts incorrectly passed</div></div>
<p><strong>Measurement-only gallery.</strong> Predictions below used a 120-second diagnostic allowance. Production budgets remain 1100 ms inside the model service, 1200 ms for n8n's model call and a 3000 ms controller Verdict Window. The diagnostic allowance cannot approve production timing.</p>
<p class="muted">Coverage threshold: 0.5% of frame area. No confidence filtering. All valid boxes are shown. This curated sample set is not an independent held-out set and does not establish general production accuracy.</p>
<section class="cards">${cards}</section><footer>Images: MVTec AD, Bergmann et al., CVPR 2019 / IJCV 2021. Licensed CC BY-NC-SA 4.0. Model outputs and raw measurements accompany this report.</footer></main></html>`;
}
