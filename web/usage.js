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
  renderTrends(data);
  renderCostByModel(data.byModel);
  renderCostOptimization(data.byModel, data.allTime);
  renderModels(data.byModel, data.allTime);
  renderProjects(data.topProjects, data.allTime);
  renderSessions(data.recentSessions);
}

function renderSummary(data) {
  $("summaryTodayTokens").textContent = fmtTokens(data.today);
  $("summaryTodayMeta").innerHTML = summaryMetaHtml(data.today, data.yesterday);
  $("summaryWeekTokens").textContent = fmtTokens(data.week);
  $("summaryWeekMeta").innerHTML = summaryMetaHtml(data.week, data.lastWeek);
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

function renderTrends(data) {
  renderTrendCard("trendDay", "trendDayBadge", data.today, data.yesterday);
  renderTrendCard("trendWeek", "trendWeekBadge", data.week, data.lastWeek);
}

function renderTrendCard(containerId, badgeId, current, previous) {
  const container = $(containerId);
  if (!container) return;

  const metrics = [
    { label: "Tokens", cur: tokTotal(current), prev: tokTotal(previous), fmt: fmtNum },
    { label: "Turns", cur: current?.turns || 0, prev: previous?.turns || 0, fmt: fmtNum },
    { label: "Cost", cur: current?.estimatedCostUsd || 0, prev: previous?.estimatedCostUsd || 0, fmt: fmtCost },
    { label: "Input", cur: current?.inputTokens || 0, prev: previous?.inputTokens || 0, fmt: fmtNum },
    { label: "Output", cur: current?.outputTokens || 0, prev: previous?.outputTokens || 0, fmt: fmtNum },
  ];

  // Overall delta badge
  const totalCur = tokTotal(current);
  const totalPrev = tokTotal(previous);
  $(badgeId).innerHTML = makeDeltaBadge(totalCur, totalPrev);

  const maxVal = Math.max(...metrics.map((m) => Math.max(m.cur, m.prev)), 1);

  container.innerHTML = metrics
    .map((m) => {
      const localMax = Math.max(m.cur, m.prev, 1);
      const curPct = Math.max(4, (m.cur / localMax) * 100);
      const prevPct = Math.max(4, (m.prev / localMax) * 100);
      return `<div class="trend-row">
        <span class="trend-label">${m.label}</span>
        <div class="trend-bar-wrap">
          <div class="trend-bar trend-bar-current"><i style="width:${curPct}%"></i></div>
          <span class="trend-value">${m.fmt(m.cur)}</span>
        </div>
        <div class="trend-bar-wrap">
          <div class="trend-bar trend-bar-previous"><i style="width:${prevPct}%"></i></div>
          <span class="trend-value">${m.fmt(m.prev)}</span>
        </div>
      </div>`;
    })
    .join("");
}

function makeDeltaBadge(cur, prev) {
  if (prev === 0 && cur === 0) return '<span class="delta-badge delta-flat">~0%</span>';
  if (prev === 0) return '<span class="delta-badge delta-up"><svg viewBox="0 0 12 12"><path d="M6 2v8M6 2l3 3M6 2 3 5"/></svg>new</span>';
  const change = ((cur - prev) / prev) * 100;
  if (Math.abs(change) < 0.5) return '<span class="delta-badge delta-flat">~0%</span>';
  const rounded = Math.round(change);
  const sign = rounded > 0 ? "+" : "";
  if (rounded > 0) {
    return `<span class="delta-badge delta-up"><svg viewBox="0 0 12 12"><path d="M6 2v8M6 2l3 3M6 2 3 5"/></svg>${sign}${rounded}%</span>`;
  }
  return `<span class="delta-badge delta-down"><svg viewBox="0 0 12 12"><path d="M6 10V2M6 10l3-3M6 10 3 7"/></svg>${rounded}%</span>`;
}

// === Model Recommendation Engine ===

const MODEL_PRICING = {
  opus: { input: 15, output: 75, label: "Opus" },
  sonnet: { input: 3, output: 15, label: "Sonnet" },
  haiku: { input: 0.8, output: 4, label: "Haiku" },
};

function classifyModel(name) {
  const lower = name.toLowerCase();
  if (lower.includes("opus") || lower.includes("fable") || lower.includes("mythos")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("haiku")) return "haiku";
  return null;
}

function renderCostOptimization(models, allTime) {
  const container = $("costOptimization");
  if (!container) return;

  const totalCost = models.reduce((s, m) => s + (m.totals.estimatedCostUsd || 0), 0);
  if (totalCost === 0) {
    container.innerHTML = '<p class="empty-note">Not enough usage data for recommendations.</p>';
    return;
  }

  // Classify model usage
  const buckets = { opus: { tokens: 0, cost: 0, turns: 0 }, sonnet: { tokens: 0, cost: 0, turns: 0 }, haiku: { tokens: 0, cost: 0, turns: 0 } };
  for (const m of models) {
    const tier = classifyModel(m.model);
    if (tier && buckets[tier]) {
      buckets[tier].tokens += tokTotal(m.totals);
      buckets[tier].cost += m.totals.estimatedCostUsd || 0;
      buckets[tier].turns += m.totals.turns || 0;
    }
  }

  const totalTokens = tokTotal(allTime);
  const cards = [];

  // Model distribution insight
  const breakdown = Object.entries(buckets)
    .filter(([, v]) => v.tokens > 0)
    .map(([tier, v]) => {
      const pct = totalTokens > 0 ? ((v.tokens / totalTokens) * 100).toFixed(0) : "0";
      return `<span class="opt-model-stat"><strong>${pct}%</strong> ${MODEL_PRICING[tier]?.label || tier}</span>`;
    });

  if (breakdown.length > 0) {
    cards.push(`<div class="opt-card">
      <div class="opt-card-header">
        <span class="opt-icon opt-info">%</span>
        <span class="opt-title">Model Distribution</span>
      </div>
      <p class="opt-body">Your token usage across model tiers:</p>
      <div class="opt-model-breakdown">${breakdown.join("")}</div>
    </div>`);
  }

  // Savings recommendation: if significant Opus usage, suggest shifting some to Sonnet
  if (buckets.opus.cost > 1) {
    // Calculate: if 30% of Opus input/output moved to Sonnet, how much saved?
    const shiftPct = 0.3;
    const opusModels = models.filter((m) => classifyModel(m.model) === "opus");
    let shiftableInputTokens = 0;
    let shiftableOutputTokens = 0;
    for (const m of opusModels) {
      shiftableInputTokens += (m.totals.inputTokens || 0) * shiftPct;
      shiftableOutputTokens += (m.totals.outputTokens || 0) * shiftPct;
    }
    const opusCostForShifted =
      (shiftableInputTokens * MODEL_PRICING.opus.input + shiftableOutputTokens * MODEL_PRICING.opus.output) / 1_000_000;
    const sonnetCostForShifted =
      (shiftableInputTokens * MODEL_PRICING.sonnet.input + shiftableOutputTokens * MODEL_PRICING.sonnet.output) / 1_000_000;
    const savings = opusCostForShifted - sonnetCostForShifted;

    if (savings > 0.1) {
      const opusPct = totalTokens > 0 ? ((buckets.opus.tokens / totalTokens) * 100).toFixed(0) : "0";
      cards.push(`<div class="opt-card">
        <div class="opt-card-header">
          <span class="opt-icon opt-savings">$</span>
          <span class="opt-title">Potential Savings</span>
        </div>
        <p class="opt-body">You used Opus for <strong>${opusPct}%</strong> of all tokens. Moving ~30% of routine Opus work to Sonnet could save approximately <span class="opt-savings-amount">${fmtCost(savings)}</span> over the same period.</p>
      </div>`);
    }
  }

  // Haiku suggestion: if no Haiku usage but significant overall usage
  if (buckets.haiku.tokens === 0 && totalTokens > 500_000) {
    cards.push(`<div class="opt-card">
      <div class="opt-card-header">
        <span class="opt-icon opt-warn">!</span>
        <span class="opt-title">Consider Haiku</span>
      </div>
      <p class="opt-body">You haven't used Haiku yet. For quick tasks like code formatting, simple refactors, or boilerplate generation, Haiku is ~19x cheaper than Opus and still very capable.</p>
    </div>`);
  }

  // If already using a good mix, say so
  if (cards.length === 1 && buckets.opus.tokens > 0 && buckets.sonnet.tokens > 0) {
    cards.push(`<div class="opt-card">
      <div class="opt-card-header">
        <span class="opt-icon opt-info">&#10003;</span>
        <span class="opt-title">Good Model Mix</span>
      </div>
      <p class="opt-body">You're already using a mix of model tiers. Keep using Opus for complex reasoning and Sonnet for routine work to optimize cost.</p>
    </div>`);
  }

  container.innerHTML = cards.join("") || '<p class="empty-note">Not enough data for recommendations.</p>';
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
  return parts.join(" · ");
}

function summaryMetaHtml(current, previous) {
  const parts = [`${fmtNum(current?.turns || 0)} turns`, fmtCost(current?.estimatedCostUsd || 0)];
  const badge = makeDeltaBadge(tokTotal(current), tokTotal(previous));
  return esc(parts.join(" · ")) + (badge ? ` ${badge}` : "");
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
