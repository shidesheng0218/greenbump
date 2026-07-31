# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, report it privately via GitHub's
[private vulnerability reporting](https://github.com/YOUR_GH_USERNAME/greenbump/security/advisories/new)
(replace `YOUR_GH_USERNAME` with wherever this repo actually lives), or by
emailing the maintainer directly if that's not enabled yet.

Include:
- A description of the issue and its impact
- Steps to reproduce
- The version/commit affected

We'll acknowledge reports as quickly as we can and credit you in the fix
unless you'd prefer otherwise.

## Scope and known risk areas

greenbump is a CLI/GitHub Action that:
- Runs shell commands from your project's own package manager (`npm`,
  `poetry`, `cargo`, etc.) against your working directory.
- Gives an LLM-driven agent tool access (`read_file`, `write_file`,
  `search_code`, `run_check`) scoped to the project directory — see
  `src/agent/fixer.ts`'s `safePath()` for the path-escape guard.
- Sends your build/test failure output, and optionally dependency changelogs,
  to the LLM provider you configure (your own API key — nothing is sent to
  any greenbump-operated server).

If you find a way for the fix agent to escape the project directory, run
arbitrary commands beyond your configured build/test scripts, or exfiltrate
data beyond what's needed for the fix loop, that's a valid report.

Vulnerabilities in third-party dependencies (`@anthropic-ai/sdk`, `openai`,
`commander`, etc.) should be reported upstream, though we're happy to hear
about them too if they materially affect greenbump.
