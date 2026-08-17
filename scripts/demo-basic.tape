# VHS documentation: https://github.com/charmbracelet/vhs

# Set up the terminal
Output docs/assets/demo-basic.gif
Set FontSize 16
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20

# Title
Type "# greenbump: Basic Upgrade Demo" Sleep 500ms Enter
Sleep 1s

# Show current React version
Type "cat package.json | grep react" Sleep 500ms Enter
Sleep 2s

# Clear and start upgrade
Type "clear" Enter
Sleep 500ms

# Run greenbump
Type "npx greenbump react" Sleep 500ms Enter
Sleep 3s

# Simulate the upgrade process output
Type "🌱 greenbump" Enter
Sleep 500ms
Type "  · target: react 18.3.1 → 19.2.0" Enter
Sleep 500ms
Type "  · created branch greenbump/react-19.2.0" Enter
Sleep 800ms

Type "  · running baseline build + tests…" Enter
Sleep 1.5s
Type "  ✓ baseline passed" Enter
Sleep 500ms

Type "  · installing react@19.2.0…" Enter
Sleep 2s
Type "  ✓ installed" Enter
Sleep 500ms

Type "  · running checks…" Enter
Sleep 1s
Type "  ✗ tests failed - starting AI fix loop" Enter
Sleep 1s

Type "  · round 1: read_file src/App.tsx" Enter
Sleep 800ms
Type "  · round 2: write_file src/App.tsx" Enter
Sleep 800ms
Type "           (replaced ReactDOM.render with createRoot)" Enter
Sleep 1s

Type "  · round 3: run_check" Enter
Sleep 1.5s
Type "  · round 3: ✓ check passed - fixed!" Enter
Sleep 1s

Type "" Enter
Type "✅ Fixed: react 18.3.1 → 19.2.0" Enter
Type "  broke the build, agent repaired 2 file(s), now green." Enter
Sleep 500ms

Type "" Enter
Type "📊 Verification:" Enter
Type "  ✓ Build passed" Enter
Type "  ✓ Tests passed (47 passed)" Enter
Type "  ✓ TypeScript types valid" Enter
Type "  ✓ No suspicious changes detected" Enter
Sleep 1s

Type "" Enter
Type "  branch: greenbump/react-19.2.0 (committed)" Enter
Type "  tokens: 41,201 in / 3,338 out" Enter
Sleep 3s

# Show git log
Type "" Enter
Type "git log --oneline -n 1" Sleep 500ms Enter
Sleep 2s

# Final pause
Sleep 2s
