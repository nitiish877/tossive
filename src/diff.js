'use strict';
// Small line-diff used to show "previous code" and "new code" inside the Tossive panel.
// Output lines: { t: 'c' | 'd' | 'a', o: old line number or 0, n: new line number or 0, s: text, h?: [start, end] }
// 'd' = removed (previous code), 'a' = added (new code), 'c' = unchanged context.
// h marks the part of a changed line that really differs from its counterpart, so it can be highlighted more strongly.

const MAX_MIDDLE_LINES = 3000; // above this (after trimming equal head/tail) the change is shown as one replaced block
const MAX_EDIT_DISTANCE = 1500;
const MAX_LINE_CHARS = 300;

function splitLines(text) {
  const value = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  if (!value) return [];
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Myers O(ND) shortest edit script. Returns ops over the given arrays: '=' (i, j), '-' (i), '+' (j).
function myers(a, b) {
  const n = a.length, m = b.length, max = n + m;
  if (!max) return [];
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  const limit = Math.min(max, MAX_EDIT_DISTANCE);
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return null;
  const ops = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const lo = offset - d - 1; // trace[d] holds v as it was before step d, i.e. the result of step d - 1, shifted by lo
    const at = (k) => trace[d][offset + k - lo];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ t: '=', i: x, j: y }); }
    if (x === prevX) { y--; ops.push({ t: '+', j: y }); } else { x--; ops.push({ t: '-', i: x }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ t: '=', i: x, j: y }); }
  return ops.reverse();
}

function diffOps(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail), midB = b.slice(head, b.length - tail);
  let mid = null;
  if (midA.length + midB.length <= MAX_MIDDLE_LINES * 2) mid = myers(midA, midB);
  if (!mid) mid = [...midA.map((_, i) => ({ t: '-', i })), ...midB.map((_, j) => ({ t: '+', j }))];
  const ops = [];
  for (let i = 0; i < head; i++) ops.push({ t: '=', i, j: i });
  for (const op of mid) {
    if (op.t === '=') ops.push({ t: '=', i: op.i + head, j: op.j + head });
    else if (op.t === '-') ops.push({ t: '-', i: op.i + head });
    else ops.push({ t: '+', j: op.j + head });
  }
  for (let k = 0; k < tail; k++) ops.push({ t: '=', i: a.length - tail + k, j: b.length - tail + k });
  return ops;
}

function markInline(del, add) {
  // Highlight only the middle part that differs between a removed line and the added line that replaces it.
  let p = 0;
  const max = Math.min(del.s.length, add.s.length);
  while (p < max && del.s[p] === add.s[p]) p++;
  let s = 0;
  while (s < max - p && del.s[del.s.length - 1 - s] === add.s[add.s.length - 1 - s]) s++;
  if (p + s === 0) return; // nothing in common: the whole line is already highlighted
  del.h = widen([p, del.s.length - s], del.s.length);
  add.h = widen([p, add.s.length - s], add.s.length);
}

// A pure insertion or deletion has an empty range; widen it by one character so the spot is still visible.
function widen(range, length) {
  let [start, end] = range;
  if (start === end) { if (start > 0) start -= 1; else if (end < length) end += 1; }
  return [start, end];
}

function clip(line) {
  if (line.s.length > MAX_LINE_CHARS) {
    line.s = line.s.slice(0, MAX_LINE_CHARS) + '…';
    if (line.h) line.h = [Math.min(line.h[0], MAX_LINE_CHARS), Math.min(line.h[1], MAX_LINE_CHARS)];
  }
  return line;
}

/**
 * compactDiff(oldText, newText, { context, maxLines })
 * -> { hunks: [{ o, n, lines: [...] }], added, removed, truncated }
 */
function compactDiff(oldText, newText, options = {}) {
  const context = options.context == null ? 3 : options.context;
  const maxLines = options.maxLines || 300;
  const a = splitLines(oldText), b = splitLines(newText);
  const ops = diffOps(a, b);
  const lines = ops.map((op) => (op.t === '=' ? { t: 'c', o: op.i + 1, n: op.j + 1, s: a[op.i] } : op.t === '-' ? { t: 'd', o: op.i + 1, n: 0, s: a[op.i] } : { t: 'a', o: 0, n: op.j + 1, s: b[op.j] }));

  // Pair removed/added lines inside each change block for word-level highlighting.
  for (let i = 0; i < lines.length;) {
    if (lines[i].t === 'c') { i++; continue; }
    let j = i;
    const dels = [], adds = [];
    while (j < lines.length && lines[j].t !== 'c') { (lines[j].t === 'd' ? dels : adds).push(lines[j]); j++; }
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) markInline(dels[k], adds[k]);
    i = j;
  }

  const added = lines.filter((line) => line.t === 'a').length;
  const removed = lines.filter((line) => line.t === 'd').length;
  const keep = new Array(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.t === 'c') return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) keep[k] = true;
  });

  const hunks = [];
  let current = null, used = 0, truncated = false;
  for (let index = 0; index < lines.length; index++) {
    if (!keep[index]) { current = null; continue; }
    if (used >= maxLines) { truncated = true; break; }
    if (!current) { current = { o: lines[index].o || 0, n: lines[index].n || 0, lines: [] }; hunks.push(current); }
    current.lines.push(clip({ ...lines[index] }));
    used++;
  }
  return { hunks, added, removed, truncated };
}

module.exports = { compactDiff, splitLines, diffOps };
