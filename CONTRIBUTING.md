# Contributing

## Setup

```bash
npm install
npm run build
npm test
```

`npm test` builds the project then runs every `*.test.js` file under `dist/`
with Node's built-in test runner. Some tests (`git.test.ts`) create real
temporary git repositories and shell out to the actual `git` binary — no
mocking — so they need `git` on `PATH` but touch nothing outside `os.tmpdir()`.

## Adding or fixing an ecosystem adapter

Each package manager lives in its own file under
`src/engine/ecosystems/<id>.ts` and implements the `EcosystemAdapter`
interface (`src/engine/ecosystems/types.ts`): `detect`, `outdated`, `install`,
`defaultCheckCommands`.

If you're fixing a parser bug, please:
1. Reproduce it against the *real* CLI output, not a guessed format — most
   existing bugs here came from a test fixture that didn't match what the
   real tool actually prints (e.g. `mix hex.outdated`'s "Only" column, or
   `pod outdated`'s `(latest version X)` suffix).
2. Add or update the corresponding case in
   `src/engine/ecosystems/parsers.test.ts` with a comment explaining the
   real-world quirk, not just the happy path.
3. If you have the toolchain installed locally, run the adapter against a
   throwaway project to confirm `detect`/`outdated`/`install` work end to end
   before setting `verified: true`.

## Code style

- No unnecessary abstractions — match the size of the existing adapters.
- Don't add error handling for cases that can't happen; only validate at
  actual boundaries (parsing untrusted CLI/API output, user-supplied paths).
- Keep PRs scoped: a parser fix doesn't need to also refactor the adapter
  around it.

## Reporting a bug in a specific ecosystem

Include:
- The ecosystem id (`--ecosystem <id>` or auto-detected)
- The exact manifest/lockfile involved (redact anything private)
- The raw output of the underlying CLI command that greenbump would have
  parsed (e.g. `npm outdated --json`, `pod outdated`)

For security issues, see [SECURITY.md](SECURITY.md) instead of opening a
public issue.
