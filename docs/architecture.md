# greenbump Architecture & Flow

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         greenbump CLI                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Ecosystem Detection                         │
│  (npm, pip, cargo, poetry, gradle, maven, bundler, etc.)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Dependency Detection                         │
│         (Detect outdated packages from lockfiles)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Git Branch Isolation                       │
│            (Create greenbump/<dep>-<version>)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Baseline Verification                         │
│         (Run build + tests - ensure not already broken)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Performance Baseline (v0.5.0)                │
│   (Capture install time, build time, test time, bundle size)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Upgrade Dependency                        │
│         (Use ecosystem's package manager to upgrade)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Tests Pass?     │
                    └─────────────────┘
                       │            │
                      Yes          No
                       │            │
                       │            ▼
                       │   ┌─────────────────────────────┐
                       │   │     AI Fix Loop             │
                       │   │  1. Read error output       │
                       │   │  2. Fetch changelog         │
                       │   │  3. LLM analyzes + edits    │
                       │   │  4. Re-run checks           │
                       │   │  5. Repeat until fixed      │
                       │   └─────────────────────────────┘
                       │            │
                       │            ▼
                       └──────────────┐
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              Static Analysis Verification (v0.3.0)              │
│         - TypeScript type check (tsc --noEmit)                  │
│         - ESLint                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Change Detection (v0.3.0)                         │
│         - Test file modifications                               │
│         - Large deletions (>50 lines)                           │
│         - Commented-out tests                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│             Dependency Graph Analysis (v0.4.0)                  │
│         - Build dependency graph (madge)                        │
│         - Organize fixes into stages                            │
│         - Incremental commits per stage                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Sandbox Mode?   │
                    └─────────────────┘
                       │            │
                      Yes          No
                       │            │
                       ▼            │
┌─────────────────────────────────────┐       │
│   Docker Sandbox (v0.5.0)          │       │
│  - Generate Dockerfile             │       │
│  - Start services (postgres, etc.) │       │
│  - Run tests in container          │       │
└─────────────────────────────────────┘       │
                       │                       │
                       └───────────────────────┘
                                      ▼
                    ┌─────────────────────┐
                    │ Detect Regressions? │
                    └─────────────────────┘
                       │            │
                      Yes          No
                       │            │
                       ▼            │
┌─────────────────────────────────────┐       │
│  Performance Comparison (v0.5.0)   │       │
│  - Compare baseline vs current     │       │
│  - Check thresholds                │       │
│  - Flag regressions                │       │
└─────────────────────────────────────┘       │
                       │                       │
                       └───────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Commit & Create PR                          │
│         - Commit changes to branch                              │
│         - Generate PR body with summary                         │
│         - Flag as draft if needs review                         │
└─────────────────────────────────────────────────────────────────┘
```

## Verification Pipeline Evolution

### v0.1.0 - v0.2.x: Basic Verification
```
Build → Tests → ✅/❌
```

### v0.3.0: Static Analysis + Change Detection
```
Build → Tests → TypeScript → ESLint → Change Detection → ✅/❌
```

### v0.4.0: Staged Fixes
```
                   ┌─ Stage 1: Config Files
                   │
Build → Tests → ──┼─ Stage 2: Type Definitions  → TypeScript → ESLint → ✅/❌
                   │
                   └─ Stage 3: Source Code
```

### v0.5.0: Full Production Verification
```
                   ┌─ Stage 1: Config Files
                   │
Build → Tests → ──┼─ Stage 2: Type Definitions
                   │
                   └─ Stage 3: Source Code
                          │
                          ▼
                   TypeScript → ESLint → Change Detection
                          │
                          ▼
                   ┌──────────────────┐
                   │ Sandbox Mode?    │
                   └──────────────────┘
                          │
                          ▼
                   Docker + Services → Container Tests
                          │
                          ▼
                   Performance Regression Check
                          │
                          ▼
                        ✅/❌
```

## AI Fix Loop Detail

```
┌─────────────────────────────────────────────────────────────────┐
│                         Fix Loop Start                          │
│                     (Build/Tests Failed)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Fetch Changelog                            │
│     (Get release notes from npm/PyPI/crates.io/etc.)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Prepare LLM Context                          │
│  - Package name & versions                                      │
│  - Failure output (build/test errors)                           │
│  - Changelog/release notes                                      │
│  - Project structure                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        LLM Agent                                │
│  Tools available:                                               │
│  - read_file: Read source files                                │
│  - write_file: Edit source files                               │
│  - run_check: Run build + tests                                │
│  - list_files: Explore project structure                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Round N        │
                    └─────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
           ┌──────────────┐    ┌──────────────┐
           │  read_file   │    │  write_file  │
           └──────────────┘    └──────────────┘
                    │                   │
                    └─────────┬─────────┘
                              ▼
                    ┌──────────────────┐
                    │   run_check      │
                    └──────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              ┌──────────┐        ┌──────────┐
              │  Fixed?  │        │ Max      │
              │   Yes    │        │ rounds?  │
              └──────────┘        └──────────┘
                    │                   │
                    │                  Yes
                    │                   │
                    ▼                   ▼
              ┌──────────┐        ┌──────────┐
              │  Exit    │        │  Flag    │
              │  ✅      │        │  Review  │
              └──────────┘        └──────────┘
                                        │
                                       No
                                        │
                                        ▼
                              ┌──────────────────┐
                              │  Next Round      │
                              └──────────────────┘
                                        │
                                        └─────────> Round N+1
```

## Sandbox Architecture (v0.5.0)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Host Machine                            │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  Sandbox Orchestrator                                  │   │
│  │  - Detect project type (Node.js/Python)               │   │
│  │  - Generate Dockerfile                                 │   │
│  │  - Generate docker-compose.yml (if services needed)   │   │
│  │  - Build image                                         │   │
│  │  - Start services                                      │   │
│  │  - Run container                                       │   │
│  └────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │         Docker Container (Isolated)                    │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────┐         │   │
│  │  │  /workspace (mounted from host)          │         │   │
│  │  │  - package.json                          │         │   │
│  │  │  - src/                                  │         │   │
│  │  │  - tests/                                │         │   │
│  │  └──────────────────────────────────────────┘         │   │
│  │                                                         │   │
│  │  Fresh Install → Build → Tests                        │   │
│  │                                                         │   │
│  │  Network: greenbump_network                            │   │
│  └────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │         Services (docker-compose)                      │   │
│  │                                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │   │
│  │  │ postgres:16 │  │  redis:7    │  │  mongodb:7  │   │   │
│  │  │ port: 5432  │  │ port: 6379  │  │ port: 27017 │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │   │
│  │                                                         │   │
│  │  Network: greenbump_network                            │   │
│  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Performance Regression Detection (v0.5.0)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Before Upgrade (Baseline)                    │
│  - npm install time: 45s                                        │
│  - npm build time: 12s                                          │
│  - npm test time: 8s                                            │
│  - bundle size: 245 KB                                          │
│  - memory peak: 180 MB                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Upgrade Dep     │
                    └──────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     After Upgrade (Current)                     │
│  - npm install time: 48s (+6.7%)                                │
│  - npm build time: 18s (+50%) ⚠️ REGRESSION                     │
│  - npm test time: 8.2s (+2.5%)                                  │
│  - bundle size: 312 KB (+27%) ⚠️ REGRESSION                     │
│  - memory peak: 185 MB (+2.8%)                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Threshold Comparison                          │
│  - Build time: >20% = WARNING                                   │
│  - Bundle size: >15% = WARNING                                  │
│  - Test time: >30% = WARNING                                    │
│  - Memory: >40% = WARNING                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ Regressions?     │
                    └──────────────────┘
                       │            │
                      Yes          No
                       │            │
                       ▼            ▼
              ┌──────────────┐  ┌──────────────┐
              │ Flag Review  │  │ All Good ✅  │
              │ needsReview  │  │              │
              └──────────────┘  └──────────────┘
```

## Accuracy Evolution

```
v0.1.0-v0.2.x: ~80% accuracy
├── Build + Tests only
└── False positives: ~20%

v0.3.0: ~90% accuracy
├── Build + Tests
├── TypeScript type checking
├── ESLint
└── Change detection (test mods, deletions)
    └── False positives: ~10%

v0.4.0: ~92% accuracy
├── All v0.3.0 features
├── Dependency graph analysis
├── Staged fixes (config → types → source)
└── Incremental commits
    └── False positives: ~8%

v0.5.0: ~95%+ accuracy (target)
├── All v0.4.0 features
├── Docker sandbox isolation
├── Database integration testing
├── Performance regression detection
└── Production-grade verification
    └── False positives: ~5%
```
