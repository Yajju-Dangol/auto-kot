const PLATFORM_LABELS = {
  pathao: "Pathao",
  foodmandu: "Foodmandu",
  test: "Test",
};

const els = {
  brandDot: document.getElementById("brand-dot"),
  engineLabel: document.getElementById("engine-label"),
  backendStatus: document.getElementById("backend-status"),
  portLabel: document.getElementById("port-label"),
  engineToggle: document.getElementById("engine-toggle"),
  printerStatus: document.getElementById("printer-status"),
  printerSelect: document.getElementById("printer-select"),
  btnTest: document.getElementById("btn-test"),
  btnClear: document.getElementById("btn-clear"),
  sessions: document.getElementById("sessions"),
  sessionCount: document.getElementById("session-count"),
  feed: document.getElementById("feed"),
  errorBanner: document.getElementById("error-banner"),
  modalBackdrop: document.getElementById("modal-backdrop"),
  modalBody: document.getElementById("modal-body"),
  modalTitle: document.getElementById("modal-title"),
  modalClose: document.getElementById("modal-close"),
  modalDismiss: document.getElementById("modal-dismiss"),
  modalReprint: document.getElementById("modal-reprint"),
};

let activeJob = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleString();
}

function formatClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function timeAgo(at) {
  const sec = Math.max(0, Math.round((Date.now() - Number(at)) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

function showError(msg) {
  if (!msg) {
    els.errorBanner.classList.add("hidden");
    els.errorBanner.textContent = "";
    return;
  }
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.remove("hidden");
}

function mergeSessions(apiSessions, jobs) {
  const map = new Map();

  for (const s of apiSessions ?? []) {
    const key = `${s.platform}:${s.installationId ?? s.hostname ?? s.accountId ?? "unknown"}`;
    map.set(key, {
      platform: s.platform,
      accountId: s.accountId,
      hostname: s.hostname,
      title: s.title,
      installationId: s.installationId,
      lastSeen: s.at,
      orderCount: 0,
      lastOrderAt: null,
    });
  }

  for (const job of jobs ?? []) {
    const key = `${job.platform}:${job.installationId ?? job.accountId ?? "unknown"}`;
    if (!map.has(key)) {
      map.set(key, {
        platform: job.platform,
        accountId: job.accountId,
        hostname: null,
        title: null,
        installationId: job.installationId,
        lastSeen: null,
        orderCount: 0,
        lastOrderAt: null,
      });
    }
    const entry = map.get(key);
    entry.orderCount += 1;
    if (!entry.lastOrderAt || job.createdAt > entry.lastOrderAt) {
      entry.lastOrderAt = job.createdAt;
    }
  }

  return Array.from(map.values()).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

function shortId(id) {
  if (!id) return "—";
  return String(id).slice(0, 8);
}

function renderSessions(list) {
  els.sessionCount.textContent = `${list.length} active`;

  if (!list.length) {
    els.sessions.innerHTML =
      '<p class="empty">Waiting for extension sessions… Open Pathao / Foodmandu tabs with the extension loaded.</p>';
    return;
  }

  els.sessions.innerHTML = list
    .map((s) => {
      const label = PLATFORM_LABELS[s.platform] ?? s.platform;
      const live = s.lastSeen && Date.now() - s.lastSeen < 90_000;
      const metaBits = [
        s.accountId ?? "—",
        s.hostname ?? null,
        `id:${shortId(s.installationId)}`,
        s.orderCount ? `${s.orderCount} ticket${s.orderCount === 1 ? "" : "s"}` : null,
        s.lastSeen ? timeAgo(s.lastSeen) : null,
      ].filter(Boolean);
      return `
        <article class="session-card ${live ? "live" : ""}">
          <div class="session-top">
            <span class="session-dot ${live ? "" : "dim"}"></span>
            <span class="session-name">${escapeHtml(label)}</span>
          </div>
          <p class="session-meta">${escapeHtml(metaBits.join(" · "))}</p>
        </article>
      `;
    })
    .join("");
}

function renderFeed(jobs) {
  if (!jobs.length) {
    els.feed.innerHTML = '<p class="empty">No tickets yet.</p>';
    return;
  }

  els.feed.innerHTML = jobs
    .map((job) => {
      const label = PLATFORM_LABELS[job.platform] ?? job.platform;
      const items = Array.isArray(job.items) ? job.items : [];
      return `
        <article class="feed-item">
          <div class="feed-main">
            <p class="feed-title">${escapeHtml(label)} <span class="mono">#${escapeHtml(job.orderId)}</span></p>
            <p class="feed-sub">${formatClock(job.createdAt)} · ${items.length} item${items.length === 1 ? "" : "s"} · ${escapeHtml(job.accountId ?? "—")}${job.customer ? ` · ${escapeHtml(job.customer)}` : ""}</p>
          </div>
          <div class="feed-side">
            <span class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
            <div class="feed-actions">
              <button type="button" class="text-btn" data-view="${escapeHtml(job.id)}">View</button>
              <button type="button" class="text-btn" data-reprint="${escapeHtml(job.id)}">Reprint</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function openModal(job) {
  activeJob = job;
  const label = PLATFORM_LABELS[job.platform] ?? job.platform;
  const items = Array.isArray(job.items) ? job.items : [];
  const rows = items.length
    ? items
        .map((item) => {
          const nepali = item.nepaliName
            ? `<div class="m-nepali">${escapeHtml(item.nepaliName)}</div>`
            : "";
          return `
      <tr>
        <td class="m-qty">${escapeHtml(item.quantity ?? 1)}×</td>
        <td class="m-name">${escapeHtml(item.name ?? "")}${nepali}${item.notes ? `<div class="m-notes">${escapeHtml(item.notes)}</div>` : ""}</td>
      </tr>`;
        })
        .join("")
    : '<tr><td colspan="2" class="m-empty">No items</td></tr>';

  els.modalTitle.textContent = `${label} #${job.orderId}`;
  els.modalBody.innerHTML = `
    <div class="m-grid">
      <div><p class="label">Status</p><p class="value"><span class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></p></div>
      <div><p class="label">Account</p><p class="value">${escapeHtml(job.accountId ?? "—")}</p></div>
      <div><p class="label">Customer</p><p class="value">${escapeHtml(job.customer ?? "—")}</p></div>
      <div><p class="label">Received</p><p class="value">${escapeHtml(formatTime(job.createdAt))}</p></div>
      <div><p class="label">Profile ID</p><p class="value">${escapeHtml(shortId(job.installationId))}</p></div>
      <div><p class="label">Items</p><p class="value">${items.length}</p></div>
    </div>
    <p class="label m-items-label">Line items</p>
    <table class="m-table">
      <thead><tr><th>Qty</th><th>Item</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${job.printError ? `<p class="m-error">Print error: ${escapeHtml(job.printError)}</p>` : ""}
  `;
  els.modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  els.modalBackdrop.classList.add("hidden");
  activeJob = null;
}

function render(status) {
  if (!status) {
    els.engineLabel.textContent = "Waiting for app…";
    els.brandDot.className = "brand-dot offline";
    return;
  }

  const { health, jobs, sessions, port, autoPrintEnabled, startupError } = status;
  const printer = health?.printer ?? "unknown";
  const reachable = Boolean(health?.ok);

  els.portLabel.textContent = `:${port}`;
  els.backendStatus.textContent = reachable
    ? `http://127.0.0.1:${port}`
    : startupError
      ? `error: ${startupError}`
      : `http://127.0.0.1:${port} (unreachable)`;

  showError(startupError ? `Server error: ${startupError}` : null);

  const online = autoPrintEnabled && reachable && printer === "ready";
  els.brandDot.className = `brand-dot ${online ? "online" : reachable ? "" : "offline"}`;
  els.engineLabel.textContent = !autoPrintEnabled
    ? "Paused"
    : reachable
      ? `Active · port ${port}`
      : "Server unreachable";

  els.engineToggle.setAttribute("aria-checked", autoPrintEnabled ? "true" : "false");
  els.printerStatus.textContent = printer;
  els.printerStatus.className = `value ${
    printer === "ready" ? "ok" : printer === "offline" || printer === "error" ? "bad" : "muted"
  }`;
  els.printerSelect.value =
    printer === "connected" || printer === "online" ? "ready" : printer || "ready";

  renderSessions(mergeSessions(sessions, jobs));
  renderFeed(jobs ?? []);
}

async function refresh() {
  try {
    const status = await window.kot.getStatus();
    render(status);
  } catch (err) {
    showError(`Bridge API unavailable: ${err.message}`);
    render(null);
  }
}

els.engineToggle.addEventListener("click", async () => {
  const next = els.engineToggle.getAttribute("aria-checked") !== "true";
  await window.kot.toggleAutoPrint(next);
  void refresh();
});

els.btnTest.addEventListener("click", async () => {
  await window.kot.testPrint();
  void refresh();
});

els.btnClear.addEventListener("click", async () => {
  await window.kot.clearJobs();
  void refresh();
});

els.printerSelect.addEventListener("change", async () => {
  await window.kot.setPrinter(els.printerSelect.value);
  void refresh();
});

els.feed.addEventListener("click", async (event) => {
  const viewBtn = event.target.closest("[data-view]");
  const reprintBtn = event.target.closest("[data-reprint]");
  if (viewBtn) {
    const status = await window.kot.getStatus();
    const job = (status.jobs ?? []).find((j) => j.id === viewBtn.dataset.view);
    if (job) openModal(job);
    return;
  }
  if (reprintBtn) {
    await window.kot.reprintJob(reprintBtn.dataset.reprint);
    void refresh();
  }
});

els.modalClose.addEventListener("click", closeModal);
els.modalDismiss.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", (e) => {
  if (e.target === els.modalBackdrop) closeModal();
});
els.modalReprint.addEventListener("click", async () => {
  if (!activeJob) return;
  await window.kot.reprintJob(activeJob.id);
  closeModal();
  void refresh();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.modalBackdrop.classList.contains("hidden")) closeModal();
});

if (window.kot?.onLog) {
  window.kot.onLog(() => void refresh());
}
if (window.kot?.onJobUpdated) {
  window.kot.onJobUpdated(() => void refresh());
}

void refresh();
setInterval(refresh, 2500);
