(() => {
  "use strict";

  const THEME_KEY = "claude-signal-theme";

  // The health page has no theme picker of its own, but it still has to honour
  // the theme chosen on the dashboard. THEMES comes from themes.js.
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    document.documentElement.dataset.theme = THEMES.has(saved) ? saved : "cozy";
  }

  const loadingEl = document.getElementById("loadingState");
  const contentEl = document.getElementById("pageContent");
  const refreshBtn = document.getElementById("refreshBtn");

  refreshBtn.addEventListener("click", load);

  // ── Rating thresholds ────────────────────────────────────────────────
  // A number on its own says nothing, so every scored metric declares which
  // direction is healthy and where the good/fair boundaries sit. dir "up"
  // means higher is better; "down" means lower is better.
  const SCORES = [
    {
      key: "first_pass_success_rate",
      label: "First-Pass Success",
      dir: "up",
      good: 0.8,
      fair: 0.6,
      format: pct,
      context: (d) =>
        `${count(d.first_pass_success_rate, d.tasks_completed)} of ${num(d.tasks_completed)} tasks passed first try`,
    },
    {
      key: "zero_repair_rate",
      label: "Zero-Repair Rate",
      dir: "up",
      good: 0.75,
      fair: 0.5,
      format: pct,
      context: (d) => `${count(d.zero_repair_rate, d.tasks_completed)} needed no fix-up pass`,
    },
    {
      key: "all_tests_pass_rate",
      label: "All Tests Pass",
      dir: "up",
      good: 0.9,
      fair: 0.75,
      format: pct,
      context: () => "Full suite green on the first run",
    },
    {
      key: "pr_merge_rate",
      label: "PR Merge Rate",
      dir: "up",
      good: 0.8,
      fair: 0.6,
      format: pct,
      context: (d) => `${num(d.prs_merged)} of ${num(d.prs_created)} PRs merged`,
    },
    {
      key: "human_intervention_rate",
      label: "Human Intervention",
      dir: "down",
      good: 0.15,
      fair: 0.3,
      format: pct,
      context: (d) =>
        `${count(d.human_intervention_rate, d.tasks_completed)} of ${num(d.tasks_completed)} needed help`,
    },
    {
      key: "avg_repair_attempts",
      label: "Avg Repair Attempts",
      dir: "down",
      good: 0.5,
      fair: 1,
      scale: 2, // the bar reads against 2 attempts, not 1
      format: (v) => (v == null ? "--" : v.toFixed(2)),
      context: () => "Per task before passing",
    },
    {
      key: "low_findings_rate",
      label: "Low-Severity Findings",
      dir: "up",
      good: 0.85,
      fair: 0.7,
      format: pct,
      context: (d) =>
        `${num(d.findings_high)} high-severity finding${d.findings_high === 1 ? "" : "s"}`,
    },
  ];

  const RATING_LABEL = { good: "Good", fair: "Fair", poor: "Poor", none: "n/a" };

  function rate(spec, v) {
    if (v == null) return "none";
    if (spec.dir === "up") return v >= spec.good ? "good" : v >= spec.fair ? "fair" : "poor";
    return v <= spec.good ? "good" : v <= spec.fair ? "fair" : "poor";
  }

  async function load() {
    loadingEl.hidden = false;
    contentEl.hidden = true;

    try {
      const res = await fetch("/api/health/metrics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      render(await res.json());
    } catch (err) {
      console.error("Failed to load health metrics:", err);
      renderFallback(err);
    }

    loadingEl.hidden = true;
    contentEl.hidden = false;
  }

  function render(d) {
    const scored = SCORES.map((spec) => ({
      spec,
      value: d[spec.key],
      rating: rate(spec, d[spec.key]),
    }));

    renderVerdict(d, scored);
    renderScores(d, scored);
    renderRisk(d);
    renderFindings(d);
    renderDelivery(d);
    renderUsage(d);
  }

  // ── Verdict ──────────────────────────────────────────────────────────
  function renderVerdict(d, scored) {
    const tally = { good: 0, fair: 0, poor: 0 };
    scored.forEach((s) => {
      if (s.rating in tally) tally[s.rating] += 1;
    });

    let verdict = "Healthy";
    let tone = "good";
    if (tally.poor > 0) {
      verdict = "Needs attention";
      tone = "poor";
    } else if (tally.fair > tally.good) {
      verdict = "Mixed";
      tone = "fair";
    }

    setText("verdictBadge", verdict);
    document.getElementById("verdict").dataset.tone = tone;
    document.getElementById("verdictTally").innerHTML =
      `<b class="t-good">${tally.good} good</b><em>·</em>` +
      `<b class="t-fair">${tally.fair} fair</b><em>·</em>` +
      `<b class="t-poor">${tally.poor} poor</b>`;

    setText("factTasks", num(d.tasks_completed));
    setText("factCommits", num(d.commits));
    setText("factCost", usd(d.total_estimated_cost_usd));
    setText("factTime", dur(d.total_duration_minutes));
  }

  // ── Scored metric cards ──────────────────────────────────────────────
  function renderScores(d, scored) {
    document.getElementById("scoreGrid").innerHTML = scored
      .map(({ spec, value, rating }) => {
        const fill = value == null ? 0 : clamp((value / (spec.scale || 1)) * 100);
        return `
        <article class="score-card" data-rating="${rating}">
          <header>
            <span class="score-label">${spec.label}</span>
            <span class="rating-chip">${RATING_LABEL[rating]}</span>
          </header>
          <strong class="score-value">${spec.format(value)}</strong>
          <div class="score-bar"><i style="width:${fill}%"></i></div>
          <p class="score-context">${spec.context(d)}</p>
        </article>`;
      })
      .join("");
  }

  // ── Risk and findings ────────────────────────────────────────────────
  function renderRisk(d) {
    const r = d.risk_distribution || {};
    document.getElementById("riskDistribution").innerHTML = barRows([
      ["Low", r.low ?? 0, "good"],
      ["Medium", r.medium ?? 0, "fair"],
      ["High", r.high ?? 0, "poor"],
    ]);
  }

  function renderFindings(d) {
    document.getElementById("findingsRows").innerHTML = barRows([
      ["Low", d.findings_low ?? 0, "good"],
      ["Medium", d.findings_medium ?? 0, "fair"],
      ["High", d.findings_high ?? 0, "poor"],
    ]);
  }

  function barRows(rows) {
    const total = rows.reduce((a, [, v]) => a + v, 0);
    if (!total) return `<p class="empty-note">Nothing recorded.</p>`;
    return rows
      .map(
        ([label, value, tone]) => `
      <div class="bar-row" data-tone="${tone}">
        <span class="bar-label">${label}</span>
        <div class="bar-track"><i style="width:${clamp((value / total) * 100)}%"></i></div>
        <span class="bar-value">${num(value)}<small>${Math.round((value / total) * 100)}%</small></span>
      </div>`
      )
      .join("");
  }

  // ── Delivery and usage ───────────────────────────────────────────────
  function renderDelivery(d) {
    const perTask =
      d.tasks_completed > 0 && d.total_estimated_cost_usd != null
        ? d.total_estimated_cost_usd / d.tasks_completed
        : null;
    document.getElementById("deliveryStats").innerHTML = statGrid([
      ["Tasks completed", num(d.tasks_completed)],
      ["Commits", num(d.commits)],
      ["PRs created", num(d.prs_created)],
      ["PRs merged", num(d.prs_merged)],
      ["Avg duration", dur(d.avg_duration_minutes)],
      ["Cost per task", perTask == null ? "--" : usd(perTask)],
    ]);
  }

  function renderUsage(d) {
    document.getElementById("usageStats").innerHTML = statGrid([
      ["Total tokens", fmt(d.total_tokens)],
      ["Input", fmt(d.total_input_tokens)],
      ["Output", fmt(d.total_output_tokens)],
      ["Cache", fmt(d.total_cache_tokens)],
      ["Estimated cost", usd(d.total_estimated_cost_usd)],
      ["Models used", num(d.models_used?.length)],
    ]);

    const parts = [
      ["Input", d.total_input_tokens ?? 0, "input"],
      ["Output", d.total_output_tokens ?? 0, "output"],
      ["Cache", d.total_cache_tokens ?? 0, "cache"],
    ];
    const total = parts.reduce((a, [, v]) => a + v, 0);
    const split = document.getElementById("tokenSplit");
    if (!total) {
      split.innerHTML = "";
      return;
    }
    split.innerHTML =
      `<div class="split-bar">` +
      parts
        .map(([, v, k]) => `<i data-kind="${k}" style="width:${(v / total) * 100}%"></i>`)
        .join("") +
      `</div><ul class="split-legend">` +
      parts
        .map(
          ([label, v, k]) =>
            `<li data-kind="${k}"><span>${label}</span><b>${fmt(v)}</b><small>${Math.round(
              (v / total) * 100
            )}%</small></li>`
        )
        .join("") +
      `</ul>`;
  }

  function statGrid(pairs) {
    return pairs.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
  }

  function renderFallback(err) {
    setText("verdictBadge", "Unavailable");
    document.getElementById("verdict").dataset.tone = "none";
    document.getElementById("verdictTally").textContent =
      "Could not reach /api/health/metrics" + (err ? ` — ${err.message}` : "");
    ["scoreGrid", "riskDistribution", "findingsRows", "deliveryStats", "usageStats", "tokenSplit"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<p class="empty-note">No data.</p>`;
      }
    );
  }

  // ── Formatting ───────────────────────────────────────────────────────
  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  function clamp(n) {
    return Math.max(0, Math.min(100, n));
  }

  function count(ratio, total) {
    if (ratio == null || total == null) return "--";
    return num(Math.round(ratio * total));
  }

  function num(v) {
    return v == null ? "--" : String(v);
  }

  function pct(v) {
    return v == null ? "--" : Math.round(v * 100) + "%";
  }

  function fmt(v) {
    if (v == null) return "--";
    if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return String(v);
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
    return h + "h" + (m ? " " + m + "m" : "");
  }

  initTheme();
  load();
})();
