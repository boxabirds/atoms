#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STDB_PORT=3000
VITE_PORT=3002
DB_NAME="atoms-multi"

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
RESET='\033[0m'

cleanup() {
  echo ""
  echo -e "${DIM}Shutting down...${RESET}"
  [[ -n "${STDB_PID:-}" ]] && kill "$STDB_PID" 2>/dev/null
  [[ -n "${VITE_PID:-}" ]] && kill "$VITE_PID" 2>/dev/null
  wait 2>/dev/null
  echo -e "${DIM}Done.${RESET}"
}
trap cleanup EXIT

# --- Get LAN IP ---
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

# --- 1. Start SpacetimeDB ---
echo -e "${CYAN}Starting SpacetimeDB on port ${STDB_PORT}...${RESET}"
if lsof -ti:${STDB_PORT} >/dev/null 2>&1; then
  echo -e "${YELLOW}  Port ${STDB_PORT} already in use — assuming SpacetimeDB is running${RESET}"
else
  spacetime start --listen-addr "0.0.0.0:${STDB_PORT}" &
  STDB_PID=$!
  # Wait for SpacetimeDB to be ready
  for i in $(seq 1 30); do
    if curl -s -o /dev/null "http://127.0.0.1:${STDB_PORT}" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  echo -e "${GREEN}  SpacetimeDB ready${RESET}"
fi

# --- 2. Publish module ---
echo -e "${CYAN}Publishing server module...${RESET}"
cd "$SCRIPT_DIR/server"
spacetime publish "$DB_NAME" -y -s local 2>&1 | tail -1
cd "$SCRIPT_DIR"
echo -e "${GREEN}  Module published${RESET}"

# --- 3. Start Vite ---
echo -e "${CYAN}Starting client on port ${VITE_PORT}...${RESET}"
if lsof -ti:${VITE_PORT} >/dev/null 2>&1; then
  echo -e "${YELLOW}  Port ${VITE_PORT} already in use — killing existing process${RESET}"
  lsof -ti:${VITE_PORT} | xargs kill 2>/dev/null
  sleep 1
fi
cd "$SCRIPT_DIR"
bunx vite --port ${VITE_PORT} &
VITE_PID=$!
# Wait for Vite
for i in $(seq 1 20); do
  if curl -s -o /dev/null "http://127.0.0.1:${VITE_PORT}" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

# --- 4. Print URLs ---
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${RESET}"
echo -e "${GREEN}  Multiplayer Atoms is running!${RESET}"
echo ""
echo -e "  Local:   ${CYAN}http://localhost:${VITE_PORT}${RESET}"
echo -e "  Network: ${CYAN}http://${LAN_IP}:${VITE_PORT}${RESET}"
echo ""
echo -e "  ${DIM}Share the Network URL with others on your LAN${RESET}"
echo -e "${GREEN}══════════════════════════════════════════════${RESET}"
echo ""
echo -e "${DIM}Press Ctrl+C to stop${RESET}"

# Keep alive
wait
