/* Tossive panel UI. Runs inside the VS Code webview; talks to the extension through postMessage. */
const api = acquireVsCodeApi();
const files = document.getElementById('files');
const history = document.getElementById('history');
const promptBox = document.getElementById('prompt');
const sendButton = document.getElementById('send');
const clearChatButton = document.getElementById('clear-chat');
const restoreChatButton = document.getElementById('restore-chat');
const authAction = document.getElementById('auth-action');
const addFilesButton = document.getElementById('add');
const modeSelect = document.getElementById('mode');

let selectedFiles = [];
let canRestore = false;
let requestNumber = 0;
let inFlight = false;
let auth = { signedIn: false, guestMessagesUsed: 0, status: '', message: '', verificationUrl: '' };
const saved = api.getState() || { messages: [] };
if (!Array.isArray(saved.messages)) saved.messages = [];
modeSelect.value = ['auto', 'build', 'chat'].includes(saved.mode) ? saved.mode : 'auto';

document.addEventListener('visibilitychange', () => { if (!document.hidden) api.postMessage({ type: 'refreshAuth' }); });
window.addEventListener('focus', () => api.postMessage({ type: 'refreshAuth' }));

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function button(label, cls, onClick, title) {
  const node = el('button', cls || 'small-button', label);
  if (title) node.title = title;
  if (onClick) node.onclick = onClick;
  return node;
}

function isLocked() { return !auth.signedIn && auth.guestMessagesUsed >= 3; }

function refreshSendState() {
  sendButton.disabled = isLocked() || !promptBox.value.trim() || inFlight;
}

function appendInline(parent, text) {
  const pattern = /(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let offset = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > offset) parent.append(document.createTextNode(text.slice(offset, match.index)));
    const token = match[0];
    const markdownLink = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
    const plainUrl = /^(https?:\/\/[^\s<>()]+)$/.exec(token);
    if (markdownLink || plainUrl) {
      let url = markdownLink ? markdownLink[2] : plainUrl[1];
      let trailing = '';
      while (/[.,!?;:]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          const link = document.createElement('a');
          link.href = parsedUrl.href;
          link.textContent = markdownLink ? markdownLink[1] : url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          parent.append(link, document.createTextNode(trailing));
        } else parent.append(document.createTextNode(token));
      } catch {
        parent.append(document.createTextNode(token));
      }
      offset = pattern.lastIndex;
      continue;
    }
    const code = token.startsWith('`');
    const bold = token.startsWith('**') || token.startsWith('__');
    const node = document.createElement(code ? 'code' : bold ? 'strong' : 'em');
    const delimiterLength = bold ? 2 : 1;
    node.textContent = token.slice(delimiterLength, token.length - delimiterLength);
    parent.append(node);
    offset = pattern.lastIndex;
  }
  if (offset < text.length) parent.append(document.createTextNode(text.slice(offset)));
}

function renderMarkdown(parent, text) {
  let list = null;
  let listType = '';
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { list = null; listType = ''; continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      list = null;
      const node = document.createElement('h' + Math.min(heading[1].length, 4));
      appendInline(node, heading[2].replace(/\s+#+\s*$/, ''));
      parent.append(node);
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    const item = bullet || numbered;
    const type = bullet ? 'ul' : 'ol';
    if (item) {
      if (!list || listType !== type) { list = document.createElement(type); listType = type; parent.append(list); }
      const li = document.createElement('li');
      appendInline(li, item[1]);
      list.append(li);
      continue;
    }
    list = null;
    listType = '';
    const p = document.createElement('p');
    appendInline(p, trimmed);
    parent.append(p);
  }
}

function renderActivity(label) {
  const row = el('div', 'activity');
  const dots = el('span', 'activity-dots');
  for (let i = 0; i < 3; i++) dots.append(document.createElement('i'));
  row.append(dots, el('span', '', label || 'Thinking…'));
  return row;
}

function updateHistoryControls() {
  clearChatButton.hidden = !saved.messages.length;
  restoreChatButton.hidden = !canRestore;
}

function renderFiles() {
  files.replaceChildren();
  for (const f of selectedFiles) {
    const chip = el('div', 'chip');
    const name = el('span', 'chip-name', f.label);
    const remove = el('button', '', '×');
    name.title = f.label;
    remove.title = 'Remove ' + f.label;
    remove.onclick = () => api.postMessage({ type: 'removeFile', uri: f.uri });
    chip.append(name, remove);
    files.append(chip);
  }
}

/* ---------- one-click "next move" buttons ---------- */
function nextChip(label, onClick, title) {
  return button(label, 'next-chip', onClick, title || label);
}

function renderPlanCard(item) {
  const card = el('div', 'build-card');
  const plan = item.plan || {};
  card.append(el('div', 'build-title', 'Plan ready: ' + (plan.title || 'New project')), el('div', 'build-summary', plan.summary || ''));
  if (plan.folder) card.append(el('div', 'muted', 'Project folder: ' + plan.folder));
  card.append(el('div', 'section-label', 'Files to create · ' + (plan.files || []).length));
  for (const f of plan.files || []) {
    const row = el('div', 'file-row');
    row.append(el('span', 'file-path', f.path), el('span', 'muted plan-purpose', f.purpose || ''));
    card.append(row);
  }
  card.append(el('div', 'muted', 'This is a bigger project, so Tossive checks with you before generating every file.'));
  const actions = el('div', 'actions');
  actions.append(
    button('Approve & build', 'small-button primary', () => api.postMessage({ type: 'approvePlan', requestId: item.requestId }), 'Generate all of these files'),
    button('Cancel', 'small-button', () => api.postMessage({ type: 'cancelPlan', requestId: item.requestId }), 'Do not create anything'),
  );
  card.append(actions);
  return card;
}

function renderCheck(card, item) {
  const check = item.check;
  if (!check) return;
  card.append(el('div', 'section-label', 'Safe check'));
  if (check.status === 'running') { card.append(renderActivity(check.text)); return; }
  const icon = { pass: '✓', fail: '✗', skipped: '–' }[check.status] || '–';
  const head = el('div', 'check-head check-' + check.status);
  head.append(el('span', 'check-icon', icon), el('span', '', check.text || ''));
  card.append(head);
  if (check.fixed?.length) card.append(el('div', 'muted', 'Fixed automatically: ' + check.fixed.join(', ')));
  for (const step of check.steps || []) {
    const row = el('div', 'step-row step-' + step.status);
    row.append(el('span', 'step-icon', { pass: '✓', fail: '✗', warn: '!', skip: '–' }[step.status] || '–'), el('span', 'step-name', step.name), el('span', 'muted step-detail', step.detail));
    card.append(row);
    if (step.output) {
      const details = el('details', 'step-output');
      details.append(el('summary', '', 'Output'));
      const pre = el('pre', 'command-text', step.output);
      details.append(pre);
      card.append(details);
    }
  }
}

function renderSandbox(card, item) {
  if (item.sandboxPhase) card.append(renderActivity(item.sandboxPhase));
  if (item.sandboxError) card.append(el('div', 'build-summary', item.sandboxError));
  if (!item.sandboxResult) return;
  card.append(el('div', 'build-title', item.sandboxResult.success ? 'Cloud sandbox run completed' : 'Cloud sandbox run returned an error'));
  for (const step of item.sandboxResult.steps || []) {
    card.append(el('div', 'section-label', step.label + ' · exit ' + step.exitCode));
    const output = [step.stdout, step.stderr].filter(Boolean).join('\n');
    if (output) card.append(el('pre', 'command-text', output));
  }
}

/* ---------- before/after view: red = previous code, green = new code ---------- */
function codeCell(line) {
  const cell = el('span', 'code');
  const text = line.s === '' ? '\u00a0' : line.s;
  if (line.h && line.t !== 'c' && line.h[1] > line.h[0] && line.s !== '') {
    const start = Math.min(line.h[0], line.s.length);
    const end = Math.min(line.h[1], line.s.length);
    cell.append(document.createTextNode(line.s.slice(0, start)));
    cell.append(el('mark', '', line.s.slice(start, end)));
    cell.append(document.createTextNode(line.s.slice(end)));
  } else cell.textContent = text;
  return cell;
}

function renderDiff(file, open) {
  const box = el('details', 'diff-box');
  box.open = open;
  const summary = el('summary', 'diff-summary');
  summary.append(el('span', 'diff-title', file.path), el('span', 'plus', '+' + file.added), el('span', 'minus', '-' + file.removed));
  box.append(summary);
  const body = el('div', 'diff');
  const legend = el('div', 'diff-legend');
  legend.append(el('span', 'legend-del', 'Red: previous code'), el('span', 'legend-add', 'Green: new code'));
  body.append(legend);
  for (const hunk of file.diff.hunks) {
    const first = hunk.lines[0] || {};
    body.append(el('div', 'diff-hunk', 'Line ' + (first.o || first.n || hunk.o || hunk.n || 1)));
    for (const line of hunk.lines) {
      const row = el('div', 'diff-line ' + (line.t === 'd' ? 'del' : line.t === 'a' ? 'add' : 'ctx'));
      row.append(el('span', 'ln', line.o || ''), el('span', 'ln', line.n || ''), el('span', 'sign', line.t === 'd' ? '−' : line.t === 'a' ? '+' : ''), codeCell(line));
      body.append(row);
    }
  }
  if (file.diff.truncated) body.append(el('div', 'diff-hunk', 'More changes not shown here. Use Diff to open the full comparison in the editor.'));
  box.append(body);
  return box;
}

function renderBuildCard(item, isLast) {
  if (item.awaitingPlan && item.plan) return renderPlanCard(item);
  const card = el('div', 'build-card');
  const d = item.data || {};
  if (item.phase) { card.append(renderActivity(item.phase)); return card; }
  if (item.error) {
    card.append(el('div', 'build-title', 'Could not finish project'), el('div', 'build-summary', item.error));
    return card;
  }
  if (item.cancelled) card.append(el('div', 'build-title', 'Cancelled'), el('div', 'build-summary', item.cancelled));
  if (item.undoText) card.append(el('div', 'build-summary', item.undoText));
  if (item.approved) {
    card.append(el('div', 'build-title', 'Changes applied'), el('div', 'build-summary', 'The selected workspace files were updated. Review the changed-file list or undo these changes.'));
  } else {
    card.append(el('div', 'build-title', d.title || 'Project ready'), el('div', 'build-summary', d.summary || ''));
    if (d.folder) card.append(el('div', 'muted folder-note', 'Created in folder: ' + d.folder));
    if (d.requirements?.length) {
      card.append(el('div', 'section-label', d.reviewMode ? 'Review findings' : 'Requirements'));
      const ul = el('ul', 'list');
      for (const x of d.requirements.slice(0, 5)) ul.append(el('li', '', x));
      card.append(ul);
    }
    if (d.architecture?.length) card.append(el('div', 'section-label', 'Structure and design'), el('div', 'build-summary', d.architecture.slice(0, 3).join(' · ')));
  }

  if (d.files?.length) {
    card.append(el('div', 'section-label', 'Changed files · ' + d.files.length));
    let shownDiffs = 0;
    for (const f of d.files) {
      const row = el('div', 'file-row');
      row.append(
        el('span', 'file-path', f.path),
        el('span', 'muted', f.action === 'created' ? 'New' : 'Updated'),
        el('span', 'plus', '+' + f.added),
        el('span', 'minus', '-' + f.removed),
        button('Open diff', 'small-button', () => api.postMessage({ type: 'viewDiff', requestId: item.requestId, path: f.path }), 'Open the side-by-side comparison in the editor'),
      );
      card.append(row);
      if (f.diff && f.diff.hunks && f.diff.hunks.length) card.append(renderDiff(f, shownDiffs++ < 3));
    }
  } else if (d.reviewMode) {
    card.append(el('div', 'muted', 'No selected files need changes.'));
  }

  // Approval: plain buttons, nothing to type.
  if (item.awaitingApproval && !item.approved) {
    card.append(el('div', 'permission', 'Allow Tossive to apply these changes to your files? Nothing is changed until you click Allow.'));
    const approval = el('div', 'actions');
    approval.append(
      button('Allow & apply changes', 'small-button primary', () => api.postMessage({ type: 'approveChanges', requestId: item.requestId }), 'Write the new code shown in green into your files. You can undo afterwards.'),
      button('Don\'t apply', 'small-button', () => api.postMessage({ type: 'cancelChanges', requestId: item.requestId }), 'Keep your files exactly as they are'),
    );
    card.append(approval);
  }

  renderCheck(card, item);

  const ready = d.files?.length && !item.awaitingApproval && !item.cancelled && !item.undoText;
  const checking = item.check?.status === 'running';
  if (ready && !d.reviewMode) {
    card.append(el('div', 'section-label', 'Next moves'));
    const moves = el('div', 'next-row');
    if (d.canCheck) {
      const checkButton = button(checking ? 'Checking…' : item.check ? 'Run check again' : 'Run & check', 'next-chip primary', () => api.postMessage({ type: 'runCheck', requestId: item.requestId }), 'Safe check: syntax, missing files and one short run. Tossive fixes simple errors automatically (up to 2 rounds).');
      checkButton.disabled = checking;
      moves.append(checkButton);
    }
    moves.append(nextChip('Open project', () => api.postMessage({ type: 'openProject', requestId: item.requestId }), 'Open the main file and show the folder in the Explorer'));
    if (d.browserFile) moves.append(nextChip('Open in browser', () => api.postMessage({ type: 'openProject', requestId: item.requestId, browser: true }), 'Open ' + d.browserFile + ' in your default browser'));
    if (d.commands?.length) moves.append(button(item.sandboxPhase ? 'Running…' : 'Cloud sandbox', 'next-chip', () => api.postMessage({ type: 'runSandbox', requestId: item.requestId }), 'Run the setup and run commands in an isolated cloud sandbox. Needs sign-in and may use credits.'));
    card.append(moves);

    if (d.commands?.length) {
      for (let i = 0; i < d.commands.length; i++) {
        const c = d.commands[i];
        const row = el('div', 'command-row');
        const text = el('span', 'command-text', c.command || c.label);
        text.title = c.command || c.label;
        row.append(el('span', 'command-label', c.label), text,
          button('Run', 'small-button primary', () => api.postMessage({ type: 'runCommand', requestId: item.requestId, index: i }), c.safe ? 'Runs in the project terminal' : 'Asks once, then runs in the project terminal'));
        card.append(row);
      }
    }
    if (isLast && d.nextSteps?.length && !inFlight) {
      const ideas = el('div', 'next-row');
      for (const label of d.nextSteps) ideas.append(nextChip(label, () => submit(label, { mode: 'build', followUpOf: item.requestId }), 'Tossive will update this project'));
      card.append(ideas);
    }
  }

  renderSandbox(card, item);

  if (d.files?.length && (d.canUndo || item.approved)) {
    const actions = el('div', 'actions');
    actions.append(button('Undo changes', 'small-button', () => api.postMessage({ type: 'undoBuild', requestId: item.requestId })));
    card.append(actions);
  }
  return card;
}

function render() {
  updateHistoryControls();
  history.replaceChildren();
  const guestLocked = isLocked();
  authAction.textContent = 'Sign in / Sign up';
  authAction.hidden = auth.signedIn;
  promptBox.disabled = guestLocked;
  modeSelect.disabled = guestLocked;
  refreshSendState();
  addFilesButton.disabled = guestLocked;
  for (const b of files.querySelectorAll('button')) b.disabled = guestLocked;

  if (!saved.messages.length) {
    const w = el('div', 'welcome');
    w.append(el('strong', '', 'Ask a question or describe what to build'));
    w.append(el('span', '', 'Ask about selected files, extract information, or request an error review—the answer appears here by default. Ask explicitly for a file change when you want Tossive to prepare a diff. Builds and checks happen only when requested.'));
    const examples = el('div', 'next-row example-row');
    for (const text of ['Build a snake game with a score and a start screen', 'Create a to-do web app that saves tasks in the browser', 'Make a Python script that renames files by date']) {
      examples.append(nextChip(text, () => submit(text, { mode: 'build' })));
    }
    w.append(examples);
    history.append(w);
  } else {
    const lastIndex = saved.messages.length - 1;
    saved.messages.forEach((item, index) => {
      const bubble = el('div', 'message ' + (item.role === 'user' ? 'user' : 'assistant'));
      const isLast = index === lastIndex;
      if (item.kind === 'build') bubble.append(renderBuildCard(item, isLast));
      else if (item.kind === 'status') bubble.append(renderActivity(item.phase));
      else if (item.role === 'assistant') renderMarkdown(bubble, item.text || '');
      else bubble.textContent = item.text || '';
      if (item.role === 'assistant' && item.kind !== 'build' && item.kind !== 'status' && isLast && item.chips?.length && !inFlight) {
        const row = el('div', 'next-row');
        for (const label of item.chips) row.append(nextChip(label, () => submit(label, { mode: 'auto' })));
        bubble.append(row);
      }
      history.append(bubble);
    });
  }

  if (guestLocked || auth.status === 'waiting' || auth.status === 'error') {
    const card = el('div', 'auth-card');
    card.append(
      el('strong', '', guestLocked ? 'Continue with full Tossive access' : 'Connect your Tejas account'),
      el('div', '', auth.message || (guestLocked ? 'Your 3 free messages are used. Sign in or sign up to continue.' : 'Finish signing in from your browser.')),
    );
    const actions = el('div', 'actions');
    actions.append(button('Sign in / Sign up', 'small-button primary', () => api.postMessage({ type: 'login' })));
    if (auth.verificationUrl) actions.append(button('Copy sign-in link', 'small-button', () => api.postMessage({ type: 'copyAuthLink' })));
    card.append(actions);
    history.append(card);
  }
  history.scrollTop = history.scrollHeight;
}

function submit(override, options) {
  const text = String(override !== undefined ? override : promptBox.value).trim();
  if (!text || inFlight || isLocked()) return;
  const extra = options || {};
  const mode = extra.mode || modeSelect.value;
  inFlight = true;
  sendButton.disabled = true;
  const requestId = String(Date.now()) + '-' + (++requestNumber);
  const createdAt = Date.now();
  saved.messages.push(
    { role: 'user', text, requestId, createdAt },
    { role: 'assistant', kind: 'status', phase: mode === 'build' ? 'Planning your project…' : 'Thinking through your request…', requestId, createdAt },
  );
  api.setState(saved);
  if (override === undefined) promptBox.value = '';
  render();
  api.postMessage({
    type: 'send',
    requestId,
    text,
    mode,
    followUpOf: extra.followUpOf || '',
    messages: saved.messages.filter((x) => x.role === 'user' || (x.role === 'assistant' && x.text)).slice(-12).map((x) => ({ role: x.role, text: x.text })),
    history: saved.messages,
  });
}

addFilesButton.onclick = () => api.postMessage({ type: 'addFiles' });
clearChatButton.onclick = () => api.postMessage({ type: 'clearHistory' });
restoreChatButton.onclick = () => api.postMessage({ type: 'restoreHistory' });
authAction.onclick = () => { if (!auth.signedIn) api.postMessage({ type: 'login' }); };
sendButton.onclick = () => submit();
modeSelect.onchange = () => { saved.mode = modeSelect.value; api.setState(saved); };
promptBox.oninput = refreshSendState;
promptBox.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
};

function finishRequest() { inFlight = false; }

window.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'authState') { auth = { ...auth, ...d }; render(); return; }
  if (d.type === 'history') {
    saved.messages = Array.isArray(d.messages) ? d.messages : [];
    canRestore = Boolean(d.canRestore);
    api.setState(saved);
    render();
    return;
  }
  if (d.type === 'files') { selectedFiles = d.files || []; renderFiles(); return; }
  if (d.type === 'undoDone') {
    const undone = saved.messages.find((x) => x.requestId === d.requestId && x.role === 'assistant');
    if (undone) {
      undone.undoText = d.files.length ? 'Undone: ' + d.files.join(', ') : 'No files were changed by Undo.';
      if (undone.data) undone.data.files = [];
    }
    api.setState(saved);
    render();
    return;
  }
  if (!d.requestId) return;
  const item = saved.messages.find((x) => x.requestId === d.requestId && x.role === 'assistant');
  if (!item) return;

  if (d.type === 'chatStatus') {
    item.kind = 'status';
    item.phase = d.phase || 'Thinking…';
    delete item.text;
  } else if (d.type === 'chatDone') {
    if (item.kind !== 'build') { item.kind = 'assistant'; item.text = d.text || 'The model returned an empty response.'; item.chips = Array.isArray(d.chips) ? d.chips : []; delete item.phase; }
    finishRequest();
  } else if (d.type === 'chatError') {
    if (item.kind === 'build') item.error = d.text; else { item.kind = 'assistant'; item.text = d.text; }
    finishRequest();
  } else if (d.type === 'buildUpdate') {
    if (d.kind === 'progress') {
      item.kind = 'build';
      item.phase = d.text;
      item.awaitingPlan = false;
      delete item.plan;
    } else if (d.kind === 'plan') {
      item.kind = 'build';
      item.phase = '';
      item.plan = d.plan;
      item.awaitingPlan = true;
    } else if (d.kind === 'review') {
      item.kind = 'build';
      item.phase = '';
      item.awaitingPlan = false;
      delete item.plan;
      item.data = d.result;
      item.awaitingApproval = d.awaitingApproval;
      item.approved = false;
      item.undoDone = false;
      delete item.check;
      finishRequest();
    } else if (d.kind === 'approved') {
      item.approved = true;
      item.awaitingApproval = false;
      finishRequest();
    } else if (d.kind === 'cancelled') {
      item.kind = 'build';
      item.phase = '';
      item.cancelled = d.text;
      item.awaitingApproval = false;
      item.awaitingPlan = false;
      delete item.plan;
      finishRequest();
    } else if (d.kind === 'error') {
      item.kind = 'build';
      item.error = d.text;
      item.phase = '';
      item.awaitingPlan = false;
      delete item.plan;
      finishRequest();
    } else if (d.kind === 'check') {
      item.check = d.check;
      if (Array.isArray(d.files) && item.data) item.data.files = d.files;
    } else if (d.kind === 'sandboxProgress') {
      item.sandboxPhase = d.text;
      item.sandboxError = '';
    } else if (d.kind === 'sandboxResult') {
      item.sandboxPhase = '';
      item.sandboxResult = d.result;
      item.sandboxError = '';
    } else if (d.kind === 'sandboxError') {
      item.sandboxPhase = '';
      item.sandboxError = d.text;
    }
  }
  api.setState(saved);
  render();
});

render();
api.postMessage({ type: 'ready' });
