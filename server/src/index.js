import { createKotServer } from "./server.js";

const server = createKotServer();
await server.start();
console.log(`  POST /api/auto-print`);
console.log(`  GET  /api/health`);
console.log(`  POST /api/dictionary`);
console.log(`  GET  /api/jobs`);

function shutdown() {
  console.log("Shutting down KOT Bridge server...");
  server.stop().then(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
