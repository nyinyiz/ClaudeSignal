(() => {
  "use strict";

  const loadingEl = document.getElementById("loadingState");
  const contentEl = document.getElementById("pageContent");
  const refreshBtn = document.getElementById("refreshBtn");

  refreshBtn.addEventListener("click", load);

  async function load() {
    loadingEl.hidden = false;
    contentEl.hidden = true;

    try {
      const res = await fetch("/api/health/metrics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(data);
    } catch (err) {
      console.error("Failed to load health metrics:", err);
      renderFallback();
    }
  }

  function render(d) {
    // Hero metrics
    setText("metricFirstPass", pct(d.first_pass_success_rate));
    setText("metricRepairs", d.avg_repair_attempts?.toFixed(1) ?? "--");
    setText("metricMergeRate", pct(d.pr_merge_rate));
    setText("metricHuman", pct(d.human_intervention_rate));

    // Usage & cost
    setText("statTotalTokens", fmt(d.total_tokens));
    setText("statInputTokens", fmt(d.total_input_tokens));
    setText("statOutputTokens", fmt(d.total_output_tokens));
    setText("statCacheTokens", fmt(d.total_cache_tokens));
    setText("statCost", usd(d.total_estimated_cost_usd));
    setText("statModels", d.models_used?.length ?? "--");

    // Quality gauges
    setGauge("gaugeFirstPassFill", "gaugeFirstPassVal", d.first_pass_success_rate);
    setGauge("gaugeZeroRepairFill", "gaugeZeroRepairVal", d.zero_repair_rate);
    setGauge("gaugeLowFindingsFill", "gaugeLowFindingsVal", d.low_findings_rate);

    // Reliability gauges
    setGauge("gaugeMergeRateFill", "gaugeMergeRateVal", d.pr_merge_rate);
    setGauge("gaugeNoInterventionFill", "gaugeNoInterventionVal", 1 - d.human_intervention_rate);
    setGauge("gaugeAllTestsPassFill", "gaugeAllTestsPassVal", d.all_tests_pass_rate);

    // Risk distribution
    renderRisk(d.risk_distribution);

    // Productivity
    setText("statTasksCompleted", d.tasks_completed ?? "--");
    setText("statTotalDuration", dur(d.total_duration_minutes));
    setText("statAvgDuration", dur(d.avg_duration_minutes));
    setText("statCommits", d.commits ?? "--");
    setText("statPRsCreated", d.prs_created ?? "--");
    setText("statPRsMerged", d.prs_merged ?? "--");

    // Review findings
    setText("findingsHigh", d.findings_high ?? 0);
    setText("findingsMedium", d.findings_medium ?? 0);
    setText("findingsLow", d.findings_low ?? 0);
    setText("findingsTotal", (d.findings_high ?? 0) + (d.findings_medium ?? 0) + (d.findings_low ?? 0));

    loadingEl.hidden = true;
    contentEl.hidden = false;
  }

  function renderRisk(dist) {
    const el = document.getElementById("riskDistribution");
    if (!dist || !el) return;

    const total = (dist.low ?? 0) + (dist.medium ?? 0) + (dist.high ?? 0);
    if (total === 0) {
      el.innerHTML = '<p class="health-empty">No tasks recorded yet</p>';
      return;
    }

    const levels = [
      { label: "Low", value: dist.low ?? 0, color: "var(--green)" },
      { label: "Medium", value: dist.medium ?? 0, color: "var(--primary-2)" },
      { label: "High", value: dist.high ?? 0, color: "var(--red)" },
    ];

    el.innerHTML = levels
      .map((l) => {
        const pctVal = ((l.value / total) * 100).toFixed(0);
        return `
        <div class="health-bar-row">
          <span class="health-bar-label">${l.label}</span>
          <div class="health-bar-track">
            <div class="health-bar-fill" style="width:${pctVal}%;background:${l.color}"></div>
          </div>
          <span class="health-bar-value">${l.value} (${pctVal}%)</span>
        </div>`;
      })
      .join("");
  }

  function renderFallback() {
    loadingEl.hidden = true;
    contentEl.hidden = false;
    contentEl.innerHTML =
      '<p class="health-empty">No data available. Start using ClaudeSignal to collect metrics.</p>';
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function setGauge(fillId, valId, rate) {
    const fill = document.getElementById(fillId);
    const valEl = document.getElementById(valId);
    if (!fill || !valEl) return;
    const clamped = Math.max(0, Math.min(1, rate ?? 0));
    const circumference = 2 * Math.PI * 42;
    fill.style.strokeDasharray = `${circumference}`;
    fill.style.strokeDashoffset = `${circumference * (1 - clamped)}`;
    valEl.textContent = pct(clamped);
  }

  function pct(v) {
    if (v == null) return "--";
    return (v * 100).toFixed(0) + "%";
  }

  function fmt(n) {
    if (n == null) return "--";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }

  function usd(v) {
    if (v == null) return "--";
    return "$" + v.toFixed(2);
  }

  function dur(mins) {
    if (mins == null) return "--";
    if (mins < 60) return mins.toFixed(0) + "m";
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h + "h " + m + "m";
  }

  load();
})();
