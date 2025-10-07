#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT_DIR/api"
UI_DIR="$ROOT_DIR/ui"

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

kill_listeners() {
  local port="$1"
  local label="$2"

  if ! command -v lsof >/dev/null 2>&1; then
    echo "lsof is required to stop $label (port $port). Install lsof or stop the process manually." >&2
    return 1
  fi

  local pids
  pids=$(lsof -ti tcp:"$port" || true)
  if [ -z "$pids" ]; then
    echo "$label appears to be stopped (no listeners on port $port)."
    return 0
  fi

  echo "Stopping $label (port $port)..."
  kill $pids >/dev/null 2>&1 || true
  sleep 1

  local remaining
  remaining=$(lsof -ti tcp:"$port" || true)
  if [ -n "$remaining" ]; then
    echo "$label still running, forcing termination..."
    kill -9 $remaining >/dev/null 2>&1 || true
    sleep 1
  fi

  if lsof -ti tcp:"$port" >/dev/null 2>&1; then
    echo "Unable to stop processes on port $port. Please check manually." >&2
    return 1
  fi

  echo "$label stopped."
}

api_port=$(resolve_api_port)
ui_port=$(resolve_ui_port)

result=0
kill_listeners "$api_port" "API" || result=$?
kill_listeners "$ui_port" "UI" || result=$?

exit "$result"
