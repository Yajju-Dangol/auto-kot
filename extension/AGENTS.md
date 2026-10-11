# AGENTS.md — KOT Bridge Chrome Extension

Guidelines for working on the KOT Bridge browser extension. Follow `ARCHITECTURE.md` for system-level design; this file covers extension-specific conventions and best practices.

## Project Overview

Chrome Manifest V3 extension that intercepts vendor order responses from Pathao Resto and Foodmandu Partners, normalizes them, and relays them to a local backend (`localhost:5001`) for translation, ESC/POS rasterization, and USB thermal printing.

## Folder Structure

```
extension/
├── manifest.json                 # MV3 manifest (single source of truth for permissions)
├── assets/icons/                 # Generated PNG icons (16/32/48/128)
└── src/
    ├── background/
    │   └── service-worker.js     # Transport engine, dedup, health, state owner
    ├── content/
    │   ├── content-script.js     # Isolated-world bridge (DOM → runtime)
    │   └── inject.js             # Page-world fetch/XHR monkey-patch (self-contained)
    ├── platforms/
    │   ├── pathao.js             # Pathao URL matchers + payload normalizers
    │   ├── foodmandu.js          # Foodmandu URL matchers + payload normalizers
    │   └── registry.js           # Adapter lookup
    ├── popup/                    # Operator dashboard (minimal OLED UI)
    ├── options/                  # Settings page
    └── shared/
        ├── constants.js          # Platforms, storage keys, message types, defaults
        └── utils.js              # Pure helpers (dedupe key, formatting)
```

## Architecture Invariants (do not break)

1. **Two-layer ingestion**: `inject.js` runs in the page's main world (monkey-patches `window.fetch` / `XMLHttpRequest`). `content-script.js` runs in the isolated world, listens via `window.postMessage`, and forwards via `chrome.runtime.sendMessage`. Never try to read vendor XHR bodies from the content script directly — the isolated world cannot see them.
2. **`inject.js` must stay self-contained** — it is injected via a `<script>` tag and cannot use ES module imports.
3. **Service worker is the single state owner** — popup/options never write order state; they request snapshots and send commands (`GET_STATE`, `TOGGLE_ENGINE`, `REPRINT_JOB`, `CLEAR_FEED`).
4. **Dedup before print** — composite key = `platform : accountId : orderId`. Polling loops will replay the same order; the backend also dedups, but the extension must dedup too to avoid hammering the local server.
5. **Multi-account = multiple Chrome profiles** — each profile has its own extension storage. Distinguish them with the `accountLabel` setting (e.g. "Account #1", "Account #2").
6. **All vendor surface area lives in `src/platforms/`** — when Pathao/Foodmandu change URLs or payload shapes, only touch platform adapters (and `inject.js` markers). Keep URL markers in sync between `inject.js` and the platform adapter for that vendor.

## Manifest V3 Rules

- Background is a **module service worker** (`"type": "module"`). It can be killed by the browser at any time — never assume long-lived in-memory state survives; hydrate from `chrome.storage` on startup and `onInstalled`.
- Content scripts are **classic scripts**, not modules. Do not add `import` statements to files listed under `content_scripts` or injected via script tag.
- Request the **minimum permissions**. Adding a new permission requires justification in the PR description.
- Use `host_permissions` only for the local backend. Vendor sites are covered by `content_scripts.matches` — do not add broad host permissions for vendor domains.
- No remote code. Everything bundled must ship with the extension.
- `web_accessible_resources` is limited to `inject.js` and scoped to vendor origins only.

## Messaging Conventions

- Message types live in `shared/constants.js` under `MSG`. Always add new types there — never use bare string literals scattered across files.
- Message shape: `{ type, ...payload }`. Validate `message.type` at the top of every listener.
- Prefer request/response (`sendMessage` + `sendResponse`) over fire-and-forget for anything the UI needs to reflect.
- `sendResponse` is async in some paths — return `true` from the listener to keep the message channel open.

## Storage

| Key | Location | Purpose |
|-----|----------|---------|
| `settings` | local | Backend URL, account label, auto-print toggle, dedup window |
| `printFeed` | local | Recent print jobs (capped at 50) |
| `seenOrders` | local | Dedup map `[key, timestamp]` (capped at 500, pruned by window) |
| `sessions` | in-memory (SW) | Live vendor tab heartbeats (TTL 2 min) |

- Never store credentials, tokens, or raw full order payloads long-term. Store only the normalized fields needed for reprint.
- All writes go through the service worker.

## Platform Adapter Contract

```js
// Every adapter exports:
{
  platform: "pathao" | "foodmandu",
  match(url: string): boolean,
  parse(url: string, payload: unknown): null | {
    platform: string,
    orderId: string,
    items: Array<{ name: string, quantity: number, notes: string|null }>,
    customer: string | null,
    rawType: string,
  }
}
```

- `parse` returns `null` when no order ID can be extracted — never invent an order ID.
- Field extraction is layered: top-level → `data` → nested `order`/`customer`. Prefer optional chaining over deep manual guards.
- Keep parsing defensive: vendor payloads will change without notice. Never throw from `parse`.

## UI Conventions

- **OLED pitch-black palette** (from architecture):
  - Base `#000000`, card `#0D0D0D`, border `#1F1F1F`
  - Success `#10B981`, danger `#EF4444`, warn `#F59E0B`
  - Muted text `#8A8A8A`, primary text `#F5F5F5`
- **No emojis in UI.** Use colored CSS dots/badges for status.
- Typography: `system-ui` stack for UI, monospace (`ui-monospace`) for IDs, URLs, timestamps.
- Popup width fixed at `360px`. Keep the feed scrollable (`max-height: 180px`).
- Escape all dynamic strings inserted into HTML (`escapeHtml` in popup.js).
- No inline styles or inline scripts — CSP forbids them in MV3 pages.

## Error Handling

- Network calls to the backend: wrap in try/catch, set `backendReachable = false` on failure, never let unhandled rejections crash the service worker.
- Content script and inject script: wrap `chrome.runtime.sendMessage` / DOM injection in try/catch — the extension context can be invalidated on reload while the page still lives.
- Failed prints stay in the feed with status `failed` and a Reprint action; they must never be silently dropped.

## Performance

- Service worker must stay lean — it is cold-started frequently.
- `inject.js` must patch fetch/XHR with negligible overhead; only parse JSON bodies for matching URLs.
- Session heartbeats: every 30s per tab, pruned at 2 min TTL.
- Health refresh alarm: every 30 seconds (`chrome.alarms`, not `setInterval` — SW timers die on suspend).

## Testing Checklist (manual, for now)

1. Load unpacked via `chrome://extensions` → Developer mode.
2. Open Pathao Resto + Foodmandu Partners tabs; popup should show 2 live sessions within ~5s.
3. With backend running on `:5001`, an order should appear in the feed as `printed` (or `failed` if backend rejects).
4. Re-polling the same order should show `duplicate` badge, not a second print.
5. Toggle engine off → new orders show `paused`.
6. Options page: change backend URL → health status updates within 30s.

## When Changing Vendors

1. Update URL markers in both `inject.js` and the platform adapter.
2. Verify payload shape against a real captured response before adjusting normalizers.
3. Add a sample payload note (redacted) to the PR.
4. Do not remove old markers until confirmed dead — vendor APIs often keep legacy routes briefly.

## Out of Scope (backend owns these)

- Devanagari translation / dictionary lookups
- Canvas rasterization / ESC-POS encoding
- USB printing / printer health probing (extension only displays what `/api/health` returns)

The extension's only contract with the backend is:

- `POST /api/auto-print` — body: `{ platform, orderId, accountId, customer, items[], sourceUrl, capturedAt, receivedAt, reprint? }`
- `GET /api/health` — response: `{ printer: string, unmappedCount: number }` (shape may evolve; read defensively)
