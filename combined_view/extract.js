#!/usr/bin/env node
/* Extract a compact combined matrix (tests x runs) from the oaccvv_results repo.
 * Output: combined.json — tests[] + runs[{vendor,machine,version,label,total,pass,cells}]
 * cells is one char per test (aligned to tests[]): P/C/R/E/X/U or '.' (absent). ~72KB total. */
const fs = require('fs'), path = require('path'), cp = require('child_process');

const SRC = process.env.OACCVV_RESULTS || path.resolve(__dirname, '..');   // repo root (combined_view/ lives there)
const OUT = process.env.OUT || path.resolve(__dirname, 'out');
const VENDORS = ['Clacc', 'Cray', 'GCC', 'nvc'];

const CODE = { 'Pass': 'P', 'Compilation Failure': 'C', 'Runtime Failure': 'R', 'Runtime Error': 'E', 'Excluded From Run': 'X', 'Unknown Section Result': 'U' };
const SEV  = { P: 0, X: 1, U: 2, R: 3, E: 4, C: 5 };       // severity for aggregating a test's segments
const LEGEND = { P: 'Pass', C: 'Compilation Failure', R: 'Runtime Failure', E: 'Runtime Error', X: 'Excluded From Run', U: 'Unknown Section Result', '.': 'Not in this run' };

const norm = s => s.replace(/^\s*var\s+jsonResults\s*=\s*/, '').trim().replace(/;\s*$/, '');
function collectSegments(node, kp, out) {              // gather {test, code} for every result leaf
  if (node && typeof node === 'object') {
    if (typeof node.result === 'string') out.push({ test: kp[kp.length - 2], code: CODE[node.result] || 'U' });
    else for (const k of Object.keys(node)) collectSegments(node[k], kp.concat(k), out);
  }
}
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const files = cp.execSync(`cd "${SRC}" && find ${VENDORS.join(' ')} -name '*.json'`).toString().trim().split('\n').filter(Boolean);
const allTests = new Set();
const runs = [];

for (const rel of files) {
  let j; try { j = JSON.parse(norm(fs.readFileSync(path.join(SRC, rel), 'utf8'))); } catch (e) { console.log('SKIP', rel, e.message); continue; }
  const parts = rel.replace(/\/[^/]*$/, '').split('/');     // vendor/machine/version[...]
  const vendor = parts[0], machine = parts[1] || '', version = parts.slice(2).join('/') || '';
  const stem = path.basename(rel).replace(/\.json$/i, '');
  const verLabel = version + (stem.toLowerCase() !== 'results' ? ` (${stem})` : '');

  const segs = []; if (j.summary) collectSegments(j.summary, [], segs);
  const byTest = {};
  for (const s of segs) (byTest[s.test] = byTest[s.test] || []).push(s.code);
  const status = {};
  for (const t of Object.keys(byTest)) {
    allTests.add(t);
    const codes = byTest[t], nonPass = codes.filter(c => c !== 'P' && c !== 'X');
    status[t] = nonPass.length ? nonPass.reduce((a, c) => SEV[c] > SEV[a] ? c : a, nonPass[0])
              : codes.includes('P') ? 'P' : 'X';
  }
  runs.push({ vendor, machine, version: verLabel, label: `${machine} ${verLabel}`.trim(), _status: status });
}

const tests = Array.from(allTests).sort(natural);
const idx = new Map(tests.map((t, i) => [t, i]));
for (const r of runs) {
  const arr = new Array(tests.length).fill('.');
  let total = 0, pass = 0;
  for (const t of Object.keys(r._status)) { const c = r._status[t]; arr[idx.get(t)] = c; total++; if (c === 'P') pass++; }
  r.cells = arr.join(''); r.total = total; r.pass = pass; delete r._status;
}
runs.sort((a, b) => natural(a.vendor, b.vendor) || natural(a.machine, b.machine) || natural(a.version, b.version));

cp.execSync(`mkdir -p "${OUT}"`);
fs.writeFileSync(path.join(OUT, 'combined.json'), JSON.stringify({ legend: LEGEND, generated_from: 'UD-CRPL/oaccvv_results', tests, runs }));
console.log(`combined.json: ${tests.length} tests x ${runs.length} runs, ${(fs.statSync(path.join(OUT, 'combined.json')).size / 1024).toFixed(0)} KB`);
