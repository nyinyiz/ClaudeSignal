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
  renderCostByModel(data.byModel);
  renderModels(data.byModel, data.allTime);
  renderProjects(data.topProjects, data.allTime);
  renderSessions(data.recentSessions);
}

function renderSummary(data) {
  $("summaryTodayTokens").textContent = fmtTokens(data.today);
  $("summaryTodayMeta").textContent = summaryMeta(data.today, data.yesterday, "vs yesterday");
  $("summaryWeekTokens").textContent = fmtTokens(data.week);
  $("summaryWeekMeta").textContent = summaryMeta(data.week, data.lastWeek, "vs last week");
  $("summaryAllTokens").textContent = fmtTokens(data.allTime);
  $("summaryAllMeta").textContent = `${fmtNum(data.allTime?.turns || 0)} turns · ${fmtCost(data.allTime?.estimatedCostUsd || 0)}`;
  $("summaryFiles").textContent = `${data.transcriptFiles}`;
  const parts = [];
  if (data.pricingUpdated) parts.push(`Prices: ${data.pricingUpdated}`);
  if (data.unpricedModels && data.unpricedModels.length > 0) {
    parts.push(`Unpriced: ${data.unpricedModels.join(", ")}`);
  }
  $("summaryPricing").textContent = parts.join(" · ") || "Cost estimates included";
}

function renderTokenBreakdown(totals) {
  const container = $("tokenBreakdown");
  if (!totals) return;
  const input = totals.inputTokens || 0;
  const output = totals.outputTokens || 0;
  const cacheRead = totals.cacheReadTokens || 0;
  const cacheWrite = totals.cacheCreationTokens || 0;
  const total = input + output + cacheRead + cacheWrite;
  if (total === 0) {
    container.innerHTML = '<p class="empty-note">No token data yet.</p>';
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
    .map((s) => `<div class="breakdown-seg ${s.cls}" style="flex:${s.value}" title="${s.label}: ${fmtNum(s.value)}"></div>`)
    .join("");

  const legendHtml = segments
    .map((s) => {
      const pct = total > 0 ? ((s.value / total) * 100).toFixed(1) : "0.0";
      return `<div class="breakdown-legend-item">
        <span class="breakdown-dot ${s.cls}"></span>
        <div class="breakdown-legend-text">
          <span class="breakdown-label">${s.label}</span>
          <strong>${fmtNum(s.value)}</strong>
          <em>${pct}%</em>
        </div>
      </div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="breakdown-bar">${barHtml}</div>
    <div class="breakdown-legend">${legendHtml}</div>
  `;
}

function renderCostByModel(models) {
  const container = $("costByModel");
  const totalCost = models.reduce((sum, m) => sum + (m.totals.estimatedCostUsd || 0), 0);
  $("modelCostTotal").textContent = fmtCost(totalCost);

  if (!models.length || totalCost === 0) {
    container.innerHTML = '<p class="empty-note">No cost data yet.</p>';
    return;
  }

  const maxCost = Math.max(...models.map((m) => m.totals.estimatedCostUsd || 0));
  container.innerHTML = models
    .filter((m) => (m.totals.estimatedCostUsd || 0) > 0)
    .map((m) => {
      const cost = m.totals.estimatedCostUsd || 0;
      const pct = Math.max(4, (cost / maxCost) * 100);
      const share = ((cost / totalCost) * 100).toFixed(1);
      return `<div class="vrow">
        <div class="vrow-head">
          <strong>${esc(m.model)}</strong>
          <span class="vrow-value">${fmtCost(cost)}</span>
        </div>
        <div class="vrow-bar"><i class="vrow-fill cost-fill" style="width:${pct}%"></i></div>
        <div class="vrow-meta">${share}% of total · ${fmtNum(m.totals.turns)} turns</div>
      </div>`;
    })
    .join("");
}

function renderModels(models, allTime) {
  const totalTokens = tokTotal(allTime);
  $("modelCount").textContent = `${models.length} model${models.length !== 1 ? "s" : ""}`;
  const container = $("modelList");
  if (!models.length) {
    container.innerHTML = '<p class="empty-note">No model data.</p>';
    return;
  }

  const maxTokens = Math.max(...models.map((m) => tokTotal(m.totals)));
  container.innerHTML = models
    .map((m) => {
      const t = m.totals;
      const tokens = tokTotal(t);
      const pct = Math.max(4, (tokens / maxTokens) * 100);
      const share = totalTokens > 0 ? ((tokens / totalTokens) * 100).toFixed(1) : "0.0";
      return `<div class="vrow">
        <div class="vrow-head">
          <strong>${esc(m.model)}</strong>
          <span class="vrow-value">${fmtNum(tokens)}</span>
        </div>
        <div class="vrow-bar"><i class="vrow-fill model-fill" style="width:${pct}%"></i></div>
        <div class="vrow-meta">${share}% · ${fmtNum(t.turns)} turns · ${fmtCost(t.estimatedCostUsd)}</div>
      </div>`;
    })
    .join("");
}

function renderProjects(projects, allTime) {
  const totalTokens = tokTotal(allTime);
  $("projectCount").textContent = `${projects.length} project${projects.length !== 1 ? "s" : ""}`;
  const container = $("projectList");
  if (!projects.length) {
    container.innerHTML = '<p class="empty-note">No project data.</p>';
    return;
  }

  const maxTokens = Math.max(...projects.map((p) => tokTotal(p.totals)));
  container.innerHTML = projects
    .map((p) => {
      const t = p.totals;
      const tokens = tokTotal(t);
      const pct = Math.max(4, (tokens / maxTokens) * 100);
      const share = totalTokens > 0 ? ((tokens / totalTokens) * 100).toFixed(1) : "0.0";
      return `<div class="vrow">
        <div class="vrow-head">
          <strong>${esc(p.project)}</strong>
          <span class="vrow-value">${fmtNum(tokens)}</span>
        </div>
        <div class="vrow-bar"><i class="vrow-fill project-fill" style="width:${pct}%"></i></div>
        <div class="vrow-meta">${share}% · ${fmtNum(t.turns)} turns · ${fmtCost(t.estimatedCostUsd)}</div>
      </div>`;
    })
    .join("");
}

function renderSessions(sessions) {
  $("sessionCount").textContent = `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`;
  const container = $("sessionList");
  if (!sessions.length) {
    container.innerHTML = '<p class="empty-note">No sessions.</p>';
    return;
  }

  container.innerHTML = sessions
    .map((s) => {
      const t = s.totals;
      return `<div class="session-card">
        <div class="session-card-top">
          <code>${esc(s.sessionId)}</code>
          <span class="session-card-time">${relativeTime(s.lastActivityAt)}</span>
        </div>
        <div class="session-card-project">${esc(shortProject(s.project))}</div>
        <div class="session-card-stats">
          <span>${fmtNum(tokTotal(t))} tok</span>
          <span>${fmtNum(t.turns)} turns</span>
          <span>${fmtCost(t.estimatedCostUsd)}</span>
        </div>
        <div class="session-card-model">${esc(s.model || "unknown")}</div>
      </div>`;
    })
    .join("");
}

function summaryMeta(current, previous, label) {
  const parts = [`${fmtNum(current?.turns || 0)} turns`, fmtCost(current?.estimatedCostUsd || 0)];
  const delta = deltaLabel(current, previous, label);
  if (delta) parts.push(delta);
  return parts.join(" · ");
}

function deltaLabel(current, previous, label) {
  if (!previous) return "";
  const cur = tokTotal(current);
  const prev = tokTotal(previous);
  if (prev === 0 && cur === 0) return "";
  if (prev === 0) return `+100% ${label}`;
  const change = ((cur - prev) / prev) * 100;
  if (Math.abs(change) < 0.5) return "";
  const sign = change > 0 ? "+" : "";
  return `${sign}${Math.round(change)}% ${label}`;
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
