import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("kot", {
  getStatus: () => ipcRenderer.invoke("kot:get-status"),
  testPrint: () => ipcRenderer.invoke("kot:test-print"),
  clearJobs: () => ipcRenderer.invoke("kot:clear-jobs"),
  toggleAutoPrint: (enabled) => ipcRenderer.invoke("kot:toggle-auto-print", enabled),
  setPrinter: (status) => ipcRenderer.invoke("kot:set-printer", status),
  onLog: (cb) => ipcRenderer.on("kot:log", (_e, line) => cb(line)),
});
