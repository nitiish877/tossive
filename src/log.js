'use strict';
const vscode = require('vscode');

let channel;
function output() {
  if (!channel) channel = vscode.window.createOutputChannel('Tossive');
  return channel;
}

// Diagnostics only: sizes, timings and (on failures) a short snippet of what the model replied. Prompts are never logged.
function log(message) {
  try { output().appendLine(`[${new Date().toLocaleTimeString()}] ${message}`); } catch { /* logging must never break the extension */ }
}

function show() {
  try { output().show(true); } catch { /* ignore */ }
}

function oneLine(text, max = 240) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = { log, show, oneLine };
