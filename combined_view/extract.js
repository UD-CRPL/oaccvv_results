#!/usr/bin/env node
/* Extract a compact combined matrix (tests x runs) from the oaccvv_results repo.
 * Outputs:
 *   combined.json        — tests[] + runs[{id,vendor,machine,version,label,total,pass,cells}]
 *                          cells is one char per test: P/C/R/E/X/U or '.' (absent). ~120KB.
 *   details/<id>.json    — per run, { testname: {status,command,errors,output} } for FAILING
 *                          tests only (the failure reason), fetched on demand when a cell is clicked. */
const fs = require('fs'), path = require('path'), cp = require('child_process');

const SRC = process.env.OACCVV_RESULTS || path.resolve(__dirname, '..');   // repo root (combined_view/ lives there)
const OUT = process.env.OUT || path.resolve(__dirname, 'out');
const VENDORS = ['Clacc', 'Cray', 'GCC', 'nvc'];

const CODE = { 'Pass': 'P', 'Compilation Failure': 'C', 'Runtime Failure': 'R', 'Runtime Error': 'E', 'Excluded From Run': 'X', 'Unknown Section Result': 'U' };
const DROP = new Set(['template.F90']);                       // the suite's test template, compiled by mistake in old runs — not a real test
const RENAME = { 'gang-dimensions.c': 'gang_dimensions.c' };  // renamed upstream in OpenACCV-V Tests/; merge old runs under the new name
const SEV  = { P: 0, X: 1, U: 2, R: 3, E: 4, C: 5 };
const LEGEND = { P: 'Pass', C: 'Compilation Failure', R: 'Runtime Failure', E: 'Runtime Error', X: 'Excluded From Run', U: 'Unknown Section Result', '.': 'Not in this run' };
const CAP = 4000;
const safe = s => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
const trunc = s => (typeof s === 'string') ? (s.length > CAP ? s.slice(0, CAP) + '\n…(truncated)' : s) : '';

const norm = s => s.replace(/^\s*var\s+jsonResults\s*=\s*/, '').trim().replace(/;\s*$/, '');
function collectSegments(node, kp, out) {              // gather {test, code, ri} for every result leaf
  if (node && typeof node === 'object') {
    if (typeof node.result === 'string') out.push({ test: kp[kp.length - 2], code: CODE[node.result] || 'U', ri: node.run_index });
    else for (const k of Object.keys(node)) collectSegments(node[k], kp.concat(k), out);
  }
}
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const files = cp.execSync(`cd "${SRC}" && find ${VENDORS.join(' ')} -name '*.json'`).toString().trim().split('\n').filter(Boolean);
const allTests = new Set();
const runs = [];
const detailByRun = {};

for (const rel of files) {
  let j; try { j = JSON.parse(norm(fs.readFileSync(path.join(SRC, rel), 'utf8'))); } catch (e) { console.log('SKIP', rel, e.message); continue; }
  const parts = rel.replace(/\/[^/]*$/, '').split('/');     // vendor/machine/version[...]
  const vendor = parts[0], machine = parts[1] || '', version = parts.slice(2).join('/') || '';
  const stem = path.basename(rel).replace(/\.json$/i, '');
  const verLabel = version + (stem.toLowerCase() !== 'results' ? ` (${stem})` : '');
  const id = [vendor, machine, verLabel].map(safe).join('__');

  const segs = []; if (j.summary) collectSegments(j.summary, [], segs);
  const byTest = {};
  for (const s of segs) {
    const t = RENAME[s.test] || s.test;
    if (DROP.has(t)) continue;
    (byTest[t] = byTest[t] || []).push(s);
  }
  const status = {}, details = {};
  for (const t of Object.keys(byTest)) {
    allTests.add(t);
    const codes = byTest[t].map(s => s.code), nonPass = codes.filter(c => c !== 'P' && c !== 'X');
    const st = nonPass.length ? nonPass.reduce((a, c) => SEV[c] > SEV[a] ? c : a, nonPass[0])
             : codes.includes('P') ? 'P' : 'X';
    status[t] = st;
    if (st !== 'P' && st !== 'X') {                          // capture failure reason
      const seg = byTest[t].find(s => s.code !== 'P' && s.code !== 'X') || byTest[t][0];
      const run = j.runs && j.runs[seg.test] && j.runs[seg.test][seg.ri] || {};
      const comp = run.compilation || {}, rt = run.runtime || {};
      details[t] = { status: LEGEND[st], command: trunc(comp.command), errors: trunc(comp.errors || rt.errors), output: trunc(comp.output || rt.output) };
    }
  }
  const id2 = detailByRun[id] ? id + '_' + runs.length : id;  // guard against id collisions
  detailByRun[id2] = details;
  runs.push({ id: id2, vendor, machine, version: verLabel, label: `${machine} ${verLabel}`.trim(), _status: status });
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

cp.execSync(`mkdir -p "${OUT}/details"`);
fs.writeFileSync(path.join(OUT, 'combined.json'), JSON.stringify({ legend: LEGEND, generated_from: 'UD-CRPL/oaccvv_results', tests, runs }));
for (const r of runs) fs.writeFileSync(path.join(OUT, 'details', r.id + '.json'), JSON.stringify(detailByRun[r.id] || {}));
console.log(`combined.json: ${tests.length} tests x ${runs.length} runs, ${(fs.statSync(path.join(OUT, 'combined.json')).size / 1024).toFixed(0)} KB`);
console.log(`details/: ${runs.length} files, ${(cp.execSync(`du -sh "${OUT}/details" | cut -f1`).toString().trim())}`);
