# Demo GIF Placeholders

This directory will contain the demo GIFs for the README.

## Expected Files

- `demo-basic.gif` - Basic upgrade flow demo
- `demo-sandbox.gif` - Sandbox mode with database services demo

## Generating the GIFs

Run the generation script:

```bash
# Make sure VHS is installed first
brew install vhs

# Generate the GIFs
./scripts/generate-gifs.sh
```

Or manually generate them:

```bash
# Install VHS
brew install vhs

# Generate demo 1
vhs scripts/demo-basic.tape

# Generate demo 2
vhs scripts/demo-sandbox.tape

# Optional: Optimize with gifsicle
brew install gifsicle
gifsicle -O3 --colors 256 docs/assets/demo-basic.gif -o docs/assets/demo-basic.gif
gifsicle -O3 --colors 256 docs/assets/demo-sandbox.gif -o docs/assets/demo-sandbox.gif
```

## File Size Guidelines

- Target: < 3MB per GIF
- Dimensions: 800x600 or 1200x700 pixels
- Duration: 30-60 seconds
- Colors: 256 colors max (for optimization)

## Alternative: Using Real Recordings

If you prefer to record actual terminal sessions instead of using VHS scripts:

```bash
# Install asciinema
brew install asciinema

# Record session
asciinema rec demo-basic.cast
# ... perform the upgrade ...
# Press Ctrl+D when done

# Convert to GIF
cargo install --git https://github.com/asciinema/agg
agg demo-basic.cast docs/assets/demo-basic.gif

# Optimize
gifsicle -O3 --colors 256 docs/assets/demo-basic.gif -o docs/assets/demo-basic.gif
```

## Placeholder Image

Until the real GIFs are generated, the README will show broken image links.
GitHub will display a "broken image" icon, which is fine for development.

Once you run `./scripts/generate-gifs.sh`, commit the generated GIFs:

```bash
git add docs/assets/*.gif
git commit -m "docs: Add demo GIFs"
git push
```
