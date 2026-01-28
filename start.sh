#!/bin/bash

# Playwright Assistant - Startup Script
# Starts the backend services and OpenVSCode server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
VSCODE_DIR="$SCRIPT_DIR/openvscode-server-v1.106.3-linux-x64"
VM_DIR="$SCRIPT_DIR/vm"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Playwright Assistant ===${NC}"
echo ""

# Parse arguments
USE_VM=false
BUILD_VM=false
SKIP_VSCODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --vm)
            USE_VM=true
            shift
            ;;
        --build-vm)
            BUILD_VM=true
            USE_VM=true
            shift
            ;;
        --backend-only)
            SKIP_VSCODE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --vm           Use Docker VM for browser (requires Docker)"
            echo "  --build-vm     Build Docker VM image before starting"
            echo "  --backend-only Start only backend services, skip VSCode"
            echo "  --help         Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Stopping services...${NC}"

    # Kill background processes
    if [ -n "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi

    if [ "$USE_VM" = true ]; then
        echo "Stopping Docker container..."
        docker-compose -f "$VM_DIR/docker-compose.yml" down 2>/dev/null || true
    fi

    echo -e "${GREEN}Shutdown complete.${NC}"
}

trap cleanup EXIT

# Check dependencies
echo -e "${BLUE}Checking dependencies...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    exit 1
fi

if [ "$USE_VM" = true ]; then
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed (required for --vm)${NC}"
        exit 1
    fi
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}Error: docker-compose is not installed (required for --vm)${NC}"
        exit 1
    fi
fi

# Build backend if needed
if [ ! -f "$BACKEND_DIR/dist/playwright-relay.js" ]; then
    echo -e "${YELLOW}Building backend...${NC}"
    cd "$BACKEND_DIR"
    npm install
    npm run build
fi

# Build/Start VM if requested
if [ "$USE_VM" = true ]; then
    echo -e "${BLUE}Starting Docker VM...${NC}"
    cd "$VM_DIR"

    if [ "$BUILD_VM" = true ]; then
        echo "Building Docker image..."
        docker-compose build
    fi

    docker-compose up -d

    echo "Waiting for VM to be ready..."
    sleep 5

    # Check if VM is healthy
    for i in {1..30}; do
        if curl -s http://localhost:6080/ > /dev/null 2>&1; then
            echo -e "${GREEN}VM is ready!${NC}"
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${RED}VM failed to start. Check docker logs.${NC}"
            exit 1
        fi
        sleep 1
    done

    echo ""
    echo -e "${GREEN}VM Services:${NC}"
    echo "  - noVNC:       http://localhost:6080/vnc.html"
    echo "  - VNC:         vnc://localhost:5900"
    echo "  - Chrome CDP:  http://localhost:9222"
    echo ""
fi

# Start backend server
echo -e "${BLUE}Starting backend services...${NC}"
cd "$BACKEND_DIR"

# Set environment variables
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

# When using VM, tell backend to use Docker Playwright client
if [ "$USE_VM" = true ]; then
    export USE_DOCKER_PLAYWRIGHT=true
    export DOCKER_PLAYWRIGHT_WS="ws://localhost:8765"
fi

node dist/playwright-relay.js &
BACKEND_PID=$!

# Give backend time to start
sleep 2

# Check if backend started successfully
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}Backend failed to start!${NC}"
    exit 1
fi

echo -e "${GREEN}Backend started (PID: $BACKEND_PID)${NC}"
echo ""

# Start OpenVSCode server
if [ "$SKIP_VSCODE" = false ]; then
    echo -e "${BLUE}Starting OpenVSCode server...${NC}"
    echo ""
    echo -e "${GREEN}=== Services Ready ===${NC}"
    echo ""
    echo "  VSCode:        http://localhost:3000"
    echo "  Backend WS:    ws://localhost:8767"
    echo "  Chat API:      http://localhost:8766/chat"

    if [ "$USE_VM" = true ]; then
        echo "  Docker PW:     ws://localhost:8765"
        echo "  noVNC:         http://localhost:6080/vnc.html"
    fi

    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
    echo ""

    cd "$VSCODE_DIR"
    ./bin/openvscode-server --without-connection-token
else
    echo ""
    echo -e "${GREEN}=== Backend Services Ready ===${NC}"
    echo ""
    echo "  Backend WS:    ws://localhost:8767"
    echo "  Chat API:      http://localhost:8766/chat"

    if [ "$USE_VM" = true ]; then
        echo "  Docker PW:     ws://localhost:8765"
        echo "  noVNC:         http://localhost:6080/vnc.html"
    fi

    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop${NC}"

    # Wait for backend process
    wait $BACKEND_PID
fi
