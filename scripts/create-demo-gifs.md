# Creating Demo GIFs for README

This guide explains how to create the demo GIFs for the greenbump README.

## Tools Needed

### Option 1: VHS (Recommended - Easiest)
```bash
# Install VHS (from charm.sh)
brew install vhs

# Or via go
go install github.com/charmbracelet/vhs@latest
```

### Option 2: asciinema + agg
```bash
# Install asciinema
brew install asciinema

# Install agg (asciinema GIF generator)
cargo install --git https://github.com/asciinema/agg
```

### Option 3: Terminalizer
```bash
npm install -g terminalizer
```

## GIF 1: Basic Upgrade Flow

**What to show**: `npx greenbump react` upgrading from React 18 → 19

**Script**: [demo-basic.tape](demo-basic.tape) (for VHS)

**Steps**:
1. Show starting state with outdated React
2. Run `npx greenbump react`
3. Show the AI fix loop in action
4. Show success message with token usage
5. Show `git log` to verify commit

**Duration**: ~30-45 seconds

**Size**: Aim for 800x600px, optimized to <3MB

## GIF 2: Sandbox Mode with Services

**What to show**: `npx greenbump typeorm --sandbox --services postgres`

**Script**: [demo-sandbox.tape](demo-sandbox.tape) (for VHS)

**Steps**:
1. Show starting state
2. Run `npx greenbump typeorm --sandbox --services postgres`
3. Show Docker container starting
4. Show PostgreSQL service starting
5. Show tests running in container
6. Show performance comparison
7. Show success

**Duration**: ~40-60 seconds

**Size**: Aim for 800x600px, optimized to <3MB

## Using VHS (Recommended)

### 1. Create tape files

See [demo-basic.tape](demo-basic.tape) and [demo-sandbox.tape](demo-sandbox.tape)

### 2. Generate GIFs

```bash
# Generate GIF 1
vhs scripts/demo-basic.tape

# Generate GIF 2
vhs scripts/demo-sandbox.tape
```

### 3. Optimize GIFs

```bash
# Install gifsicle
brew install gifsicle

# Optimize
gifsicle -O3 --colors 256 demo-basic.gif -o demo-basic-optimized.gif
gifsicle -O3 --colors 256 demo-sandbox.gif -o demo-sandbox-optimized.gif
```

### 4. Move to assets directory

```bash
mkdir -p docs/assets
mv demo-basic-optimized.gif docs/assets/demo-basic.gif
mv demo-sandbox-optimized.gif docs/assets/demo-sandbox.gif
```

## Using asciinema + agg

### 1. Record sessions

```bash
# Record basic upgrade
asciinema rec demo-basic.cast
# ... perform the upgrade ...
# Press Ctrl+D to stop

# Record sandbox mode
asciinema rec demo-sandbox.cast
# ... perform the upgrade ...
# Press Ctrl+D to stop
```

### 2. Convert to GIF

```bash
# Convert to GIF
agg demo-basic.cast demo-basic.gif
agg demo-sandbox.cast demo-sandbox.gif

# Customize output
agg --font-size 16 --speed 1.5 demo-basic.cast demo-basic.gif
```

### 3. Optimize and move

```bash
gifsicle -O3 --colors 256 demo-basic.gif -o docs/assets/demo-basic.gif
gifsicle -O3 --colors 256 demo-sandbox.gif -o docs/assets/demo-sandbox.gif
```

## Tips

1. **Keep it short**: 30-60 seconds max
2. **Clear terminal**: Run `clear` before recording
3. **Readable font size**: Use larger fonts (16-18pt)
4. **Add pauses**: Let users read output (use `Sleep` in VHS)
5. **Optimize size**: GIFs should be <3MB for fast loading
6. **Use placeholder project**: Create a minimal test project with:
   - Outdated dependencies
   - Fast build/test commands
   - Predictable failures that AI can fix

## Alternative: Static SVG

If GIF creation is difficult, consider using SVG terminal recordings:

```bash
# Record with asciinema
asciinema rec demo.cast

# Convert to SVG (using svg-term-cli)
npm install -g svg-term-cli
cat demo.cast | svg-term --out demo.svg
```

Then embed in README:
```markdown
![Demo](docs/assets/demo.svg)
```

## Placeholder Projects

Create two minimal test projects:

### Project 1: React upgrade (basic)
```
test-projects/react-basic/
├── package.json (react: "18.2.0")
├── src/
│   └── App.tsx (uses ReactDOM.render - deprecated in v19)
└── package-lock.json
```

### Project 2: TypeORM upgrade (sandbox)
```
test-projects/typeorm-sandbox/
├── package.json (typeorm: "0.2.45")
├── src/
│   └── entity.ts (uses deprecated decorators)
├── docker-compose.yml (postgres)
└── package-lock.json
```

## Final Steps

1. Create GIFs using preferred method
2. Place in `docs/assets/`
3. Update README.md to reference them
4. Commit and push
5. Verify GIFs load correctly on GitHub

## Troubleshooting

**GIF too large (>3MB)**:
- Reduce colors: `--colors 128` in gifsicle
- Reduce FPS: `--lossy=80` in gifsicle
- Reduce dimensions: resize to 640x480

**Terminal not looking good**:
- Use a clean theme (e.g., Solarized Dark)
- Increase font size
- Use a monospace font (Fira Code, Menlo)

**Recording issues**:
- Make sure commands are in PATH
- Use absolute paths if needed
- Add `set -e` to fail on errors
