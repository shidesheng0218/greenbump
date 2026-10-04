# greenbump benchmarks

A reproducible suite that measures how often greenbump actually fixes a broken
upgrade — no vibes, no made-up percentages. Every case runs a real `run()`
against a minimal fixture repo and checks the result mechanically.

## Run it

```bash
npm run bench           # all cases; tier-4 cases need a provider API key in env
npm run bench:no-llm    # only cases fixed without an LLM (tiers 0–3) — this is what CI runs
node dist/benchmarks/run.js --case lodash-pluck --verbose   # single case, with agent logs
node dist/benchmarks/run.js --json                          # machine-readable output
```

- Cases with `expectedTier: 4` are **skipped** (reported as `SKIP`, never as
  failures) when `--no-llm` is passed or no provider key
  (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, …) is set.
- In no-key mode the fix loop runs against a stub provider, so a case that
  secretly needs the LLM fails honestly instead of erroring.
- Each case runs on a **copy** of its fixture in a temp dir with its own git
  repo and isolated `GREENBUMP_CACHE_DIR` / `GREENBUMP_STATS_DIR`. Fixtures are
  never mutated.
- Exit code is 1 when any case FAILs (SKIP does not fail the run).

## Anatomy of a case

```
benchmarks/cases/<name>/
  case.json     # what to upgrade and what we expect to fix it
  expect.json   # mechanical pass/fail criteria
  repo/         # a minimal but REAL project (npm install must take seconds)
```

`case.json`:

```json
{
  "name": "lodash-pluck",
  "dep": "lodash",
  "from": "3.10.1",
  "to": "4.17.21",
  "ecosystem": "npm",
  "description": "Lodash 4 removed _.pluck — should be fixed by the tier-1 codemod",
  "expectedTier": 1
}
```

`expectedTier` is informational except for one rule: `>= 4` marks the case as
LLM-required (skipped without a key).

`expect.json`:

```json
{
  "shouldFix": true,
  "neededFix": true,
  "forbiddenPatterns": ["_\\.pluck\\("],
  "requiredPatterns": ["_\\.map\\("],
  "forbiddenFileChanges": ["package.json", "package-lock.json", "test.js", "**/*.test.js"]
}
```

- `shouldFix` — expected value of `RunSummary.fixed`.
- `neededFix` — optional; expected value of `RunSummary.neededFix` (use
  `false` for "upgrade breaks nothing" cases to catch false-positive fixes).
- `requiredPatterns` / `forbiddenPatterns` — regexes checked against the final
  contents of the files the fix edited.
- `forbiddenFileChanges` — globs the **fix agent** must not touch. Checked
  against `summary.editedFiles` (the agent's edits), NOT the whole git diff —
  the upgrade itself legitimately rewrites `package.json` and the lockfile.
  This is what catches "the AI edited a test to make CI green".

## Adding a case

1. Create `benchmarks/cases/<name>/repo/` with the smallest project that
   demonstrates the breakage. Pin the "before" version of the dependency.
2. Its `test` (and/or `build`) script must fail after the upgrade and pass
   before it. Verify both directions by hand:
   `npm install && npm test` (green) → bump the dep → `npm test` (red).
3. **The failure output must reference the broken source file.**
   Tier-1 codemods only rewrite files discovered in the failure output
   (`file.js:line:col` references, e.g. a stack frame). If the breakage is a
   real exception this happens naturally; if it's silent wrong behavior (e.g.
   Express 5's `res.send(404)` returning 200), make the test print a failure
   message that includes the path like `src/server.js:4:9`.
4. Write `case.json` and `expect.json`. Be honest in `expect.json` — a
   benchmark that is tuned to pass is worthless.
5. Run `node dist/benchmarks/run.js --case <name> --verbose` until it passes.

## Current cases

| case | breakage | expected fix tier |
|---|---|---|
| express-4-to-5-codemod | `app.del` removed | 1 (codemod) |
| express-4-to-5-sendstatus | `res.send(status)` removed | 1 (codemod) |
| zod-3-to-4-issues | `error.errors` → `error.issues` | 1 (codemod) |
| react-router-5-to-6-switch | `<Switch>` → `<Routes>` | 1 (codemod) |
| lodash-pluck | `_.pluck` removed | 1 (codemod) |
| no-fix-needed | nothing breaks (false-positive guard) | — |
| typescript-type-error | `@types/express` 5 removes `app.del` from types | 4 (LLM) |
| multi-file-breakage | `_.where` removed, used in 3 files | 4 (LLM) |
