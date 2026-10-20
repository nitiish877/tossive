'use strict';
// Run: node test/sandbox.test.js
const assert = require('assert');
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? {} : origLoad.call(this, request, ...rest); };
const { checkProject } = require('../src/sandbox.js');
const f = (path, content) => ({ path, content });
const status = (r, name) => (r.steps.find((s) => s.name.startsWith(name)) || {}).status;

(async () => {
  let r = await checkProject({ run: true, files: [f('index.js', 'console.log(1+1)'), f('package.json', '{"main":"index.js"}')] });
  assert(r.ok && status(r, 'Run') === 'pass', 'good node project passes');

  r = await checkProject({ run: true, files: [f('index.js', 'function a( {')] });
  assert(!r.ok && r.failing[0].path === 'index.js' && status(r, 'Run') === 'skip', 'syntax error is reported and run is skipped');

  r = await checkProject({ run: true, files: [f('main.js', 'require("./u").nope()'), f('u.js', 'module.exports={}')] });
  assert(!r.ok && r.failing[0].path === 'main.js', 'runtime error is attributed to main.js');

  r = await checkProject({ run: true, files: [f('index.js', 'require("express")')] });
  assert(r.ok && status(r, 'Run') === 'warn', 'missing package is a warning with an install hint, not a failure');

  r = await checkProject({ run: true, files: [f('index.js', 'setInterval(()=>{},1000);console.log("up")')] });
  assert(r.ok && /kept running/.test(r.steps.find((s) => s.name.startsWith('Run')).detail), 'long-running program is stopped by the timeout');

  r = await checkProject({ files: [f('game.js', 'import {a} from "./b.js";console.log(a)'), f('b.js', 'export const a=1')] });
  assert(r.ok, 'ES module syntax in .js is accepted');

  r = await checkProject({ run: true, files: [f('index.html', '<script>let a = ;</script><script src="missing.js"></script>')] });
  assert(!r.ok && r.failing[0].path === 'index.html', 'bad inline script and missing file are caught in HTML');

  r = await checkProject({ run: true, files: [f('index.html', '<link href="s.css"><script src="g.js"></script>'), f('s.css', 'a{}'), f('g.js', 'document.title="x"')] });
  assert(r.ok && /browser project/.test(r.steps.find((s) => s.name === 'Run').detail), 'browser projects are checked but not run in Node');

  r = await checkProject({ files: Array.from({ length: 30 }, (_, i) => f(`f${i}.js`, 'module.exports = ' + i + ';')) });
  assert(!r.skipped && r.ok, 'a 30-file project is accepted by default');

  r = await checkProject({ files: Array.from({ length: 31 }, (_, i) => f(`f${i}.js`, '1')) });
  assert(r.skipped && /too big/.test(r.reason), 'more than the default 30 files is refused');

  r = await checkProject({ files: [f('big.js', 'var a = 1;\n'.repeat(30000))] });
  assert(!r.skipped && r.ok, 'a 300 KB source file (thousands of lines) is accepted by default');

  r = await checkProject({ files: [f('big.js', 'x'.repeat(401 * 1024))] });
  assert(r.skipped, 'more than 400 KB is refused');

  r = await checkProject({ files: [f('a.js', '1'), f('b.js', '1'), f('c.js', '1')], limits: { maxFiles: 2 } });
  assert(r.skipped && /limit: 2 files/.test(r.reason), 'limits can be lowered from settings');

  r = await checkProject({ run: true, limits: { runTimeoutMs: 3000 }, files: [f('index.js', 'setInterval(()=>{},1000)')] });
  assert(r.ok && /kept running for 3s/.test(r.steps.find((s) => s.name.startsWith('Run')).detail), 'run timeout can be changed from settings');

  r = await checkProject({ files: [f('../evil.js', '1')] });
  assert(r.skipped, 'path traversal is ignored');

  process.env.SECRET_TOKEN = 'abc123';
  r = await checkProject({ run: true, files: [f('index.js', 'console.log("T=" + process.env.SECRET_TOKEN)')] });
  assert(/T=undefined/.test(r.steps.find((s) => s.name.startsWith('Run')).output), 'environment secrets are not passed to the program');

  console.log('sandbox: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
