import {
  API_PATHS,
  ALARM_NAMES,
  DEFAULT_SETTINGS,
  MAX_FEED_ITEMS,
  MAX_SEEN_ORDERS,
  MSG,
  STORAGE_KEYS,
} from "../shared/constants.js";
import { clampList, makeDedupeKey, nowIso } from "../shared/utils.js";

const SESSION_TTL_MS = 2 * 60 * 1000;

const state = {
  settings: { ...DEFAULT_SETTINGS },
  engineOnline: false,
  backendReachable: false,
  printerStatus: "unknown",
  unmappedCount: 0,
  sessions: new Map(),
  printFeed: [],
  seenOrders: new Map(),
};

async function loadPersistedState() {
  const local = await chrome.storage.local.get([
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.PRINT_FEED,
    STORAGE_KEYS.SEEN_ORDERS,
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...(local[STORAGE_KEYS.SETTINGS] || {}) };
  state.printFeed = clampList(local[STORAGE_KEYS.PRINT_FEED] || [], MAX_FEED_ITEMS);
  state.seenOrders = new Map(local[STORAGE_KEYS.SEEN_ORDERS] || []);
  state.engineOnline = state.settings.autoPrintEnabled;
}

async function persistFeed() {
  await chrome.storage.local.set({ [STORAGE_KEYS.PRINT_FEED]: state.printFeed });
}

async function persistSeenOrders() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.SEEN_ORDERS]: Array.from(state.seenOrders.entries()),
  });
}

async function persistSettings() {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: state.settings });
}

function pruneSeenOrders() {
  const cutoff = Date.now() - state.settings.dedupeWindowHours * 60 * 60 * 1000;
  let mutated = false;
  for (const [key, ts] of state.seenOrders) {
    if (ts < cutoff) {
      state.seenOrders.delete(key);
      mutated = true;
    }
  }
  if (state.seenOrders.size > MAX_SEEN_ORDERS) {
    const entries = Array.from(state.seenOrders.entries()).sort((a, b) => a[1] - b[1]);
    const drop = entries.slice(0, state.seenOrders.size - MAX_SEEN_ORDERS);
    for (const [key] of drop) state.seenOrders.delete(key);
    mutated = true;
  }
  return mutated;
}

async function backendPost(path, body) {
  const url = `${state.settings.backendUrl.replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    state.backendReachable = true;
    return { ok: res.ok, status: res.status };
  } catch {
    state.backendReachable = false;
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function backendGet(path) {
  const url = `${state.settings.backendUrl.replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    state.backendReachable = res.ok;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    state.backendReachable = false;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pushFeedItem(item) {
  state.printFeed = [item, ...state.printFeed].slice(0, MAX_FEED_ITEMS);
  void persistFeed();
  updateBadge();
}

function updateBadge() {
  const hasNew = state.printFeed.some(
    (f) => f.status === "failed" || f.status === "duplicate"
  );
  chrome.action.setBadgeText({ text: hasNew ? "!" : "" });
  chrome.action.setBadgeBackgroundColor({ color: hasNew ? "#EF4444" : "#10B981" });
}

async function handleOrderCandidate(candidate) {
  const { platform, orderId, items, customer, url, capturedAt } = candidate;
  if (!platform || !orderId) return;

  // Reject empty orders — they are almost always false positives from non-order APIs
  if (!Array.isArray(items) || items.length === 0) {
    console.debug("[KOT Bridge] ignored order with no items:", orderId);
    return;
  }

  const dedupeKey = makeDedupeKey({
    platform,
    accountId: state.settings.accountLabel,
    orderId,
  });

  if (state.seenOrders.has(dedupeKey)) {
    pushFeedItem({
      id: `${dedupeKey}:${capturedAt}`,
      platform,
      orderId,
      itemCount: items?.length ?? 0,
      customer: customer ?? null,
      status: "duplicate",
      at: nowIso(),
    });
    return;
  }

  state.seenOrders.set(dedupeKey, Date.now());
  pruneSeenOrders();
  void persistSeenOrders();

  const feedId = `${dedupeKey}:${capturedAt}`;
  const entry = {
    id: feedId,
    platform,
    orderId,
    itemCount: items?.length ?? 0,
    customer: customer ?? null,
    status: state.settings.autoPrintEnabled ? "queued" : "paused",
    at: nowIso(),
  };
  pushFeedItem(entry);

  if (!state.settings.autoPrintEnabled) return;

  const result = await backendPost(API_PATHS.AUTO_PRINT, {
    platform,
    orderId,
    accountId: state.settings.accountLabel,
    customer,
    items: items ?? [],
    sourceUrl: url,
    capturedAt,
    receivedAt: Date.now(),
  });

  const item = state.printFeed.find((f) => f.id === feedId);
  if (item) {
    item.status = result.ok ? "printed" : "failed";
    void persistFeed();
    updateBadge();
  }
}

async function handleReprint(jobId) {
  const job = state.printFeed.find((f) => f.id === jobId || f.orderId === jobId);
  if (!job) return;
  const result = await backendPost(API_PATHS.AUTO_PRINT, {
    reprint: true,
    platform: job.platform,
    orderId: job.orderId,
    accountId: state.settings.accountLabel,
    customer: job.customer,
    items: job.items ?? [],
  });
  job.status = result.ok ? "reprinted" : "failed";
  void persistFeed();
  updateBadge();
}

function upsertSession(session) {
  const key = `${session.platform}:${state.settings.accountLabel}`;
  state.sessions.set(key, { ...session, at: Date.now() });
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [key, s] of state.sessions) {
    if (s.at < cutoff) state.sessions.delete(key);
  }
}

async function refreshHealth() {
  const health = await backendGet(API_PATHS.HEALTH);
  if (health) {
    state.printerStatus = health.printer ?? health.printerStatus ?? "unknown";
    state.unmappedCount = Number(health.unmappedCount ?? 0);
  } else {
    state.printerStatus = "offline";
  }
  state.engineOnline = state.settings.autoPrintEnabled;
}

function buildSnapshot() {
  pruneSessions();
  return {
    engine: {
      enabled: state.settings.autoPrintEnabled,
      backendUrl: state.settings.backendUrl,
      backendReachable: state.backendReachable,
      printerStatus: state.printerStatus,
      unmappedCount: state.unmappedCount,
    },
    accountLabel: state.settings.accountLabel,
    sessions: Array.from(state.sessions.values()),
    printFeed: state.printFeed,
  };
}

async function handleTestPrint() {
  const orderId = `TEST-${Date.now().toString(36).toUpperCase()}`;
  const candidate = {
    platform: "test",
    orderId,
    url: "manual://test-print",
    items: [
      { name: "Test Item Alpha", quantity: 1, notes: "test print" },
      { name: "Test Item Beta", quantity: 2, notes: null },
    ],
    customer: "Test Customer",
    capturedAt: Date.now(),
  };
  await handleOrderCandidate(candidate);
  return buildSnapshot();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;

  switch (message.type) {
    case MSG.ORDER_CANDIDATE:
      void handleOrderCandidate(message.candidate);
      sendResponse({ ok: true });
      return false;
    case MSG.SESSION_HEARTBEAT:
      upsertSession(message.session);
      sendResponse({ ok: true });
      return false;
    case MSG.GET_STATE:
      void (async () => {
        await refreshHealth();
        sendResponse(buildSnapshot());
      })();
      return true;
    case MSG.TOGGLE_ENGINE:
      state.settings.autoPrintEnabled = Boolean(message.enabled);
      state.engineOnline = state.settings.autoPrintEnabled;
      void persistSettings().then(() => sendResponse(buildSnapshot()));
      return true;
    case MSG.CLEAR_FEED:
      state.printFeed = [];
      void persistFeed().then(() => {
        updateBadge();
        sendResponse(buildSnapshot());
      });
      return true;
    case MSG.TEST_PRINT:
      void handleTestPrint().then(() => sendResponse(buildSnapshot()));
      return true;
    case MSG.REPRINT_JOB:
      void handleReprint(message.jobId).then(() => sendResponse(buildSnapshot()));
      return true;
    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void loadPersistedState().then(() => refreshHealth());
});

chrome.runtime.onStartup.addListener(() => {
  void loadPersistedState().then(() => refreshHealth());
});

chrome.alarms.create(ALARM_NAMES.SESSION_HEARTBEAT, { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAMES.SESSION_HEARTBEAT) {
    void refreshHealth().then(() => {
      chrome.runtime
        .sendMessage({ type: "kot/state-changed", snapshot: buildSnapshot() })
        .catch(() => {});
    });
  }
});

void loadPersistedState().then(() => refreshHealth());
