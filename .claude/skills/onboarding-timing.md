---
name: onboarding-timing
description: Extract per-step wall-clock timing from an onboarding run (Function A + Claude + Gmail + DB layers) and produce a timeline table showing where the Card 3 wait went. Use when the user asks to analyze onboarding speed, diagnose a slow run, or produce a timing report after a manual E2E.
user_invocable: true
---

# Onboarding Timing Report

Parse structured JSON log output from a recent onboarding run (web dev server + Inngest dev server) and produce a single timeline table showing where wall-clock time was spent.

## Sources

Logs are emitted as JSON-per-line to stdout/stderr. The user typically pipes their dev server to `tee` so the lines land in a file:

```bash
pnpm --filter web dev 2>&1 | tee /tmp/web.log
npx inngest-cli@latest dev -u http://localhost:3001/api/inngest 2>&1 | tee /tmp/inngest.log
```

If the user hasn't set up `tee`, ask them to paste the relevant log lines directly or to redirect next time.

## Arguments

- No args: ask the user which log file(s) to analyze. Defaults: `/tmp/web.log` and/or `/tmp/inngest.log`.
- One path: analyze that file.
- Two paths: analyze both.
- `--schema <schemaId>`: filter to a single schema (useful when multiple runs are interleaved).

## Operations to grep

Primary timing markers (added in commit `fcc8420`):

| Operation                               | Source             | Fields                                                                                              |
|-----------------------------------------|--------------------|-----------------------------------------------------------------------------------------------------|
| `generate-hypothesis.complete`          | runOnboarding      | `stepDurationMs, dbReadMs, generateHypothesisMs, dbWriteMs`                                         |
| `validate-hypothesis.complete`          | runOnboarding      | `stepDurationMs, dbReadMs, gmailTokenMs, gmailSampleScanMs, validateHypothesisMs, dbWriteMs`        |
| `advance-to-awaiting-review.complete`   | runOnboarding      | `stepDurationMs`                                                                                    |
| `runOnboarding.awaitingReview`          | runOnboarding      | `totalDurationMs`                                                                                   |

Already-present markers from other layers:

| Operation                                | Source    | Fields                                        |
|------------------------------------------|-----------|-----------------------------------------------|
| `claude.generateHypothesis.complete`     | ai/client | `durationMs, inputTokens, outputTokens`       |
| `claude.validateHypothesis.complete`     | ai/client | `durationMs, inputTokens, outputTokens`       |
| `gmail.sampleScan`                       | gmail     | `durationMs, messageCount, domainCount`       |
| `gmail.searchEmails`                     | gmail     | `durationMs, messageCount`                    |
| `auth.request.complete` / withAuth end   | auth mw   | `durationMs, path, method, status`            |
| `start.created` / `start.idempotent`     | onboarding| (marker)                                       |
| `confirm` / `confirm.idempotent`         | onboarding| (marker)                                       |

## Extraction approach

Lines are JSON-per-line but may be wrapped in Next.js or Inngest dev-server prefixes (e.g. `[web] { ... }`). Strip any leading prefix up to the first `{`, then `JSON.parse` each line. Skip lines that don't parse.

For each matching line, emit a row with:
- `timestamp` (HH:MM:SS.mmm portion)
- `operation`
- `durationMs` (whichever of `durationMs`, `stepDurationMs`, `totalDurationMs` is present)
- Any sub-timings as extra columns

If `--schema` was provided, filter to lines whose `schemaId` matches.

## Report format

Use a single ASCII table ordered by timestamp. Example:

```
Run: schema 01KP...
Start: 13:54:22.730
End:   13:56:09.500
Total: 106.8s

t+0.00s  [runOnboarding]  generate-hypothesis.complete       step=13420ms   dbRead=42   genHyp=13340   dbWrite=38
  t+0.04s  [ai/claude]    claude.generateHypothesis          api=13280ms   in=2150  out=1840
t+13.5s  [runOnboarding]  validate-hypothesis.complete       step=89210ms
  t+13.6s  [gmail]        sampleScan                         api=18400ms   n=100 domains=47
  t+32.0s  [ai/claude]    claude.validateHypothesis          api=68100ms   in=8240  out=2140
t+102.7s [runOnboarding]  advance-to-awaiting-review         step=310ms
t+103.0s [runOnboarding]  runOnboarding.awaitingReview       TOTAL=103020ms
```

Follow with a breakdown summary:

```
Where the time went:
  Claude (hypothesis):   13.3s  (13%)
  Claude (validate):     68.1s  (66%)
  Gmail sampleScan:      18.4s  (18%)
  DB round-trips:         0.2s  (0.2%)
  Inngest overhead:       3.0s  (3%)
```

Compute Inngest overhead as `sum(stepDurationMs) - sum(sub-timings)`.

## Command template (bash prototype)

If a file path is provided, use this as a starting point; refine or rewrite to handle the actual line format in the file:

```bash
grep -E '"operation":"(generate-hypothesis\.complete|validate-hypothesis\.complete|advance-to-awaiting-review\.complete|runOnboarding\.awaitingReview|claude\.(generateHypothesis|validateHypothesis)\.complete|sampleScan|searchEmails)"' /tmp/web.log /tmp/inngest.log \
  | sed -E 's/^[^{]*//' \
  | jq -r '[.timestamp, .operation, (.stepDurationMs // .durationMs // .totalDurationMs), .schemaId] | @tsv'
```

Then format into the table above.

If `jq` isn't available on this machine (Windows), use a short inline Node/tsx one-liner:

```bash
cat /tmp/web.log /tmp/inngest.log | node -e "
const ops = new Set(['generate-hypothesis.complete','validate-hypothesis.complete','advance-to-awaiting-review.complete','runOnboarding.awaitingReview','claude.generateHypothesis.complete','claude.validateHypothesis.complete','sampleScan','searchEmails']);
let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => {
  for (const line of d.split('\n')) {
    const i = line.indexOf('{'); if (i < 0) continue;
    try { const o = JSON.parse(line.slice(i)); if (ops.has(o.operation)) console.log(JSON.stringify(o)); } catch {}
  }
});
"
```

## What NOT to do

- Don't add more log sites to the code while running this skill. If a needed timing is missing, note it in the report as a TODO and file a separate issue.
- Don't compute averages across multiple runs unless the user asks. One run -> one report.
- Don't strip tokens or PII — the logs are already designed to exclude them, so emit what's there.
- Don't guess at missing fields. If a sub-timing is absent, show "—" in that column.

## Troubleshooting

- "No matching lines found" — the user likely didn't capture stdout to a file. Ask them to run `pnpm --filter web dev 2>&1 | tee /tmp/web.log` (and the Inngest equivalent) and retry.
- "Multiple runs interleaved" — ask for the schemaId of the run they care about, use `--schema`.
- "Claude line present but `validateHypothesisMs` absent from the runOnboarding step" — most likely the step threw before reaching the log call. Look for `.error` operations in the same file.
