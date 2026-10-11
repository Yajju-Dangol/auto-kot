export const PLATFORMS = Object.freeze({
  PATHAO: "pathao",
  FOODMANDU: "foodmandu",
});

export const DEFAULT_SETTINGS = Object.freeze({
  autoPrintEnabled: true,
  backendUrl: "http://127.0.0.1:5001",
  accountLabel: "Account #1",
  dedupeWindowHours: 24,
});

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: "settings",
  SESSIONS: "sessions",
  PRINT_FEED: "printFeed",
  SEEN_ORDERS: "seenOrders",
  ENGINE_STATUS: "engineStatus",
  INSTALLATION_ID: "installationId",
});

export const MAX_FEED_ITEMS = 50;
export const MAX_SEEN_ORDERS = 500;

export const API_PATHS = Object.freeze({
  AUTO_PRINT: "/api/auto-print",
  HEALTH: "/api/health",
  SESSIONS: "/api/sessions",
  JOBS: "/api/jobs",
});

export const ALARM_NAMES = Object.freeze({
  SESSION_HEARTBEAT: "session-heartbeat",
});

export const MSG = Object.freeze({
  ORDER_CANDIDATE: "kot/order-candidate",
  SESSION_HEARTBEAT: "kot/session-heartbeat",
  REPRINT_JOB: "kot/reprint-job",
  GET_STATE: "kot/get-state",
  STATE_SNAPSHOT: "kot/state-snapshot",
  TOGGLE_ENGINE: "kot/toggle-engine",
  CLEAR_FEED: "kot/clear-feed",
  TEST_PRINT: "kot/test-print",
});

export const PLATFORM_META = Object.freeze({
  [PLATFORMS.PATHAO]: { label: "Pathao Resto", short: "Pathao" },
  [PLATFORMS.FOODMANDU]: { label: "Foodmandu Partners", short: "Foodmandu" },
  test: { label: "Test Print", short: "Test" },
});
