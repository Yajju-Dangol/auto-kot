import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKotServer } from "../server/src/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_PORT = Number(process.env.KOT_PORT) || 5001;
let mainWindow = null;
let kotServer = null;
let autoPrintEnabled = true;
let boundPort = BASE_PORT;
let startupError = null;
let printing = new Set();
let printPollTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "KOT Bridge",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function tryListen(port) {
  const server = createKotServer({
    port,
    onLog: (...args) => {
      const line = args.join(" ");
      console.log(line);
      mainWindow?.webContents.send("kot:log", line);
    },
  });
  await server.start();
  return server;
}

async function startServer() {
  const ports = [BASE_PORT, BASE_PORT + 1, BASE_PORT + 2, 5050, 8080];
  for (const port of ports) {
    try {
      kotServer = await tryListen(port);
      boundPort = port;
      startupError = null;
      return;
    } catch (err) {
      if (err.code === "EADDRINUSE") {
        console.warn(`Port ${port} in use, trying next...`);
        continue;
      }
      startupError = err.message;
      throw err;
    }
  }
  boundPort = BASE_PORT;
  kotServer = null;
  startupError = null;
  console.warn(`All ports busy — using external server on :${BASE_PORT}`);
}

async function apiFetch(pathname, init) {
  const res = await fetch(`http://127.0.0.1:${boundPort}${pathname}`, init);
  return res.json();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildReceiptHtml(job) {
  const items = Array.isArray(job.items) ? job.items : [];
  const platform = String(job.platform ?? "").toUpperCase();
  const created = new Date(job.createdAt ?? Date.now());
  const timeStr = created.toLocaleString();
  const rows = items
    .map((item) => {
      const nepali = item.nepaliName
        ? `<div class="nepali">${escapeHtml(item.nepaliName)}</div>`
        : "";
      return `
      <tr>
        <td class="qty">${escapeHtml(item.quantity ?? 1)}x</td>
        <td class="name">${escapeHtml(item.name ?? "")}${nepali}${item.notes ? `<div class="notes">${escapeHtml(item.notes)}</div>` : ""}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>KOT #${escapeHtml(job.orderId)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 72mm;
    padding: 3mm;
    font-family: "Segoe UI", "Noto Sans Devanagari", "Mangal", sans-serif;
    font-size: 12px;
    color: #000;
    background: #fff;
  }
  .center { text-align: center; }
  .header { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
  .platform { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 4px; }
  .meta { font-size: 10px; margin: 2px 0; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  .qty { width: 14mm; font-weight: 700; font-size: 13px; }
  .name { font-size: 12px; }
  .nepali { font-size: 13px; font-weight: 600; margin-top: 1px; }
  .notes { font-size: 10px; margin-left: 2mm; }
  .footer { margin-top: 8px; font-size: 10px; text-align: center; }
  .order-id { font-size: 14px; font-weight: 700; }
</style>
</head>
<body>
  <div class="center header">KOT BRIDGE</div>
  <div class="center platform">${escapeHtml(platform)} ORDER</div>
  <div class="divider"></div>
  <div class="order-id center">#${escapeHtml(job.orderId)}</div>
  <div class="meta center">${escapeHtml(timeStr)}</div>
  ${job.accountId ? `<div class="meta center">Account: ${escapeHtml(job.accountId)}</div>` : ""}
  ${job.customer ? `<div class="meta center">Customer: ${escapeHtml(job.customer)}</div>` : ""}
  <div class="divider"></div>
  <table>${rows}</table>
  <div class="divider"></div>
  <div class="footer">${items.length} item${items.length === 1 ? "" : "s"} · KOT Bridge</div>
</body>
</html>`;
}

async function printJob(job) {
  const html = buildReceiptHtml(job);
  const printWin = new BrowserWindow({
    show: false,
    width: 320,
    height: 480,
    webPreferences: { offscreen: true, sandbox: true },
  });

  try {
    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const success = await new Promise((resolve) => {
      printWin.webContents.print(
        {
          silent: true,
          printBackground: false,
          deviceName: "",
          margins: { marginType: "none" },
          pageSize: { width: 80000, height: 297000 },
        },
        (ok, failureReason) => {
          if (!ok) console.error("Print failed:", failureReason);
          resolve(Boolean(ok));
        }
      );
    });
    return success;
  } finally {
    if (!printWin.isDestroyed()) printWin.destroy();
  }
}

async function processQueuedJobs() {
  if (!autoPrintEnabled) return;
  if (kotServer?.state?.printer && kotServer.state.printer !== "ready") return;

  let jobs = [];
  try {
    const res = await apiFetch("/api/jobs");
    jobs = res.jobs ?? [];
  } catch {
    return;
  }

  const queued = jobs.filter(
    (j) => j.status === "queued" && !j.printAttempted && !printing.has(j.id)
  );

  for (const job of queued) {
    printing.add(job.id);
    mainWindow?.webContents.send("kot:log", `Printing ${job.platform} #${job.orderId}...`);
    let ok = false;
    let error = null;
    try {
      ok = await printJob(job);
      if (!ok) error = "OS print dialog rejected / no printer";
    } catch (err) {
      error = err.message;
    }
    printing.delete(job.id);

    const status = ok ? "printed" : "failed";
    try {
      await apiFetch(`/api/jobs/${job.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, printAttempted: true, error }),
      });
    } catch {
      /* ignore */
    }
    mainWindow?.webContents.send("kot:log", `${job.orderId}: ${status}${error ? ` (${error})` : ""}`);
    mainWindow?.webContents.send("kot:job-updated", { id: job.id, status });
  }
}

function startPrintPolling() {
  if (printPollTimer) clearInterval(printPollTimer);
  printPollTimer = setInterval(() => {
    void processQueuedJobs();
  }, 1500);
}

ipcMain.handle("kot:get-status", async () => {
  const health = await apiFetch("/api/health").catch(() => null);
  const jobsRes = await apiFetch("/api/jobs").catch(() => ({ jobs: [] }));
  const sessionsRes = await apiFetch("/api/sessions").catch(() => ({ sessions: [] }));
  return {
    port: boundPort,
    autoPrintEnabled,
    running: Boolean(kotServer) || Boolean(health?.ok),
    startupError,
    health,
    jobs: jobsRes.jobs ?? [],
    sessions: sessionsRes.sessions ?? [],
  };
});

ipcMain.handle("kot:test-print", async () => {
  return apiFetch("/api/auto-print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: "test",
      orderId: `TEST-${Date.now().toString(36).toUpperCase()}`,
      accountId: "Desktop",
      installationId: "electron-desktop",
      customer: "Test Customer",
      items: [
        { name: "Test Item Alpha", quantity: 1, notes: "electron test" },
        { name: "Test Item Beta", quantity: 2, notes: null },
      ],
    }),
  }).catch((e) => ({ ok: false, error: e.message }));
});

ipcMain.handle("kot:reprint-job", async (_e, jobId) => {
  const jobsRes = await apiFetch("/api/jobs").catch(() => ({ jobs: [] }));
  const job = (jobsRes.jobs ?? []).find((j) => j.id === jobId || j.orderId === jobId);
  if (!job) return { ok: false, error: "Job not found" };
  return apiFetch("/api/auto-print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reprint: true,
      platform: job.platform,
      orderId: job.orderId,
      accountId: job.accountId,
      installationId: job.installationId,
      customer: job.customer,
      items: job.items,
    }),
  });
});

ipcMain.handle("kot:clear-jobs", async () => {
  if (kotServer?.state) {
    kotServer.state.printJobs = [];
  } else {
    await apiFetch("/api/jobs/clear", { method: "POST" }).catch(() => {});
  }
  return { ok: true };
});

ipcMain.handle("kot:toggle-auto-print", async (_e, enabled) => {
  autoPrintEnabled = Boolean(enabled);
  if (autoPrintEnabled) void processQueuedJobs();
  return { ok: true, autoPrintEnabled };
});

ipcMain.handle("kot:set-printer", async (_e, status) => {
  const value = String(status || "ready");
  if (kotServer?.state) {
    kotServer.state.printer = value;
  } else {
    await apiFetch("/api/printer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: value }),
    }).catch(() => {});
  }
  if (value === "ready") void processQueuedJobs();
  return { ok: true };
});

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (err) {
    startupError = err.message;
    console.error("Server start failed:", err);
  }
  createWindow();
  startPrintPolling();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  if (printPollTimer) clearInterval(printPollTimer);
  if (kotServer) {
    e.preventDefault();
    await kotServer.stop().catch(() => {});
    app.exit(0);
  }
});
