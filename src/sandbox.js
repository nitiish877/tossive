'use strict';
// Tossive safe runner.
// Checks SMALL projects in a throw-away temp folder: syntax checks, local-reference checks and (only when
// asked) one short run with a timeout. This is a controlled runner, not an OS-level sandbox: it never runs
// inside the user's workspace, never installs packages, strips secrets from the environment, caps output and
// kills the process after a timeout, but it cannot stop code from using the network or the user's disk.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const LIMITS = { maxFiles: 30, maxTotalBytes: 400 * 1024, runTimeoutMs: 15000, checkTimeoutMs: 10000, outputChars: 4000 };

function safeRelative(value) {
  const p = String(value || '').replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.includes('\0')) return null;
  const parts = p.split('/');
  return parts.some((part) => !part || part === '.' || part === '..') ? null : parts.join('/');
}

function scrubbedEnv(tmp) {
  const env = { PATH: process.env.PATH || '', TEMP: tmp, TMP: tmp, TMPDIR: tmp, HOME: tmp, USERPROFILE: tmp, CI: '1', NODE_ENV: 'development', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'ComSpec', 'PATHEXT', 'LANG']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

function killTree(child) {
  try {
    if (process.platform === 'win32') cp.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
}

function runProcess(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const cap = LIMITS.outputChars * 3;
    let child;
    try {
      child = cp.spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (error) { resolve({ code: -1, stdout: '', stderr: String(error.message || error), timedOut: false, spawnError: true }); return; }
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { timedOut = true; killTree(child); setTimeout(() => finish({ code: null, stdout, stderr, timedOut: true }), 300); }, timeoutMs);
    child.stdout.on('data', (chunk) => { if (stdout.length < cap) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { if (stderr.length < cap) stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish({ code: -1, stdout, stderr: stderr || String(error.message || error), timedOut: false, spawnError: true }));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut }));
  });
}

function nodeArgs(args, tmp) {
  // The VS Code extension host is Electron; ELECTRON_RUN_AS_NODE makes it behave like plain Node.
  return { command: process.execPath, args, env: { ...scrubbedEnv(tmp), ELECTRON_RUN_AS_NODE: '1' } };
}

async function findPython(tmp) {
  for (const name of process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']) {
    const result = await runProcess(name, ['--version'], { cwd: tmp, env: scrubbedEnv(tmp), timeoutMs: 3000 });
    if (!result.spawnError && result.code === 0) return name;
  }
  return null;
}

function tail(text, tmp) {
  let clean = String(text || '').replace(/\r/g, '');
  for (const dir of new Set([tmp, (() => { try { return fs.realpathSync(tmp); } catch { return tmp; } })()])) clean = clean.split(dir + path.sep).join('').split(dir).join('.');
  clean = clean.trim();
  return clean.length > LIMITS.outputChars ? '…' + clean.slice(-LIMITS.outputChars) : clean;
}

function fileFromError(text, known) {
  const names = [...known].sort((a, b) => b.length - a.length);
  for (const name of names) if (text.includes(name) || text.includes(path.basename(name) + ':') || text.includes(`"${path.basename(name)}"`)) return name;
  return null;
}

function missingModule(text) {
  const node = /Cannot find (?:module|package) '([^'./][^']*)'/.exec(text);
  if (node) return `npm install ${node[1]}`;
  const py = /ModuleNotFoundError: No module named '([^']+)'/.exec(text);
  if (py) return `pip install ${py[1].split('.')[0]}`;
  return '';
}

async function checkProject({ files, run = false, limits }) {
  const lim = { ...LIMITS, ...(limits || {}) };
  const list = (files || []).filter((file) => safeRelative(file.path) && typeof file.content === 'string');
  if (!list.length) return { skipped: true, reason: 'There are no files to check.' };
  const total = list.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0);
  if (list.length > lim.maxFiles || total > lim.maxTotalBytes) {
    return { skipped: true, reason: `This project is too big for the safe runner (limit: ${lim.maxFiles} files and ${Math.round(lim.maxTotalBytes / 1024)} KB, adjustable in Settings > Tossive; this one has ${list.length} files and ${Math.ceil(total / 1024)} KB). Use the Run buttons to run it in your own terminal.` };
  }
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tossive-check-'));
  const steps = [], failing = new Map();
  const known = new Set(list.map((file) => safeRelative(file.path)));
  const fail = (file, error) => { if (file && !failing.has(file)) failing.set(file, String(error).slice(0, 1500)); };
  try {
    for (const file of list) {
      const rel = safeRelative(file.path);
      await fs.promises.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true });
      await fs.promises.writeFile(path.join(tmp, rel), file.content, 'utf8');
    }
    const byExt = (...exts) => [...known].filter((name) => exts.includes(path.extname(name).toLowerCase()));

    // JSON files
    const jsonFiles = byExt('.json');
    if (jsonFiles.length) {
      const bad = [];
      for (const name of jsonFiles) { try { JSON.parse(list.find((f) => safeRelative(f.path) === name).content); } catch (error) { bad.push(name); fail(name, `Invalid JSON: ${error.message}`); } }
      steps.push({ name: 'JSON files', status: bad.length ? 'fail' : 'pass', detail: bad.length ? `Invalid: ${bad.join(', ')}` : `${jsonFiles.length} valid` });
    }

    // JavaScript syntax (node --check, never executes the file)
    const jsFiles = byExt('.js', '.mjs', '.cjs');
    if (jsFiles.length) {
      const bad = [];
      for (const name of jsFiles) {
        const abs = path.join(tmp, name);
        const spec = nodeArgs(['--check', abs], tmp);
        let result = await runProcess(spec.command, spec.args, { cwd: tmp, env: spec.env, timeoutMs: lim.checkTimeoutMs });
        if (result.code !== 0 && /import statement outside a module|Unexpected token 'export'|Cannot use 'import\.meta'/.test(result.stderr) && !name.endsWith('.cjs')) {
          const copy = abs.replace(/\.js$/, '.__check__.mjs');
          await fs.promises.copyFile(abs, copy);
          const retry = nodeArgs(['--check', copy], tmp);
          result = await runProcess(retry.command, retry.args, { cwd: tmp, env: retry.env, timeoutMs: lim.checkTimeoutMs });
          await fs.promises.rm(copy, { force: true });
        }
        if (result.code !== 0) { bad.push(name); fail(name, tail(result.stderr || result.stdout, tmp)); }
      }
      steps.push({ name: 'JavaScript syntax', status: bad.length ? 'fail' : 'pass', detail: bad.length ? `Errors in: ${bad.join(', ')}` : `${jsFiles.length} file(s) OK` });
    }

    // Python syntax
    const pyFiles = byExt('.py');
    let python = null;
    if (pyFiles.length) {
      python = await findPython(tmp);
      if (!python) steps.push({ name: 'Python syntax', status: 'skip', detail: 'Python was not found on this computer, so .py files were not checked.' });
      else {
        const bad = [];
        for (const name of pyFiles) {
          const code = 'import sys\nsource=open(sys.argv[1],encoding="utf-8").read()\ncompile(source,sys.argv[1],"exec")';
          const result = await runProcess(python, ['-c', code, path.join(tmp, name)], { cwd: tmp, env: scrubbedEnv(tmp), timeoutMs: lim.checkTimeoutMs });
          if (result.code !== 0) { bad.push(name); fail(name, tail(result.stderr || result.stdout, tmp)); }
        }
        steps.push({ name: 'Python syntax', status: bad.length ? 'fail' : 'pass', detail: bad.length ? `Errors in: ${bad.join(', ')}` : `${pyFiles.length} file(s) OK` });
      }
    }

    // HTML: inline scripts compile (never run) and local references exist
    const htmlFiles = byExt('.html', '.htm');
    const referencedScripts = new Set();
    if (htmlFiles.length) {
      const problems = [];
      for (const name of htmlFiles) {
        const html = list.find((f) => safeRelative(f.path) === name).content;
        const dir = path.posix.dirname(name);
        const refs = [...html.matchAll(/<(?:script|link|img|source|audio|video)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"'#?]+)[^"']*["'][^>]*>/gi)].map((m) => ({ value: m[1], tag: m[0] }));
        for (const ref of refs) {
          if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref.value) || ref.value.startsWith('/')) continue;
          const target = path.posix.normalize(dir === '.' ? ref.value : `${dir}/${ref.value}`);
          if (/^<script/i.test(ref.tag)) referencedScripts.add(target);
          if (!known.has(target)) { problems.push(`${name} points to missing file ${ref.value}`); fail(name, `This HTML file references "${ref.value}" but that file does not exist in the project.`); }
        }
        let index = 0;
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          index += 1;
          const attrs = match[1] || '';
          if (/\bsrc\s*=/.test(attrs) || !match[2].trim()) continue;
          const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || '';
          if (type && !/^(?:text\/javascript|application\/javascript)$/i.test(type)) continue;
          try { new vm.Script(match[2], { filename: `${name} (inline script ${index})` }); }
          catch (error) { problems.push(`${name}: inline script ${index}: ${error.message}`); fail(name, `Inline <script> ${index} has a syntax error: ${error.message}`); }
        }
      }
      steps.push({ name: 'HTML pages', status: problems.length ? 'fail' : 'pass', detail: problems.length ? problems.slice(0, 4).join(' · ') : `${htmlFiles.length} page(s): scripts parse, local files found` });
    }

    // One short run, only when the user asked for it.
    if (run) {
      let pkg = {};
      try { pkg = JSON.parse((list.find((f) => safeRelative(f.path) === 'package.json') || { content: '{}' }).content); } catch { pkg = {}; }
      const usesDeps = Object.keys(pkg.dependencies || {}).length > 0;
      const isBrowserScript = (name) => referencedScripts.has(name) || /\b(?:document|window|localStorage|requestAnimationFrame)\b/.test(list.find((f) => safeRelative(f.path) === name)?.content || '');
      const startMatch = /node\s+([\w./-]+\.(?:js|mjs|cjs))/.exec(String(pkg.scripts?.start || ''));
      const nodeEntry = [startMatch?.[1], pkg.main, 'index.js', 'main.js', 'app.js', 'server.js', 'cli.js'].map((n) => n && safeRelative(String(n).replace(/^\.\//, ''))).find((n) => n && known.has(n) && !isBrowserScript(n));
      const pyEntry = ['main.py', 'app.py', 'index.py', 'game.py', 'run.py', 'script.py'].find((n) => known.has(n)) || (pyFiles.length === 1 ? pyFiles[0] : null);
      const bad = failing.size > 0;
      if (bad) steps.push({ name: 'Run', status: 'skip', detail: 'Skipped because the checks above found errors. Fix those first.' });
      else if (nodeEntry && usesDeps) steps.push({ name: `Run ${nodeEntry}`, status: 'skip', detail: 'This project needs npm packages. The safe runner never installs packages; run it from the terminal with the Run buttons.' });
      else if (nodeEntry || (pyEntry && python)) {
        const isNode = Boolean(nodeEntry);
        const entry = isNode ? nodeEntry : pyEntry;
        const spec = isNode ? nodeArgs([path.join(tmp, entry)], tmp) : { command: python, args: [path.join(tmp, entry)], env: scrubbedEnv(tmp) };
        const result = await runProcess(spec.command, spec.args, { cwd: tmp, env: spec.env, timeoutMs: lim.runTimeoutMs });
        const combined = tail(`${result.stdout}\n${result.stderr}`, tmp);
        const errorText = tail(result.stderr, tmp);
        const needs = missingModule(errorText);
        const wantsInput = /EOFError|EOF when reading a line/.test(errorText);
        if (result.timedOut && !/(?:Error|Exception|Traceback)\b/.test(errorText)) steps.push({ name: `Run ${entry}`, status: 'pass', detail: `Started and kept running for ${lim.runTimeoutMs / 1000}s without errors (stopped automatically).`, output: combined });
        else if (result.code === 0) steps.push({ name: `Run ${entry}`, status: 'pass', detail: 'Finished with exit code 0.', output: combined });
        else if (needs) steps.push({ name: `Run ${entry}`, status: 'warn', detail: `Needs a package that is not installed here. Run "${needs}" in your terminal, then run it there.`, output: combined });
        else if (wantsInput) steps.push({ name: `Run ${entry}`, status: 'warn', detail: 'The program waits for keyboard input, so the safe runner cannot finish it. Syntax is fine; run it in your terminal.', output: combined });
        else { steps.push({ name: `Run ${entry}`, status: 'fail', detail: `Exited with an error (code ${result.code}).`, output: combined }); fail(fileFromError(errorText, known) || entry, errorText || combined); }
      } else if (pyEntry && !python) steps.push({ name: `Run ${pyEntry}`, status: 'skip', detail: 'Python was not found on this computer.' });
      else steps.push({ name: 'Run', status: 'skip', detail: htmlFiles.length ? 'This is a browser project (HTML/JS). It needs a browser, so only the checks above were done. Use "Open project" to try it.' : 'No runnable entry file was found.' });
    }

    const ok = ![...steps].some((step) => step.status === 'fail');
    return { skipped: false, ok, steps, failing: [...failing].map(([file, error]) => ({ path: file, error })), ran: Boolean(run) };
  } finally {
    fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { checkProject, LIMITS };
