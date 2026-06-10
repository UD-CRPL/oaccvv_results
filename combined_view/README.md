# combined_view — static OpenACC V&V results

Turns the per-vendor result JSON in this repo into one compact **combined matrix**
(tests × compiler/version runs) with **no database and no server code**.

## Files
- `extract.js` — reads every `*/*/*/results.json` (Clacc, Cray, GCC, nvc), aggregates each
  test's pass/fail, and writes a compact **`combined.json`** (~120 KB; one char per cell).
- `index.html` — standalone viewer that loads `combined.json` and renders the filterable table.
  (The production site embeds its own themed version of this; this file is the reference renderer.)

## Build
```bash
node combined_view/extract.js          # writes combined_view/out/combined.json
# or point it elsewhere:
OACCVV_RESULTS=/path/to/repo OUT=/path/to/output node combined_view/extract.js
```
No dependencies — pure Node stdlib, so it runs anywhere with `node`, no `npm install`.

## How it stays current
A nightly job on the crpl server pulls this repo (public, over HTTPS — no credentials) and
re-runs `extract.js`, so adding results here makes them appear on the site within a day.
Cell codes: `P`ass · `C`ompilation Failure · `R`untime Failure · `E`runtime Error · e`X`cluded · `U`nknown · `.` not in run.
