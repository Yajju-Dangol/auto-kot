import { MSG, PLATFORM_META } from "../shared/constants.js";
import { formatTime } from "../shared/utils.js";

const els = {
  brandDot: document.getElementById("brand-dot"),
  engineLabel: document.getElementById("engine-label"),
  backendStatus: document.getElementById("backend-status"),
  engineToggle: document.getElementById("engine-toggle"),
  sessions: document.getElementById("sessions"),
  sessionCount: document.getElementById("session-count"),
  feed: document.getElementById("feed"),
  printerStatus: document.getElementById("printer-status"),
  unmappedCount: document.getElementById("unmapped-count"),
  btnClear: document.getElementById("btn-clear"),
  btnTest: document.getElementById("btn-test"),
  btnOptions: document.getElementById("btn-options"),
};

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function renderSessions(sessions = []) {
  els.sessionCount.textContent = `${sessions.length} active`;
  if (!sessions.length) {
    els.sessions.innerHTML = '<p class="empty">No active sessions detected.</p>';
    return;
  }

  els.sessions.innerHTML = sessions
    .map((s) => {
      const meta = PLATFORM_META[s.platform] ?? { short: s.platform };
      return `
        <article class="session-card">
          <div class="session-top">
            <span class="session-dot"></span>
            <span class="session-name">${escapeHtml(meta.short)}</span>
          </div>
          <p class="session-meta">${escapeHtml(s.hostname ?? "")}</p>
        </article>
      `;
    })
    .join("");
}

function renderFeed(feed = []) {
  if (!feed.length) {
    els.feed.innerHTML = '<p class="empty">No tickets yet.</p>';
    return;
  }

  els.feed.innerHTML = feed
    .map((item) => {
      const meta = PLATFORM_META[item.platform] ?? { short: item.platform };
      const canReprint = item.status === "failed" || item.status === "printed" || item.status === "reprinted";
      return `
        <article class="feed-item">
          <div class="feed-main">
            <p class="feed-title">${escapeHtml(meta.short)} <span class="mono">#${escapeHtml(item.orderId)}</span></p>
            <p class="feed-sub">${formatTime(item.at)} · ${item.itemCount ?? 0} item${(item.itemCount ?? 0) === 1 ? "" : "s"}${item.customer ? ` · ${escapeHtml(item.customer)}` : ""}</p>
          </div>
          <div class="feed-side">
            <span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
            ${
              canReprint
                ? `<button type="button" class="reprint-btn" data-reprint="${escapeHtml(item.id)}">Reprint</button>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSnapshot(snapshot) {
  const { engine, sessions, printFeed, accountLabel } = snapshot;
  const online = engine.enabled && engine.backendReachable;

  els.brandDot.classList.toggle("online", online);
  els.brandDot.classList.toggle("offline", !online);
  els.engineLabel.textContent = engine.enabled
    ? engine.backendReachable
      ? `Active · ${accountLabel}`
      : "Engine on · backend unreachable"
    : "Paused";
  els.backendStatus.textContent = engine.backendUrl;

  els.engineToggle.setAttribute("aria-checked", engine.enabled ? "true" : "false");
  els.engineToggle.setAttribute("aria-label", engine.enabled ? "Disable auto-print" : "Enable auto-print");

  const printer = engine.printerStatus ?? "unknown";
  els.printerStatus.textContent = printer;
  els.printerStatus.classList.toggle("ok", printer === "ready" || printer === "connected" || printer === "online");
  els.printerStatus.classList.toggle("bad", printer === "offline" || printer === "error");
  els.unmappedCount.textContent = String(engine.unmappedCount ?? 0);

  renderSessions(sessions);
  renderFeed(printFeed);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function refresh() {
  try {
    const snapshot = await sendMessage({ type: MSG.GET_STATE });
    renderSnapshot(snapshot);
  } catch {
    els.engineLabel.textContent = "Service worker unavailable";
  }
}

els.engineToggle.addEventListener("click", async () => {
  const next = els.engineToggle.getAttribute("aria-checked") !== "true";
  const snapshot = await sendMessage({ type: MSG.TOGGLE_ENGINE, enabled: next });
  renderSnapshot(snapshot);
});

els.btnClear.addEventListener("click", async () => {
  const snapshot = await sendMessage({ type: MSG.CLEAR_FEED });
  renderSnapshot(snapshot);
});

els.btnTest.addEventListener("click", async () => {
  const snapshot = await sendMessage({ type: MSG.TEST_PRINT });
  renderSnapshot(snapshot);
});

els.btnOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

els.feed.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-reprint]");
  if (!btn) return;
  const snapshot = await sendMessage({ type: MSG.REPRINT_JOB, jobId: btn.dataset.reprint });
  renderSnapshot(snapshot);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "kot/state-changed" && message.snapshot) {
    renderSnapshot(message.snapshot);
  }
});

void refresh();
setInterval(refresh, 15000);
