import { PLATFORMS } from "../shared/constants.js";

const PATHAO_POLL = "/api/proxy/resto-polling-service/api/v1/polling/poll";
const PATHAO_ORDER_DETAIL = "/api/proxy/resto-service/resto/orders/details/";

const FOODMANDU_VENDOR = "/Vendor/";
const FOODMANDU_ORDER = "/Order/";

function matchPlatform(url) {
  if (!url) return null;
  if (url.includes(PATHAO_POLL) || url.includes(PATHAO_ORDER_DETAIL)) {
    return PLATFORMS.PATHAO;
  }
  if (url.includes(FOODMANDU_VENDOR) || url.includes(FOODMANDU_ORDER)) {
    return PLATFORMS.FOODMANDU;
  }
  return null;
}

function extractOrderId(platform, payload, url) {
  if (payload && typeof payload === "object") {
    const candidates = [
      payload.orderId,
      payload.order_id,
      payload.id,
      payload?.data?.orderId,
      payload?.data?.order_id,
      payload?.data?.id,
      payload?.order?.orderId,
      payload?.order?.id,
      payload?.data?.order?.orderId,
      payload?.data?.order?.id,
    ];
    for (const c of candidates) {
      if (c !== undefined && c !== null && String(c).trim() !== "") {
        return String(c);
      }
    }
  }
  if (platform === PLATFORMS.PATHAO) {
    const m = url.match(/orders\/details\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
  }
  return null;
}

function extractItems(payload) {
  const bags =
    payload?.data?.bags ??
    payload?.bags ??
    payload?.data?.items ??
    payload?.items ??
    payload?.data?.orderItems ??
    payload?.orderItems ??
    null;
  if (!Array.isArray(bags)) return [];

  const items = [];
  for (const bag of bags) {
    const lines = bag?.items ?? bag?.orderItems ?? [];
    if (!Array.isArray(lines) || lines.length === 0) {
      const single = normalizeLine(bag);
      if (single) items.push(single);
      continue;
    }
    for (const line of lines) {
      const normalized = normalizeLine(line);
      if (normalized) items.push(normalized);
    }
  }
  return items;
}

function normalizeLine(line) {
  if (!line || typeof line !== "object") return null;
  const name =
    line.itemName ??
    line.name ??
    line.title ??
    line.variantName ??
    line?.item?.name ??
    null;
  if (!name) return null;
  return {
    name: String(name).trim(),
    quantity: Number(line.quantity ?? line.qty ?? line.count ?? 1) || 1,
    notes: line.note ?? line.notes ?? line.remarks ?? null,
  };
}

function extractCustomer(payload) {
  return (
    payload?.data?.customerName ??
    payload?.customerName ??
    payload?.data?.customer?.name ??
    payload?.customer?.name ??
    payload?.data?.delivery?.name ??
    payload?.delivery?.name ??
    null
  );
}

export const pathaoAdapter = Object.freeze({
  platform: PLATFORMS.PATHAO,
  match: matchPlatform,
  parse(url, payload) {
    const orderId = extractOrderId(PLATFORMS.PATHAO, payload, url);
    if (!orderId) return null;
    return {
      platform: PLATFORMS.PATHAO,
      orderId,
      items: extractItems(payload),
      customer: extractCustomer(payload),
      rawType: url.includes("polling/poll") ? "poll" : "detail",
    };
  },
});
