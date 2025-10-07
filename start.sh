#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$ROOT_DIR/service"
CLIENT_DIR="$ROOT_DIR/client"

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

resolve_service_port() {
  local value
  value=$(extract_env_value "$SERVICE_DIR/.env" "PORT") || true
  if [ -n "$value" ]; then
    echo "$value"
    return
  fi

  echo "8000"
}

resolve_client_port() {
  local value
  value=$(extract_env_value "$CLIENT_DIR/.env" "CLIENT_PORT") || true
  if [ -n "$value" ]; then
    echo "$value"
    return
  fi

  value=$(extract_env_value "$CLIENT_DIR/.env" "PORT") || true
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

start_service() {
  (cd "$SERVICE_DIR" && npm start)
}

start_client() {
  (cd "$CLIENT_DIR" && npm start)
}

ensure_installed "$SERVICE_DIR"
ensure_installed "$CLIENT_DIR"

service_port=$(resolve_service_port)
client_port=$(resolve_client_port)

check_port_available "$service_port"
check_port_available "$client_port"

start_service &
service_pid=$!

start_client &
client_pid=$!

cleanup() {
  trap - INT TERM
  kill "$service_pid" "$client_pid" 2>/dev/null || true
  wait "$service_pid" "$client_pid" 2>/dev/null || true
}

trap cleanup INT TERM

wait -n "$service_pid" "$client_pid"
exit_code=$?
cleanup
exit "$exit_code"
