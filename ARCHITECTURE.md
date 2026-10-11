Comprehensive System Architecture \& Engineering Blueprint: Autonomous Multi-Account KOT Translation \& USB Printing Engine1. Executive Architecture OverviewThis blueprint specifies a local-first, low-latency, event-driven automated system designed to intercept incoming restaurant orders from multiple accounts across two food delivery platforms (Pathao Resto and Foodmandu Partners), normalize order payloads, translate item descriptions into Devanagari (Nepali Unicode), and output rendered receipts to a USB-connected thermal Kitchen Order Ticket (KOT) printer.High-Level Data Flow TopologyPlaintext┌─────────────────────────────────────────────────────────────────────────────┐

│                       1. BROWSER INGESTION LAYER                            │

│  Chrome Instance (2 Profiles / Multi-Tab Session Context)                   │

│  ├── Profile A: Pathao Account 1  +  Foodmandu Account 1                     │

│  └── Profile B: Pathao Account 2  +  Foodmandu Account 2                     │

│                                                                             │

│  \[ injected\_interceptor.js ]  ──(Intercepts Fetch/XHR)                      │

│               │                                                             │

│               ▼ (DOM Window Message)                                        │

│  \[ content\_script.js ]                                                      │

│               │                                                             │

│               ▼ (Chrome Runtime Relay)                                      │

│  \[ background\_service\_worker.js ]                                           │

└──────────────────────────────────────┬──────────────────────────────────────┘

&#x20;                                      │ HTTP POST (JSON Payload)

&#x20;                                      ▼

┌─────────────────────────────────────────────────────────────────────────────┐

│                      2. LOCAL BACKEND ENGINE (Node.js)                      │

│  Listening on http://localhost:5000                                         │

│                                                                             │

│  ┌───────────────────────────────────────────────────────────────────────┐  │

│  │ A. Ingestion \& Deduplication Gateway                                  │  │

│  │    • Validates payload signature                                      │  │

│  │    • Checks Composite Key \[Platform + Account + OrderID] in SQLite   │  │

│  └──────────────────────────────────┬────────────────────────────────────┘  │

│                                     │ Unique Order                          │

│  ┌──────────────────────────────────▼────────────────────────────────────┐  │

│  │ B. Dictionary Translation Engine                                      │  │

│  │    • Multilevel Mapping (Exact -> Normalized Fuzzy -> Fallback)       │  │

│  │    • Enriches items with Devanagari text string                       │  │

│  └──────────────────────────────────┬────────────────────────────────────┘  │

│                                     │ Translated Object                     │

│  ┌──────────────────────────────────▼────────────────────────────────────┐  │

│  │ C. Devanagari Thermal Canvas Rasterizer                               │  │

│  │    • Renders Layout into 2D Headless Canvas (384px/576px width)       │  │

│  │    • Converts HTML/Text + Nepali Fonts to 1-Bit Monochrome Bitmap     │  │

│  │    • Transforms Bitmap into ESC/POS Raster Bytes (GS v 0 format)     │  │

│  └──────────────────────────────────┬────────────────────────────────────┘  │

│                                     │ Raw Byte Stream                       │

│  ┌──────────────────────────────────▼────────────────────────────────────┐  │

│  │ D. Hardware USB Driver Controller                                     │  │

│  │    • Outbound queue buffer manager                                    │  │

│  │    • Direct LibUSB / Raw OS Spooler Interface                         │  │

│  └──────────────────────────────────┬────────────────────────────────────┘  │

└──────────────────────────────────────┼──────────────────────────────────────┘

&#x20;                                      │ Raw ESC/POS Byte Array

&#x20;                                      ▼

┌─────────────────────────────────────────────────────────────────────────────┐

│                         3. HARDWARE OUTPUT LAYER                            │

│  \[ POS Thermal KOT Printer (58mm / 80mm) connected via Direct USB ]         │

└─────────────────────────────────────────────────────────────────────────────┘

2\. Browser Ingestion Layer (Chrome Extension V3)Multi-Account Session IsolationTo maintain four active vendor accounts simultaneously without credential conflict:Account Partitioning Strategy: Use two distinct Google Chrome Profiles (or Chrome Standard + Incognito Window bindings).Chrome Profile 1: Hosts Pathao Account 1 (resto.pathao.com) and Foodmandu Account 1 (partners.foodmandu.com).Chrome Profile 2: Hosts Pathao Account 2 and Foodmandu Account 2.Persistent Tab Binding: All four tabs remain opened, pinned, and active in the background.Interceptor Architecture \& Ingestion MechanicsBecause modern browser extension content scripts run in isolated execution worlds, they cannot directly read response data from window.fetch or window.XMLHttpRequest initiated by vendor page scripts.Two-Layer Ingestion Injection Pattern:Page-Context Script (inject.js): The content script programmatically appends a <script> tag into the page's DOM root at document\_start. This injects code directly into the main window execution context, enabling full monkey-patching of window.fetch and window.XMLHttpRequest.prototype.open.Isolated Content Script (content\_script.js): Listens for internal browser events dispatched from inject.js using window.addEventListener("message"), extracts normalized payloads, and forwards them to the extension's background service worker via chrome.runtime.sendMessage().Background Service Worker (background.js): Acts as the central transport engine. It receives order objects from any active browser tab, attaches an Account Identifier metadata tag based on tab/origin context, and executes an HTTP POST request to the local printing server (http://localhost:5000/api/auto-print).Target Endpoint Mapping \& Payload Detection LogicPathao Resto Interception Filter:Active Polling Endpoint: Watch for background requests containing /api/proxy/resto-polling-service/api/v1/polling/poll.Detail Fetch Endpoint: Watch for detail calls containing /api/proxy/resto-service/resto/orders/details/<ORDER\_ID>.Key Payload Target Fields: Extract serial\_no, user\_details.name, items\[].name, items\[].quantity, and subtotal.Foodmandu Partners Interception Filter:Polling \& Detail Endpoints: Watch for requests matching /Vendor/, /Order/, or responses containing root fields VendorOrderNo, OrderId, or OrderDetails.Key Payload Target Fields: Extract VendorOrderNo/OrderId, CustomerName, OrderDetails\[].ProductName, OrderDetails\[].Quantity, and GrandTotal.3. Local Backend Engine Architecture (Node.js System)The local backend engine runs as a lightweight, continuous background service (managed via PM2 or compiled as an Electron system tray app) on the restaurant desktop machine.Plaintext\[HTTP Gateway] ──> \[Deduplication Store] ──> \[Translation Engine] ──> \[Canvas Renderer] ──> \[USB Driver]

Core Engine ModulesHTTP Gateway Interface (Fastify / Express):Exposes internal API endpoints:POST /api/auto-print: Receives order payloads from the Chrome extension.GET /api/health: Provides continuous health metrics (USB connectivity, queue size, database state) to the extension popup UI.POST /api/dictionary: Allows adding/editing item translations from the operator dashboard.Order Idempotency \& Deduplication Engine:Problem: Web vendors use repetitive polling loops (e.g., polling every 3–5 seconds), causing identical order payloads to arrive continuously while an order remains active.Solution (Composite Key Deduplication):Construct a unique hash key: SHA256(Platform\_AccountID\_OrderID).Maintain an In-Memory LRU Cache synced with an embedded SQLite Database (better-sqlite3).If the incoming key exists in the database within a configurable time window (e.g., last 24 hours), the server drops the request immediately with a 200 OK (Duplicate Ignored) status without triggering the printer.4. Translation \& Menu Mapping EngineBecause vendor platforms output item names in Romanized English ("Buff Steam Momo", "Chicken Chowmein"), the translation engine maps these strings into clear, standardized Devanagari text ("बफ मःमः (भाप)", "चिकन चौमिन").PlaintextIncoming Item String: "Buff Steam Momo"

&#x20;      │

&#x20;      ▼

┌──────────────────────────┐

│ Exact Hash Lookup        │ ──(Found)──> Return Devanagari String

└────────────┬─────────────┘

&#x20;            │ (Miss)

&#x20;            ▼

┌──────────────────────────┐

│ Normalized Fuzzy Search  │ ──(Found)──> Return Devanagari String + Log Notice

└────────────┬─────────────┘

&#x20;            │ (Miss)

&#x20;            ▼

┌──────────────────────────┐

│ Fallback Handler         │ ──> Return Original English String + Append "\[NEW]" Tag

└──────────────────────────┘

Multi-Tiered Translation PipelineTier 1: Exact Key-Value Lookup (Primary)Queries a pre-compiled JSON/SQLite dictionary table mapping standardized menu items directly to their Devanagari equivalents.Case-insensitive, whitespace-trimmed comparison.Tier 2: Normalized Fuzzy String Matching (Secondary)Utilizes the Fuse.js or Fast-Levenshtein library to match minor menu name variations (e.g., "Buff Steam Momo." vs "Buff Steam Momo" or "Buff Steamed Momo").Sets a strict similarity threshold score (e.g., similarity > 0.88). If matched, returns the corresponding Devanagari entry and logs an entry to auto-alias the variation.Tier 3: Fallback \& Operator Alert Handler (Tertiary)If a brand-new menu item is detected that does not exist in the dictionary:The item is preserved in its original English format so kitchen staff can still read it.An alert flag (is\_untranslated: true) is saved in the SQLite store.The item is pushed to the operator UI dashboard under "Unmapped Menu Items", allowing the restaurant manager to input the Nepali translation once, updating the dictionary permanently for future orders.5. Devanagari Thermal Canvas \& ESC/POS Rasterization PipelineThe Hardware Rendering ChallengeThermal receipt printers (Epson, Star Micronics, TVS, Xprinter, etc.) operate on fixed firmware code pages (like PC437, PC858). No standard thermal printer possesses native font ROMs capable of rendering complex Devanagari Unicode glyphs directly from raw text strings. Sending raw UTF-8 Nepali characters results in garbled text (???? or random symbol artifacts).The Solution: Canvas Graphic RasterizationInstead of sending text commands, the engine converts the receipt layout into a high-resolution 2D graphic bitmap image containing pre-rendered Devanagari typography, then transforms that bitmap into ESC/POS graphic bit-image raster instructions.Plaintext\[Receipt JSON Payload]

&#x20;      │

&#x20;      ▼

\[Headless HTML Canvas Setup] ──(Apply System Fonts: Kalimati / Mukti / Noto Sans)

&#x20;      │

&#x20;      ▼

\[Canvas Context 2D Drawing]  ──(Draw Headers, Lines, Quantities \& Nepali Text)

&#x20;      │

&#x20;      ▼

\[1-Bit Binarization Shader]  ──(Threshold pixels: RGB > 128 ? White : Black)

&#x20;      │

&#x20;      ▼

\[ESC/POS Raster Conversion]  ──(Generate "GS v 0" Bit-Image Command Buffer)

&#x20;      │

&#x20;      ▼

\[Outbound USB Byte Stream]

Detailed Canvas Pipeline StepsCanvas Geometry Setup:For 58mm Printers: Canvas width locked strictly to 384 pixels (printable area).For 80mm Printers: Canvas width locked strictly to 576 pixels.Height is dynamic, calculated based on the number of line items.Typography \& Layout Rendering (using node-canvas or skia-canvas):Load local Devanagari TrueType fonts (Noto Sans Devanagari, Kalimati, or Mukti).Draw header blocks: Platform Name (Bold, large font), Order Serial Number, Customer Info, Timestamp.Draw item table:Quantity Column: Large, bold text (e.g., 2x).Item Description: Devanagari text rendered at standard size with word-wrapping.Add-ons / Notes: Indented text directly under the main item.Draw horizontal divider lines using solid vector paths.Monochrome (1-Bit) Pixel Binarization:Thermal printheads can only toggle an individual thermal element ON (Black) or OFF (White).The rendered 32-bit RGBA canvas array is processed using a thresholding algorithm:$$\\text{Luminance} = 0.299R + 0.587G + 0.114B$$$$\\text{Pixel State} = \\begin{cases} 0 \\text{ (White)}, \& \\text{if Luminance} > 128 \\\\ 1 \\text{ (Black)}, \& \\text{if Luminance} \\le 128 \\end{cases}$$ESC/POS Bit-Image Byte Generation:Map the 1-bit binary grid into bytes (8 pixels per byte).Wrap the binary payload inside standard ESC/POS raster bit-image command headers:GS v 0 m xL xH yL yH \[raster byte data]Append auto-cut command bytes (GS V 66 0) at the tail of the buffer to trigger the automatic paper cutter on supported hardware.6. USB Hardware Interface \& OS CommunicationUSB Communication LayerTo transmit raw ESC/POS byte buffers to the physical thermal printer connected via USB, use direct USB hardware endpoint communication via node-usb (LibUSB wrapper) or platform-native raw printing bindings.Plaintext\[ESC/POS Byte Buffer] ──> \[USB Queue] ──> \[Endpoint Bulk Transfer] ──> \[Physical KOT Printer]

Connection Management \& Driver StrategiesVendor ID (VID) \& Product ID (PID) Auto-Discovery:The backend scans connected USB interfaces using system USB enumeration.Standard POS thermal printers expose a USB Class 0x07 (Printer Interface) with a Bulk Transfer Endpoint.The engine detects printer interfaces matching common VID/PIDs (e.g., Epson 0x04b8, TVS/Xprinter 0x0483, Star 0x0519) or allows manual selection in settings.Windows Driver Handling (Zadig / WinUSB vs. Win32 Raw Print):Direct LibUSB Method: Requires replacing the default vendor printer driver with WinUSB via Zadig. Allows the Node.js application to claim interface #0 and execute direct bulk transfers.Raw Win32 Spooler Method (Alternative for Standard Windows Spooler): If maintaining standard Windows printer drivers is desired, use native OS printing bindings (e.g., pdf-to-printer or direct raw spooling via Windows OpenPrinter / WritePrinter API using Node native extensions) to bypass driver graphic overrides and send raw ESC/POS bytes straight to the spooler queue.Hardware Health Monitoring \& Reconnect Loop:Maintain a 5-second background heartbeat check to verify USB device readiness.If a user unplugged the printer, paper ran out, or the USB connection dropped:Flag system state as PRINTER\_OFFLINE.Retain pending order payloads in a persistent retry queue (SQLite / BullMQ).Automatically flush the queue sequentially upon reconnection without dropping orders.7. Fault Tolerance, Deduplication \& Queue ManagementIdempotency MatrixEvent ScenarioSystem ActionResultDuplicate Polling Request (Same Order)Detected in SQLite cache via Platform\_OrderIDIgnored (HTTP 200 returned, no print)New Order Arrives (Printer Online)Processed, translated, rasterized, sent to USBPrinted Instantly (\~300ms)New Order Arrives (Printer Offline/Out of Paper)Processed, translated, rasterized, saved to QueueHeld in Queue + UI Alert ActivePrinter Reconnected / Paper LoadedQueue auto-flushes in chronological orderAll missed orders printed sequentiallyPower Failure / CrashNode.js process restarted via PM2 / System ServiceState recovered from SQLite disk storeQueue ArchitecturePlaintextIncoming Order ──> \[Deduplication Check] ──> Pass ──> \[SQLite Queue Store (Status: PENDING)]

&#x20;                                                             │

&#x20;                                                             ▼

&#x20;                                                  \[Queue Worker Loop]

&#x20;                                                             │

&#x20;                                      ┌──────────────────────┴──────────────────────┐

&#x20;                                (USB Ready)                                   (USB Offline)

&#x20;                                      │                                             │

&#x20;                                      ▼                                             ▼

&#x20;                         \[Stream ESC/POS Bytes]                     \[Retain Item \& Retry in 3s]

&#x20;                                      │                                             │

&#x20;                                      ▼                                             ▼

&#x20;                        \[Mark Status: COMPLETED]                     \[Emit UI Warning Banner]

8\. Pitch-Black UI/UX \& Operator Dashboard SpecificationsThe extension popup and web dashboard follow an OLED Pitch Black Aesthetic (#000000 base, #0D0D0D card containers, #1F1F1F structural borders, with crisp Emerald #10B981 and Crimson #EF4444 indicator accents).Interface Structural SectionsPlaintext┌─────────────────────────────────────────────────────────┐

│ 🟢 KOT BRIDGE ENGINE                              v1.0  │

├─────────────────────────────────────────────────────────┤

│ AUTO-PRINT ENGINE                              \[ ON ]   │

│ Status: Active • Listening on Port 5000                 │

├─────────────────────────────────────────────────────────┤

│ ACTIVE VENDOR SESSIONS (4)                              │

│ ┌───────────────────────────┐ ┌───────────────────────┐ │

│ │ 🟢 Pathao Account #1       │ │ 🟢 Pathao Account #2  │ │

│ ├───────────────────────────┤ ├───────────────────────┤ │

│ │ 🟢 Foodmandu Account #1   │ │ 🟢 Foodmandu Account #2│ │

│ └───────────────────────────┘ └───────────────────────┘ │

├─────────────────────────────────────────────────────────┤

│ LIVE PRINT FEED                                  Clear  │

│ ┌─────────────────────────────────────────────────────┐ │

│ │ 16:42 • Pathao Resto #7825                \[PRINTED] │ │

│ │ 3 items • 🖨️ USB Bulk Sent                           │ │

│ ├─────────────────────────────────────────────────────┤ │

│ │ 16:38 • Foodmandu #FM-9812                \[PRINTED] │ │

│ │ 2 items • 🖨️ USB Bulk Sent                           │ │

│ └─────────────────────────────────────────────────────┘ │

├─────────────────────────────────────────────────────────┤

│ HARDWARE STATUS                                         │

│ Thermal Printer: Connected (Xprinter XP-Q800 USB)       │

│ Unmapped Menu Items: 0 pending                          │

└─────────────────────────────────────────────────────────┘

Essential Dashboard Components \& ControlsEngine Master Toggle:Hardware switch interface allowing operators to pause auto-printing temporarily during kitchen line maintenance without logging out of food delivery accounts.4-Account Live Session Indicators:Real-time connection status tiles representing each connected platform account.Detects active DOM heartbeats from each tab to ensure background sessions have not timed out or logged out.Live Print Feed \& Manual Re-Print Button:Chronological list of processed orders displaying order ID, platform origin, item counts, timestamp, and print status.Includes a "Re-Print KOT" button next to each past order to immediately resend the rasterized payload to the USB printer in case paper jammed.Dictionary \& Menu Alias Manager (In Web Dashboard):UI interface listing all translated items.Provides a search input field and an "Add Translation" modal to instantly map newly discovered English menu items to Devanagari text.9. Recommended Technology Stack \& Production LibrariesBrowser Extension LayerManifest Version: Chrome Extensions Manifest V3DOM Injection Utility: Native Browser Context Script Injection (document\_start)Styling Framework: Custom Pure CSS3 (Scoped Variables, OLED Dark Theme Palette)Local Backend Server EnvironmentRuntime Platform: Node.js (v18+ LTS or v20+ LTS)API Server Framework: Fastify (Ultra low-overhead HTTP performance) or ExpressDatabase Engine: better-sqlite3 (Fast, synchronous, disk-backed embedded database for order logs, idempotency state, and translation dictionaries)Process Manager: PM2 (Configured with auto-start on boot) or Electron (for a graphical system tray desktop application)Translation \& Text ProcessingFuzzy Matching Library: fuse.js (Lightweight, client-side/server-side fuzzy search library)Text Normalization: Native JavaScript Unicode Regular Expressions (\\p{L})Graphic Canvas \& ESC/POS RasterizationHeadless 2D Canvas Engine: skia-canvas or node-canvas (C++ bound native rendering performance for node)Font Packages: Google Noto Sans Devanagari TrueType Font (.ttf) files bundled locally in the project assets folderESC/POS Command Utility: Custom bit-image encoder or escpos framework core utilitiesUSB Hardware CommunicationDirect USB Access: usb (Node.js LibUSB binding) or escpos-usbNative Spooler Alternative: pdf-to-printer / node-printer (For standard OS print spooler routing)10. Summary Verification ChecklistBefore deploying this system in a live restaurant kitchen environment, verify that:Account Isolation: All 4 vendor tabs remain logged in across active Chrome profile sessions without unexpected auto-logout timeouts.Network Filtering: The interceptor isolates order payload responses without interfering with vendor page operations or standard user clicks.Canvas Raster Output: Devanagari Unicode characters render crisp, sharp, and without illegible anti-aliasing artifacts when binarized to 1-bit thermal print commands.Hardware Stability: The backend recovers gracefully if the USB printer cable is disconnected and reconnected, flushing queued orders without duplicate prints.

