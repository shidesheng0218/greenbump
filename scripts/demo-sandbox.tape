# VHS documentation: https://github.com/charmbracelet/vhs

# Set up the terminal
Output docs/assets/demo-sandbox.gif
Set FontSize 16
Set Width 1200
Set Height 800
Set Theme "Catppuccin Mocha"
Set Padding 20

# Title
Type "# greenbump: Sandbox Mode with Database Services" Sleep 500ms Enter
Sleep 1s

# Show Docker is available
Type "docker --version" Sleep 500ms Enter
Sleep 1.5s

Type "clear" Enter
Sleep 500ms

# Run greenbump with sandbox
Type "npx greenbump typeorm --sandbox --services postgres" Sleep 500ms Enter
Sleep 3s

# Simulate the upgrade process output
Type "🌱 greenbump (sandbox mode)" Enter
Sleep 500ms
Type "  · target: typeorm 0.2.45 → 0.3.20" Enter
Sleep 500ms
Type "  · created branch greenbump/typeorm-0.3.20" Enter
Sleep 800ms

Type "" Enter
Type "🐳 Sandbox Setup:" Enter
Sleep 500ms
Type "  · generating Dockerfile…" Enter
Sleep 800ms
Type "  · generating docker-compose.yml…" Enter
Sleep 800ms
Type "  · building image greenbump-test:latest…" Enter
Sleep 2.5s
Type "  ✓ image built (425 MB)" Enter
Sleep 500ms

Type "  · starting services:" Enter
Sleep 500ms
Type "    - postgres:16 (port 5432)…" Enter
Sleep 1.5s
Type "    ✓ postgres ready" Enter
Sleep 800ms

Type "" Enter
Type "📊 Baseline (before upgrade):" Enter
Sleep 500ms
Type "  · running in container…" Enter
Sleep 2s
Type "  ✓ build: 12.3s" Enter
Type "  ✓ tests: 8.1s (42 passed)" Enter
Type "  · bundle size: 245 KB" Enter
Sleep 1s

Type "" Enter
Type "⬆️  Upgrading:" Enter
Sleep 500ms
Type "  · installing typeorm@0.3.20…" Enter
Sleep 2s
Type "  ✓ installed" Enter
Sleep 500ms

Type "  · running checks in container…" Enter
Sleep 1.5s
Type "  ✗ tests failed - starting AI fix loop" Enter
Sleep 1s

Type "" Enter
Type "🤖 AI Fix Loop:" Enter
Sleep 500ms
Type "  · round 1: read_file src/entity/User.ts" Enter
Sleep 800ms
Type "  · round 2: write_file src/entity/User.ts" Enter
Sleep 800ms
Type "           (updated decorator syntax @Column → @Column())" Enter
Sleep 1s

Type "  · round 3: read_file src/migration/*.ts" Enter
Sleep 800ms
Type "  · round 4: write_file src/migration/1234567890.ts" Enter
Sleep 800ms
Type "           (updated QueryRunner API)" Enter
Sleep 1s

Type "  · round 5: run_check" Enter
Sleep 2s
Type "  · round 5: ✓ check passed - fixed!" Enter
Sleep 1s

Type "" Enter
Type "✅ Fixed: typeorm 0.2.45 → 0.3.20" Enter
Type "  broke the build, agent repaired 5 file(s), now green." Enter
Sleep 800ms

Type "" Enter
Type "📊 Verification (after upgrade):" Enter
Type "  ✓ Build passed: 12.8s (+4.1%)" Enter
Type "  ✓ Tests passed: 8.3s (+2.5%) - 42 passed" Enter
Type "  ✓ TypeScript types valid" Enter
Type "  · Bundle size: 267 KB (+9.0%)" Enter
Type "  ✓ No suspicious changes detected" Enter
Sleep 1.5s

Type "" Enter
Type "⚡ Performance:" Enter
Type "  ✓ Build time: +4.1% (within threshold)" Enter
Type "  ✓ Bundle size: +9.0% (within threshold)" Enter
Type "  ✓ No regressions detected" Enter
Sleep 1.5s

Type "" Enter
Type "🧹 Cleanup:" Enter
Type "  · stopping services…" Enter
Sleep 1s
Type "  · removing container…" Enter
Sleep 500ms
Type "  ✓ cleanup complete" Enter
Sleep 1s

Type "" Enter
Type "  branch: greenbump/typeorm-0.3.20 (committed)" Enter
Type "  tokens: 52,847 in / 4,129 out" Enter
Sleep 3s

# Final pause
Sleep 2s
