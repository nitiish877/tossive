'use strict';
const vscode = require('vscode');

const DEFAULT_BACKEND = 'https://localhost.com';

// The backend address can be changed in VS Code settings ("tossive.backendUrl"), e.g. for a local server.
function backendBase() {
  let raw = '';
  try { raw = String(vscode.workspace.getConfiguration('tossive').get('backendUrl') || '').trim(); } catch { raw = ''; }
  raw = raw.replace(/\/+$/, '').replace(/\/api$/i, '');
  const valid = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(raw) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(raw);
  return valid ? raw : DEFAULT_BACKEND;
}

function numberSetting(key, fallback, min, max) {
  let value = NaN;
  try { value = Number(vscode.workspace.getConfiguration('tossive').get(key)); } catch { value = NaN; }
  return Number.isFinite(value) && value > 0 ? Math.min(max, Math.max(min, value)) : fallback;
}

// Limits of the local safe check. Defaults are generous; users can change them in Settings > Tossive.
function checkLimits() {
  return {
    maxFiles: Math.round(numberSetting('check.maxFiles', 30, 1, 100)),
    maxTotalBytes: Math.round(numberSetting('check.maxKilobytes', 400, 10, 2000)) * 1024,
    runTimeoutMs: Math.round(numberSetting('check.runSeconds', 15, 3, 60)) * 1000,
  };
}

module.exports = {
  checkLimits,
  DEFAULT_BACKEND,
  backendBase,
  apiRoot: () => `${backendBase()}/api`,
  chatUrl: () => `${backendBase()}/api/chat`,
};
