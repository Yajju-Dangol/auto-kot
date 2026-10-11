import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { translateItems, translationStats } from "./translate.js";
import { config } from "./config.js";

const DEFAULT_PORT = Number(process.env.PORT) || 5001;
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";

function makeDedupeKey({ platform, accountId, orderId }) {
  return `${platform}:${accountId}:${orderId}`;
}

export function createKotServer(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const onLog = options.onLog ?? ((...args) => console.log(...args));

  const SESSION_TTL_MS = 90 * 1000;

  const state = {
    printer: options.printer ?? "ready",
    unmappedCount: 0,
    seenOrders: new Map(),
    printJobs: [],
    sessions: new Map(),
    dedupeWindowHours: 24,
  };

  function pruneSessions() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [key, s] of state.sessions) {
      if (s.at < cutoff) state.sessions.delete(key);
    }
  }

  function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(payload);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 1_000_000) {
          reject(new Error("Payload too large"));
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  function pruneSeenOrders() {
    const cutoff = Date.now() - state.dedupeWindowHours * 60 * 60 * 1000;
    for (const [key, ts] of state.seenOrders) {
      if (ts < cutoff) state.seenOrders.delete(key);
    }
  }

  async function handleAutoPrint(req, res) {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }

    const { platform, orderId, accountId, customer, items, reprint, installationId } = body;
    if (!platform || !orderId) {
      return json(res, 400, { ok: false, error: "platform and orderId are required" });
    }
    if (!reprint && platform !== "test" && (!Array.isArray(items) || items.length === 0)) {
      return json(res, 400, { ok: false, error: "items required for non-test orders" });
    }

    const dedupeKey = makeDedupeKey({
      platform,
      accountId: `${accountId ?? "unknown"}:${installationId ?? "local"}`,
      orderId: String(orderId),
    });

    if (!reprint && state.seenOrders.has(dedupeKey)) {
      return json(res, 200, {
        ok: true,
        status: "duplicate",
        message: "Duplicate order ignored",
        orderId,
      });
    }

    state.seenOrders.set(dedupeKey, Date.now());
    pruneSeenOrders();

    // Translate Romanized English item names → Nepali (Devanagari) via RapidAPI
    let translatedItems = Array.isArray(items) ? items : [];
    let translateFailed = false;
    try {
      translatedItems = await translateItems(translatedItems);
    } catch (err) {
      translateFailed = true;
      onLog(`[translate] pipeline error: ${err.message}`);
    }

    const nepaliCount = translatedItems.filter((i) => i.nepaliName).length;

    const job = {
      id: randomUUID(),
      platform,
      orderId: String(orderId),
      accountId: accountId ?? null,
      installationId: installationId ?? null,
      customer: customer ?? null,
      items: translatedItems,
      reprint: Boolean(reprint),
      // Stay queued until the desktop app (or print worker) marks it printed.
      status: "queued",
      printAttempted: false,
      translated: nepaliCount > 0,
      translateFailed,
      createdAt: new Date().toISOString(),
    };

    state.printJobs.unshift(job);
    if (state.printJobs.length > 200) state.printJobs.length = 200;
    onLog(
      `[auto-print] ${platform} #${orderId} (${job.items.length} items, ${nepaliCount} translated) -> queued`
    );

    return json(res, 200, {
      ok: true,
      status: job.status,
      jobId: job.id,
      orderId,
    });
  }

  async function handleHealth(_req, res) {
    return json(res, 200, {
      ok: true,
      printer: state.printer,
      printerStatus: state.printer,
      unmappedCount: state.unmappedCount,
      queueSize: state.printJobs.filter((j) => j.status === "queued" || j.status === "held").length,
      uptimeSec: Math.round(process.uptime()),
      translation: translationStats(),
    });
  }

  async function handleTranslate(req, res) {
    try {
      const body = await readBody(req);
      const texts = Array.isArray(body.texts) ? body.texts : [body.text];
      const out = [];
      for (const t of texts) {
        if (!t) {
          out.push(null);
          continue;
        }
        const { translateText } = await import("./translate.js");
        out.push(await translateText(String(t)));
      }
      return json(res, 200, { ok: true, translations: out, ...translationStats() });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  async function handleDictionary(req, res) {
    try {
      const body = await readBody(req);
      return json(res, 200, { ok: true, received: body });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  async function handleJobs(_req, res) {
    return json(res, 200, { ok: true, jobs: state.printJobs.slice(0, 50) });
  }

  async function handleClearJobs(_req, res) {
    state.printJobs = [];
    return json(res, 200, { ok: true });
  }

  async function handlePrinter(req, res) {
    try {
      const body = await readBody(req);
      if (body.status) state.printer = String(body.status);
      return json(res, 200, { ok: true, printer: state.printer });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  async function handleSessionsUpsert(req, res) {
    try {
      const body = await readBody(req);
      const { platform, hostname, title, accountId, installationId } = body;
      if (!platform) return json(res, 400, { ok: false, error: "platform required" });
      // Key by installationId so two Chrome profiles never collide
      const key = `${platform}:${installationId ?? hostname ?? accountId ?? "default"}`;
      state.sessions.set(key, {
        platform,
        hostname: hostname ?? null,
        title: title ?? null,
        accountId: accountId ?? null,
        installationId: installationId ?? null,
        at: Date.now(),
      });
      pruneSessions();
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  async function handleJobStatus(req, res, jobId) {
    try {
      const body = await readBody(req);
      const job = state.printJobs.find((j) => j.id === jobId || j.orderId === jobId);
      if (!job) return json(res, 404, { ok: false, error: "Job not found" });
      if (body.status) {
        job.status = String(body.status);
        if (job.status === "printed" || job.status === "failed") {
          job.printedAt = new Date().toISOString();
          job.printError = body.error ?? null;
        }
      }
      if (body.printAttempted != null) job.printAttempted = Boolean(body.printAttempted);
      return json(res, 200, { ok: true, job });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  async function handleSessionsList(_req, res) {
    pruneSessions();
    return json(res, 200, {
      ok: true,
      sessions: Array.from(state.sessions.values()).sort((a, b) => b.at - a.at),
    });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    try {
      if (req.method === "POST" && path === "/api/auto-print") {
        return await handleAutoPrint(req, res);
      }
      if (req.method === "GET" && path === "/api/health") {
        return await handleHealth(req, res);
      }
      if (req.method === "POST" && path === "/api/translate") {
        return await handleTranslate(req, res);
      }
      if (req.method === "POST" && path === "/api/dictionary") {
        return await handleDictionary(req, res);
      }
      if (req.method === "GET" && path === "/api/jobs") {
        return await handleJobs(req, res);
      }
      if (req.method === "POST" && path === "/api/jobs/clear") {
        return await handleClearJobs(req, res);
      }
      if (req.method === "POST" && path === "/api/printer") {
        return await handlePrinter(req, res);
      }
      if (req.method === "POST" && path === "/api/sessions") {
        return await handleSessionsUpsert(req, res);
      }
      if (req.method === "GET" && path === "/api/sessions") {
        return await handleSessionsList(req, res);
      }
      const jobStatusMatch = path.match(/^\/api\/jobs\/([^/]+)\/status$/);
      if (req.method === "POST" && jobStatusMatch) {
        return await handleJobStatus(req, res, jobStatusMatch[1]);
      }
      return json(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  });

  function start() {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        onLog(`KOT Bridge server listening on http://${host}:${port}`);
        resolve({ port, host });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  function getStatus() {
    return {
      printer: state.printer,
      unmappedCount: state.unmappedCount,
      queueSize: state.printJobs.filter((j) => j.status === "queued" || j.status === "held").length,
      jobs: state.printJobs.slice(0, 50),
    };
  }

  return { start, stop, getStatus, state, port, host };
}
