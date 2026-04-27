#!/bin/bash
#
# Setup script for the Hybrid Search Agent
# Usage: ./setup.sh
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

print_header() {
    echo -e "\n${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}  $1${NC}"
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

# ─── Check Prerequisites ──────────────────────────────────────────────────────

print_header "Checking Prerequisites"

# Check Node.js version
if ! command -v node &>/dev/null; then
    print_error "Node.js is not installed. Please install Node.js >= 18.0.0"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [[ "$NODE_MAJOR" -lt 18 ]]; then
    print_error "Node.js version $NODE_VERSION is too old. Require >= 18.0.0"
    exit 1
fi
print_success "Node.js v$NODE_VERSION"

# Check npm
if ! command -v npm &>/dev/null; then
    print_error "npm is not installed. Please install npm >= 9.0.0"
    exit 1
fi

NPM_VERSION=$(npm -v)
NPM_MAJOR=$(echo "$NPM_VERSION" | cut -d. -f1)

if [[ "$NPM_MAJOR" -lt 9 ]]; then
    print_warning "npm v$NPM_VERSION detected. Recommend >= 9.0.0"
else
    print_success "npm v$NPM_VERSION"
fi

# Check Python
PYTHON_CMD=""
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
else
    print_warning "Python not found. Local embedding/reranking servers will not be available."
    print_info "To enable local servers, install Python >= 3.9 and re-run this script."
fi

if [[ -n "$PYTHON_CMD" ]]; then
    PY_VERSION=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
    PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
    PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)

    if [[ "$PY_MAJOR" -lt 3 ]] || [[ "$PY_MAJOR" -eq 3 && "$PY_MINOR" -lt 9 ]]; then
        print_warning "Python $PY_VERSION is too old for local servers. Require >= 3.9"
    else
        print_success "Python $PY_VERSION"
    fi
fi

# ─── Install Node.js Dependencies ─────────────────────────────────────────────

print_header "Installing Node.js Dependencies"

if [[ -d "node_modules" ]]; then
    print_info "node_modules/ already exists. Skipping npm install."
    print_info "Run 'npm install' manually if you want to refresh dependencies."
else
    npm install
    print_success "Node.js dependencies installed"
fi

# ─── Install Python Dependencies ──────────────────────────────────────────────

if [[ -n "$PYTHON_CMD" && -f "requirements.txt" ]]; then
    print_header "Installing Python Dependencies"

    if $PYTHON_CMD -m pip --version &>/dev/null || $PYTHON_CMD -m pip3 --version &>/dev/null; then
        PIP_CMD="$PYTHON_CMD -m pip"
        $PIP_CMD install -r requirements.txt
        print_success "Python dependencies installed"
    else
        print_warning "pip not found. Could not install Python dependencies."
    fi
else
    print_info "Skipping Python dependency installation."
fi

# ─── Create Environment File ──────────────────────────────────────────────────

print_header "Environment Configuration"

if [[ -f ".env" ]]; then
    print_info ".env file already exists. Skipping creation."
    print_info "Review .env manually if you need to update API keys."
else
    cp .env.example .env
    print_success "Created .env from .env.example"
    echo ""
    print_warning "You MUST edit .env and add your API keys before using the system."
    echo ""

    # Interactive prompt for API keys
    echo -e "${BOLD}Enter your API keys (press Enter to skip and edit .env manually):${NC}"
    echo ""

    read -rp "  Grid API Key (for LLM synthesis): " grid_key
    read -rp "  HuggingFace API Key (optional, for cloud embeddings): " hf_key

    if [[ -n "$grid_key" ]]; then
        # Replace placeholder with actual key
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS sed
            sed -i '' "s/GRID_API_KEY=.*/GRID_API_KEY=${grid_key}/" .env
        else
            # GNU sed
            sed -i "s/GRID_API_KEY=.*/GRID_API_KEY=${grid_key}/" .env
        fi
        print_success "Grid API key saved to .env"
    fi

    if [[ -n "$hf_key" ]]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/HUGGINGFACE_API_KEY=.*/HUGGINGFACE_API_KEY=${hf_key}/" .env
        else
            sed -i "s/HUGGINGFACE_API_KEY=.*/HUGGINGFACE_API_KEY=${hf_key}/" .env
        fi
        print_success "HuggingFace API key saved to .env"
    fi

    echo ""
    print_info "Review .env for any other configuration you want to adjust."
fi

# ─── Create Data Directories ──────────────────────────────────────────────────

print_header "Creating Data Directories"

mkdir -p data logs
print_success "Created data/ and logs/ directories"

# ─── TypeScript Type Check ────────────────────────────────────────────────────

print_header "TypeScript Compilation Check"

if npm run typecheck &>/dev/null; then
    print_success "TypeScript type check passed"
else
    print_warning "TypeScript type check had issues (non-blocking)"
    print_info "You can run 'npm run typecheck' manually to see details."
fi

# ─── Setup Summary ────────────────────────────────────────────────────────────

print_header "Setup Complete!"

echo -e "${BOLD}Next steps:${NC}"
echo ""
echo -e "  ${BOLD}1. Verify your .env configuration:${NC}"
echo -e "     ${CYAN}cat .env${NC}"
echo ""
echo -e "  ${BOLD}2. Start the local Python servers:${NC}"
echo ""
echo -e "     ${YELLOW}./start-servers.sh${NC}"
echo ""
echo -e "     ${CYAN}(Starts all 3 servers: PDF extractor, embedding server, reranker)${NC}"
echo ""
echo -e "  ${BOLD}3. Ingest a PDF:${NC}"
echo -e "     ${YELLOW}npm run ingest -- \"/path/to/document.pdf\"${NC}"
echo ""
echo -e "  ${BOLD}4. Run a query:${NC}"
echo -e "     ${YELLOW}npm run query -- \"What is this document about?\"${NC}"
echo ""
echo -e "${BOLD}Quick Reference:${NC}"
echo ""
printf "  %-25s %s\n" "Ingest document:" "npm run ingest -- <path-to-pdf>"
printf "  %-25s %s\n" "Query:" "npm run query -- '<question>'"
printf "  %-25s %s\n" "More subagents:" "npm run query -- '<question>' --subagents 6"
printf "  %-25s %s\n" "More hops:" "npm run query -- '<question>' --max-hops 5"
printf "  %-25s %s\n" "JSON output:" "npm run query -- '<question>' --format json"
printf "  %-25s %s\n" "Custom chunks:" "npm run ingest -- <path> --chunk-size 256 --overlap 25"
echo ""
echo -e "${GREEN}Happy searching!${NC}"
