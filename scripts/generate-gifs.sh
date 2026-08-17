#!/bin/bash

set -e

echo "🎬 Generating greenbump demo GIFs..."
echo ""

# Check if VHS is installed
if ! command -v vhs &> /dev/null; then
    echo "❌ VHS is not installed."
    echo ""
    echo "Install VHS:"
    echo "  macOS:  brew install vhs"
    echo "  Linux:  See https://github.com/charmbracelet/vhs#installation"
    echo "  Go:     go install github.com/charmbracelet/vhs@latest"
    echo ""
    exit 1
fi

# Create assets directory if it doesn't exist
mkdir -p docs/assets

# Generate GIF 1: Basic upgrade
echo "📹 Recording demo 1: Basic upgrade flow..."
vhs scripts/demo-basic.tape
echo "✅ Generated docs/assets/demo-basic.gif"
echo ""

# Generate GIF 2: Sandbox mode
echo "📹 Recording demo 2: Sandbox mode with services..."
vhs scripts/demo-sandbox.tape
echo "✅ Generated docs/assets/demo-sandbox.gif"
echo ""

# Check if gifsicle is available for optimization
if command -v gifsicle &> /dev/null; then
    echo "🗜️  Optimizing GIFs with gifsicle..."

    # Optimize basic demo
    gifsicle -O3 --colors 256 docs/assets/demo-basic.gif -o docs/assets/demo-basic-optimized.gif
    mv docs/assets/demo-basic-optimized.gif docs/assets/demo-basic.gif
    echo "✅ Optimized demo-basic.gif"

    # Optimize sandbox demo
    gifsicle -O3 --colors 256 docs/assets/demo-sandbox.gif -o docs/assets/demo-sandbox-optimized.gif
    mv docs/assets/demo-sandbox-optimized.gif docs/assets/demo-sandbox.gif
    echo "✅ Optimized demo-sandbox.gif"
    echo ""
else
    echo "⚠️  gifsicle not found - skipping optimization"
    echo "   Install with: brew install gifsicle"
    echo ""
fi

# Show file sizes
echo "📊 File sizes:"
ls -lh docs/assets/demo-*.gif | awk '{print "  " $9 ": " $5}'
echo ""

echo "✅ Done! GIFs are ready in docs/assets/"
echo ""
echo "Next steps:"
echo "  1. Review the GIFs: open docs/assets/"
echo "  2. If happy, commit them: git add docs/assets/*.gif"
echo "  3. The README already references these files"
