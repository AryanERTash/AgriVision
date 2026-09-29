const page = document.getElementById("pageContent");
const sidebar = document.getElementById("sidebar");
const crumbCurrent = document.getElementById("crumbCurrent");
const toast = document.getElementById("toast");
let selectedFiles = [];
let toastTimer;

const icons = {
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14.5v3.75A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V14.5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4c-7.2 0-13.8 2.1-15.5 7.1C3.1 15.2 7 19 11 18.4 17.3 17.6 20 11.8 20 4Z"/><path d="M5 19c2.5-4 6.1-6.6 10.5-8.8"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.2-6.3 9.2-6.3 9.2 6.3 9.2 6.3-3.2 6.3-9.2 6.3S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.4 4.2L19.5 6.8"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 16.5v2A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-2"/></svg>',
  print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V4h10v4M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17"/><path d="M7 14h10v6H7z"/><path d="M17 11.5h.01"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M8 3.5v4m8-4v4M4 9.5h16"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10.2c0 5.1-7 10.3-7 10.3S5 15.3 5 10.2a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.1"/></svg>',
  factory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V9l6 3V9l6 3V5h4v15H4Z"/><path d="M7.5 16h2m3 0h2m3 0h1"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.6 6.2L20 11l-6.4 1.8L12 19l-1.6-6.2L4 11l6.4-1.8L12 3Z"/><path d="m19 15 .8 2.1L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.9L19 15Z"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>',
  cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c-4 0-6.5 3-6.5 6.5 0 2.4 1.2 4.1 2.8 5.4.8.7 1.2 1.4 1.3 2.1h4.8c.1-.7.5-1.4 1.3-2.1 1.6-1.3 2.8-3 2.8-5.4 0-3.5-2.5-6.5-6.5-6.5Z"/><path d="M9.7 20h4.6m-4.1-3h3.6"/></svg>',
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function formatDate(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en-IN", options).format(date);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(date);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof body === "object" ? body.detail : body;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return body;
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function updateNavigation(route) {
  const labels = { overview: "Overview", inspect: "New inspection", reports: "Inspection reports", guide: "Grading guide", report: "Inspection report" };
  crumbCurrent.textContent = labels[route] || labels.overview;
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.dataset.route === route || (route === "report" && link.dataset.route === "reports");
    link.classList.toggle("active", active);
  });
  sidebar.classList.remove("open");
}

function currentPath() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length) return { route: "overview" };
  return { route: parts[0], id: parts[1] };
}

async function renderRoute() {
  const { route, id } = currentPath();
  updateNavigation(route);
  if (route === "inspect") return renderInspect();
  if (route === "reports") return renderReports();
  if (route === "guide") return renderGuide();
  if (route === "report" && id) return renderReportById(id);
  return renderOverview();
}

function go(route) {
  if (location.hash === `#${route}`) renderRoute();
  else location.hash = route;
}

function onionIllustration() {
  return `<img class="onion-banner" src="/static/assets/onion-image.png" alt="Onions arranged for quality inspection" />
    <div class="art-stats">${icons.spark}<span><strong>Every bulb, accounted for</strong>Clear notes. Consistent review.</span></div>`;
}

function statCard(label, value, foot, icon, color = "") {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`;
}

function recentRows(items) {
  if (!items.length) return `<div class="empty-state"><div class="empty-icon">${icons.bulb}</div><strong>Your first inspection starts here</strong><p>Save an image check and its digital report will show up here.</p><button class="button button-secondary" data-go="inspect">Create inspection ${icons.arrow}</button></div>`;
  return `<div class="recent-list">${items.map((item) => `<button class="recent-row" data-open-report="${escapeHtml(item.id)}">
    <span class="recent-thumb">${icons.bulb}</span>
    <span class="recent-main"><strong>${escapeHtml(item.batch_name)}</strong><span>${escapeHtml(item.center || "Local inspection")} · ${formatDate(item.created_at, { day: "numeric", month: "short" })} ${formatTime(item.created_at)}</span></span>
    <span class="recent-result"><strong>${item.grade_a_pct}% A</strong><span class="hide-mobile">${item.total} bulbs</span><span class="mini-arrow">›</span></span>
  </button>`).join("")}</div>`;
}

function chartMarkup(data) {
  if (!data.samples) return `<div class="chart-empty"><strong>No quality trend yet</strong>Complete an inspection to start a local history.</div>`;
  const y = Math.max(7, Math.min(80, 80 - (data.grade_a_pct / 100) * 72));
  const d = `M0 77 C24 73 30 ${y + 12} 55 ${y + 7} S90 ${y + 15} 112 ${y - 3} S153 ${y + 1} 171 ${y - 11} S209 ${y - 7} 230 ${y - 17} S270 ${y - 12} 300 ${y - 24}`;
  return `<div class="quality-chart-meta"><strong>${data.grade_a_pct}%</strong><span>Grade A average across ${data.samples} inspected bulbs</span></div>
    <svg class="quality-chart" viewBox="0 0 300 100" preserveAspectRatio="none" aria-label="Quality trend">
      <defs><linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#a7c879" stop-opacity=".26"/><stop offset="1" stop-color="#a7c879" stop-opacity="0"/></linearGradient></defs>
      <path class="chart-grid" d="M0 20H300M0 50H300M0 80H300"/><path class="chart-fill" d="${d} L300 100 L0 100Z"/><path class="chart-line" d="${d}"/>
      <circle cx="300" cy="${y - 24}" r="3.5" fill="#fff" stroke="#578663" stroke-width="2"/>
    </svg><div class="chart-legend"><span>First inspection</span><span>Latest inspection</span></div>`;
}

async function renderOverview() {
  page.innerHTML = `<section class="welcome-card"><div class="welcome-copy"><span class="eyebrow"><i class="eyebrow-dot"></i> Onion quality intelligence</span><h1>Quality, made visible.</h1><p>Bring consistency to procurement with clear image evidence, per-onion grading and a report you can share.</p><div class="welcome-actions"><button class="button button-lime" data-go="inspect">Start an inspection ${icons.arrow}</button><span class="welcome-hint">Single bulb or full batch</span></div></div><div class="welcome-art">${onionIllustration()}</div></section>
  <div class="stats-grid" id="overviewStats">${[0, 1, 2, 3].map(() => '<div class="stat-card"><div class="skeleton" style="width:76px"></div><div class="skeleton" style="width:60px;height:23px;margin-top:16px"></div></div>').join("")}</div>
  <section class="dashboard-grid"><article class="panel quality-panel"><div class="panel-header"><div><h2>Grade A overview</h2><p>Based on saved visual inspections</p></div><span class="stat-icon">${icons.leaf}</span></div><div class="quality-chart-wrap" id="qualityChart"></div></article><article class="panel"><div class="panel-header"><div><h2>Recent inspections</h2><p>Your latest quality reports</p></div><button class="text-button" data-go="reports">All reports ${icons.arrow}</button></div><div id="recentInspections"></div></article></section>
  <div class="section-title"><div><h2>A clearer inspection, in three steps</h2><p>From a quick capture to a record your team can return to.</p></div></div>
  <section class="process-steps"><article class="process-step"><span class="step-number">01</span><div><strong>Capture the sample</strong><span>Upload a tray photo or individual onion images from a phone or computer.</span></div></article><article class="process-step"><span class="step-number">02</span><div><strong>Review visual evidence</strong><span>Local object detection marks each bulb and highlights visible surface cues.</span></div></article><article class="process-step"><span class="step-number">03</span><div><strong>Share the report</strong><span>Save a batch summary, export the item list or print a PDF copy.</span></div></article></section>`;
  try {
    const [data, health] = await Promise.all([api("/api/summary"), api("/api/health")]);
    const average = data.grade_a_pct ? `${data.grade_a_pct}%` : "—";
    document.getElementById("overviewStats").innerHTML = [
      statCard("Inspections saved", data.inspections, "All-time in this workspace", icons.factory),
      statCard("Bulbs reviewed", data.samples, "Across saved reports", icons.bulb, "blue"),
      statCard("Grade A share", average, data.samples ? `${data.grade_a_count} bulbs met the visual screen` : "Appears after your first inspection", icons.check),
      statCard("Needs a second look", data.review_count, data.review_count ? "Low confidence or unclear evidence" : "Low confidence samples are flagged", icons.eye, "orange"),
    ].join("");
    document.getElementById("qualityChart").innerHTML = chartMarkup(data);
    document.getElementById("recentInspections").innerHTML = recentRows(data.recent || []);
    const modelPill = document.getElementById("modelStatusLabel");
    if (modelPill) {
      modelPill.textContent = health.model === "trained detector ready" ? "Vision model ready" : "CV fallback active";
      modelPill.title = `${health.model} · ${health.model_version}`;
    }
  } catch (error) {
    showToast(`Could not load workspace: ${error.message}`, true);
    document.getElementById("overviewStats").innerHTML = statCard("Inspections saved", "—", "Could not reach the local API", icons.factory);
  }
}

function renderFiles() {
  const list = document.getElementById("fileList");
  if (!list) return;
  if (!selectedFiles.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = selectedFiles.map((file, index) => {
    const thumb = URL.createObjectURL(file);
    return `<div class="file-row"><span class="file-preview"><img src="${thumb}" alt="" /></span><span class="file-info"><strong>${escapeHtml(file.name)}</strong><span>${(file.size / (1024 * 1024)).toFixed(1)} MB · Image ready</span></span><button type="button" class="remove-file" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">${icons.cross}</button></div>`;
  }).join("");
}

function renderInspect() {
  page.innerHTML = `<div class="page-heading"><div><span class="eyebrow"><i class="eyebrow-dot"></i> New inspection</span><h1>Check onion quality</h1><p>Add a clear photo, run the local vision model and save a report for one onion or an entire batch.</p></div></div>
    <div class="inspect-layout"><form class="panel form-panel" id="inspectionForm"><h2>Inspection details</h2><p class="form-intro">Add a few details so the report is easier to trace later.</p>
      <div class="form-fields"><div class="field"><label for="batchName">Batch name <span aria-hidden="true">*</span></label><input id="batchName" name="batch_name" maxlength="100" placeholder="e.g. Nashik lot · 24 Sep" required /></div><div class="field"><label for="center">Procurement center</label><input id="center" name="center" maxlength="100" placeholder="e.g. Lasalgaon APMC" /></div><div class="field full"><label for="supplier">Supplier or farmer</label><input id="supplier" name="supplier" maxlength="100" placeholder="Optional traceability detail" /></div></div>
      <label class="upload-zone" id="uploadZone" for="photoFiles"><input id="photoFiles" type="file" name="files" accept="image/jpeg,image/png,image/webp" multiple /><span class="upload-icon">${icons.upload}</span><strong>Drop photos here, or <span>browse files</span></strong><p>Upload one photo with a full tray, or up to 12 individual bulb photos.</p><span class="upload-specs">JPG, PNG or WebP <b></b> Up to 15 MB per photo <b></b> Max 12</span></label>
      <div class="sample-download"><span class="sample-label">Try a sample inspection</span><div><button class="text-button" id="useSampleImage" type="button">${icons.upload} Add sample.jpeg</button><a class="text-button" href="/static/assets/sample.jpeg" download="sample.jpeg">${icons.download} Download sample.jpeg</a></div><small>Photo: <a href="https://doi.org/10.6084/m9.figshare.30596084.v4" target="_blank" rel="noreferrer">VegQual dataset</a> · CC BY 4.0</small></div>
      <div class="file-list" id="fileList"></div>
      <div class="form-actions"><span id="uploadCount">No photos selected</span><button class="button button-primary" id="analyzeButton" type="submit">Analyze quality ${icons.arrow}</button></div></form>
      <aside class="panel tips-panel"><h3>Capture for a clearer read</h3><p>Soft daylight and a simple background help the model separate the onion from its surroundings.</p>
        <div class="capture-tip"><span class="capture-tip-icon">${icons.eye}</span><div><strong>Keep the bulb in focus</strong><span>Show the full onion, including the neck, and avoid motion blur.</span></div></div>
        <div class="capture-tip"><span class="capture-tip-icon">${icons.bulb}</span><div><strong>Leave space between bulbs</strong><span>For tray photos, arrange onions so their edges do not overlap.</span></div></div>
        <div class="capture-tip"><span class="capture-tip-icon">${icons.spark}</span><div><strong>Use a shared scale</strong><span>Relative size flags work only when multiple bulbs appear in the same photo.</span></div></div>
        <div class="model-note">${icons.info}<span><strong>Prototype assessment.</strong> Results are visual estimates. Hidden/internal defects and calibrated market sizes cannot be measured from a single photo.</span></div>
      </aside></div>`;
  const input = document.getElementById("photoFiles");
  input.addEventListener("change", () => addFiles(input.files));
  const zone = document.getElementById("uploadZone");
  ["dragenter", "dragover"].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault(); zone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault(); zone.classList.remove("dragging");
  }));
  zone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
  document.getElementById("useSampleImage").addEventListener("click", async () => {
    try {
      const response = await fetch("/static/assets/sample.jpeg");
      if (!response.ok) throw new Error("Sample photo could not be loaded");
      const sample = new File([await response.blob()], "sample.jpeg", { type: "image/jpeg" });
      addFiles([sample]);
      const batchName = document.getElementById("batchName");
      if (batchName && !batchName.value) batchName.value = "VegQual sample";
    } catch (error) {
      showToast(error.message, true);
    }
  });
  renderFiles();
  syncUploadCount();
}

function addFiles(fileList) {
  const candidates = Array.from(fileList || []);
  let rejected = 0;
  let overflow = 0;
  for (const file of candidates) {
    if (!file.type.startsWith("image/") || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) {
      rejected++;
      continue;
    }
    if (selectedFiles.some((item) => item.name === file.name && item.size === file.size)) continue;
    if (selectedFiles.length < 12) selectedFiles.push(file);
    else overflow++;
  }
  if (rejected) showToast("Use a JPG, PNG or WebP photo under 15 MB.", true);
  if (overflow || candidates.length > 12) showToast("An inspection can include up to 12 photos.", true);
  renderFiles();
  syncUploadCount();
}

function syncUploadCount() {
  const count = document.getElementById("uploadCount");
  if (count) count.textContent = selectedFiles.length ? `${selectedFiles.length} photo${selectedFiles.length === 1 ? "" : "s"} ready` : "No photos selected";
}

async function submitInspection(event) {
  event.preventDefault();
  if (!selectedFiles.length) return showToast("Add at least one onion photo first.", true);
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return showToast("Inspection form is unavailable. Please reopen it.", true);
  const button = document.getElementById("analyzeButton");
  const formData = new FormData(form);
  formData.delete("files");
  selectedFiles.forEach((file) => formData.append("files", file));
  button.disabled = true;
  button.innerHTML = `Reading image${icons.spark}<span class="loading-dots"><i></i><i></i><i></i></span>`;
  try {
    const record = await api("/api/analyze", { method: "POST", body: formData });
    selectedFiles = [];
    location.hash = `report/${record.id}`;
    showToast(`Report ready · ${record.total} onion${record.total === 1 ? "" : "s"} reviewed`);
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
    button.innerHTML = `Analyze quality ${icons.arrow}`;
  }
}

async function renderReports() {
  page.innerHTML = `<div class="page-heading"><div><span class="eyebrow"><i class="eyebrow-dot"></i> Saved records</span><h1>Inspection reports</h1><p>A searchable history of onion samples, quality grades and review notes.</p></div><div class="heading-actions"><button class="button button-primary" data-go="inspect">${icons.upload} New inspection</button></div></div><section class="panel"><div class="reports-toolbar"><label class="search-input">${icons.search}<input id="reportSearch" type="search" placeholder="Search batch, center or supplier" aria-label="Search reports" /></label><span class="result-count" id="reportCount">Loading reports…</span></div><div id="reportsTable"></div></section>`;
  try {
    const records = await api("/api/batches");
    const table = document.getElementById("reportsTable");
    const count = document.getElementById("reportCount");
    const search = document.getElementById("reportSearch");
    const draw = () => {
      const query = search.value.trim().toLowerCase();
      const filtered = records.filter((record) => `${record.batch_name} ${record.center} ${record.supplier}`.toLowerCase().includes(query));
      count.textContent = `${filtered.length} report${filtered.length === 1 ? "" : "s"}`;
      if (!filtered.length) {
        table.innerHTML = `<div class="empty-state"><div class="empty-icon">${icons.bulb}</div><strong>${records.length ? "No matching reports" : "No reports saved yet"}</strong><p>${records.length ? "Try another search term." : "Create an inspection to save your first report."}</p>${records.length ? "" : '<button class="button button-secondary" data-go="inspect">Start inspection ' + icons.arrow + "</button>"}</div>`;
        return;
      }
      table.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Batch / sample</th><th>Inspection date</th><th>Procurement center</th><th>Reviewed</th><th>Grade A share</th><th>Action</th></tr></thead><tbody>${filtered.map((record) => `<tr data-open-report="${escapeHtml(record.id)}" tabindex="0" role="link"><td class="table-title">${escapeHtml(record.batch_name)}<span class="table-sub">${escapeHtml(record.supplier || "Supplier not added")}</span></td><td>${formatDate(record.created_at)}<span class="table-sub">${formatTime(record.created_at)}</span></td><td>${escapeHtml(record.center || "—")}</td><td>${record.total} bulbs<span class="table-sub">${record.review_count ? `${record.review_count} need review` : "Review complete"}</span></td><td><span class="badge ${record.grade_a_pct >= 70 ? "badge-grade" : "badge-urs"}">${record.grade_a_pct}% Grade A</span></td><td><button class="table-action" data-open-report="${escapeHtml(record.id)}" aria-label="Open report">${icons.arrow}</button></td></tr>`).join("")}</tbody></table></div>`;
    };
    search.addEventListener("input", draw);
    draw();
  } catch (error) {
    document.getElementById("reportsTable").innerHTML = `<div class="empty-state"><strong>Could not load saved reports</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function badge(grade) {
  if (grade === "Grade A") return '<span class="badge badge-grade">Grade A</span>';
  if (grade === "URS") return '<span class="badge badge-urs">URS</span>';
  return '<span class="badge badge-review">Review</span>';
}

function flagBreakdown(samples) {
  const groups = [
    { key: "Visible defect", title: "Visible defect", color: "orange" },
    { key: "Possible sprout", title: "Possible sprouting", color: "orange" },
    { key: "Dark surface patches", title: "Dark surface patches", color: "orange" },
    { key: "Undersized", title: "Small relative to frame", color: "orange" },
    { key: "Manual review", title: "Manual review", color: "" },
  ];
  return groups.map((group) => {
    const n = samples.filter((sample) => sample.flags.some((flag) => flag.includes(group.key))).length;
    if (!n) return "";
    const width = Math.round(n / Math.max(1, samples.length) * 100);
    return `<div class="breakdown-item"><i class="breakdown-dot ${group.color}"></i><span>${group.title}</span><strong>${n}</strong><div class="breakdown-bar ${group.color}"><i style="width:${width}%"></i></div></div>`;
  }).join("") || '<div class="side-sub">No visible issue cues were recorded.</div>';
}

function sampleCard(sample) {
  const chips = sample.flags.length ? sample.flags.map((flag) => `<span class="flag-chip ${flag === "Manual review" ? "neutral" : ""}">${escapeHtml(flag)}</span>`).join("") : '<span class="flag-chip neutral">No visible flags</span>';
  const photoLabel = `Photo ${sample.source_photo} · bulb ${sample.object_number}`;
  return `<article class="sample-card"><div class="sample-image-wrap"><img src="${escapeHtml(sample.crop_url)}" alt="Cropped onion sample ${sample.number}" loading="lazy"/><span class="confidence-pill">${sample.confidence}% model confidence</span>${badge(sample.grade)}</div><div class="sample-info"><div class="sample-info-head"><strong title="${escapeHtml(sample.original_name)}">#${sample.number} · ${escapeHtml(sample.original_name)}</strong></div><p>${escapeHtml(photoLabel)} · ${escapeHtml(sample.size_status)}</p><div class="flag-list">${chips}</div><div class="sample-review"><select aria-label="Correct grade for sample ${sample.number}" data-review-grade="${escapeHtml(sample.id)}"><option value="Grade A" ${sample.grade === "Grade A" ? "selected" : ""}>Grade A</option><option value="URS" ${sample.grade === "URS" ? "selected" : ""}>URS</option></select><button data-save-review="${escapeHtml(sample.id)}">${sample.human_grade ? "Update review" : "Correct grade"}</button></div>${sample.human_grade ? `<div class="human-review-note">Reviewed by operator${sample.review_note ? ` · ${escapeHtml(sample.review_note)}` : ""}</div>` : ""}</div></article>`;
}

async function renderReportById(id) {
  page.innerHTML = '<div class="panel empty-state"><div class="empty-icon">' + icons.spark + '</div><strong>Preparing inspection report</strong><p>Loading the saved sample details.</p></div>';
  try {
    const record = await api(`/api/batches/${encodeURIComponent(id)}`);
    renderReport(record);
  } catch (error) {
    page.innerHTML = `<div class="panel empty-state"><div class="empty-icon">${icons.info}</div><strong>Report unavailable</strong><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-go="reports">Back to reports</button></div>`;
  }
}

function renderReport(record) {
  const percent = record.grade_a_pct || 0;
  const issueCount = record.samples.filter((sample) => sample.flags.some((flag) => flag !== "Manual review")).length;
  const modeDescription = record.total === 1 ? "Single onion sample" : `${record.total} onion samples`;
  const overlayGroups = [...new Map(record.samples.map((sample) => [sample.annotated_url, sample])).values()];
  const overlays = overlayGroups.map((sample) => `<a class="overlay-thumb" href="${escapeHtml(sample.annotated_url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(sample.annotated_url)}" alt="Detection boxes for ${escapeHtml(sample.original_name)}" loading="lazy"/><span>${escapeHtml(sample.original_name)} <i>↗</i></span></a>`).join("");
  page.innerHTML = `<div class="report-top"><div><button class="report-back" data-go="reports">${icons.arrow} All reports</button><div class="report-title-row"><h1>${escapeHtml(record.batch_name)}</h1>${record.review_count ? '<span class="badge badge-review">Review suggested</span>' : '<span class="badge badge-grade">Report ready</span>'}</div><div class="report-meta"><span>${icons.calendar}${formatDate(record.created_at)} · ${formatTime(record.created_at)}</span><span>${icons.pin}${escapeHtml(record.center || "Procurement center not added")}</span><span>${icons.factory}${escapeHtml(record.supplier || "Supplier not added")}</span><span>${icons.bulb}${modeDescription}</span></div></div><div class="report-actions"><a class="button button-secondary" href="/api/batches/${encodeURIComponent(record.id)}/report.csv">${icons.download} Export CSV</a><button class="button button-primary" id="printReport">${icons.print} Print / PDF</button></div></div>
  <div class="model-banner"><span><strong>AI visual estimate.</strong> This prototype detects surface appearance only. Confirm URS against the buyer’s reference and review unclear samples before procurement decisions.</span><span class="model-tag">${escapeHtml(record.model_version)}</span></div>
  <section class="panel overlay-panel"><div class="panel-header"><div><h2>Detection overlay</h2><p>Boxes show where the model found onions. Select an image to open it full size.</p></div><span class="result-count">${overlayGroups.length} source photo${overlayGroups.length === 1 ? "" : "s"}</span></div><div class="overlay-grid">${overlays}</div></section>
  <section class="report-stats"><article class="report-stat"><div class="grade-ring" style="--ring-pct:${percent}%;--ring-color:${percent >= 70 ? "#7ea36d" : "#e89970"}"><span>${percent}%</span></div><div class="report-stat-copy"><span>Grade A share</span><strong>${record.grade_a_count} / ${record.total}</strong><small>Visual screen passed</small></div></article><article class="report-stat"><span class="stat-icon">${icons.bulb}</span><div class="report-stat-copy"><span>Onions identified</span><strong>${record.total}</strong><small>Across uploaded photo${record.total === 1 ? "" : "s"}</small></div></article><article class="report-stat"><span class="stat-icon orange">${icons.eye}</span><div class="report-stat-copy"><span>URS estimate</span><strong>${record.urs_count}</strong><small>Below visual screen</small></div></article><article class="report-stat"><span class="stat-icon blue">${icons.spark}</span><div class="report-stat-copy"><span>Visible issue cues</span><strong>${issueCount}</strong><small>May include multiple cues</small></div></article></section>
  <div class="report-analysis-grid"><section class="panel"><div class="panel-header"><div><h2>Sample-by-sample results</h2><p>Use the grade selector to save a human correction.</p></div><span class="result-count">${record.samples.length} item${record.samples.length === 1 ? "" : "s"}</span></div><div class="sample-grid">${record.samples.map(sampleCard).join("")}</div></section><aside class="report-side"><section class="panel"><h3>Batch grade split</h3><p class="side-sub">Share of objects in this inspection</p><div class="breakdown-item"><i class="breakdown-dot"></i><span>Grade A</span><strong>${record.grade_a_count}</strong><div class="breakdown-bar"><i style="width:${record.grade_a_pct}%"></i></div></div><div class="breakdown-item"><i class="breakdown-dot orange"></i><span>URS</span><strong>${record.urs_count}</strong><div class="breakdown-bar orange"><i style="width:${record.urs_pct}%"></i></div></div>${flagBreakdown(record.samples)}</section><section class="panel"><h3>How to read this report</h3><p class="side-sub">The estimate combines an onion object detector with visible colour cues.</p><div class="method-list"><div class="method-row"><span class="method-icon">${icons.eye}</span><div><strong>Surface-only screening</strong><span>Internal rot, firmness and moisture are not visible in one photo.</span></div></div><div class="method-row"><span class="method-icon">${icons.bulb}</span><div><strong>Size is relative</strong><span>Small-size flags compare bulbs in the same photo; they are not millimetre measurements.</span></div></div><div class="method-row"><span class="method-icon">${icons.check}</span><div><strong>URS means under reference standard</strong><span>Confirm your procurement centre’s required grades and thresholds.</span></div></div></div>${record.review_count ? `<div class="review-note-box">${icons.info}<span>${record.review_count} sample${record.review_count === 1 ? "" : "s"} have low-confidence or uncertain detections. Please review them manually.</span></div>` : ""}</section></aside></div>`;
  document.getElementById("printReport").addEventListener("click", () => window.print());
}

async function saveHumanReview(button) {
  const id = button.dataset.saveReview;
  const select = document.querySelector(`[data-review-grade="${CSS.escape(id)}"]`);
  if (!select) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Saving…";
  try {
    const record = await api(`/api/samples/${encodeURIComponent(id)}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade: select.value, note: "" }),
    });
    renderReport(record);
    showToast("Human review saved to the report.");
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    showToast(error.message, true);
  }
}

function renderGuide() {
  page.innerHTML = `<div class="page-heading"><div><span class="eyebrow"><i class="eyebrow-dot"></i> Reference</span><h1>Grading guide</h1><p>A transparent starting point for visual screening. Set the final acceptance rules with your procurement team.</p></div><div class="heading-actions"><button class="button button-primary" data-go="inspect">Start an inspection ${icons.arrow}</button></div></div>
  <div class="guide-grid"><section class="panel guide-card"><h2>How grades are assigned</h2><p>The prototype uses the predicted fresh/defected class and visible surface cues to produce a suggested grade.</p><div class="grade-row"><div class="grade-swatch">A</div><strong>Grade A</strong><span>Detector classifies the onion as fresh, with no visible surface cue or relative-size flag.</span></div><div class="grade-row"><div class="grade-swatch urs">U</div><strong>URS</strong><span>Detector sees a defect, the image has possible sprouting or dark patches, or the result is uncertain.</span></div><div class="guide-caveat"><strong>URS = Under Reference Standard.</strong> This is a prototype label, not a statutory or buyer-specific grade definition. Confirm acceptance thresholds locally.</div></section><section class="panel guide-card"><h2>What the model can see</h2><p>Local image processing marks objects and visible cues. Use a second inspection for anything unclear.</p><div class="guide-list"><div class="guide-list-item"><span class="guide-list-icon">${icons.bulb}</span><div><strong>Onion detection</strong><span>A fine-tuned YOLO model proposes each visible bulb and predicts a fresh or defected class.</span></div></div><div class="guide-list-item"><span class="guide-list-icon">${icons.spark}</span><div><strong>Surface colour cues</strong><span>OpenCV checks for green sprout-like pixels and dark surface patches as prompts for review.</span></div></div><div class="guide-list-item"><span class="guide-list-icon">${icons.eye}</span><div><strong>Relative size</strong><span>When a photo contains several onions, noticeably smaller detections are flagged against that frame’s median.</span></div></div><div class="guide-list-item"><span class="guide-list-icon">${icons.check}</span><div><strong>Human review</strong><span>Correct Grade A / URS per sample in the report. The correction is saved with the batch.</span></div></div></div></section></div>
  <div class="section-title"><div><h2>Model and dataset</h2><p>What powers this local prototype.</p></div></div><section class="panel guide-card"><div class="guide-list"><div class="guide-list-item"><span class="guide-list-icon">${icons.spark}</span><div><strong>YOLOv8n, fine-tuned for onion detection</strong><span>Trained with the fresh and defective onion categories from VegQual. The dataset is shared under CC BY 4.0.</span><span><a class="source-link" href="https://doi.org/10.6084/m9.figshare.30596084.v4" target="_blank" rel="noreferrer">VegQual dataset and attribution ↗</a></span></div></div><div class="guide-list-item"><span class="guide-list-icon">${icons.leaf}</span><div><strong>Detection limits</strong><span>Training labels cover fresh versus defective appearance. The prototype does not claim separate learned classes for rot, damage and sprouting, and it cannot detect hidden defects.</span></div></div></div></section>`;
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-route]");
  if (nav) {
    event.preventDefault();
    go(nav.dataset.route);
    return;
  }
  const goButton = event.target.closest("[data-go]");
  if (goButton) {
    event.preventDefault();
    go(goButton.dataset.go);
    return;
  }
  const reportTarget = event.target.closest("[data-open-report]");
  if (reportTarget) {
    const id = reportTarget.dataset.openReport;
    if (id) location.hash = `report/${id}`;
    return;
  }
  const remove = event.target.closest("[data-remove-file]");
  if (remove) {
    selectedFiles.splice(Number(remove.dataset.removeFile), 1);
    renderFiles(); syncUploadCount();
    return;
  }
  const review = event.target.closest("[data-save-review]");
  if (review) saveHumanReview(review);
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "inspectionForm") submitInspection(event);
});

document.getElementById("mobileMenu").addEventListener("click", () => sidebar.classList.toggle("open"));
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
    event.preventDefault(); go("inspect");
  }
  if (event.key === "Escape") sidebar.classList.remove("open");
  if (event.target.matches("tr[data-open-report]") && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault(); location.hash = `report/${event.target.dataset.openReport}`;
  }
});
window.addEventListener("hashchange", renderRoute);
renderRoute();
