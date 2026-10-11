(() => {
  "use strict";

  const CHANNEL = "KOT_BRIDGE_PAGE";
  const DEBUG = true; // captures all JSON API traffic for endpoint discovery

  const PATHAO_MARKERS = [
    "/api/proxy/resto-polling-service/api/v1/polling/poll",
    "/api/proxy/resto-service/resto/orders/details/",
  ];

  // Broad Foodmandu markers — match any order-ish API path on the partner host
  const FOODMANDU_MARKERS = [
    "/order",
    "/Order",
    "/vendor",
    "/Vendor",
    "/api/",
  ];

  function detectPlatform(url) {
    if (!url) return null;
    if (url.includes("pathao.com") && PATHAO_MARKERS.some((m) => url.includes(m))) {
      return "pathao";
    }
    if (url.includes("foodmandu.com")) {
      // On foodmandu partner host, match order/vendor APIs but skip static assets
      if (/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf)(\?|$)/i.test(url)) return null;
      if (FOODMANDU_MARKERS.some((m) => url.includes(m))) return "foodmandu";
    }
    return null;
  }

  function emit(url, payload, kind) {
    const platform = detectPlatform(url);
    if (!platform && !DEBUG) return;
    if (!platform && DEBUG) {
      // Still emit unmatched foodmandu/pathao JSON responses for discovery
      if (url.includes("foodmandu.com") || url.includes("pathao.com")) {
        // mark as unknown so content-script can log it
      } else {
        return;
      }
    }
    try {
      window.postMessage(
        {
          source: CHANNEL,
          type: "KOT_ORDER_RESPONSE",
          payload: {
            url,
            platform: platform ?? "unknown",
            body: payload ?? null,
            kind: kind ?? "fetch",
            receivedAt: Date.now(),
          },
        },
        "*"
      );
    } catch {
      /* page-context emission is best-effort */
    }
  }

  function safeJsonParse(text) {
    if (typeof text !== "string") return text;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function patchedFetch(input, init) {
      const response = await originalFetch.apply(this, arguments);
      try {
        const url =
          typeof input === "string"
            ? input
            : input && typeof input.url === "string"
              ? input.url
              : String(input);
        const shouldCapture =
          detectPlatform(url) ||
          (DEBUG && (url.includes("foodmandu.com") || url.includes("pathao.com")));
        if (shouldCapture) {
          const clone = response.clone();
          const ct = clone.headers.get("content-type") || "";
          if (ct.includes("json") || !ct) {
            clone
              .json()
              .then((body) => emit(url, body, "fetch"))
              .catch(() => {});
          }
        }
      } catch {
        /* ignore */
      }
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    try {
      this.__kotUrl = typeof url === "string" ? url : String(url);
    } catch {
      this.__kotUrl = null;
    }
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend() {
    this.addEventListener("load", function onXhrLoad() {
      try {
        const url = this.__kotUrl;
        if (!url) return;
        const shouldCapture =
          detectPlatform(url) ||
          (DEBUG && (url.includes("foodmandu.com") || url.includes("pathao.com")));
        if (!shouldCapture) return;
        const contentType = String(this.getResponseHeader("content-type") || "");
        if (contentType && !contentType.includes("json")) return;
        const body = safeJsonParse(this.responseText);
        if (body) emit(url, body, "xhr");
      } catch {
        /* ignore */
      }
    });
    return originalSend.apply(this, arguments);
  };

  document.documentElement.setAttribute("data-kot-bridge", "ready");
})();
