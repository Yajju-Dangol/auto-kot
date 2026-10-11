import { PLATFORMS } from "../shared/constants.js";

function matchPlatform(url) {
  if (!url || !url.includes("foodmandu.com")) return false;
  if (/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf)(\?|$)/i.test(url)) return false;
  return /order|vendor|cart|checkout/i.test(url);
}

function extractOrderId(payload, url) {
  if (payload && typeof payload === "object") {
    const candidates = [
      payload.orderId,
      payload.order_id,
      payload.id,
      payload.orderNumber,
      payload.order_number,
      payload?.data?.orderId,
      payload?.data?.order_id,
      payload?.data?.id,
      payload?.data?.orderNumber,
      payload?.data?.order?.orderId,
      payload?.data?.order?.id,
      payload?.result?.orderId,
      payload?.result?.id,
    ];
    for (const c of candidates) {
      if (c !== undefined && c !== null && String(c).trim() !== "") {
        return String(c);
      }
    }
    if (Array.isArray(payload?.data)) {
      for (const item of payload.data) {
        if (item && typeof item === "object") {
          const id = item.orderId ?? item.order_id ?? item.id ?? item.orderNumber;
          if (id !== undefined && id !== null && String(id).trim() !== "") {
            return String(id);
          }
        }
      }
    }
  }
  const m = url.match(/order[_-]?(?:id|number)?[=\/]([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  return null;
}

function extractItems(payload) {
  const list =
    payload?.data?.items ??
    payload?.items ??
    payload?.data?.orderItems ??
    payload?.orderItems ??
    payload?.data?.cartItems ??
    payload?.cartItems ??
    payload?.data?.order?.items ??
    payload?.result?.items ??
    null;
  if (!Array.isArray(list)) return [];

  const items = [];
  for (const line of list) {
    if (!line || typeof line !== "object") continue;
    const name =
      line.itemName ??
      line.name ??
      line.title ??
      line.productName ??
      line.foodName ??
      line?.item?.name ??
      line?.product?.name ??
      null;
    if (!name) continue;
    items.push({
      name: String(name).trim(),
      quantity: Number(line.quantity ?? line.qty ?? line.count ?? 1) || 1,
      notes: line.note ?? line.notes ?? line.remarks ?? null,
    });
  }
  return items;
}

function extractCustomer(payload) {
  return (
    payload?.data?.customerName ??
    payload?.customerName ??
    payload?.data?.customer?.name ??
    payload?.customer?.name ??
    payload?.data?.deliveryAddress?.name ??
    payload?.deliveryAddress?.name ??
    payload?.data?.buyer?.name ??
    payload?.buyer?.name ??
    null
  );
}

export const foodmanduAdapter = Object.freeze({
  platform: PLATFORMS.FOODMANDU,
  match: matchPlatform,
  parse(url, payload) {
    const orderId = extractOrderId(payload, url);
    if (!orderId) return null;
    return {
      platform: PLATFORMS.FOODMANDU,
      orderId,
      items: extractItems(payload),
      customer: extractCustomer(payload),
      rawType: url.toLowerCase().includes("order") ? "order" : "api",
    };
  },
});
