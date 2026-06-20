const THEME_KEY = "claude-signal-theme";
const THEMES = new Set(["cozy", "matcha", "graphite", "ember"]);
const $ = (id) => document.getElementById(id);

async function boot() {
  initTheme();
  await fetchAndRender();

  $("refreshBtn").addEventListener("click", async () => {
    $("refreshBtn").disabled = true;
    await fetchAndRender();
    $("refreshBtn").disabled = false;
  });
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  document.documentElement.dataset.theme = THEMES.has(saved) ? saved : "cozy";
}

async function fetchAndRender() {
  $("lastUpdated").textContent = "Scanning…";
  try {
    const response = await fetch("/api/usage/history", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
  } catch (error) {
    $("lastUpdated").textContent = "Failed to load";
    console.error("Usage fetch failed", error);
  }
}

function render(data) {
  $("loadingState").hidden = true;
  $("pageContent").hidden = false;
  $("lastUpdated").textContent = `Scanned ${relativeTime(data.generatedAt)}`;

  renderSummary(data);
  renderTokenBreakdown(data.allTime);
  renderModels(data.byModel, data.allTime);
  renderProjects(data.topProjects, data.allTime);
  renderSessions(data.recentSessions);
}

function renderSummary(data) {
  $("summaryTodayTokens").textContent = fmtTokens(data.today);
  $("summaryTodayMeta").textContent = `${fmtNum(data.today?.turns || 0)} turns · ${fmtCost(data.today?.estimatedCostUsd || 0)}`;
  $("summaryWeekTokens").textContent = fmtTokens(data.week);
  $("summaryWeekMeta").textContent = `${fmtNum(data.week?.turns || 0)} turns · ${fmtCost(data.week?.estimatedCostUsd || 0)}`;
  $("summaryAllTokens").textContent = fmtTokens(data.allTime);
  $("summaryAllMeta").textContent = `${fmtNum(data.allTime?.turns || 0)} turns · ${fmtCost(data.allTime?.estimatedCostUsd || 0)}`;
  $("summaryFiles").textContent = `${data.transcriptFiles}`;
  const pricingParts = [];
  if (data.pricingUpdated) pricingParts.push(`Prices: ${data.pricingUpdated}`);
  if (data.unpricedModels && data.unpricedModels.length > 0) {
    pricingParts.push(`Unpriced: ${data.unpricedModels.join(", ")}`);
  }
  $("summaryPricing").textContent = pricingParts.join(" · ") || "Cost estimates included";
}

function renderTokenBreakdown(totals) {
  if (!totals) return;
  const input = totals.inputTokens || 0;
  const output = totals.outputTokens || 0;
  const cacheRead = totals.cacheReadTokens || 0;
  const cacheWrite = totals.cacheCreationTokens || 0;
  const total = input + output + cacheRead + cacheWrite;
  if (total === 0) {
    $("tokenBreakdown").innerHTML = '<p class="empty-note">No token data yet.</p>';
    return;
  }

  const segments = [
    { label: "Input", value: input, cls: "seg-input" },
    { label: "Output", value: output, cls: "seg-output" },
    { label: "Cache Read", value: cacheRead, cls: "seg-cache-read" },
    { label: "Cache Write", value: cacheWrite, cls: "seg-cache-write" },
  ];

  const barHtml = segments
    .filter((s) => s.value > 0)
    .map((s) => `<div class="breakdown-seg ${s.cls}" style="flex:${s.value}"></div>`)
    .join("");

  const legendHtml = segments
    .map((s) => {
      const pct = total > 0 ? ((s.value / total) * 100).toFixed(1) : "0.0";
      return `<div class="breakdown-legend-item">
        <span class="breakdown-dot ${s.cls}"></span>
        <span class="breakdown-label">${s.label}</span>
        <strong>${fmtNum(s.value)}</strong>
        <em>${pct}%</em>
      </div>`;
    })
    .join("");

  $("tokenBreakdown").innerHTML = `
    <div class="breakdown-bar">${barHtml}</div>
    <div class="breakdown-legend">${legendHtml}</div>
  `;
}

function renderModels(models, allTime) {
  const totalTokens = tokTotal(allTime);
  $("modelCount").textContent = `${models.length} model${models.length !== 1 ? "s" : ""}`;
  const tbody = $("modelBody");
  if (!models.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-note">No model data</td></tr>';
    return;
  }
  tbody.innerHTML = models
    .map((m) => {
      const t = m.totals;
      const share = totalTokens > 0 ? ((tokTotal(t) / totalTokens) * 100).toFixed(1) : "0.0";
      return `<tr>
        <td><strong>${esc(m.model)}</strong></td>
        <td class="num">${fmtNum(t.inputTokens)}</td>
        <td class="num">${fmtNum(t.outputTokens)}</td>
        <td class="num">${fmtNum(t.cacheReadTokens)}</td>
        <td class="num">${fmtNum(t.cacheCreationTokens)}</td>
        <td class="num">${fmtNum(t.turns)}</td>
        <td class="num">${fmtCost(t.estimatedCostUsd)}</td>
        <td class="num"><span class="share-badge">${share}%</span></td>
      </tr>`;
    })
    .join("");
}

function renderProjects(projects, allTime) {
  const totalTokens = tokTotal(allTime);
  $("projectCount").textContent = `${projects.length} project${projects.length !== 1 ? "s" : ""}`;
  const tbody = $("projectBody");
  if (!projects.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-note">No project data</td></tr>';
    return;
  }
  tbody.innerHTML = projects
    .map((p) => {
      const t = p.totals;
      const share = totalTokens > 0 ? ((tokTotal(t) / totalTokens) * 100).toFixed(1) : "0.0";
      return `<tr>
        <td><strong>${esc(p.project)}</strong></td>
        <td class="num">${fmtNum(tokTotal(t))}</td>
        <td class="num">${fmtNum(t.turns)}</td>
        <td class="num">${fmtCost(t.estimatedCostUsd)}</td>
        <td class="num"><span class="share-badge">${share}%</span></td>
      </tr>`;
    })
    .join("");
}

function renderSessions(sessions) {
  $("sessionCount").textContent = `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`;
  const tbody = $("sessionBody");
  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-note">No sessions</td></tr>';
    return;
  }
  tbody.innerHTML = sessions
    .map((s) => {
      const t = s.totals;
      return `<tr>
        <td><code>${esc(s.sessionId)}</code></td>
        <td>${esc(shortProject(s.project))}</td>
        <td>${esc(s.model || "--")}</td>
        <td class="num">${fmtNum(tokTotal(t))}</td>
        <td class="num">${fmtNum(t.turns)}</td>
        <td class="num">${fmtCost(t.estimatedCostUsd)}</td>
        <td class="num">${relativeTime(s.lastActivityAt)}</td>
      </tr>`;
    })
    .join("");
}

// === Helpers ===

function tokTotal(t) {
  if (!t) return 0;
  return (t.inputTokens || 0) + (t.outputTokens || 0) + (t.cacheReadTokens || 0) + (t.cacheCreationTokens || 0);
}

function fmtTokens(t) {
  return `${fmtNum(tokTotal(t))} tokens`;
}

function fmtNum(v) {
  if (typeof v !== "number") return "--";
  return new Intl.NumberFormat([], { notation: v >= 10000 ? "compact" : "standard" }).format(v);
}

function fmtCost(v) {
  if (typeof v !== "number") return "--";
  return `$${v.toFixed(v < 1 ? 2 : 1)}`;
}

function relativeTime(v) {
  if (!v) return "--";
  const s = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function shortProject(p) {
  const parts = String(p).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "unknown";
}

boot();
