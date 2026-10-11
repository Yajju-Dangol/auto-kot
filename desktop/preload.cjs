const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kot", {
  getStatus: () => ipcRenderer.invoke("kot:get-status"),
  testPrint: () => ipcRenderer.invoke("kot:test-print"),
  reprintJob: (jobId) => ipcRenderer.invoke("kot:reprint-job", jobId),
  clearJobs: () => ipcRenderer.invoke("kot:clear-jobs"),
  toggleAutoPrint: (enabled) => ipcRenderer.invoke("kot:toggle-auto-print", enabled),
  setPrinter: (status) => ipcRenderer.invoke("kot:set-printer", status),
  onLog: (cb) => ipcRenderer.on("kot:log", (_e, line) => cb(line)),
  onJobUpdated: (cb) => ipcRenderer.on("kot:job-updated", (_e, data) => cb(data)),
});
