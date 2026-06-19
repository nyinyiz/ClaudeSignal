const state = {
  socket: null,
  reconnectDelay: 500,
  snapshot: null,
  usage: null,
  history: null,
  usageFetchInFlight: false,
  historyFetchInFlight: false,
  nextHistoryRefreshAt: null,
  isUnloading: false,
  connected: false,
  lastStatus: null,
  catPlayTimeout: null,
  settingsTrigger: null,
};

const THEME_KEY = "claude-signal-theme";
const USAGE_REFRESH_INTERVAL_MS = 10000;
const THEMES = new Set(["cozy", "matcha", "graphite", "ember"]);
const MOOD_THRESHOLDS = [
  { minTokens: 45_000_000, name: "overload", pressure: "critical" },
  { minTokens: 25_000_000, name: "tired", pressure: "high" },
  { minTokens: 15_000_000, name: "busy", pressure: "medium" },
  { minTokens: 6_000_000, name: "focus", pressure: "medium" },
  { minTokens: 1_000_000, name: "curious", pressure: "low" },
];

const moodMeta = {
  calm: [":)", "Calm"],
  curious: ["?", "Curious"],
  focus: [">_", "Focus"],
  busy: ["//", "Busy"],
  tired: ["zz", "Tired"],
  overload: ["!", "Overload"],
  sleeping: ["zz", "Sleeping"],
};

const emotionHTML = {
  offline: '<span class="ez">z</span><span class="ez">z</span><span class="ez">z</span>',
  idle: '<span class="ez">z</span><span class="ez">z</span><span class="ez">z</span>',
  sleeping: '<span class="ez">z</span><span class="ez">z</span><span class="ez">z</span>',
  tired: '<span class="ez">rest</span><span class="ez">z</span><span class="ez">z</span>',
  focus: '',
  busy: '!',
  curious: '?',
  overload: '?',
};

const emotionTypes = {
  offline: "zzz",
  idle: "zzz",
  sleeping: "zzz",
  tired: "zzz",
  focus: null,
  busy: "excite",
  curious: "question",
  overload: "question",
};

const moodAuraGlyphs = {
  sleeping: ["z", "moon", "z", "...", "sleep", "z", "moon", "...", "z"],
  calm: ["dot", "breathe", "dot", "~", "rest", "dot", "~", "soft", "dot"],
  curious: ["?", "look", "?", "!", "hmm", "?", "...", "why", "?"],
  focus: ["0101", "fn()", "</>", "1010", "git", "const", "0110", "{ }", "&&"],
  busy: ["> run", "build", "&&", "ship", "test", "git", "$", "loop", "ok"],
  tired: ["rest", "z", "...", "pause", "z", "slow", "...", "zz", "rest"],
  overload: ["!", "WARN", "!!!", "429", "HOT", "!!", "LIMIT", "X", "!"],
};

const $ = (id) => document.getElementById(id);

async function boot() {
  window.addEventListener("beforeunload", () => {
    state.isUnloading = true;
  });
  initTheme();
  initSettings();

  try {
    const response = await fetch("/api/status");
    state.snapshot = await response.json();
    renderSnapshot();
  } catch (error) {
    console.warn("Initial status fetch failed", error);
  }

  await Promise.all([fetchCurrentUsage(), fetchHistory()]);
  updateCatMood();

  connect();
  setInterval(renderSnapshot, 1000);
  setInterval(fetchCurrentUsage, USAGE_REFRESH_INTERVAL_MS);
  setInterval(fetchHistory, USAGE_REFRESH_INTERVAL_MS);
  setInterval(renderRefreshCountdown, 1000);
  setInterval(renderWorldTime, 1000);
  renderWorldTime();
  renderRefreshCountdown();
  initCatInteractions();
}

function initTheme() {
  const select = $("themeSelect");
  const saved = localStorage.getItem(THEME_KEY);
  const initialTheme = THEMES.has(saved) ? saved : "cozy";
  setTheme(initialTheme, false);

  if (select) {
    select.addEventListener("change", () => {
      setTheme(select.value);
    });
  }

  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      setTheme(button.dataset.themeChoice);
    });
  });
}

function setTheme(theme, persist = true) {
  const normalized = THEMES.has(theme) ? theme : "cozy";
  document.documentElement.dataset.theme = normalized;
  if (persist) localStorage.setItem(THEME_KEY, normalized);
  syncThemeControls(normalized);
}

function syncThemeControls(theme) {
  const select = $("themeSelect");
  if (select && select.value !== theme) select.value = theme;

  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const selected = button.dataset.themeChoice === theme;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
    const helper = button.querySelector("em");
    if (helper) helper.textContent = selected ? "Currently active" : themeCardSubtitle(button.dataset.themeChoice);
  });
}

function themeCardSubtitle(theme) {
  const subtitles = {
    cozy: "Current default",
    matcha: "Green low-light",
    graphite: "Quiet slate",
    ember: "Warm contrast",
  };
  return subtitles[theme] || "Dashboard theme";
}

function initSettings() {
  const openButton = $("settingsOpen");
  const closeButton = $("settingsClose");
  const overlay = $("settingsOverlay");
  if (!openButton || !closeButton || !overlay) return;

  openButton.addEventListener("click", () => openSettings(openButton));
  closeButton.addEventListener("click", closeSettings);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeSettings();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) closeSettings();
  });
}

function openSettings(trigger) {
  const overlay = $("settingsOverlay");
  const closeButton = $("settingsClose");
  if (!overlay) return;
  state.settingsTrigger = trigger || document.activeElement;
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("settings-open");
  syncThemeControls(document.documentElement.dataset.theme || "cozy");
  closeButton?.focus();
}

function closeSettings() {
  const overlay = $("settingsOverlay");
  if (!overlay) return;
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("settings-open");
  state.settingsTrigger?.focus?.();
}

async function fetchHistory() {
  if (state.historyFetchInFlight) return;
  state.historyFetchInFlight = true;
  renderRefreshCountdown();
  try {
    const response = await fetch("/api/usage/history", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.history = await response.json();
    renderHistory();
  } catch (error) {
    logFetchWarning("Usage history fetch failed", error);
  } finally {
    state.historyFetchInFlight = false;
    state.nextHistoryRefreshAt = Date.now() + USAGE_REFRESH_INTERVAL_MS;
    renderRefreshCountdown();
  }
}

async function fetchCurrentUsage() {
  if (state.usageFetchInFlight) return;
  state.usageFetchInFlight = true;
  try {
    const response = await fetch("/api/usage", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.usage = payload.usage || null;
    renderUsage();
  } catch (error) {
    logFetchWarning("Usage fetch failed", error);
  } finally {
    state.usageFetchInFlight = false;
  }
}

function logFetchWarning(message, error) {
  if (state.isUnloading) return;
  console.warn(message, error);
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    state.reconnectDelay = 500;
    setConnection(true);
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "status") {
      state.snapshot = message.data;
      renderSnapshot();
    } else if (message.type === "usage") {
      state.usage = message.data;
      renderUsage();
    }
  });

  socket.addEventListener("close", reconnect);
  socket.addEventListener("error", () => socket.close());
}

function reconnect() {
  setConnection(false);
  const delay = state.reconnectDelay;
  state.reconnectDelay = Math.min(state.reconnectDelay * 1.7, 6000);
  setTimeout(connect, delay);
}

function setConnection(connected) {
  state.connected = connected;
  $("connection").classList.toggle("connected", connected);
  $("connection").classList.toggle("disconnected", !connected);
  $("connectionText").textContent = connected ? "Online" : "Offline";
}

function renderUsage() {
  const usage = state.usage;
  const panel = $("usagePanel");
  if (!panel) return;

  panel.classList.toggle("usage-empty", !usage);
  panel.classList.toggle("usage-stale", Boolean(usage && usageIsStale(usage)));

  if (!usage) {
    $("usageModel").textContent = "Waiting for Claude";
    $("usageUpdated").textContent = "No data";
    $("usageNote").textContent = "Connect Claude Code status line to show real context and limit data.";
    setMeter("contextFill", "contextPercentText", null);
    setMeter("fiveHourFill", "fiveHourText", null);
    setMeter("sevenDayFill", "sevenDayText", null);
    $("contextDetail").textContent = "Start the dashboard server to stream usage.";
    $("fiveHourReset").textContent = "Reset unknown";
    $("sevenDayReset").textContent = "Reset unknown";
    $("inputTokenText").textContent = "--";
    $("outputTokenText").textContent = "--";
    $("cacheTokenText").textContent = "--";
    $("costText").textContent = "--";
    return;
  }

  const stale = usageIsStale(usage);
  $("usageModel").textContent = usage.modelName || "Claude session";
  $("usageUpdated").textContent = stale ? `Stale · ${relativeTime(usage.updatedAt)}` : `Updated ${relativeTime(usage.updatedAt)}`;
  $("usageNote").textContent = usageNote(usage, stale);
  setMeter("contextFill", "contextPercentText", usage.contextPercentUsed);
  setMeter("fiveHourFill", "fiveHourText", usage.fiveHourPercent);
  setMeter("sevenDayFill", "sevenDayText", usage.sevenDayPercent);
  $("contextDetail").textContent = contextDetail(usage);
  $("fiveHourReset").textContent = limitDetail(usage.fiveHourPercent, usage.fiveHourResetsAt);
  $("sevenDayReset").textContent = limitDetail(usage.sevenDayPercent, usage.sevenDayResetsAt);
  $("inputTokenText").textContent = formatNumber(usage.inputTokens);
  $("outputTokenText").textContent = formatNumber(usage.outputTokens);
  $("cacheTokenText").textContent = formatNumber(sumDefined(usage.cacheCreationTokens, usage.cacheReadTokens));
  $("costText").textContent = formatCost(usage.sessionCostUsd);
}

function setMeter(fillId, textId, value) {
  const normalized = clampPercent(value);
  $(fillId).style.width = normalized == null ? "0%" : `${normalized}%`;
  $(textId).textContent = normalized == null ? "--" : `${Math.round(normalized)}%`;
}

function renderHistory() {
  const history = state.history;
  const panel = $("historyPanel");
  if (!panel || !history) return;

  const hasTurns = (history.turns || 0) > 0;
  panel.classList.toggle("history-empty", !hasTurns);
  $("historyUpdated").textContent = hasTurns ? `Scanned ${relativeTime(history.generatedAt)}` : "No transcripts";
  $("historyNote").textContent = hasTurns
    ? `${history.transcriptFiles} transcript files · ${history.turns} assistant turns`
    : "No Claude Code usage transcripts found on this Mac yet.";

  renderHistoryTotals("historyToday", history.today);
  renderHistoryTotals("historyWeek", history.week);
  renderHistoryTotals("historyAll", history.allTime);
  renderActivityChart(history.dailyActivity || []);
  renderUsageRows("historyModels", history.byModel || [], "model");
  renderUsageRows("historyProjects", history.topProjects || [], "project");
  renderSessionRows(history.recentSessions || []);
  updateCatMood();
}

function renderRefreshCountdown() {
  const countdown = $("historyCountdown");
  if (!countdown) return;
  const value = $("historyCountdownValue");
  const ring = $("historyCountdownRing");
  const totalSeconds = Math.round(USAGE_REFRESH_INTERVAL_MS / 1000);

  if (state.historyFetchInFlight) {
    if (value) value.textContent = "0";
    if (ring) ring.style.strokeDashoffset = "0";
    countdown.setAttribute("aria-label", "Refreshing usage data");
    countdown.classList.add("is-refreshing");
    return;
  }

  countdown.classList.remove("is-refreshing");
  if (!state.nextHistoryRefreshAt) {
    if (value) value.textContent = String(totalSeconds);
    if (ring) ring.style.strokeDashoffset = "0";
    countdown.setAttribute("aria-label", `Next usage scan in ${totalSeconds} seconds`);
    return;
  }

  const remainingMs = Math.max(0, state.nextHistoryRefreshAt - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const elapsedRatio = Math.min(1, Math.max(0, 1 - remainingMs / USAGE_REFRESH_INTERVAL_MS));
  if (value) value.textContent = String(remainingSeconds);
  if (ring) ring.style.strokeDashoffset = String(Math.round(elapsedRatio * 100));
  countdown.setAttribute("aria-label", `Next usage scan in ${remainingSeconds} seconds`);
}

function renderHistoryTotals(prefix, totals) {
  $(`${prefix}Tokens`).textContent = formatTokenTotal(totals);
  $(`${prefix}Meta`).textContent = `${formatNumber(totals?.turns || 0)} turns · ${formatCost(totals?.estimatedCostUsd || 0)}`;
}

function renderActivityChart(rows) {
  const chart = $("activityChart");
  if (!chart) return;

  const visible = normalizeActivityRows(rows);
  const tokenValues = visible.map((row) => tokenTotal(row.totals));
  const requestValues = visible.map((row) => row.totals?.turns || 0);
  const maxTokens = Math.max(...tokenValues, 1);
  const maxRequests = Math.max(...requestValues, 1);
  const tokenPoints = tokenValues.map((value, index) => chartPoint(index, value, maxTokens, 30, 176));
  const requestPoints = requestValues.map((value, index) => chartPoint(index, value, maxRequests, 92, 190));

  $("tokensLine")?.setAttribute("d", smoothPath(tokenPoints));
  $("requestsLine")?.setAttribute("d", smoothPath(requestPoints));
  $("tokensArea")?.setAttribute("d", areaPath(tokenPoints, 208));
  $("requestsArea")?.setAttribute("d", areaPath(requestPoints, 208));

  const days = $("activityDays");
  if (days) {
    days.innerHTML = visible.map((row) => `<span>${escapeHtml(row.label || "--")}</span>`).join("");
  }
}

function normalizeActivityRows(rows) {
  if (rows.length >= 7) return rows.slice(-7);
  const labels = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  return labels.map((label, index) => rows[index] || { label, totals: {} });
}

function chartPoint(index, value, maxValue, top, bottom) {
  const x = index * (1000 / 6);
  const ratio = maxValue === 0 ? 0 : value / maxValue;
  const y = bottom - ratio * (bottom - top);
  return { x, y };
}

function smoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const controlX = previous.x + (point.x - previous.x) / 2;
    return `${path} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`;
  }, "");
}

function areaPath(points, baseline) {
  if (points.length === 0) return "";
  return `${smoothPath(points)} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
}

function renderUsageRows(id, rows, labelField) {
  const container = $(id);
  if (!container) return;
  const visible = rows.slice(0, 4);
  if (visible.length === 0) {
    container.innerHTML = '<article><span>No data</span><strong>--</strong><div class="usage-bar"><i></i></div><p>Run Claude Code to create transcripts.</p></article>';
    return;
  }
  const maxTokens = Math.max(...visible.map((row) => tokenTotal(row.totals)), 1);
  container.innerHTML = visible.map((row) => {
    const label = escapeHtml(row[labelField] || "unknown");
    const percent = Math.max(8, Math.round((tokenTotal(row.totals) / maxTokens) * 100));
    return `<article><span>${label}</span><strong>${formatTokenTotal(row.totals)}</strong><div class="usage-bar"><i style="--bar:${percent}%"></i></div><p>${formatNumber(row.totals.turns || 0)} turns · ${formatCost(row.totals.estimatedCostUsd || 0)}</p></article>`;
  }).join("");
}

function renderSessionRows(rows) {
  const container = $("historySessions");
  if (!container) return;
  const visible = rows.slice(0, 5);
  if (visible.length === 0) {
    container.innerHTML = '<article><span class="session-dot"></span><div><span class="session-kicker">No sessions</span><strong>--</strong><p>Claude Code transcripts will appear here.</p></div></article>';
    return;
  }
  container.innerHTML = visible.map((session) => (
    `<article><span class="session-dot"></span><div><span class="session-kicker">${escapeHtml(shortProject(session.project || "unknown"))} · ${relativeTime(session.lastActivityAt)}</span><strong>${formatTokenTotal(session.totals)}</strong><p>${formatNumber(session.totals.turns || 0)} turns · ${formatCost(session.totals.estimatedCostUsd || 0)}</p></div></article>`
  )).join("");
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  if (!snapshot) return;

  updateCatMood();
}

// === Emotion Emoji ===

function setEmotionEmoji(status) {
  const el = document.getElementById("emotionEmoji");
  if (!el) return;

  const type = emotionTypes[status];
  const html = emotionHTML[status];

  if (type && html) {
    el.setAttribute("data-emotion", type);
    el.innerHTML = html;
  } else {
    el.removeAttribute("data-emotion");
    el.innerHTML = "";
  }
}

function updateCatMood() {
  const panel = $("statusPanel");
  const stage = document.querySelector(".cat-stage");
  if (!panel || !stage) return;

  const mood = catMoodFromState();
  stage.dataset.mood = mood.name;
  stage.dataset.pressure = mood.pressure;
  panel.dataset.catMood = mood.name;
  panel.className = `hero-card usage-${mood.name}`;
  const meta = moodMeta[mood.name] || moodMeta.calm;
  $("statusIcon").textContent = meta[0];
  $("statusText").textContent = meta[1];
  $("statusDescription").textContent = catBriefing(mood);
  setEmotionEmoji(mood.name);
  setMoodAura(mood.name);
}

function setMoodAura(moodName) {
  const aura = $("moodAura");
  if (!aura) return;

  const glyphs = moodAuraGlyphs[moodName] || moodAuraGlyphs.calm;
  aura.dataset.mood = moodName;
  aura.querySelectorAll("span").forEach((node, index) => {
    node.textContent = glyphs[index % glyphs.length];
  });
}

function catBriefing(mood) {
  const history = state.history;
  if (!history || !history.turns) {
    return `${greeting()} No Claude Code usage history found yet. The cat is waiting for local transcripts.`;
  }

  const today = tokenTotal(history.today);
  const week = tokenTotal(history.week);
  const allTime = tokenTotal(history.allTime);
  const weekShare = ratioPercent(today, week);
  const allShare = ratioPercent(today, allTime);
  const turnText = formatNumber(history.today?.turns || 0);
  const costText = formatCost(history.today?.estimatedCostUsd || 0);
  if (today === 0) {
    return `${greeting()} You have not used any Claude Code tokens today yet. This week and all-time history are still tracked below. The cat is rested and waiting for the first session.`;
  }
  return `${greeting()} You used ${formatNumber(today)} tokens today across ${turnText} turns (${costText}). That's ${weekShare} of this week and ${allShare} of all-time usage. ${catMoodSentence(mood.name)}`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

function ratioPercent(value, total) {
  if (!value || !total) return "0%";
  const percent = Math.min(999, Math.max(0, (value / total) * 100));
  if (percent > 99) return `${Math.round(percent)}%`;
  if (percent >= 10) return `${Math.round(percent)}%`;
  return `${percent.toFixed(1)}%`;
}

function catMoodSentence(moodName) {
  const lines = {
    calm: "The cat is calm because today's usage is light.",
    curious: "The cat is curious, but the day still looks balanced.",
    focus: "The cat is focused; usage is picking up.",
    busy: "The cat is busy; today is active, but still under the tired zone.",
    tired: "The cat is tired because today's usage is now genuinely heavy.",
    overload: "The cat is overloaded; consider pacing the next session.",
    sleeping: "The cat is sleeping because there is not enough usage history yet.",
  };
  return lines[moodName] || "The cat is watching the signal.";
}

function catMoodFromState() {
  const today = tokenTotal(state.history?.today);
  if (!state.history || !state.history.turns || today === 0) {
    return { name: "sleeping", pressure: "low" };
  }

  const threshold = MOOD_THRESHOLDS.find((item) => today >= item.minTokens);
  if (threshold) {
    return { name: threshold.name, pressure: threshold.pressure };
  }

  return { name: "calm", pressure: "low" };
}

// === Cat Interactions ===

function initCatInteractions() {
  const scene = document.querySelector(".cat-stage");
  if (!scene) return;

  scene.addEventListener("mousemove", (e) => {
    const rect = scene.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    scene.style.setProperty("--look-x", `${(x - 0.5) * 7}px`);
    scene.style.setProperty("--look-y", `${(y - 0.5) * 5}px`);

    scene.querySelectorAll(".cat-eye").forEach((eye) => {
      eye.style.transform = `translate(${(x - 0.5) * 3}px, ${(y - 0.5) * 2}px)`;
    });
  });

  scene.addEventListener("mouseleave", () => {
    scene.style.setProperty("--look-x", "0px");
    scene.style.setProperty("--look-y", "0px");
    scene.querySelectorAll(".cat-eye").forEach((eye) => {
      eye.style.transform = "";
    });
  });

  scene.addEventListener("click", () => {
    scene.classList.remove("cat-play");
    void scene.offsetWidth;
    scene.classList.add("cat-play");
    clearTimeout(state.catPlayTimeout);
    state.catPlayTimeout = setTimeout(() => scene.classList.remove("cat-play"), 900);
  });

  scene.addEventListener("touchstart", () => {
    scene.classList.add("hovering");
  }, { passive: true });

  scene.addEventListener("touchend", () => {
    setTimeout(() => scene.classList.remove("hovering"), 1500);
  }, { passive: true });

  updateCatMood();
}

// === Helpers ===

function relativeTime(value) {
  if (!value) return "--";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function formatTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function contextDetail(usage) {
  const used = formatNumber(usage.contextTokensUsed);
  const remaining = formatNumber(usage.contextTokensRemaining);
  const size = formatNumber(usage.contextWindowSize);
  if (used !== "--" && remaining !== "--" && size !== "--") return `${used} used · ${remaining} left · ${size} window`;
  if (used !== "--" && remaining !== "--") return `${used} used · ${remaining} left`;
  if (used !== "--") return `${used} context tokens used`;
  if (remaining !== "--") return `${remaining} context tokens left`;
  return "Waiting for Claude's first API response";
}

function usageNote(usage, stale = false) {
  if (stale) {
    return "This usage snapshot is stale. Restart the dashboard or rerun the installer so Claude Code can stream status-line data.";
  }
  if (usage.contextPercentUsed == null && usage.inputTokens == null && usage.outputTokens == null) {
    return "Claude is connected; usage appears after the first API response.";
  }
  if (usage.fiveHourPercent == null && usage.sevenDayPercent == null) {
    return "Showing context usage. Rate-limit percentages are unavailable for this account/session.";
  }
  return "Live from Claude Code status line. Current session and weekly limits mirror Claude's plan usage windows.";
}

function limitDetail(percent, value) {
  if (percent == null) return "Unavailable until Claude sends subscriber rate data";
  return resetText(value);
}

function resetText(value) {
  if (!value) return "Reset unknown";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return `Resets ${value}`;
  const seconds = Math.max(0, Math.floor((time - Date.now()) / 1000));
  if (seconds === 0) return "Reset due now";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 24) return `Resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${minutes}m`;
}

function clampPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function usageIsStale(usage) {
  if (!usage?.updatedAt) return true;
  const updatedAt = new Date(usage.updatedAt).getTime();
  if (Number.isNaN(updatedAt)) return true;
  return Date.now() - updatedAt > 2 * 60 * 1000;
}

function formatNumber(value) {
  if (typeof value !== "number") return "--";
  return new Intl.NumberFormat([], { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function formatTokenTotal(totals) {
  if (!totals) return "--";
  return `${formatNumber(tokenTotal(totals))} tokens`;
}

function tokenTotal(totals) {
  if (!totals) return 0;
  return (totals.inputTokens || 0) +
    (totals.outputTokens || 0) +
    (totals.cacheReadTokens || 0) +
    (totals.cacheCreationTokens || 0);
}

function formatCost(value) {
  if (typeof value !== "number") return "--";
  return `$${value.toFixed(value < 1 ? 2 : 1)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function sumDefined(...values) {
  const numbers = values.filter((value) => typeof value === "number");
  if (numbers.length === 0) return null;
  return numbers.reduce((total, value) => total + value, 0);
}

function shortProject(project) {
  const parts = String(project).split("/").filter(Boolean);
  if (parts.length === 0) return "unknown";
  return parts[parts.length - 1];
}

function renderWorldTime() {
  setClock("timeThailand", "Asia/Bangkok");
  setClock("timeUk", "Europe/London");
  setClock("timeHongKong", "Asia/Hong_Kong");
  setClock("timeCanada", "America/Toronto");
}

function setClock(id, timeZone) {
  const element = $(id);
  if (!element) return;
  element.textContent = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date());
}

boot();
