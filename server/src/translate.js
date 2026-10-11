import { config } from "./config.js";

const TRANSLATE_URL = `https://${config.rapidapiHost}/translate`;
const CACHE_MAX = 5000;
const cache = new Map();
const inflight = new Map();

function cacheKey(text) {
  return `${config.translateTo}:${String(text).trim().toLowerCase()}`;
}

function cacheGet(text) {
  return cache.get(cacheKey(text));
}

function cacheSet(text, value) {
  const key = cacheKey(text);
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

function normalizeTranslationResponse(data) {
  // Response is often an array: [{ detected_language, translated, original }]
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    const t = data[0].translated ?? data[0].text ?? data[0].output;
    if (typeof t === "string" && t.trim()) return t.trim();
  }

  const candidates = [
    data?.data?.translation,
    data?.data?.translated,
    data?.data?.text,
    data?.translation,
    data?.translated,
    data?.text,
    data?.data,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (Array.isArray(c) && typeof c[0] === "string" && c[0].trim()) return c[0].trim();
  }
  if (Array.isArray(data?.data) && data.data[0]) {
    const t =
      data.data[0]?.translation ?? data.data[0]?.translated ?? data.data[0]?.text;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return null;
}

async function callRapidApi(text, { signal } = {}) {
  if (!config.rapidapiKey) {
    const err = new Error("RAPIDAPI_KEY not configured");
    err.code = "NO_API_KEY";
    throw err;
  }

  const res = await fetch(TRANSLATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": config.rapidapiKey,
      "X-RapidAPI-Host": config.rapidapiHost,
    },
    body: JSON.stringify({
      text,
      from_lang: config.translateFrom,
      to: config.translateTo,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Translate HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  const translated = normalizeTranslationResponse(json);
  if (!translated) {
    const err = new Error("Translate response missing translation text");
    err.status = 0;
    throw err;
  }
  return translated;
}

/**
 * Translate a single string to Nepali. Returns original text on failure.
 */
export async function translateText(text, { signal, useCache = true } = {}) {
  const input = String(text ?? "").trim();
  if (!input) return input;

  // Already Devanagari — skip API call
  if (/[\u0900-\u097F]/.test(input)) return input;

  if (useCache) {
    const hit = cacheGet(input);
    if (hit) return hit;
  }

  const key = cacheKey(input);
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = (async () => {
    try {
      const translated = await callRapidApi(input, { signal });
      cacheSet(input, translated);
      return translated;
    } catch (err) {
      if (err.code !== "NO_API_KEY") {
        console.warn(`[translate] failed for "${input}": ${err.message}`);
      }
      return input; // fallback: keep original English
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * Translate an array of item names. Preserves order. Concurrent with small concurrency limit.
 */
export async function translateItems(items, { concurrency = 3 } = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (!config.translateEnabled) {
    return items.map((item) => ({ ...item, nepaliName: null, translated: false }));
  }

  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      const name = item?.name ?? "";
      const nepaliName = await translateText(name);
      results[i] = {
        ...item,
        nepaliName: nepaliName === name ? null : nepaliName,
        translated: nepaliName !== name,
      };
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function translationStats() {
  return {
    enabled: config.translateEnabled,
    to: config.translateTo,
    cached: cache.size,
    host: config.rapidapiHost,
  };
}
