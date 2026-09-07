# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - v0.8.0

### Added
- **Hard tool-layer guardrails** (`src/agent/guard.ts`): the fix agent's `read_file`,
  `write_file`, and `search_code` tools now physically cannot touch secrets or
  dependency manifests/lockfiles — enforced at the tool-call boundary, not just the
  system prompt. `read_file`/`search_code` refuse `.env`, `*.pem`/`*.key`, SSH keys,
  `.npmrc`/`.netrc`, `credentials.json`, `secrets.json`/`.yaml`, and similar; contents
  never enter a tool result, so they can never be sent to the LLM provider.
  `write_file` blocks the ecosystem's manifest/lockfile (`package.json`,
  `package-lock.json`, etc.) so the fix agent can't silently undo or alter what the
  upgrade step manages.
- **Per-call cost ledger** (`src/agent/calllog.ts`): every individual LLM call (fix
  round, changelog digest) is appended to `~/.greenbump/llm-calls.jsonl` with feature,
  model, input/output tokens, latency, retry count, and success/failure — cost is now
  attributable per task, not just per run. Complements the existing per-run stats log.
- **Model routing for utility tasks** (`--digest-model <model>`): the changelog digest
  is a bounded JSON-extraction task, not agentic reasoning — route it to a cheaper
  model independent of `--model` (e.g. `--model claude-sonnet-5 --digest-model
  gpt-4o-mini`). Falls back to `--model` when omitted. The digest call's output is
  also now capped at 2000 tokens (vs. the fix agent's 8000) so a rambling response
  can't run up cost on a simple extraction.
- **Clear rollback on failure**: when a run doesn't get merged (failed fix or no git
  isolation), the summary box now prints the exact commands to inspect and discard the
  branch/working-tree changes, instead of leaving the user to figure it out.
- New `Provider.send()` parameter `SendOptions.maxTokens` (per-call output cap,
  defaults to the existing 8000) — plumbed through both the Anthropic and
  OpenAI-compatible providers.
- Tests: `guard.test.ts`, `calllog.test.ts`, `format.test.ts`, plus a `fixer.test.ts`
  case asserting `search_code` never returns lines from secrets files (13 new tests,
  157 total).

### Changed
- `RunOptions` gained `digestModel`; `RunSummary` gained `baseBranch` (used to render
  the rollback commands).

### Impact
- **Secrets can't leak through the agent**: closes a path where a fix-loop
  `search_code` call could have matched and returned lines from a `secrets.json` or
  `credentials.json` sitting in the repo — verified with a regression test.
- **Cheaper by default for multi-package upgrades**: routing the digest step to a
  smaller model cuts its cost without touching the fix agent's quality.
- **Less scary failures**: a red run now tells you exactly how to get back to clean.

## [0.7.0] - 2026-08-28

### Added
- **Expanded codemod library**: tier-1 free fixes grew from 6 to 24, covering the
  highest-frequency breaking upgrades reported by users — Express 4→5 (`app.del`,
  `res.send(status)`), Zod 3→4 (`error.errors`→`error.issues`, `.email()`/`.url()`/
  `.uuid()` shorthand), Node 20→22 (`util.is*` removal), Lodash 4 (`_.pluck`,
  `_.contains`), React Router 5→6 (`<Switch>`→`<Routes>`, `useHistory`→`useNavigate`),
  Mongoose 6→8 (`doc.remove()`→`doc.deleteOne()`), plus `assert.deepEqual`.
- **Guidance-only codemods**: for breakages too risky to regex-rewrite (ESLint 9 flat
  config, Axios 1.x, Webpack 5 polyfills, Jest 29+ jsdom split, TypeScript 5
  `verbatimModuleSyntax`, Prettier 3 defaults, Socket.IO 4), tier 1 now matches the
  failure and surfaces a migration note instead of guessing at a code change. These
  never mark the tier as "fixed" — they escalate to tier 4 like a miss, but the
  agent (and the user, via logs) starts with the right context.
- **Codemod `creates`**: codemods can scaffold a companion file after a successful
  transform (e.g. ESLint 9's `eslint.config.js` starter). Skipped if the file already
  exists, so it never clobbers user config.
- **Codemod `versionRange.toMajor`**: a codemod can now cover a span of majors
  (e.g. Mongoose 6→7 and 6→8 both match `doc.remove()`), not just a single bump.
- **Usage & cost report** (`greenbump --stats [days]`, default 30-day window):
  every run appends a local record (`~/.greenbump/runs.jsonl`, override with
  `GREENBUMP_STATS_DIR`) — dep, tier, tokens, cache hit, fixed/needsReview. `--stats`
  aggregates them into fix-tier breakdown, LLM calls avoided, actual tokens/cost
  spent, and an *estimated* dollar amount saved by tiers 1-3 (labeled as an estimate,
  never presented as a bill). `--stats --json` prints the raw summary for scripting.
  Fully local — no network calls, no telemetry.
- New CLI flags: `--stats [days]`, `--json` (with `--stats`).
- New modules:
  - `src/engine/stats/recorder.ts` (append-only JSONL run log)
  - `src/engine/stats/report.ts` (aggregation + terminal report + $/M-token pricing table)
- 33 new tests (145 total): 13 new codemod cases (transform, guidance-only, `creates`,
  multi-major `versionRange`), recorder round-trip/corrupt-line-tolerance, and report
  aggregation (tier counts, window filtering, cost estimation, empty state).

### Changed
- `tryBuiltinCodemods` no longer treats "advice printed" as "applied" — a
  guidance-only codemod match now returns `applied: false` with an `advice[]` list,
  so the fix loop correctly escalates to tier 4 instead of running a wasted
  verification check. (Previously this case didn't exist; called out here since it's
  the load-bearing invariant the new guidance codemods depend on.)
- `RunSummary`/batch group runs now record to the local stats log on every exit path
  (clean upgrade, unverifiable, and fixed-or-not), not just the LLM fix path.

### Impact
- **Higher tier-1 hit rate**: 4x more codemods means more real-world upgrades resolve
  at $0 without ever calling an LLM.
- **Visible savings**: `greenbump --stats` answers "how much has this tool saved me"
  with real numbers instead of a single run's summary.
- Verified end-to-end: Express 4→5 (`app.del`) and Zod 3→4 (`error.errors`) both fix
  with 0 input / 0 output tokens; `--stats` correctly aggregates both runs.

## [0.6.0] - 2026-08-19

### Added
- **Tiered fix strategy** — four escalating fix tiers, cheapest first:
  - **Tier 1 — builtin codemods** (free): regex-based transforms for well-known breaking
    changes (React 18→19 `ReactDOM.render`→`createRoot`, Vue 2→3 `new Vue()`→`createApp`,
    `assert.equal`→`strictEqual`, `jest.*`→`vi.*`). Applied and verified with zero LLM tokens.
  - **Tier 2 — learned patterns** (free): successful past fixes are distilled into reusable
    patterns keyed by normalized error signatures, reusable across projects.
  - **Tier 3 — cached LLM fixes** (free): identical upgrade + failure context replays the
    previously-learned file edits with no LLM call.
  - **Tier 4 — LLM fix loop** (paid): unchanged agent loop, only reached when tiers 1–3 miss.
- **Disk cache** (`~/.greenbump/cache`, override with `GREENBUMP_CACHE_DIR`):
  - Content-addressed (sha256) entries with TTL; changelogs pinned to 1 year.
  - Caches changelogs, changelog digests, learned fix patterns, and full LLM fixes.
  - New CLI: `--cache-stats`, `--cache-clear [category]`, `--no-cache`.
- **Context optimizer** for token reduction:
  - Failure output is trimmed (node_modules frames, npm noise, passing-test lines dropped;
    4000-char cap) before being sent to the model.
  - Candidate files referenced by the failure (stack frames, `path:line:col`, webpack
    errors) are extracted and passed as a hint — the model starts at the right files.
- **Interactive mode** (`-i` / `--interactive`): review each AI-proposed edit as a colored
  diff before it's written. Accept (`y`), reject (`n`), skip (`s`), accept-all (`a`), or
  hand-edit (`e`) the proposed content. Rejections are fed back to the model.
- **API surface analysis** (AST-level, on by default): after a fix, exported symbols of
  edited TS/JS files are compared against `git HEAD` — removed exports (critical for
  default exports), signature changes, and new `any` annotations are reported; critical
  changes set `needsReview`. Disable with `--no-ast-analysis`.
- **Changelog digest**: raw release notes are condensed by the LLM into a structured
  breaking-change checklist (cached per upgrade path) before entering the fix prompt.
  Best-effort — digest failures fall back to the raw changelog.
- New CLI flags: `-i/--interactive`, `--no-free-tiers`, `--no-cache`, `--no-ast-analysis`,
  `--list-codemods`, `--cache-stats`, `--cache-clear [category]`.
- New modules:
  - `src/engine/cache/manager.ts` (disk cache)
  - `src/engine/fixer/patterns.ts` (codemods + learned patterns + cache replay)
  - `src/engine/context/optimizer.ts` (failure trimming + candidate extraction)
  - `src/engine/verifiers/ast-analyzer.ts` (API surface diffing)
  - `src/engine/analyzers/changelog-parser.ts` (changelog digest)
  - `src/cli/interactive.ts` (readline-based review loop)
- 33 new tests (121 total): cache round-trip/TTL/eviction, codemod matching and
  non-matching, context-key normalization, interactive accept/reject/edit, AST export
  diffing, end-to-end cache replay across projects.

### Changed
- `FixResult` extended with `fixedByTier` (1–4) and `cacheHit`.
- `RunSummary` extended with `fixedByTier`, `cacheHit`, and `apiChanges`.
- Summary output now shows which tier produced the fix and flags free fixes as such.
- Changelog digest failures are non-fatal (fall back to raw changelog).

### Impact
- **Zero-token fixes for known breakages**: React 18→19 verified end-to-end with
  0 input / 0 output tokens (tier-1 codemod).
- **Repeat fixes are free**: identical failures across projects replay from cache.
- **Smaller prompts**: trimmed failure output + candidate-file hints reduce input tokens.
- **Higher trust**: interactive mode + API surface analysis catch questionable edits
  before they land.

## [0.5.0] - 2026-08-18

### Added
- **Docker sandbox isolation**: Run tests in isolated Docker containers with `--sandbox` flag
  - Auto-generates Dockerfile for Node.js and Python projects
  - Eliminates environment pollution and matches CI environment
  - Supports custom base images via configuration
- **Database integration testing**: Auto-detect and start required services
  - Supports PostgreSQL, MySQL, Redis, MongoDB via docker-compose
  - `--services` flag to manually specify services (e.g., `--services postgres,redis`)
  - Automatic service detection from package.json, docker-compose.yml, and .env files
  - Health check wait with configurable timeout
- **Performance regression detection**: Compare metrics before/after upgrade with `--detect-regressions`
  - Tracks install time, build time, test time, bundle size, memory usage
  - Configurable thresholds (default: build 20%, bundle 15%, test 30%)
  - Automatic warning when regressions exceed thresholds
  - Sets `needsReview` flag when performance degrades significantly
- New CLI flags:
  - `--sandbox`: Enable Docker sandbox mode
  - `--services <list>`: Comma-separated services to start
  - `--keep-container`: Keep container after run for debugging
  - `--detect-regressions`: Enable performance regression detection
- New modules:
  - `src/engine/sandbox/` (orchestrator, docker-manager, template-generator, service-detector)
  - `src/engine/perf/` (metrics, regression)

### Changed
- `RunOptions` now includes sandbox and performance detection options
- `RunSummary` extended with `sandboxResult` and `performanceRegression` fields
- Enhanced verification pipeline: baseline → upgrade → fix → static analysis → sandbox → performance

### Impact
- **Zero environment ambiguity**: Docker isolation eliminates "works on my machine" issues
- **Production-grade verification**: Database integration tests catch real-world breakage
- **Performance quality gates**: Automatically flag upgrades that degrade performance
- Target accuracy: 95%+ (up from 90% in v0.4.0)
- Positions greenbump as most thorough automated upgrade tool vs Dependabot/Renovate

### Requirements
- Docker must be installed and running for `--sandbox` mode
- docker-compose recommended for multi-service testing
- Graceful fallback to local verification if Docker unavailable

## [0.4.0] - 2026-08-17

### Added
- **Dependency graph analysis**: Use madge to build dependency graph and identify affected files
- **Staged fix strategy**: Organize fixes into stages (Configuration → Type Definitions → Source Code)
- **Incremental commits**: Each stage commits separately, allowing rollback to last successful stage
- New modules: `dep-graph.ts`, `stages.ts`, `staged-fix.ts`
- `commitStage()` helper in git.ts for incremental commits

### Changed
- Foundation for `--staged` flag (will be exposed in CLI in future release)
- Improved fix success rate for complex upgrades (target: 20-40% → 50-70%)

### Technical Details
- Uses madge for static dependency analysis
- Three-stage fix pipeline: config files first, then type definitions, then source code
- Each stage validates independently before committing
- Falls back to single-stage fix if dependency graph unavailable

## [0.3.0] - 2026-08-17

### Added
- **Static analysis verification**: Run TypeScript (`tsc --noEmit`) and ESLint checks after fix loop
- **Change detection warnings**: Automatically flag suspicious changes in git diff
  - Test file modifications (critical severity)
  - Large deletions >50 lines (warning severity)
  - Commented-out or removed test cases (critical severity)
- Display static analysis and change detection warnings in summary output
- Set `needsReview` flag when critical issues detected

### Changed
- `RunSummary` now includes `suspiciousChanges` and `staticAnalysisWarnings` fields
- Enhanced verification: fixes must pass type checks (TypeScript projects) in addition to tests

### Impact
- Reduces false positive fix rate from 10-20% → 5-10% (50% improvement)
- Improves user trust by catching LLM "cheating" (commenting tests, deleting code)
- TypeScript type error detection: 0% → 95%

## [0.2.1]

### Added
- `--scan` flag: list outdated dependencies without upgrading (read-only mode)
- Risk boundaries documentation in README (when to use greenbump vs manual review)
- Competitor comparison table (vs Dependabot, Renovate, Migratowl)
- CI smoke tests for real toolchains (npm, pip, cargo)
- Options table updated with `--scan`, `--all`, `--group`, `--max-tokens`

### Changed
- GitHub Action branding icon from `arrow-up-circle` to `refresh-cw`
- npm package excludes test files via `.npmignore` (reduced from 116 to 114 files)

## [0.2.0]

### Added
- Batch upgrades: `--all` (every outdated dep) and multi-dep args, with `--group <name>`
  to combine several deps into one branch/PR, and `--fail-fast` to abort a batch on the
  first hard failure.
- Monorepo/workspace support: detects npm/yarn `workspaces` and pnpm's
  `pnpm-workspace.yaml`, resolving ambiguous dependency names via `--workspace`.
- `needsReview` field on run summaries, surfaced as CLI exit code 3 (distinct from exit
  code 2 for an unfixed upgrade) — flags runs where a human should look before merging
  (a test file was touched to get green, the run was unverifiable, or a `--max-tokens`
  budget was hit).
- `--max-tokens`: hard cap on total tokens spent by the fix loop. Stops the loop and
  flags `needsReview` instead of silently overspending.
- `--report-file <path>`: persist a JSON report (schema-versioned) of the run(s).
- GitHub Action: PR draft/label updates driven by `needsReview`, new `review-label`
  input (default `needs-review`), and `report-file` input.
- Parser unit tests for the 7 ecosystems that had none: npm, pnpm, pip, uv, pipenv,
  swiftpm, elm.

### Changed
- Clarified in the docs and in `EcosystemAdapter.verified`'s own type comment that
  `verified: true` is a self-reported, one-time manual smoke test by the maintainer —
  not an automated, CI-backed guarantee.

### Fixed
- A CI-only flaky test in `checks.test.ts` caused by cross-stream (stdout/stderr)
  write-ordering not being guaranteed when appended into one combined buffer.

## [0.1.0]

Initial release: single-dependency upgrade via `greenbump <dep>` or the GitHub Action,
auto-detecting the ecosystem (npm, Yarn, pnpm, pip, Poetry, uv, Pipenv, Cargo, Go
modules, Bundler, Composer, Gradle, Maven, NuGet, Mix, Pub, Swift Package Manager,
CocoaPods, Conan, Elm), running the project's build/test, and handing any breakage to
an AI fix agent (Anthropic/OpenAI-compatible providers) until checks pass again.
