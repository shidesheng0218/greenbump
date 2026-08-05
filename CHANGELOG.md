# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
