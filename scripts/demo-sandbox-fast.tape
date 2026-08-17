# VHS documentation: https://github.com/charmbracelet/vhs

# Set up the terminal
Output docs/assets/demo-sandbox-fast.gif
Set FontSize 14
Set Width 1000
Set Height 650
Set Theme "Catppuccin Mocha"
Set Padding 15

# Run greenbump with sandbox
Type "npx greenbump typeorm --sandbox --services postgres" Sleep 300ms Enter
Sleep 1s

# Simulate the upgrade process output
Type "🌱 greenbump (sandbox mode)" Enter
Sleep 200ms
Type "  · target: typeorm 0.2.45 → 0.3.20" Enter
Sleep 200ms
Type "  · created branch greenbump/typeorm-0.3.20" Enter
Sleep 300ms

Type "" Enter
Type "🐳 Sandbox Setup:" Enter
Sleep 200ms
Type "  · generating Dockerfile…" Enter
Sleep 300ms
Type "  · building image greenbump-test:latest…" Enter
Sleep 1s
Type "  ✓ image built (425 MB)" Enter
Sleep 200ms
Type "  · starting services:" Enter
Sleep 200ms
Type "    - postgres:16 (port 5432)…" Enter
Sleep 600ms
Type "    ✓ postgres ready" Enter
Sleep 300ms

Type "" Enter
Type "📊 Baseline (before upgrade):" Enter
Sleep 200ms
Type "  · running in container…" Enter
Sleep 800ms
Type "  ✓ build: 12.3s" Enter
Type "  ✓ tests: 8.1s (42 passed)" Enter
Type "  · bundle size: 245 KB" Enter
Sleep 400ms

Type "" Enter
Type "⬆️  Upgrading:" Enter
Sleep 200ms
Type "  · installing typeorm@0.3.20…" Enter
Sleep 800ms
Type "  ✓ installed" Enter
Sleep 200ms
Type "  · running checks in container…" Enter
Sleep 600ms
Type "  ✗ tests failed - starting AI fix loop" Enter
Sleep 400ms

Type "" Enter
Type "🤖 AI Fix Loop:" Enter
Sleep 200ms
Type "  · round 1: read_file src/entity/User.ts" Enter
Sleep 300ms
Type "  · round 2: write_file src/entity/User.ts" Enter
Sleep 300ms
Type "           (updated decorator syntax)" Enter
Sleep 400ms
Type "  · round 3: run_check" Enter
Sleep 800ms
Type "  · round 3: ✓ check passed - fixed!" Enter
Sleep 500ms

Type "" Enter
Type "✅ Fixed: typeorm 0.2.45 → 0.3.20" Enter
Type "  broke the build, agent repaired 5 file(s), now green." Enter
Sleep 300ms

Type "" Enter
Type "📊 Verification:" Enter
Type "  ✓ Build: 12.8s (+4.1%)" Enter
Type "  ✓ Tests: 8.3s - 42 passed" Enter
Type "  ✓ Bundle: 267 KB (+9.0%)" Enter
Type "  ✓ No regressions detected" Enter
Sleep 500ms

Type "" Enter
Type "  branch: greenbump/typeorm-0.3.20 (committed)" Enter
Type "  tokens: 52,847 in / 4,129 out" Enter
Sleep 2s
