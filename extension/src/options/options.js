import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../shared/constants.js";

const els = {
  backendUrl: document.getElementById("backend-url"),
  accountLabel: document.getElementById("account-label"),
  dedupeHours: document.getElementById("dedupe-hours"),
  autoPrint: document.getElementById("auto-print"),
  btnSave: document.getElementById("btn-save"),
  btnReset: document.getElementById("btn-reset"),
  status: document.getElementById("status"),
};

function fillForm(settings) {
  els.backendUrl.value = settings.backendUrl;
  els.accountLabel.value = settings.accountLabel;
  els.dedupeHours.value = String(settings.dedupeWindowHours);
  els.autoPrint.checked = Boolean(settings.autoPrintEnabled);
}

function readForm() {
  return {
    backendUrl: els.backendUrl.value.trim().replace(/\/$/, "") || DEFAULT_SETTINGS.backendUrl,
    accountLabel: els.accountLabel.value.trim() || DEFAULT_SETTINGS.accountLabel,
    dedupeWindowHours: Math.min(168, Math.max(1, Number(els.dedupeHours.value) || DEFAULT_SETTINGS.dedupeWindowHours)),
    autoPrintEnabled: els.autoPrint.checked,
  };
}

async function load() {
  const { [STORAGE_KEYS.SETTINGS]: stored } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  fillForm({ ...DEFAULT_SETTINGS, ...(stored || {}) });
}

async function save() {
  const settings = readForm();
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
  els.status.textContent = "Saved.";
  setTimeout(() => {
    els.status.textContent = "";
  }, 1500);
}

async function reset() {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS } });
  fillForm(DEFAULT_SETTINGS);
  els.status.textContent = "Reset to defaults.";
  setTimeout(() => {
    els.status.textContent = "";
  }, 1500);
}

els.btnSave.addEventListener("click", () => void save());
els.btnReset.addEventListener("click", () => void reset());

void load();
