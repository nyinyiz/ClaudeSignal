const state = {
  socket: null,
  reconnectDelay: 500,
  snapshot: null,
  connected: false,
  lastStatus: null,
  idleTimer: null,
  idleAnimTimeout: null,
};

const statusMeta = {
  offline: [">_", "Offline", "ClaudeSignal is not attached to a Claude terminal."],
  idle: ["zz", "Idle", "Claude is quiet and ready for the next move."],
  starting: ["◉", "Starting", "ClaudeSignal is attaching to this terminal."],
  working: ["✦", "Working", "Claude is active in your terminal."],
  thinking: ["...", "Thinking", "No recent activity. Claude may be planning."],
  waiting_input: ["⌨", "Need Input", "Claude needs your answer in the terminal."],
  completed: ["✓", "Done", "Claude finished this session."],
  error: ["!", "Error", "Claude or the monitor hit an error."],
  session_limit: ["△", "Limit Hit", "Claude appears to have hit a usage limit."],
};

const emotionHTML = {
  offline: '<span class="ez">z</span><span class="ez">z</span><span class="ez">z</span>',
  idle: '<span class="ez">z</span><span class="ez">z</span><span class="ez">z</span>',
  starting: '!',
  working: '',
  thinking: '',
  waiting_input: '',
  completed: '<span class="heart">♥</span><span class="heart">♥</span><span class="heart">♥</span>',
  error: '💧',
  session_limit: '?',
};

const emotionTypes = {
  offline: "zzz",
  idle: "zzz",
  starting: "excite",
  working: null,
  thinking: null,
  waiting_input: null,
  completed: "hearts",
  error: "sweat",
  session_limit: "question",
};

const $ = (id) => document.getElementById(id);

async function boot() {
  try {
    const response = await fetch("/api/status");
    state.snapshot = await response.json();
    renderSnapshot();
  } catch (error) {
    console.warn("Initial status fetch failed", error);
  }

  connect();
  setInterval(renderSnapshot, 1000);
  initCatInteractions();
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
      const prevStatus = state.snapshot?.status;
      state.snapshot = message.data;
      renderSnapshot();
      if (prevStatus !== message.data.status) {
        onStatusChange(prevStatus, message.data.status);
      }
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
  $("healthConnection").textContent = connected ? "Online" : "Offline";
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const meta = statusMeta[snapshot.status] || statusMeta.offline;
  $("statusIcon").textContent = meta[0];
  $("statusText").textContent = meta[1];
  $("statusDescription").textContent = meta[2];
  $("statusPanel").className = `hero-card status-${snapshot.status}`;
  $("durationText").textContent = formatDuration(currentDuration(snapshot));
  $("activityText").textContent = relativeTime(snapshot.lastActivityAt);
  $("sessionText").textContent = shortSession(snapshot.sessionId);
  $("projectText").textContent = projectName(snapshot);
  $("startedText").textContent = formatTime(snapshot.startedAt);
  $("runningText").textContent = snapshot.isClaudeRunning ? "Running" : "Stopped";
  $("monitorText").textContent = snapshot.startedAt ? "Attached" : "Standby";

  document.querySelectorAll(".state-tile").forEach((tile) => {
    tile.classList.toggle("active", tile.dataset.status === snapshot.status);
  });
}

function onStatusChange(prev, next) {
  clearIdleAnimations();
  setEmotionEmoji(next);

  if (next === "completed") {
    spawnConfetti();
  }

  if (next === "idle" || next === "offline") {
    startIdleAnimations();
  }
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

// === Cat Interactions ===

function initCatInteractions() {
  const scene = document.querySelector(".cat-scene");
  if (!scene) return;

  scene.addEventListener("mousemove", (e) => {
    const rect = scene.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const shines = scene.querySelectorAll(".eye-shine");
    shines.forEach((shine) => {
      shine.style.transform = `translate(${(x - 0.5) * 4}px, ${(y - 0.5) * 3}px)`;
    });

    const smallShines = scene.querySelectorAll(".eye-shine-small");
    smallShines.forEach((shine) => {
      shine.style.transform = `translate(${(x - 0.5) * 2}px, ${(y - 0.5) * 1.5}px)`;
    });
  });

  scene.addEventListener("touchstart", () => {
    scene.classList.add("hovering");
  }, { passive: true });

  scene.addEventListener("touchend", () => {
    setTimeout(() => scene.classList.remove("hovering"), 1500);
  }, { passive: true });

  const snapshot = state.snapshot;
  if (snapshot) {
    setEmotionEmoji(snapshot.status);

    if (snapshot.status === "idle" || snapshot.status === "offline") {
      startIdleAnimations();
    }
  }
}

// === Idle Personality Animations ===

const idleAnimations = ["idle-yawn", "idle-stretch", "idle-groom", "idle-bat"];
let idleActive = false;

function startIdleAnimations() {
  if (idleActive) return;
  idleActive = true;
  scheduleNextIdleAnim();
}

function scheduleNextIdleAnim() {
  if (!idleActive) return;
  const delay = 5000 + Math.random() * 8000;
  state.idleTimer = setTimeout(() => {
    if (!idleActive) return;
    playRandomIdleAnim();
    scheduleNextIdleAnim();
  }, delay);
}

function playRandomIdleAnim() {
  const cat = document.querySelector(".cat");
  if (!cat) return;

  const anim = idleAnimations[Math.floor(Math.random() * idleAnimations.length)];
  cat.classList.add(anim);

  const duration = anim === "idle-yawn" ? 2000 : anim === "idle-stretch" ? 1500 : 1200;
  state.idleAnimTimeout = setTimeout(() => {
    cat.classList.remove(anim);
  }, duration);
}

function clearIdleAnimations() {
  idleActive = false;
  clearTimeout(state.idleTimer);
  clearTimeout(state.idleAnimTimeout);
  const cat = document.querySelector(".cat");
  if (cat) {
    idleAnimations.forEach((anim) => cat.classList.remove(anim));
  }
}

// === Confetti ===

function spawnConfetti() {
  const container = document.querySelector(".confetti-container");
  if (!container) return;
  container.innerHTML = "";

  const colors = ["#ff985f", "#ffc08f", "#62d887", "#ffd76f", "#ff7474", "#ffcf9a", "#ffb8a0"];

  for (let i = 0; i < 30; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti";
    piece.style.left = `${25 + Math.random() * 50}%`;
    piece.style.top = `${15 + Math.random() * 35}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${0.7 + Math.random() * 0.8}s`;
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    piece.style.width = `${4 + Math.random() * 5}px`;
    piece.style.height = `${4 + Math.random() * 5}px`;
    container.appendChild(piece);
  }

  setTimeout(() => {
    container.innerHTML = "";
  }, 2500);
}

// === Helpers ===

function currentDuration(snapshot) {
  if (!snapshot.startedAt) return 0;
  if (snapshot.completedAt) return snapshot.durationSeconds || 0;
  return Math.max(0, Math.floor((Date.now() - new Date(snapshot.startedAt).getTime()) / 1000));
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

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

function shortSession(sessionId) {
  if (!sessionId) return "--";
  const parts = sessionId.split("-");
  return parts.length > 2 ? parts.slice(-2).join("-") : sessionId;
}

function projectName(snapshot) {
  const line = snapshot.lastOutput || "";
  const marker = "ClaudeSignal attached to ";
  if (line.startsWith(marker)) {
    const path = line.slice(marker.length);
    return path.split("/").filter(Boolean).pop() || path;
  }
  return snapshot.sessionId ? "Attached terminal" : "--";
}

boot();
