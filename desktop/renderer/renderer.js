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
};

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
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function renderSessions(jobs) {
  const byAccount = new Map();
  for (const job of jobs) {
    const key = `${job.platform}:${job.accountId ?? "unknown"}`;
    if (!byAccount.has(key)) {
      byAccount.set(key, {
        platform: job.platform,
        accountId: job.accountId,
        count: 0,
        lastAt: job.createdAt,
      });
    }
    const entry = byAccount.get(key);
    entry.count += 1;
    if (job.createdAt > entry.lastAt) entry.lastAt = job.createdAt;
  }

  const list = Array.from(byAccount.values()).sort((a, b) =>
    (b.lastAt ?? "").localeCompare(a.lastAt ?? "")
  );
  els.sessionCount.textContent = `${list.length} account${list.length === 1 ? "" : "s"}`;

  if (!list.length) {
    els.sessions.innerHTML =
      '<p class="empty">No orders yet. Sessions are tracked by the Chrome extension — orders will appear here once captured.</p>';
    return;
  }

  els.sessions.innerHTML = list
    .map((s) => {
      const label = PLATFORM_LABELS[s.platform] ?? s.platform;
      return `
        <article class="session-card">
          <div class="session-top">
            <span class="session-dot"></span>
            <span class="session-name">${escapeHtml(label)}</span>
          </div>
          <p class="session-meta">${escapeHtml(s.accountId ?? "—")} · ${s.count} ticket${s.count === 1 ? "" : "s"}</p>
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
      const itemsPreview = items
        .slice(0, 3)
        .map((i) => `${i.quantity ?? 1}× ${escapeHtml(i.name)}`)
        .join(", ");
      const more = items.length > 3 ? ` +${items.length - 3} more` : "";
      return `
        <article class="feed-item">
          <div class="feed-main">
            <p class="feed-title">${escapeHtml(label)} <span class="mono">#${escapeHtml(job.orderId)}</span></p>
            <p class="feed-sub">${formatTime(job.createdAt)} · ${items.length} item${items.length === 1 ? "" : "s"} · ${escapeHtml(job.accountId ?? "—")}${job.customer ? ` · ${escapeHtml(job.customer)}` : ""}</p>
            ${itemsPreview ? `<p class="feed-items"><span>${itemsPreview}</span>${more}</p>` : ""}
          </div>
          <span class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
        </article>
      `;
    })
    .join("");
}

function render(status) {
  if (!status) {
    els.engineLabel.textContent = "Server unreachable";
    els.brandDot.className = "brand-dot offline";
    return;
  }

  const { health, jobs, port, autoPrintEnabled } = status;
  const printer = health?.printer ?? "unknown";
  const reachable = Boolean(health?.ok);

  els.portLabel.textContent = `:${port}`;
  els.backendStatus.textContent = `http://127.0.0.1:${port}`;

  const online = autoPrintEnabled && reachable && printer === "ready";
  els.brandDot.className = `brand-dot ${online ? "online" : reachable ? "" : "offline"}`;
  els.engineLabel.textContent = !autoPrintEnabled
    ? "Paused"
    : reachable
      ? `Active · port ${port}`
      : "Backend unreachable";

  els.engineToggle.setAttribute("aria-checked", autoPrintEnabled ? "true" : "false");
  els.printerStatus.textContent = printer;
  els.printerStatus.className = `value ${
    printer === "ready" ? "ok" : printer === "offline" || printer === "error" ? "bad" : "muted"
  }`;
  els.printerSelect.value = printer === "connected" || printer === "online" ? "ready" : printer;

  renderSessions(jobs ?? []);
  renderFeed(jobs ?? []);
}

async function refresh() {
  try {
    const status = await window.kot.getStatus();
    render(status);
  } catch {
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

void refresh();
setInterval(refresh, 3000);
