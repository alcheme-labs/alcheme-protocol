#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-${TMPDIR:-/tmp}/alcheme-runtime}"

STOP_SURFPOOL="${STOP_SURFPOOL:-true}"
STOP_DOCKER_SERVICES="${STOP_DOCKER_SERVICES:-true}"
FORCE_KILL_AFTER_SEC="${FORCE_KILL_AFTER_SEC:-8}"
SURFPOOL_FORCE_KILL_AFTER_SEC="${SURFPOOL_FORCE_KILL_AFTER_SEC:-2}"
SURFPOOL_STOP_TIMEOUT_SEC="${SURFPOOL_STOP_TIMEOUT_SEC:-6}"
STOP_CMD_TIMEOUT_SEC="${STOP_CMD_TIMEOUT_SEC:-12}"
DOCKER_CHECK_TIMEOUT_SEC="${DOCKER_CHECK_TIMEOUT_SEC:-3}"
DOCKER_PS_TIMEOUT_SEC="${DOCKER_PS_TIMEOUT_SEC:-4}"
DOCKER_STOP_TIMEOUT_SEC="${DOCKER_STOP_TIMEOUT_SEC:-8}"
SURFPOOL_STOP_MODE="${SURFPOOL_STOP_MODE:-force}"
POSTGRES_SERVICE_NAME="${POSTGRES_SERVICE_NAME:-postgres}"
REDIS_SERVICE_NAME="${REDIS_SERVICE_NAME:-redis}"
ANCHOR_SIGNER_PORT="${ANCHOR_SIGNER_PORT:-8787}"

STOPPED_COUNT=0

log() {
  printf "[%s] %s\n" "$(date '+%H:%M:%S')" "$*"
}

warn() {
  printf "[%s] WARN: %s\n" "$(date '+%H:%M:%S')" "$*" >&2
}

is_pid_running() {
  local pid="$1"
  kill -0 "$pid" >/dev/null 2>&1
}

list_pids_by_pattern() {
  local pattern="$1"
  ps -ax -o pid= -o command= 2>/dev/null | awk -v p="$pattern" '
    $0 ~ p { print $1 }
  ' | sort -u
}

kill_by_port() {
  local port="$1"
  local name="$2"
  local force_kill_after_sec="${3:-$FORCE_KILL_AFTER_SEC}"
  local pids

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    terminate_pid "$pid" "$name" "$force_kill_after_sec"
  done < <(printf "%s\n" "$pids" | sort -u)
}

fast_kill_pids() {
  local name="$1"
  local pids="$2"
  local cleaned

  cleaned="$(printf "%s\n" "$pids" | awk '/^[0-9]+$/' | sort -u | tr '\n' ' ' | xargs || true)"
  if [[ -z "$cleaned" ]]; then
    return
  fi

  # Fast path for potentially stuck surfpool processes: do not wait per pid.
  kill -TERM $cleaned >/dev/null 2>&1 || true
  sleep 1
  kill -KILL $cleaned >/dev/null 2>&1 || true
  log "stopped $name (pids: $cleaned)"
}

run_with_timeout() {
  local timeout_sec="$1"
  shift
  local cmd=("$@")
  local waited=0
  local reap_waited=0
  local child_pid
  local timed_out="false"
  local exit_code=0

  "${cmd[@]}" &
  child_pid=$!

  while is_pid_running "$child_pid" && (( waited < timeout_sec )); do
    sleep 1
    waited=$((waited + 1))
  done

  if is_pid_running "$child_pid"; then
    timed_out="true"
    warn "command timed out after ${timeout_sec}s: ${cmd[*]}"
    kill -TERM "$child_pid" >/dev/null 2>&1 || true
    sleep 1
    if is_pid_running "$child_pid"; then
      kill -KILL "$child_pid" >/dev/null 2>&1 || true
    fi
  fi

  if [[ "$timed_out" == "true" ]]; then
    while is_pid_running "$child_pid" && (( reap_waited < 2 )); do
      sleep 1
      reap_waited=$((reap_waited + 1))
    done
    if is_pid_running "$child_pid"; then
      warn "child still running after kill signals: pid=$child_pid"
      return 124
    fi
  fi

  wait "$child_pid" >/dev/null 2>&1 || exit_code=$?
  return "$exit_code"
}

terminate_pid() {
  local pid="$1"
  local name="$2"
  local force_kill_after_sec="${3:-$FORCE_KILL_AFTER_SEC}"
  local waited=0

  if ! is_pid_running "$pid"; then
    return 0
  fi

  kill -TERM "$pid" >/dev/null 2>&1 || true

  while is_pid_running "$pid" && (( waited < force_kill_after_sec )); do
    sleep 1
    waited=$((waited + 1))
  done

  if is_pid_running "$pid"; then
    warn "force killing $name (pid=$pid)"
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi

  if ! is_pid_running "$pid"; then
    STOPPED_COUNT=$((STOPPED_COUNT + 1))
    log "stopped $name (pid=$pid)"
  fi
}

stop_by_pid_file() {
  local name="$1"
  local pid_file="$RUNTIME_DIR/${name}.pid"

  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    terminate_pid "$pid" "$name"
  fi

  rm -f "$pid_file"
}

stop_by_pattern() {
  local name="$1"
  local pattern="$2"
  local force_kill_after_sec="${3:-$FORCE_KILL_AFTER_SEC}"
  local pids

  pids="$(list_pids_by_pattern "$pattern" || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    terminate_pid "$pid" "$name" "$force_kill_after_sec"
  done < <(printf "%s\n" "$pids" | sort -u)
}

stop_docker_service_if_running() {
  local service="$1"
  local compose_rpc="${COMPOSE_RPC_ENDPOINT:-http://127.0.0.1:8899}"
  local compose_event="${COMPOSE_EVENT_EMITTER_PROGRAM_ID:-11111111111111111111111111111111}"

  log "stopping docker service: $service"
  if ! run_with_timeout "$DOCKER_STOP_TIMEOUT_SEC" env \
    RPC_ENDPOINT="$compose_rpc" \
    EVENT_EMITTER_PROGRAM_ID="$compose_event" \
    docker compose -f "$ROOT_DIR/docker-compose.yml" stop "$service"; then
    warn "docker compose stop timed out/failed for $service, continue"
  fi
}

is_docker_available() {
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi

  if ! run_with_timeout "$DOCKER_CHECK_TIMEOUT_SEC" docker info >/dev/null 2>&1; then
    return 1
  fi

  if ! run_with_timeout "$DOCKER_CHECK_TIMEOUT_SEC" docker compose version >/dev/null 2>&1; then
    return 1
  fi

  return 0
}

stop_surfpool_impl() {
  # surfpool CLI stop may hang on some versions/environments.
  # Use process-based stop by default; graceful stop is explicit opt-in.
  if [[ "$SURFPOOL_STOP_MODE" == "graceful" ]] && command -v surfpool >/dev/null 2>&1; then
    log "attempting graceful surfpool stop..."
    run_with_timeout "$STOP_CMD_TIMEOUT_SEC" surfpool stop --yes >/dev/null 2>&1 || \
      run_with_timeout "$STOP_CMD_TIMEOUT_SEC" surfpool stop >/dev/null 2>&1 || true
  elif [[ "$SURFPOOL_STOP_MODE" != "force" ]]; then
    warn "unknown SURFPOOL_STOP_MODE='$SURFPOOL_STOP_MODE', fallback to 'force'"
  fi

  log "stopping surfpool processes (TERM -> KILL)"

  local pids_by_port pids_by_pattern all_pids
  pids_by_port=""
  if command -v lsof >/dev/null 2>&1; then
    pids_by_port="$(
      {
        lsof -nP -tiTCP:8899 -sTCP:LISTEN 2>/dev/null || true
        lsof -nP -tiTCP:8900 -sTCP:LISTEN 2>/dev/null || true
      } | sort -u
    )"
  fi

  pids_by_pattern="$(list_pids_by_pattern "surfpool start" || true)"
  all_pids="$(printf "%s\n%s\n" "$pids_by_port" "$pids_by_pattern" | awk 'NF { print }' | sort -u)"
  fast_kill_pids "surfpool" "$all_pids"
}

stop_surfpool_if_needed() {
  if [[ "$STOP_SURFPOOL" != "true" ]]; then
    log "STOP_SURFPOOL=false, skip surfpool"
    return
  fi

  if ! run_with_timeout "$SURFPOOL_STOP_TIMEOUT_SEC" stop_surfpool_impl; then
    warn "surfpool stop routine timed out/failed, continue"
  fi
}

stop_data_services_if_needed() {
  if [[ "$STOP_DOCKER_SERVICES" != "true" ]]; then
    log "STOP_DOCKER_SERVICES=false, keep postgres/redis"
    return
  fi

  if [[ ! -f "$ROOT_DIR/docker-compose.yml" ]]; then
    return
  fi

  if ! is_docker_available; then
    warn "docker daemon unavailable/unhealthy, skip postgres/redis stop"
    return
  fi

  log "stopping docker data services..."
  stop_docker_service_if_running "$POSTGRES_SERVICE_NAME"
  stop_docker_service_if_running "$REDIS_SERVICE_NAME"
}

main() {
  log "stopping local stack..."

  stop_by_pid_file "frontend"
  stop_by_pid_file "query-api"
  stop_by_pid_file "anchor-signer"
  stop_by_pid_file "tracker"
  stop_by_pid_file "indexer-core"
  stop_by_pid_file "redis-local"

  # Fallback in case PID files are stale/missing.
  stop_by_pattern "frontend" "$ROOT_DIR/frontend.*next dev"
  stop_by_pattern "query-api" "$ROOT_DIR/services/query-api"
  stop_by_pattern "anchor-signer" "$ROOT_DIR/extensions/anchor-signer/src/server.js"
  stop_by_pattern "tracker" "$ROOT_DIR/extensions/contribution-engine/tracker"
  stop_by_pattern "indexer-core" "$ROOT_DIR/services/indexer-core.*(cargo run --bin indexer|target/debug/indexer)"
  stop_by_pattern "start-local-stack wrapper" "$ROOT_DIR/scripts/start-local-stack.sh"
  kill_by_port "$ANCHOR_SIGNER_PORT" "anchor-signer"

  stop_surfpool_if_needed
  stop_data_services_if_needed

  log "done (stopped processes: $STOPPED_COUNT)"
}

main "$@"
