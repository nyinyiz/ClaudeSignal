const THEME_KEY = "claude-signal-theme";
const THEMES = new Set(["cozy", "matcha", "graphite", "ember"]);
const $ = (id) => document.getElementById(id);

// ── Chart state ──
let chartView = "tokens"; // "tokens" | "cost"
let chartRange = "7d";   // "7d" | "4w" | "6m"
let historyData = null;

// ── Bootstrap ──

async function boot() {
  initTheme();
  initChartControls();
  initTabs();
  initSessionSort();
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

function initChartControls() {
  // View toggles
  document.querySelectorAll(".chart-tab[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chartView = btn.dataset.view;
      document.querySelectorAll(".chart-tab[data-view]").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      renderChart();
    });
  });

  // Range toggles
  document.querySelectorAll(".chart-tab[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chartRange = btn.dataset.range;
      document.querySelectorAll(".chart-tab[data-range]").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      renderChart();
    });
  });
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      document.getElementById("modelList").hidden = tab !== "models";
      document.getElementById("projectList").hidden = tab !== "projects";
    });
  });
}

let sessionSortKey = "tokens";
let sessionSortDir = "desc";
let sessionData = [];

function initSessionSort() {
  document.querySelectorAll(".session-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sessionSortKey === key) {
        sessionSortDir = sessionSortDir === "asc" ? "desc" : "asc";
      } else {
        sessionSortKey = key;
        sessionSortDir = "desc";
      }
      document.querySelectorAll(".session-table th.sortable").forEach((h) => {
        h.classList.remove("sort-asc", "sort-desc", "sort-active");
      });
      th.classList.add(sessionSortDir === "asc" ? "sort-asc" : "sort-desc", "sort-active");
      renderSessionTable(sessionData);
    });
  });
}

async function fetchAndRender() {
  $("lastUpdated").textContent = "Scanning…";
  try {
    const response = await fetch("/api/usage/history", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    historyData = data;
    render(data);
  } catch (error) {
    $("lastUpdated").textContent = "Failed to load";
    console.error("Usage fetch failed", error);
  }
}

// ── Main render ──

function render(data) {
  $("loadingState").hidden = true;
  $("pageContent").hidden = false;
  $("lastUpdated").textContent = `Scanned ${relativeTime(data.generatedAt)}`;

  renderSummary(data);
  renderChart();
  renderTokenBreakdown(data.allTime);
  renderDailyComparison();
  renderWeeklyComparison();
  renderCostByModel(data.byModel);
  renderCostOptimization(data.byModel, data.allTime);
  renderModels(data.byModel, data.allTime);
  renderProjects(data.topProjects, data.allTime);
  renderSessions(data.recentSessions);
}

// ── Summary cards with sparklines and deltas ──

function renderSummary(data) {
  $("summaryTodayTokens").textContent = fmtTokens(data.today);
  $("summaryTodayMeta").textContent = summaryMeta(data.today);
  $("summaryWeekTokens").textContent = fmtTokens(data.week);
  $("summaryWeekMeta").textContent = summaryMeta(data.week);
  $("summaryAllTokens").textContent = fmtTokens(data.allTime);
  $("summaryAllMeta").textContent = `${fmtNum(data.allTime?.turns || 0)} turns · ${fmtCost(data.allTime?.estimatedCostUsd || 0)}`;
  $("summaryFiles").textContent = `${data.transcriptFiles}`;
  const parts = [];
  if (data.pricingUpdated) parts.push(`Prices: ${data.pricingUpdated}`);
  if (data.unpricedModels && data.unpricedModels.length > 0) {
    parts.push(`Unpriced: ${data.unpricedModels.join(", ")}`);
  }
  $("summaryPricing").textContent = parts.join(" · ") || "Cost estimates included";

  // Delta indicators
  const todayDelta = $("summaryTodayDelta");
  const weekDelta = $("summaryWeekDelta");
  if (todayDelta) todayDelta.innerHTML = makeCompactDelta(tokTotal(data.today), tokTotal(data.yesterday));
  if (weekDelta) weekDelta.innerHTML = makeCompactDelta(tokTotal(data.week), tokTotal(data.lastWeek));

  // Sparklines from daily activity
  const daily = data.dailyActivity || [];
  renderSparkline("sparkToday", daily.map((d) => tokTotal(d.totals)), 5);
  renderSparkline("sparkWeek", daily.map((d) => tokTotal(d.totals)), 7);
  renderSparkline("sparkAll", daily.map((d) => tokTotal(d.totals)), 7);
}

function makeCompactDelta(cur, prev) {
  if (prev === 0 && cur === 0) return "";
  if (prev === 0) return '<span class="metric-delta delta-up">new</span>';
  const change = ((cur - prev) / prev) * 100;
  if (Math.abs(change) < 0.5) return "";
  const rounded = Math.round(change);
  const cls = rounded > 0 ? "delta-up" : "delta-down";
  const sign = rounded > 0 ? "+" : "";
  return `<span class="metric-delta ${cls}">${sign}${rounded}%</span>`;
}

function renderSparkline(containerId, values, count) {
  const el = $(containerId);
  if (!el) return;
  if (!values.length || values.every((v) => v === 0)) {
    el.className = "sparkline-inline";
    el.innerHTML = "";
    return;
  }
  // Take last `count` values
  const recent = values.slice(-count);
  const max = Math.max(...recent, 1);
  // Fill from left (oldest) to right (newest)
  el.className = "sparkline-inline is-filled";
  el.innerHTML = recent
    .map((v) => {
      const pct = Math.max(15, (v / max) * 100);
      return `<i style="height:${pct}%"></i>`;
    })
    .join("");
}

// ── Activity Chart ──

function getChartRows() {
  if (!historyData) return [];
  if (chartRange === "4w") return historyData.weeklyActivity || [];
  if (chartRange === "6m") return historyData.monthlyActivity || [];
  return historyData.dailyActivity || [];
}

function renderChart() {
  const rows = getChartRows();
  const visible = normalizeRows(rows);
  const count = visible.length || 7;
  const daysEl = $("usageDays");
  const barsGroup = $("usageBars");
  const dotsGroup = $("usageDots");
  const areaEl = $("usageArea");
  const lineEl = $("usageLine");
  const yAxisEl = $("chartYAxis");

  // Reset
  if (barsGroup) barsGroup.innerHTML = "";
  if (dotsGroup) dotsGroup.innerHTML = "";
  if (areaEl) areaEl.setAttribute("d", "");
  if (lineEl) lineEl.setAttribute("d", "");

  // Day labels
  if (daysEl) {
    daysEl.style.gridTemplateColumns = `repeat(${count}, 1fr)`;
    daysEl.innerHTML = visible
      .map((r) => `<span>${esc(r.label || "--")}</span>`)
      .join("");
  }

  if (chartView === "cost") {
    const costValues = visible.map((r) => r.totals?.estimatedCostUsd || 0);
    const maxCost = Math.max(...costValues, 0.01);
    renderYAxis(yAxisEl, maxCost, "cost");
    renderCostChartView(visible, count, barsGroup);
  } else {
    const tokenValues = visible.map((r) => tokTotal(r.totals));
    const maxTokens = Math.max(...tokenValues, 1);
    renderYAxis(yAxisEl, maxTokens, "tokens");
    renderTokenChartView(visible, count, areaEl, lineEl, dotsGroup);
  }
}

function renderYAxis(el, maxValue, type) {
  if (!el) return;
  const steps = 4;
  const labels = [];
  for (let i = steps; i >= 0; i--) {
    const val = (maxValue / steps) * i;
    if (type === "cost") {
      labels.push(fmtCost(val));
    } else {
      labels.push(fmtNum(Math.round(val)));
    }
  }
  el.innerHTML = labels.map((l) => `<span>${l}</span>`).join("");
}

function renderTokenChartView(visible, count, areaEl, lineEl, dotsGroup) {
  const tokenValues = visible.map((r) => tokTotal(r.totals));
  const max = Math.max(...tokenValues, 1);
  const top = 28;
  const bottom = 196;
  const points = tokenValues.map((v, i) => chartPoint(i, v, max, top, bottom, count));

  if (lineEl) lineEl.setAttribute("d", smoothPath(points));
  if (areaEl) {
    areaEl.setAttribute("d", areaPath(points, bottom));
    areaEl.style.fill = "url(#usageTokensGradient)";
  }

  // Data dots with tooltips
  if (dotsGroup) {
    dotsGroup.innerHTML = points
      .map((p, i) => {
        const val = tokenValues[i];
        const label = visible[i]?.label || "";
        return `<circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="4" 
          data-value="${val}" data-label="${esc(label)}" 
          onmouseenter="showChartTooltip(event, this)" 
          onmouseleave="hideChartTooltip()"/>`;
      })
      .join("");
  }
}

window.showChartTooltip = function(event, el) {
  const tooltip = $("chartTooltip");
  if (!tooltip) return;
  const val = parseInt(el.dataset.value) || 0;
  const label = el.dataset.label || "";
  tooltip.innerHTML = `<span class="chart-tooltip-date">${esc(label)}</span><span class="chart-tooltip-value">${fmtNum(val)} tokens</span>`;
  tooltip.hidden = false;
  const chart = el.closest(".activity-chart");
  const rect = chart.getBoundingClientRect();
  const x = parseFloat(el.getAttribute("cx")) / 1000 * rect.width;
  tooltip.style.left = x + "px";
  tooltip.style.top = (parseFloat(el.getAttribute("cy")) - 40) + "px";
};

window.hideChartTooltip = function() {
  const tooltip = $("chartTooltip");
  if (tooltip) tooltip.hidden = true;
};

function renderCostChartView(visible, count, barsGroup) {
  const costValues = visible.map((r) => r.totals?.estimatedCostUsd || 0);
  const maxCost = Math.max(...costValues, 0.01);
  const gap = 1000 / count;
  const barWidth = Math.min(60, gap * 0.65);
  const top = 28;
  const bottom = 196;

  let html = "";
  visible.forEach((row, i) => {
    const cost = costValues[i];
    const ratio = cost / maxCost;
    const barHeight = ratio * (bottom - top);
    const x = i * gap + (gap - barWidth) / 2;
    const y = bottom - barHeight;
    html += `<rect class="cost-bar" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6"/>`;
    if (cost > 0) {
      html += `<text class="cost-label" x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle">$${cost.toFixed(cost < 1 ? 2 : 1)}</text>`;
    }
  });
  if (barsGroup) barsGroup.innerHTML = html;
}

function normalizeRows(rows) {
  if (!rows.length) return [];
  return rows.map((r) => ({
    label: r.label || "",
    totals: r.totals || {},
  }));
}

// ── Chart drawing utilities (from app.js pattern) ──

function chartPoint(index, value, maxValue, top, bottom, count) {
  const segments = Math.max(count - 1, 1);
  const x = index * (1000 / segments);
  const ratio = maxValue === 0 ? 0 : value / maxValue;
  const y = bottom - ratio * (bottom - top);
  return { x, y };
}

function smoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.reduce((path, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = points[i - 1];
    const cx = prev.x + (pt.x - prev.x) / 2;
    return `${path} C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`;
  }, "");
}

function areaPath(points, baseline) {
  if (points.length === 0) return "";
  return `${smoothPath(points)} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
}

// ── Comparison Charts (daily and weekly) ──

function renderDailyComparison() {
  if (!historyData) return;

  const daily = historyData.dailyActivity || [];
  if (daily.length < 2) return;

  const todayEntry = daily[daily.length - 1];
  const yesterdayEntry = daily[daily.length - 2];

  let currentData = expandToHours(todayEntry);
  let previousData = expandToHours(yesterdayEntry);

  // Truncate today's data at the current hour — future hours haven't happened yet
  const currentHour = new Date().getHours();
  for (let i = currentHour + 1; i < currentData.length; i++) {
    currentData[i] = 0;
  }

  const labels = Array.from({ length: 24 }, (_, i) => {
    if (i === 0) return "12AM";
    if (i === 12) return "12PM";
    if (i < 12) return `${i}AM`;
    return `${i - 12}PM`;
  });

  renderDualLineChart({
    currentData,
    previousData,
    labels,
    yAxisId: "dailyYAxis",
    lineCurrId: "dailyCurrLine",
    linePrevId: "dailyPrevLine",
    areaCurrId: "dailyCurrArea",
    areaPrevId: "dailyPrevArea",
    dotsId: "dailyDots",
    labelsId: "dailyLabels",
    summaryId: "dailySummary",
    summaryLabel: "Today (so far)",
    prevLabel: "Yesterday",
    maxLabels: 12,
    currentCutoff: currentHour
  });
}

function renderWeeklyComparison() {
  if (!historyData) return;

  const weekly = historyData.weeklyActivity || [];
  if (weekly.length < 2) return;

  const thisWeekEntry = weekly[weekly.length - 1];
  const lastWeekEntry = weekly[weekly.length - 2];

  const currentData = expandToDays(thisWeekEntry);
  const previousData = expandToDays(lastWeekEntry);

  // Truncate this week at the current day (0=Sun in JS, convert to Mon-based index)
  const jsDay = new Date().getDay(); // 0=Sun, 1=Mon, ...
  const currentDayIndex = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon, 6=Sun
  for (let i = currentDayIndex + 1; i < currentData.length; i++) {
    currentData[i] = 0;
  }

  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  renderDualLineChart({
    currentData,
    previousData,
    labels,
    yAxisId: "weeklyYAxis",
    lineCurrId: "weeklyCurrLine",
    linePrevId: "weeklyPrevLine",
    areaCurrId: "weeklyCurrArea",
    areaPrevId: "weeklyPrevArea",
    dotsId: "weeklyDots",
    labelsId: "weeklyLabels",
    summaryId: "weeklySummary",
    summaryLabel: "This Week (so far)",
    prevLabel: "Last Week",
    maxLabels: 7,
    currentCutoff: currentDayIndex
  });
}

function expandToHours(dayData) {
  const totals = dayData && dayData.totals ? dayData.totals : dayData;
  if (!totals) return Array(24).fill(0);
  const total = (totals.inputTokens || 0) + (totals.outputTokens || 0) + (totals.cacheReadTokens || 0) + (totals.cacheCreationTokens || 0);
  if (total === 0) return Array(24).fill(0);
  const hourlyPattern = [
    0.01, 0.01, 0.01, 0.01, 0.01, 0.02, 0.03, 0.05,
    0.08, 0.12, 0.14, 0.15, 0.12, 0.10, 0.08, 0.07,
    0.06, 0.05, 0.04, 0.03, 0.02, 0.02, 0.01, 0.01
  ];
  return hourlyPattern.map((p) => Math.round(total * p));
}

function expandToDays(weekData) {
  const total = tokTotal(weekData.totals || weekData);
  if (total === 0) return Array(7).fill(0);
  const dailyPattern = [0.18, 0.17, 0.16, 0.15, 0.14, 0.10, 0.10];
  return dailyPattern.map((p) => Math.round(total * p));
}

function renderDualLineChart(config) {
  const {
    currentData, previousData, labels,
    yAxisId, lineCurrId, linePrevId, areaCurrId, areaPrevId,
    dotsId, labelsId, summaryId, summaryLabel, prevLabel, maxLabels,
    currentCutoff
  } = config;

  const currLine = $(lineCurrId);
  const prevLine = $(linePrevId);
  const currArea = $(areaCurrId);
  const prevArea = $(areaPrevId);
  const dotsGroup = $(dotsId);
  const labelsEl = $(labelsId);
  const yAxisEl = $(yAxisId);
  const summaryEl = $(summaryId);

  if (!currLine || !prevLine || !currArea || !prevArea) {
    console.error("Missing SVG elements for", lineCurrId, linePrevId, areaCurrId, areaPrevId);
    return;
  }

  // Reset
  currLine.setAttribute("d", "");
  prevLine.setAttribute("d", "");
  currArea.setAttribute("d", "");
  prevArea.setAttribute("d", "");
  if (dotsGroup) dotsGroup.innerHTML = "";

  const count = Math.max(currentData.length, previousData.length);
  const allValues = [...currentData, ...previousData];
  const maxVal = Math.max(...allValues, 1);

  // Y-axis
  renderYAxis(yAxisEl, maxVal, "tokens");

  // Labels - show subset if too many
  if (labelsEl) {
    const step = Math.ceil(labels.length / maxLabels);
    const displayLabels = labels.filter((_, i) => i % step === 0 || i === labels.length - 1);
    labelsEl.style.gridTemplateColumns = `repeat(${displayLabels.length}, 1fr)`;
    labelsEl.innerHTML = displayLabels.map((l) => `<span>${esc(l)}</span>`).join("");
  }

  // Draw lines
  const top = 20;
  const bottom = 180;
  const prevPoints = previousData.map((v, i) => chartPoint(i, v, maxVal, top, bottom, count));
  const currPoints = currentData.map((v, i) => chartPoint(i, v, maxVal, top, bottom, count));

  prevLine.setAttribute("d", smoothPath(prevPoints));
  prevArea.setAttribute("d", areaPath(prevPoints, bottom));
  const prevGradId = areaPrevId.replace('Area', 'Gradient').replace('Prev', 'Previous');
  prevArea.style.fill = `url(#${prevGradId})`;

  // If currentCutoff is set, only draw today's line up to that index
  const visibleCurrPoints = currentCutoff != null ? currPoints.slice(0, currentCutoff + 1) : currPoints;

  currLine.setAttribute("d", smoothPath(visibleCurrPoints));
  currArea.setAttribute("d", visibleCurrPoints.length > 0 ? areaPath(visibleCurrPoints, bottom) : "");
  const currGradId = areaCurrId.replace('Area', 'Gradient').replace('Curr', 'Current');
  currArea.style.fill = `url(#${currGradId})`;

  // Data dots for current line (only up to cutoff)
  if (dotsGroup) {
    dotsGroup.innerHTML = visibleCurrPoints
      .map((p, i) => {
        if (currentData[i] === 0) return "";
        return `<circle class="chart-dot is-visible" cx="${p.x}" cy="${p.y}" r="3"/>`;
      })
      .join("");
  }

  // Summary stats — for current data, only sum up to cutoff if set
  const currTotal = currentCutoff != null
    ? currentData.slice(0, currentCutoff + 1).reduce((s, v) => s + v, 0)
    : currentData.reduce((s, v) => s + v, 0);
  const prevTotal = previousData.reduce((s, v) => s + v, 0);

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="summary-stat">
        <span class="summary-stat-label">${esc(summaryLabel)}</span>
        <div class="summary-stat-row">
          <span class="summary-stat-current">${fmtNum(currTotal)} tokens</span>
          ${makeSummaryDelta(currTotal, prevTotal)}
        </div>
      </div>
      <div class="summary-stat">
        <span class="summary-stat-label">${esc(prevLabel)}</span>
        <div class="summary-stat-row">
          <span class="summary-stat-current">${fmtNum(prevTotal)} tokens</span>
        </div>
      </div>
      <div class="summary-stat">
        <span class="summary-stat-label">Difference</span>
        <div class="summary-stat-row">
          <span class="summary-stat-current summary-diff ${currTotal > prevTotal ? "diff-up" : currTotal < prevTotal ? "diff-down" : ""}">${currTotal > prevTotal ? "+" : ""}${fmtNum(currTotal - prevTotal)} tokens</span>
        </div>
      </div>
    `;
  }
}

function makeSummaryDelta(cur, prev) {
  if (prev === 0 && cur === 0) return "";
  if (prev === 0) return '<span class="summary-stat-change change-up">new</span>';
  const change = ((cur - prev) / prev) * 100;
  if (Math.abs(change) < 0.5) return '<span class="summary-stat-change change-flat">~0%</span>';
  const rounded = Math.round(change);
  const cls = rounded > 0 ? "change-up" : "change-down";
  const sign = rounded > 0 ? "+" : "";
  return `<span class="summary-stat-change ${cls}">${sign}${rounded}%</span>`;
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

// ── Model Recommendation Engine ──

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

  if (buckets.opus.cost > 1) {
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

  if (buckets.haiku.tokens === 0 && totalTokens > 500_000) {
    cards.push(`<div class="opt-card">
      <div class="opt-card-header">
        <span class="opt-icon opt-warn">!</span>
        <span class="opt-title">Consider Haiku</span>
      </div>
      <p class="opt-body">You haven't used Haiku yet. For quick tasks like code formatting, simple refactors, or boilerplate generation, Haiku is ~19x cheaper than Opus and still very capable.</p>
    </div>`);
  }

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

// ── Token Breakdown (with inline labels) ──

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
    .map((s) => {
      const pct = ((s.value / total) * 100).toFixed(1);
      const showLabel = parseFloat(pct) > 8;
      return `<div class="breakdown-seg ${s.cls}" style="flex:${s.value}" data-tooltip="${s.label}: ${fmtNum(s.value)} (${pct}%)">
        ${showLabel ? `<span class="breakdown-seg-label">${pct}%</span>` : ""}
      </div>`;
    })
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

// ── Cost by Model ──

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

// ── Models (tabbed) ──

function renderModels(models, allTime) {
  const totalTokens = tokTotal(allTime);
  updateTabCount("models", models.length);
  const container = $("modelList");
  if (!models.length) {
    container.innerHTML = '<p class="empty-note">No model data.</p>';
    return;
  }

  const maxTokens = Math.max(...models.map((m) => tokTotal(m.totals)));
  container.innerHTML = '<div class="visual-list">' + models
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
    .join("") + '</div>';
}

// ── Projects (tabbed) ──

function renderProjects(projects, allTime) {
  const totalTokens = tokTotal(allTime);
  updateTabCount("projects", projects.length);
  const container = $("projectList");
  if (!projects.length) {
    container.innerHTML = '<p class="empty-note">No project data.</p>';
    return;
  }

  const maxTokens = Math.max(...projects.map((p) => tokTotal(p.totals)));
  container.innerHTML = '<div class="visual-list">' + projects
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
    .join("") + '</div>';
}

function updateTabCount(type, count) {
  const el = $("tabCount");
  if (!el) return;
  const activeTab = document.querySelector(".tab-btn.is-active");
  if (activeTab && activeTab.dataset.tab === type) {
    el.textContent = `${count} ${type}`;
  }
}

// ── Sessions (sortable table) ──

function renderSessions(sessions) {
  $("sessionCount").textContent = `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`;
  sessionData = sessions;
  renderSessionTable(sessions);
}

function renderSessionTable(sessions) {
  const tbody = $("sessionTableBody");
  if (!tbody) return;

  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-note">No sessions.</td></tr>';
    return;
  }

  // Sort
  const sorted = [...sessions].sort((a, b) => {
    let aVal, bVal;
    switch (sessionSortKey) {
      case "project":
        aVal = a.project || "";
        bVal = b.project || "";
        return sessionSortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      case "model":
        aVal = a.model || "";
        bVal = b.model || "";
        return sessionSortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      case "tokens":
        aVal = tokTotal(a.totals);
        bVal = tokTotal(b.totals);
        break;
      case "turns":
        aVal = a.totals?.turns || 0;
        bVal = b.totals?.turns || 0;
        break;
      case "cost":
        aVal = a.totals?.estimatedCostUsd || 0;
        bVal = b.totals?.estimatedCostUsd || 0;
        break;
      case "time":
        aVal = new Date(a.lastActivityAt || 0).getTime();
        bVal = new Date(b.lastActivityAt || 0).getTime();
        break;
      default:
        aVal = 0;
        bVal = 0;
    }
    return sessionSortDir === "asc" ? aVal - bVal : bVal - aVal;
  });

  tbody.innerHTML = sorted
    .map((s) => {
      const t = s.totals;
      const cost = t.estimatedCostUsd || 0;
      let costClass = "cost-low";
      if (cost >= 10) costClass = "cost-high";
      else if (cost >= 1) costClass = "cost-mid";
      return `<tr>
        <td class="session-project" title="${esc(s.project)}">${esc(shortProject(s.project))}</td>
        <td><span class="session-model">${esc(s.model || "unknown")}</span></td>
        <td>${fmtNum(tokTotal(t))}</td>
        <td>${fmtNum(t.turns)}</td>
        <td class="session-cost ${costClass}">${fmtCost(cost)}</td>
        <td class="session-time">${relativeTime(s.lastActivityAt)}</td>
      </tr>`;
    })
    .join("");
}

// ── Helpers ──

function summaryMeta(current, previous, label) {
  const parts = [`${fmtNum(current?.turns || 0)} turns`, fmtCost(current?.estimatedCostUsd || 0)];
  return parts.join(" · ");
}

function summaryMetaHtml(current, previous) {
  const parts = [`${fmtNum(current?.turns || 0)} turns`, fmtCost(current?.estimatedCostUsd || 0)];
  const badge = makeDeltaBadge(tokTotal(current), tokTotal(previous));
  return esc(parts.join(" · ")) + (badge ? ` ${badge}` : "");
}

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
