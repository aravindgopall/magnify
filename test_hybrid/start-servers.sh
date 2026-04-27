#!/bin/bash
#
# Start all local Python servers for the Hybrid Search Agent.
# Usage: ./start-servers.sh
#

set -uo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_CMD=""
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
else
    echo -e "${RED}Error:${NC} Python is not installed or not in PATH."
    exit 1
fi

echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${CYAN}  Starting Hybrid Search Local Servers${NC}"
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

PIDS=()

# Cleanup function to kill all child processes on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down servers...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null
            wait "$pid" 2>/dev/null
        fi
    done
    echo -e "${GREEN}All servers stopped.${NC}"
    exit 0
}

trap cleanup INT TERM EXIT

start_server() {
    local name=$1
    local script=$2
    local port=$3

    echo -e "${CYAN}Starting${NC} ${BOLD}$name${NC} on port ${BOLD}$port${NC}..."
    $PYTHON_CMD "$script" > "logs/${name}.log" 2>&1 &
    local pid=$!
    PIDS+=($pid)

    # Wait briefly and check if process is still alive
    sleep 1
    if ! kill -0 "$pid" 2>/dev/null; then
        echo -e "  ${RED}✗ $name failed to start.${NC}"
        echo -e "  ${YELLOW}Check logs/${name}.log for details.${NC}"
        return 1
    fi

    echo -e "  ${GREEN}✓ $name running (PID: $pid)${NC}"
    return 0
}

# Create logs dir if not exists
mkdir -p logs

# Start each server
start_server "pdf-extractor"     "scripts/pdf_extractor.py"    8001
start_server "embedding-server"  "scripts/embedding_server.py" 8002
start_server "reranker-server"   "scripts/reranker_server.py"  8003

echo ""
echo -e "${BOLD}${GREEN}All servers are up!${NC}"
echo ""
echo -e "${CYAN}Server Endpoints:${NC}"
echo -e "  PDF Extractor    ${BOLD}http://localhost:8001${NC}  → logs/pdf-extractor.log"
echo -e "  Embedding Server ${BOLD}http://localhost:8002${NC}  → logs/embedding-server.log"
echo -e "  Reranker Server  ${BOLD}http://localhost:8003${NC}  → logs/reranker-server.log"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all servers.${NC}"
echo ""

# Keep script alive until interrupted
wait
