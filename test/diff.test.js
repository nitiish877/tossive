'use strict';
// Run: node test/diff.test.js
const assert = require('assert');
const { compactDiff, diffOps, splitLines } = require('../src/diff.js');

// Reference LCS length to prove the edit script is minimal.
const lcs = (a, b) => { const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0)); for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]); return dp[a.length][b.length]; };
let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let round = 0; round < 400; round++) {
  const a = Array.from({ length: rnd(25) }, () => 'l' + rnd(6));
  const b = Array.from({ length: rnd(25) }, () => 'l' + rnd(6));
  const ops = diffOps(a, b);
  const rebuilt = [];
  for (const op of ops) { if (op.t === '=') { assert.strictEqual(a[op.i], b[op.j]); rebuilt.push(a[op.i]); } else if (op.t === '+') rebuilt.push(b[op.j]); }
  assert.deepStrictEqual(rebuilt, b, 'applying the script to the old lines gives the new lines');
  assert.deepStrictEqual(ops.filter((o) => o.t !== '+').map((o) => a[o.i]), a, 'every old line is accounted for');
  assert.strictEqual(ops.filter((o) => o.t === '=').length, lcs(a, b), 'edit script is minimal');
}
console.log('diff: 400 random cases reconstruct correctly and are minimal');

const oldCode = ['function total(items) {', '  let sum = 0;', '  for (let i = 0; i <= items.length; i++) {', '    sum += items[i].price;', '  }', '  return sum;', '}', '', 'module.exports = total;'].join('\n');
const newCode = ['function total(items) {', '  let sum = 0;', '  for (let i = 0; i < items.length; i++) {', '    sum += items[i].price;', '  }', '  return sum;', '}', '', 'module.exports = total;'].join('\n');
const d = compactDiff(oldCode, newCode);
assert.strictEqual(d.added, 1); assert.strictEqual(d.removed, 1);
const del = d.hunks[0].lines.find((l) => l.t === 'd'), add = d.hunks[0].lines.find((l) => l.t === 'a');
assert.strictEqual(del.s, '  for (let i = 0; i <= items.length; i++) {');
assert.strictEqual(del.o, 3); assert.strictEqual(add.n, 3);
assert.strictEqual(del.s.slice(...del.h), '=', 'the exact changed character of the previous line is marked');
assert.strictEqual(add.s.slice(...add.h), '<', 'the spot of the change in the new line is marked');
const d1b = compactDiff('const a = 1;', 'const a = 2;');
const x = d1b.hunks[0].lines;
assert.strictEqual(x[0].s.slice(...x[0].h), '1'); assert.strictEqual(x[1].s.slice(...x[1].h), '2');
assert(d.hunks[0].lines.filter((l) => l.t === 'c').length === 5, 'up to three lines of context around the change (2 above, 3 below here)');
console.log('diff: single-line fix shows previous line, new line and the exact changed characters');

// two separate fixes far apart -> two hunks, line numbers stay correct after an insertion
const big = Array.from({ length: 60 }, (_, i) => 'line ' + (i + 1));
const edited = [...big]; edited[4] = 'line 5 FIXED'; edited.splice(40, 0, 'brand new line'); 
const d2 = compactDiff(big.join('\n'), edited.join('\n'));
assert.strictEqual(d2.hunks.length, 2);
const ins = d2.hunks[1].lines.find((l) => l.t === 'a');
assert.deepStrictEqual([ins.o, ins.n, ins.s], [0, 41, 'brand new line']);
const after = d2.hunks[1].lines.find((l) => l.t === 'c' && l.s === 'line 41');
assert.deepStrictEqual([after.o, after.n], [41, 42], 'old/new numbers diverge after an inserted line');
console.log('diff: separate fixes become separate hunks with correct old/new line numbers');

assert.deepStrictEqual(compactDiff('a\nb\n', 'a\nb\n').hunks, [], 'identical text has no hunks');
assert.strictEqual(compactDiff('', 'x\ny\n').added, 2);
assert.strictEqual(compactDiff('x\r\ny\r\n', 'x\ny\n').added, 0, 'line endings alone are not a change');
assert.strictEqual(splitLines('a\n').length, 1);
const huge = compactDiff(Array.from({ length: 5000 }, (_, i) => 'a' + i).join('\n'), Array.from({ length: 5000 }, (_, i) => 'b' + i).join('\n'), { maxLines: 100 });
assert(huge.truncated && huge.removed === 5000 && huge.added === 5000, 'huge rewrites are summarised, not hung');
console.log('diff: edge cases ok (identical, empty, CRLF, huge)');
