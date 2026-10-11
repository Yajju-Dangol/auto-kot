import { pathaoAdapter } from "./pathao.js";
import { foodmanduAdapter } from "./foodmandu.js";

const adapters = [pathaoAdapter, foodmanduAdapter];

export function detectPlatform(url) {
  return adapters.find((a) => a.match(url)) ?? null;
}

export function parseOrder(url, payload) {
  const adapter = detectPlatform(url);
  if (!adapter) return null;
  return adapter.parse(url, payload);
}
