# 🌱 greenbump

**The Renovate that actually fixes your code.**

Dependabot and Renovate bump your version numbers — then hand you a red PR and walk away. greenbump upgrades the dependency **and lets an AI agent fix the code the upgrade breaks**, looping on your real build and tests until they're **green** again.

```bash
npx greenbump react
```

```
🌱 greenbump
  · target: react 18.3.1 → 19.2.0
  · created branch greenbump/react-19.2.0
  · running baseline build + tests…
  · installing react@19.2.0…
  · upgrade broke test — starting AI fix loop
  · round 1: read_file src/App.tsx
  · round 2: write_file src/App.tsx
  · round 3: run_check
  · round 3: check passed — fixed

✓ Fixed: react 18.3.1 → 19.2.0 broke the build, agent repaired 2 file(s), now green.
  branch: greenbump/react-19.2.0 (committed)
  tokens: 41,201 in / 3,338 out
```

## Why

> Every version bump is a chore that ends in the same place: something broke, and now *you* read the changelog, find the renamed export, and patch the call sites. greenbump does that part.

- **Bring your own key.** greenbump uses *your* Anthropic API key — you pay only for the tokens a fix actually costs. No server, no subscription, nothing phones home.
- **Verifies against your real suite.** It only calls a run "fixed" when *your* `build` and `test` scripts pass. No guessing.
- **Safe by default.** Works on a fresh git branch, never auto-merges, never edits your lockfile to cheat, never deletes tests to go green.
- **Bounded cost.** The fix loop is capped (`--max-rounds`) so a hard upgrade can't run away with your tokens.

## Install / Use

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# upgrade a specific dependency to latest
npx greenbump react

# pin a target version
npx greenbump eslint --to 9.15.0

# let greenbump pick the most-outdated dependency
npx greenbump
```

### Options

| Flag | Description |
|---|---|
| `[dep]` | Dependency to upgrade. Omit to pick the most-outdated one. |
| `--to <version>` | Target version (default: `latest`). |
| `--ecosystem <id>` | Dependency ecosystem (`npm`, `poetry`, `cargo`, `maven`, …). Auto-detected if omitted. |
| `--list-ecosystems` | List every supported ecosystem and exit. |
| `--build-cmd <cmd>` | Override the build command, e.g. `"make build"`. |
| `--test-cmd <cmd>` | Override the test command, e.g. `"make test"`. |
| `--provider <name>` | Model provider preset (`anthropic`, `openai`, `deepseek`, `groq`, …). |
| `--model <model>` | Model id for the fix agent (default: per provider). |
| `--max-rounds <n>` | Cap fix-loop rounds / token spend (default: `15`). |
| `--no-git` | Operate in place instead of on a new branch. |
| `--pr-body` | Print a ready-to-paste PR body. |

## Ecosystems

greenbump auto-detects the ecosystem from your project's lockfile/manifest. Run `greenbump --list-ecosystems` for the current list.

**"Verified" (self-reported, manually smoke-tested once by the maintainer, not CI-checked):** npm, Yarn, pnpm, pip, Poetry, uv, Pipenv, Cargo, Go modules, Bundler, Composer, Gradle, Maven, NuGet (.NET), Mix (Hex), Pub (Dart/Flutter), Swift Package Manager, CocoaPods, Conan (C/C++), Elm.

"Verified" here means the maintainer personally ran the detect → outdated → install → build/test chain against a real project for that ecosystem at least once — it is **not** an automated guarantee, and CI does not re-run every real toolchain on every change (that would require installing 20 separate language runtimes and package managers). The `verified` field is self-reported per adapter in [`src/engine/ecosystems/types.ts`](src/engine/ecosystems/types.ts); parser logic for each ecosystem is unit-tested (see [`parsers.test.ts`](src/engine/ecosystems/parsers.test.ts)), but the underlying CLI tools themselves are not exercised in CI.

Please [report an issue](https://github.com/shidesheng0218/greenbump/issues) if one of these doesn't work as expected on your machine — real-world edge cases (unusual manifest styles, less common CLI flags) are the best signal for tightening these adapters further.

## GitHub Action

Let greenbump upgrade a dependency on a schedule and open the PR for you. Add `.github/workflows/greenbump.yml`:

```yaml
name: greenbump
on:
  schedule:
    - cron: "0 6 * * 1" # Mondays
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - uses: shidesheng0218/greenbump@v0
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Replace `shidesheng0218/greenbump` above with wherever you publish this repo. Add your key as the `ANTHROPIC_API_KEY` repo secret. greenbump opens a normal PR when build + tests are green, or a **draft** PR (flagged for review) when it couldn't fully fix the upgrade or the repo has nothing to verify against.

> **Want CI to run on the PR?** PRs opened with the default `GITHUB_TOKEN` don't trigger other workflows (a GitHub safeguard against loops). Pass a personal access token as `github-token:` if you need your CI to fire on greenbump's PRs.

Full example with inputs: [examples/greenbump.yml](examples/greenbump.yml).

## How it works

1. **Detect** the ecosystem and the outdated dependency (e.g. `npm outdated`, `poetry show -o`, `cargo` vs. crates.io, …).
2. **Isolate** on a fresh `greenbump/<dep>-<version>` branch.
3. **Baseline** — run your build + tests. If they're already red, greenbump stops (so it never chases pre-existing failures).
4. **Upgrade** the dependency.
5. **Fix loop** — if the upgrade breaks anything, an AI agent reads the failure, edits the source, and re-runs your checks until they pass or the round cap is hit.
6. **Commit** the branch and hand you a PR body.

## Status

Early MVP, one dependency at a time. Roadmap: batch upgrades, wider provider coverage, deeper per-ecosystem verification.

## License

MIT
