# VHS documentation: https://github.com/charmbracelet/vhs

# Set up the terminal
Output docs/assets/demo-basic-fast.gif
Set FontSize 14
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set Padding 15

# Run greenbump
Type "npx greenbump react" Sleep 300ms Enter
Sleep 1s

# Simulate the upgrade process output
Type "🌱 greenbump" Enter
Sleep 200ms
Type "  · target: react 18.3.1 → 19.2.0" Enter
Sleep 200ms
Type "  · created branch greenbump/react-19.2.0" Enter
Sleep 300ms
Type "  · running baseline build + tests…" Enter
Sleep 500ms
Type "  ✓ baseline passed" Enter
Sleep 200ms
Type "  · installing react@19.2.0…" Enter
Sleep 800ms
Type "  ✓ installed" Enter
Sleep 200ms
Type "  · running checks…" Enter
Sleep 400ms
Type "  ✗ tests failed - starting AI fix loop" Enter
Sleep 500ms
Type "  · round 1: read_file src/App.tsx" Enter
Sleep 300ms
Type "  · round 2: write_file src/App.tsx" Enter
Sleep 300ms
Type "           (replaced ReactDOM.render with createRoot)" Enter
Sleep 400ms
Type "  · round 3: run_check" Enter
Sleep 600ms
Type "  · round 3: ✓ check passed - fixed!" Enter
Sleep 500ms

Type "" Enter
Type "✅ Fixed: react 18.3.1 → 19.2.0" Enter
Type "  broke the build, agent repaired 2 file(s), now green." Enter
Sleep 200ms

Type "" Enter
Type "📊 Verification:" Enter
Type "  ✓ Build passed" Enter
Type "  ✓ Tests passed (47 passed)" Enter
Type "  ✓ TypeScript types valid" Enter
Type "  ✓ No suspicious changes detected" Enter
Sleep 500ms

Type "" Enter
Type "  branch: greenbump/react-19.2.0 (committed)" Enter
Type "  tokens: 41,201 in / 3,338 out" Enter
Sleep 2s
