(() => {
  "use strict";

  const CHANNEL = "KOT_BRIDGE_PAGE";
  const INJECT_SRC = chrome.runtime.getURL("src/content/inject.js");

  function injectPageScript() {
    try {
      const script = document.createElement("script");
      script.src = INJECT_SRC;
      script.async = false;
      script.dataset.kot = "inject";
      (document.documentElement || document.head).appendChild(script);
      script.addEventListener("load", () => script.remove(), { once: true });
    } catch {
      /* extension context may be invalidated on reload */
    }
  }

  function looksLikeOrder(payload) {
    if (!payload || typeof payload !== "object") return false;
    // Must have an explicit order id field (not bare "id")
    const hasOrderId =
      payload.orderId != null ||
      payload.order_id != null ||
      payload.orderNumber != null ||
      payload.order_number != null ||
      payload?.data?.orderId != null ||
      payload?.data?.order_id != null ||
      payload?.data?.orderNumber != null ||
      payload?.data?.order?.orderId != null ||
      payload?.data?.order?.id != null ||
      payload?.order?.orderId != null ||
      payload?.order?.id != null;
    if (!hasOrderId) return false;

    // Must have order-like content: items, bags, cart, or status
    const hasItems =
      Array.isArray(payload.items) ||
      Array.isArray(payload.bags) ||
      Array.isArray(payload.cartItems) ||
      Array.isArray(payload.orderItems) ||
      Array.isArray(payload?.data?.items) ||
      Array.isArray(payload?.data?.bags) ||
      Array.isArray(payload?.data?.cartItems) ||
      Array.isArray(payload?.data?.orderItems) ||
      Array.isArray(payload?.data?.order?.items);
    const hasStatus =
      payload.status != null ||
      payload.orderStatus != null ||
      payload.state != null ||
      payload?.data?.status != null ||
      payload?.data?.orderStatus != null ||
      payload?.data?.order?.status != null;
    return hasItems || hasStatus;
  }

  function normalizeItems(payload) {
    const bags =
      payload?.bags ??
      payload?.items ??
      payload?.orderItems ??
      payload?.cartItems ??
      payload?.data?.bags ??
      payload?.data?.items ??
      payload?.data?.orderItems ??
      payload?.data?.cartItems ??
      payload?.data?.order?.items ??
      [];
    if (!Array.isArray(bags)) return [];

    const out = [];
    for (const entry of bags) {
      if (!entry || typeof entry !== "object") continue;
      const nested = entry?.items ?? entry?.orderItems ?? entry?.cartItems ?? [];
      const lines = Array.isArray(nested) && nested.length ? nested : [entry];
      for (const line of lines) {
        if (!line || typeof line !== "object") continue;
        const name =
          line.itemName ??
          line.name ??
          line.title ??
          line.variantName ??
          line.productName ??
          line.foodName ??
          line?.item?.name ??
          line?.product?.name ??
          null;
        if (!name) continue;
        out.push({
          name: String(name).trim(),
          quantity: Number(line.quantity ?? line.qty ?? line.count ?? 1) || 1,
          notes: line.note ?? line.notes ?? line.remarks ?? null,
        });
      }
    }
    return out;
  }

  function extractOrderId(payload, url, platform) {
    // Strict: only explicit order id fields — never bare "id"
    if (payload && typeof payload === "object") {
      const candidates = [
        payload.orderId,
        payload.order_id,
        payload.orderNumber,
        payload.order_number,
        payload?.data?.orderId,
        payload?.data?.order_id,
        payload?.data?.orderNumber,
        payload?.data?.order_number,
        payload?.data?.order?.orderId,
        payload?.data?.order?.id,
        payload?.order?.orderId,
        payload?.order?.id,
        payload?.result?.orderId,
        payload?.result?.order_id,
      ];
      for (const c of candidates) {
        if (c !== undefined && c !== null && String(c).trim() !== "") {
          return String(c);
        }
      }
      // Array of orders: pick first entry that looks like an order
      if (Array.isArray(payload?.data)) {
        for (const item of payload.data) {
          if (!item || typeof item !== "object") continue;
          const id = item.orderId ?? item.order_id ?? item.orderNumber ?? item.order_number;
          if (id !== undefined && id !== null && String(id).trim() !== "") {
            return String(id);
          }
        }
      }
    }
    if (platform === "pathao") {
      const m = url.match(/orders\/details\/([A-Za-z0-9_-]+)/);
      if (m) return m[1];
    }
    return null;
  }

  function extractCustomer(payload) {
    return (
      payload?.customerName ??
      payload?.data?.customerName ??
      payload?.customer?.name ??
      payload?.data?.customer?.name ??
      payload?.delivery?.name ??
      payload?.data?.delivery?.name ??
      payload?.deliveryAddress?.name ??
      payload?.data?.deliveryAddress?.name ??
      payload?.buyer?.name ??
      payload?.data?.buyer?.name ??
      null
    );
  }

  function handlePageMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== CHANNEL || data.type !== "KOT_ORDER_RESPONSE") return;

    const { url, platform, body, receivedAt } = data.payload ?? {};
    if (!url || platform === "unknown") return;

    if (!looksLikeOrder(body)) {
      // Log for discovery but never emit — prevents false print feed entries
      console.debug("[KOT Bridge] skipped non-order API:", url);
      return;
    }

    const orderId = extractOrderId(body, url, platform);
    if (!orderId) return;

    console.log("[KOT Bridge] order detected", { platform, orderId, url });

    chrome.runtime.sendMessage({
      type: "kot/order-candidate",
      candidate: {
        platform,
        orderId,
        url,
        items: normalizeItems(body),
        customer: extractCustomer(body),
        capturedAt: receivedAt ?? Date.now(),
      },
    });
  }

  function detectPlatformFromHost() {
    const h = location.hostname;
    if (h.includes("pathao")) return "pathao";
    if (h.includes("foodmandu")) return "foodmandu";
    return "unknown";
  }

  function sendHeartbeat() {
    try {
      chrome.runtime.sendMessage({
        type: "kot/session-heartbeat",
        session: {
          platform: detectPlatformFromHost(),
          hostname: location.hostname,
          title: document.title || location.hostname,
          at: Date.now(),
        },
      });
    } catch {
      /* ignore */
    }
  }

  injectPageScript();
  window.addEventListener("message", handlePageMessage, false);
  sendHeartbeat();
  setInterval(sendHeartbeat, 30000);
})();
