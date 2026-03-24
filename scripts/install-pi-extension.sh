#!/bin/bash
# Installation script for Magnify Pi-Mono Extension

set -e

echo "🚀 Installing Magnify Pi-Mono Extension..."

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Pi-Mono user directories
PI_HOME="$HOME/.pi/agent"

# Create directories
echo "📁 Creating directories..."
mkdir -p "$PI_HOME/extensions/magnify"
mkdir -p "$PI_HOME/agents"

# Symlink extension
echo "🔗 Linking extension..."
ln -sf "$PROJECT_ROOT/extensions/pi-mono-magnify/index.ts" "$PI_HOME/extensions/magnify/index.ts"

# Symlink agents
echo "🔗 Linking agents..."
for agent in "$PROJECT_ROOT/extensions/pi-mono-magnify/agents"/*.md; do
  agent_name=$(basename "$agent")
  echo "  - $agent_name"
  ln -sf "$agent" "$PI_HOME/agents/$agent_name"
done

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Installed components:"
echo "  Extension: ~/.pi/agent/extensions/magnify/index.ts"
echo "  Agents:"
echo "    - rewriter.md"
echo "    - explorer.md"
echo "    - reader.md"
echo "    - main-agent.md"
echo ""
echo "🎯 Next steps:"
echo "  1. Start the Magnify server: cd $PROJECT_ROOT && npm run dev"
echo "  2. Upload a PDF document"
echo "  3. Use pi-mono to query your documents"
echo ""
echo "📖 Example usage:"
echo '  pi "Upload the PDF at /path/to/document.pdf using magnify_upload_document"'
echo '  pi "Query the uploaded document: What is the authorization process?"'
echo ""
