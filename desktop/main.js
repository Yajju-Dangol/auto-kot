import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKotServer } from "../server/src/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.KOT_PORT) || 5001;
let mainWindow = null;
let kotServer = null;
let autoPrintEnabled = true;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#000000",
    title: "KOT Bridge",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
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

async function startServer() {
  kotServer = createKotServer({
    port: PORT,
    onLog: (...args) => {
      console.log(...args);
      mainWindow?.webContents.send("kot:log", args.join(" "));
    },
  });
  try {
    await kotServer.start();
  } catch (err) {
    if (err.code === "EADDRINUSE") {
      console.warn(`Port ${PORT} already in use — assuming external server is running.`);
    } else {
      throw err;
    }
  }
}

ipcMain.handle("kot:get-status", async () => {
  const health = await fetch(`http://127.0.0.1:${PORT}/api/health`)
    .then((r) => r.json())
    .catch(() => null);
  const jobs = await fetch(`http://127.0.0.1:${PORT}/api/jobs`)
    .then((r) => r.json())
    .then((r) => r.jobs ?? [])
    .catch(() => []);
  return {
    port: PORT,
    autoPrintEnabled,
    health,
    jobs,
    running: Boolean(kotServer),
  };
});

ipcMain.handle("kot:test-print", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/auto-print`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: "test",
      orderId: `TEST-${Date.now().toString(36).toUpperCase()}`,
      accountId: "Desktop",
      customer: "Test Customer",
      items: [
        { name: "Test Item Alpha", quantity: 1, notes: "electron test" },
        { name: "Test Item Beta", quantity: 2, notes: null },
      ],
    }),
  }).then((r) => r.json());
  return res;
});

ipcMain.handle("kot:clear-jobs", async () => {
  // Server keeps jobs in memory; restart view by refetching — clear via direct state
  if (kotServer?.state) {
    kotServer.state.printJobs = [];
  }
  return { ok: true };
});

ipcMain.handle("kot:toggle-auto-print", async (_e, enabled) => {
  autoPrintEnabled = Boolean(enabled);
  return { ok: true, autoPrintEnabled };
});

ipcMain.handle("kot:set-printer", async (_e, status) => {
  if (kotServer?.state) {
    kotServer.state.printer = String(status || "ready");
  }
  return { ok: true };
});

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  if (kotServer) {
    e.preventDefault();
    await kotServer.stop().catch(() => {});
    app.exit(0);
  }
});
