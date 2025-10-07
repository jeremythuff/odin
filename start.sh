#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT_DIR/api"
UI_DIR="$ROOT_DIR/ui"

ensure_installed() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    (cd "$dir" && npm install --loglevel warn)
  fi
}

extract_env_value() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 1
  fi

  local line
  line=$(grep -E "^${key}=" "$file" | tail -n 1)
  if [ -z "$line" ]; then
    return 1
  fi

  echo "${line#*=}"
  return 0
}

resolve_api_port() {
  local value
  value=$(extract_env_value "$API_DIR/.env" "PORT") || true
  if [ -n "$value" ]; then
    echo "$value"
    return
  fi

  echo "8000"
}

resolve_ui_port() {
  local value
  value=$(extract_env_value "$UI_DIR/.env" "CLIENT_PORT") || true
  if [ -n "$value" ]; then
    echo "$value"
    return
  fi

  value=$(extract_env_value "$UI_DIR/.env" "PORT") || true
  if [ -n "$value" ]; then
    echo "$value"
    return
  fi

  echo "3000"
}

check_port_available() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -ti tcp:"$port" >/dev/null 2>&1; then
      echo "Port $port is already in use. Stop the process using it or adjust your .env before running start.sh." >&2
      exit 1
    fi
  else
    # Fallback: attempt to bind via bash built-in using /dev/tcp
    if (echo > /dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
      echo "Port $port is already in use (detected via /dev/tcp)." >&2
      exit 1
    fi
  fi
}

start_api() {
  (cd "$API_DIR" && npm start)
}

start_ui() {
  (cd "$UI_DIR" && npm start)
}

ensure_installed "$API_DIR"
ensure_installed "$UI_DIR"

api_port=$(resolve_api_port)
ui_port=$(resolve_ui_port)

check_port_available "$api_port"
check_port_available "$ui_port"

start_api &
api_pid=$!

start_ui &
ui_pid=$!

cleanup() {
  trap - INT TERM
  kill "$api_pid" "$ui_pid" 2>/dev/null || true
  wait "$api_pid" "$ui_pid" 2>/dev/null || true
  "$ROOT_DIR/stop.sh" >/dev/null 2>&1 || true
}

trap cleanup INT TERM

exit_code=0
while true; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    if wait "$api_pid" >/dev/null 2>&1; then
      exit_code=0
    else
      exit_code=$?
    fi
    break
  fi

  if ! kill -0 "$ui_pid" 2>/dev/null; then
    if wait "$ui_pid" >/dev/null 2>&1; then
      exit_code=0
    else
      exit_code=$?
    fi
    break
  fi

  sleep 1
done

cleanup
exit "$exit_code"
