export function nowIso() {
  return new Date().toISOString();
}

export function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function makeDedupeKey({ platform, accountId, orderId }) {
  const raw = `${platform}:${accountId}:${orderId}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${raw}:${(hash >>> 0).toString(16)}`;
}

export function clampList(list, max) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, max);
}

export function withTimeout(ms, signal) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    signal?.addEventListener?.(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      },
      { once: true }
    );
  });
}
