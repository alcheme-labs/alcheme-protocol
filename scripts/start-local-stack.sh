#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/services/query-api/.env}"

load_env_file_defaults() {
  local env_file="${1:-}"
  local env_name
  local restore_file

  if [[ -z "$env_file" || ! -f "$env_file" ]]; then
    return 0
  fi

  restore_file="$(mktemp)"

  while IFS= read -r env_name; do
    printf 'export %s=%q\n' "$env_name" "${!env_name}" >> "$restore_file"
  done < <(compgen -e)

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  # shellcheck disable=SC1090
  source "$restore_file"
  rm -f "$restore_file"
}

load_env_file_defaults "$ENV_FILE"

RUNTIME_DIR="${RUNTIME_DIR:-${TMPDIR:-/tmp}/alcheme-runtime}"

RPC_URL="${RPC_URL:-http://127.0.0.1:8899}"
WS_URL="${WS_URL:-ws://127.0.0.1:8900}"
DATABASE_URL="${DATABASE_URL:-postgresql://alcheme:alcheme_dev_password@localhost:5432/alcheme_indexer}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
# Browser origins allowed by query-api CORS. Keep this narrow outside local dev.
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"
# Extra local game dev origins that may register/use ExternalApp sandbox access.
EXTERNAL_APP_DEV_ORIGINS="${EXTERNAL_APP_DEV_ORIGINS:-http://localhost:4173,http://127.0.0.1:4173,http://localhost:5173,http://127.0.0.1:5173}"
# Local-only operator token for ExternalApp sandbox registration. Do not ship it
# to browser clients; production approval belongs to registry/governance flow.
EXTERNAL_APP_ADMIN_TOKEN="${EXTERNAL_APP_ADMIN_TOKEN:-local-external-app-admin}"
# ExternalApp Registry V2 chain anchoring. Local stack defaults to disabled so
# existing sandbox/dev external app flows keep working without a signer.
EXTERNAL_APP_REGISTRY_MODE="${EXTERNAL_APP_REGISTRY_MODE:-disabled}"
EXTERNAL_APP_REGISTRY_AUTHORITY_KEYPAIR_PATH="${EXTERNAL_APP_REGISTRY_AUTHORITY_KEYPAIR_PATH:-}"
EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_URL="${EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_URL:-}"
EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_TOKEN="${EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_TOKEN:-}"
EXTERNAL_APP_REGISTRY_IDL_PATH="${EXTERNAL_APP_REGISTRY_IDL_PATH:-}"
STORAGE_UPLOAD_ENDPOINT="${STORAGE_UPLOAD_ENDPOINT:-}"
# STORAGE_UPLOAD_MODE controls how draft "final-document" upload behaves when
# query-api executes crystallization:
# - external: requires STORAGE_UPLOAD_ENDPOINT and forwards the document to an
#   upstream upload bridge that returns ipfs://... / cid / IpfsHash
# - local: stores the finalized draft document inside query-api's private
#   content store so local/dev environments can crystallize without an extra
#   upload service
# Precedence rule: if STORAGE_UPLOAD_ENDPOINT is set, query-api always uses the
# external bridge and ignores STORAGE_UPLOAD_MODE.
STORAGE_UPLOAD_MODE="${STORAGE_UPLOAD_MODE:-local}"
AI_MODE="${AI_MODE:-builtin}"
AI_BUILTIN_TEXT_API="${AI_BUILTIN_TEXT_API:-chat_completions}"
NEW_API_URL="${NEW_API_URL:-}"
NEW_API_KEY="${NEW_API_KEY:-}"
AI_EXTERNAL_URL="${AI_EXTERNAL_URL:-}"
NEW_API_TIMEOUT_MS="${NEW_API_TIMEOUT_MS:-${AI_GATEWAY_TIMEOUT_MS:-15000}}"
AI_GATEWAY_TIMEOUT_MS="${AI_GATEWAY_TIMEOUT_MS:-$NEW_API_TIMEOUT_MS}"
AI_EXTERNAL_TIMEOUT_MS="${AI_EXTERNAL_TIMEOUT_MS:-15000}"
AI_EXTERNAL_PRIVATE_CONTENT_MODE="${AI_EXTERNAL_PRIVATE_CONTENT_MODE:-deny}"
SCORING_MODEL="${SCORING_MODEL:-}"
GHOST_DRAFT_MODEL="${GHOST_DRAFT_MODEL:-}"
DISCUSSION_INITIAL_DRAFT_MODEL="${DISCUSSION_INITIAL_DRAFT_MODEL:-}"
DISCUSSION_SUMMARY_MODEL="${DISCUSSION_SUMMARY_MODEL:-}"
DISCUSSION_TRIGGER_MODEL="${DISCUSSION_TRIGGER_MODEL:-}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-}"
DRAFT_LIFECYCLE_ANCHOR_LOOKUP_ATTEMPTS="${DRAFT_LIFECYCLE_ANCHOR_LOOKUP_ATTEMPTS:-30}"
DRAFT_LIFECYCLE_ANCHOR_LOOKUP_DELAY_MS="${DRAFT_LIFECYCLE_ANCHOR_LOOKUP_DELAY_MS:-1000}"
DRAFT_LIFECYCLE_ANCHOR_RPC_TIMEOUT_MS="${DRAFT_LIFECYCLE_ANCHOR_RPC_TIMEOUT_MS:-5000}"
AI_SMOKE_CHECK_ON_START="${AI_SMOKE_CHECK_ON_START:-true}"
AI_SMOKE_CHECK_STRICT="${AI_SMOKE_CHECK_STRICT:-false}"
DISCUSSION_AUTH_MODE="${DISCUSSION_AUTH_MODE:-session_token}"
DISCUSSION_REQUIRE_SESSION_TOKEN="${DISCUSSION_REQUIRE_SESSION_TOKEN:-false}"
DISCUSSION_REQUIRE_SESSION_BOOTSTRAP_SIGNATURE="${DISCUSSION_REQUIRE_SESSION_BOOTSTRAP_SIGNATURE:-true}"
DISCUSSION_SESSION_TTL_SEC="${DISCUSSION_SESSION_TTL_SEC:-1800}"
DISCUSSION_SESSION_REFRESH_WINDOW_SEC="${DISCUSSION_SESSION_REFRESH_WINDOW_SEC:-300}"
GHOST_RELEVANCE_MODE="${GHOST_RELEVANCE_MODE:-${DISCUSSION_RELEVANCE_MODE:-rule}}"
GHOST_SUMMARY_USE_LLM="${GHOST_SUMMARY_USE_LLM:-${DISCUSSION_SUMMARY_USE_LLM:-false}}"
GHOST_SUMMARY_WINDOW="${GHOST_SUMMARY_WINDOW:-${DISCUSSION_SUMMARY_WINDOW:-80}}"
GHOST_SUMMARY_CACHE_TTL_SEC="${GHOST_SUMMARY_CACHE_TTL_SEC:-${DISCUSSION_SUMMARY_CACHE_TTL_SEC:-45}}"
GHOST_SUMMARY_INTERNAL_ENDPOINT_ENABLED="${GHOST_SUMMARY_INTERNAL_ENDPOINT_ENABLED:-true}"
GHOST_DRAFT_TRIGGER_ENABLED="${GHOST_DRAFT_TRIGGER_ENABLED:-${DISCUSSION_DRAFT_TRIGGER_ENABLED:-true}}"
GHOST_DRAFT_TRIGGER_MODE="${GHOST_DRAFT_TRIGGER_MODE:-${DISCUSSION_DRAFT_TRIGGER_MODE:-notify_only}}"
GHOST_DRAFT_TRIGGER_WINDOW="${GHOST_DRAFT_TRIGGER_WINDOW:-${DISCUSSION_DRAFT_TRIGGER_WINDOW:-80}}"
GHOST_DRAFT_TRIGGER_MIN_MESSAGES="${GHOST_DRAFT_TRIGGER_MIN_MESSAGES:-${DISCUSSION_DRAFT_TRIGGER_MIN_MESSAGES:-10}}"
GHOST_DRAFT_TRIGGER_MIN_QUESTIONS="${GHOST_DRAFT_TRIGGER_MIN_QUESTIONS:-${DISCUSSION_DRAFT_TRIGGER_MIN_QUESTIONS:-2}}"
GHOST_DRAFT_TRIGGER_MIN_FOCUSED_RATIO="${GHOST_DRAFT_TRIGGER_MIN_FOCUSED_RATIO:-${DISCUSSION_DRAFT_TRIGGER_MIN_FOCUSED_RATIO:-0.55}}"
GHOST_DRAFT_TRIGGER_COOLDOWN_SEC="${GHOST_DRAFT_TRIGGER_COOLDOWN_SEC:-${DISCUSSION_DRAFT_TRIGGER_COOLDOWN_SEC:-900}}"
GHOST_DRAFT_TRIGGER_SUMMARY_USE_LLM="${GHOST_DRAFT_TRIGGER_SUMMARY_USE_LLM:-${DISCUSSION_DRAFT_TRIGGER_SUMMARY_USE_LLM:-false}}"
GHOST_DRAFT_TRIGGER_GENERATE_COMMENT="${GHOST_DRAFT_TRIGGER_GENERATE_COMMENT:-${DISCUSSION_DRAFT_TRIGGER_GENERATE_COMMENT:-false}}"
GHOST_ADMIN_TOKEN="${GHOST_ADMIN_TOKEN:-${INTERNAL_API_TOKEN:-local-ghost-admin}}"
INTERNAL_API_TOKEN="${INTERNAL_API_TOKEN:-$GHOST_ADMIN_TOKEN}"
DRAFT_PROOF_ISSUER_KEY_ID="${DRAFT_PROOF_ISSUER_KEY_ID:-9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj}"
DRAFT_PROOF_ISSUER_SECRET="${DRAFT_PROOF_ISSUER_SECRET:-[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,121,181,86,46,143,230,84,249,64,120,177,18,232,169,139,167,144,31,133,58,230,149,190,215,224,227,145,11,173,4,150,100]}"
MEMBERSHIP_BRIDGE_ISSUER_KEY_ID="${MEMBERSHIP_BRIDGE_ISSUER_KEY_ID:-}"
MEMBERSHIP_BRIDGE_ISSUER_SECRET="${MEMBERSHIP_BRIDGE_ISSUER_SECRET:-}"
CRYSTAL_MINT_RPC_URL="${CRYSTAL_MINT_RPC_URL:-$RPC_URL}"
CRYSTAL_MINT_AUTHORITY_SECRET="${CRYSTAL_MINT_AUTHORITY_SECRET:-}"
CRYSTAL_MASTER_OWNER_PUBKEY="${CRYSTAL_MASTER_OWNER_PUBKEY:-}"
CRYSTAL_METADATA_BASE_URL="${CRYSTAL_METADATA_BASE_URL:-}"
# Voice defaults stay disabled so local stack can run without LiveKit.
# Set VOICE_PROVIDER=livekit and point these URLs/credentials at a LiveKit server
# when testing room voice. VOICE_PUBLIC_URL is returned to browsers; the
# LIVEKIT_* values are server-side only.
VOICE_PROVIDER="${VOICE_PROVIDER:-disabled}"
VOICE_PUBLIC_URL="${VOICE_PUBLIC_URL:-ws://localhost:7880}"
LIVEKIT_SERVER_URL="${LIVEKIT_SERVER_URL:-http://127.0.0.1:7880}"
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-devkey}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-secret}"
# If true, query-api refuses voice session/token calls while LiveKit health fails.
VOICE_REQUIRE_PROVIDER_HEALTH="${VOICE_REQUIRE_PROVIDER_HEALTH:-false}"
VOICE_PROVIDER_HEALTH_TIMEOUT_MS="${VOICE_PROVIDER_HEALTH_TIMEOUT_MS:-1500}"

DISCUSSION_RELEVANCE_MODE="${DISCUSSION_RELEVANCE_MODE:-$GHOST_RELEVANCE_MODE}"
if [[ -z "${DISCUSSION_RELEVANCE_USE_LLM:-}" ]]; then
  if [[ "$GHOST_RELEVANCE_MODE" == "hybrid" ]]; then
    DISCUSSION_RELEVANCE_USE_LLM="true"
  else
    DISCUSSION_RELEVANCE_USE_LLM="false"
  fi
fi
DISCUSSION_SUMMARY_USE_LLM="${DISCUSSION_SUMMARY_USE_LLM:-$GHOST_SUMMARY_USE_LLM}"
DISCUSSION_SUMMARY_WINDOW="${DISCUSSION_SUMMARY_WINDOW:-$GHOST_SUMMARY_WINDOW}"
DISCUSSION_SUMMARY_CACHE_TTL_SEC="${DISCUSSION_SUMMARY_CACHE_TTL_SEC:-$GHOST_SUMMARY_CACHE_TTL_SEC}"
DISCUSSION_DRAFT_TRIGGER_ENABLED="${DISCUSSION_DRAFT_TRIGGER_ENABLED:-$GHOST_DRAFT_TRIGGER_ENABLED}"
DISCUSSION_DRAFT_TRIGGER_MODE="${DISCUSSION_DRAFT_TRIGGER_MODE:-$GHOST_DRAFT_TRIGGER_MODE}"
DISCUSSION_DRAFT_TRIGGER_WINDOW="${DISCUSSION_DRAFT_TRIGGER_WINDOW:-$GHOST_DRAFT_TRIGGER_WINDOW}"
DISCUSSION_DRAFT_TRIGGER_MIN_MESSAGES="${DISCUSSION_DRAFT_TRIGGER_MIN_MESSAGES:-$GHOST_DRAFT_TRIGGER_MIN_MESSAGES}"
DISCUSSION_DRAFT_TRIGGER_MIN_QUESTIONS="${DISCUSSION_DRAFT_TRIGGER_MIN_QUESTIONS:-$GHOST_DRAFT_TRIGGER_MIN_QUESTIONS}"
DISCUSSION_DRAFT_TRIGGER_MIN_FOCUSED_RATIO="${DISCUSSION_DRAFT_TRIGGER_MIN_FOCUSED_RATIO:-$GHOST_DRAFT_TRIGGER_MIN_FOCUSED_RATIO}"
DISCUSSION_DRAFT_TRIGGER_COOLDOWN_SEC="${DISCUSSION_DRAFT_TRIGGER_COOLDOWN_SEC:-$GHOST_DRAFT_TRIGGER_COOLDOWN_SEC}"
DISCUSSION_DRAFT_TRIGGER_SUMMARY_USE_LLM="${DISCUSSION_DRAFT_TRIGGER_SUMMARY_USE_LLM:-$GHOST_DRAFT_TRIGGER_SUMMARY_USE_LLM}"
DISCUSSION_DRAFT_TRIGGER_GENERATE_COMMENT="${DISCUSSION_DRAFT_TRIGGER_GENERATE_COMMENT:-$GHOST_DRAFT_TRIGGER_GENERATE_COMMENT}"

START_INDEXER="${START_INDEXER:-true}"
START_ANCHOR_SIGNER="${START_ANCHOR_SIGNER:-true}"
AUTO_INITIALIZE="${AUTO_INITIALIZE:-true}"
AUTO_AIRDROP_WALLET="${AUTO_AIRDROP_WALLET:-true}"
FORCE_REDEPLOY_CORE="${FORCE_REDEPLOY_CORE:-false}"
CORE_PROGRAM_FINGERPRINT_FILE="${CORE_PROGRAM_FINGERPRINT_FILE:-$ROOT_DIR/target/deploy/.core-program-source-fingerprint}"
# Optional comma-separated local wallet addresses to fund on the local RPC.
AIRDROP_WALLET_ADDRESS="${AIRDROP_WALLET_ADDRESS:-}"
AIRDROP_AMOUNT_SOL="${AIRDROP_AMOUNT_SOL:-2}"
# Fast-forwarding checkpoint can skip old historical events.
# For local dev, default to keeping a recent replay window so indexer doesn't
# get stuck on very old slots.
AUTO_FAST_FORWARD_CHECKPOINT="${AUTO_FAST_FORWARD_CHECKPOINT:-true}"
INDEXER_MAX_LAG_SLOTS="${INDEXER_MAX_LAG_SLOTS:-3000}"
INDEXER_FAST_FORWARD_BUFFER_SLOTS="${INDEXER_FAST_FORWARD_BUFFER_SLOTS:-1000}"
LOCAL_RPC_MAX_RETRIES_PER_SLOT="${LOCAL_RPC_MAX_RETRIES_PER_SLOT:-3}"
LOCAL_RPC_MAX_RETRIES_PER_TX="${LOCAL_RPC_MAX_RETRIES_PER_TX:-1}"
LOCAL_RPC_MAX_FAILED_TXS_PER_SLOT="${LOCAL_RPC_MAX_FAILED_TXS_PER_SLOT:-16}"
LOCAL_RPC_MAX_CONCURRENT_TX_FETCHES="${LOCAL_RPC_MAX_CONCURRENT_TX_FETCHES:-8}"
LOCAL_RPC_REQUEST_TIMEOUT_MS="${LOCAL_RPC_REQUEST_TIMEOUT_MS:-30000}"
LOCAL_RPC_POLL_INTERVAL_MS="${LOCAL_RPC_POLL_INTERVAL_MS:-1500}"
LOCAL_RPC_MAX_SLOTS_PER_TICK="${LOCAL_RPC_MAX_SLOTS_PER_TICK:-32}"
LOCAL_RPC_INITIAL_BACKFILL_SLOTS="${LOCAL_RPC_INITIAL_BACKFILL_SLOTS:-32}"
LOCAL_LISTENER_MODE="${LOCAL_LISTENER_MODE:-program_cursor}"
LOCAL_WS_URL="${LOCAL_WS_URL:-$WS_URL}"
LOCAL_BACKFILL_SIGNATURE_LIMIT="${LOCAL_BACKFILL_SIGNATURE_LIMIT:-16}"
INDEXER_ID="${INDEXER_ID:-local-indexer-1}"
INDEXER_EVENT_SOURCE="${INDEXER_EVENT_SOURCE:-yellowstone}"
YELLOWSTONE_ENDPOINT="${YELLOWSTONE_ENDPOINT:-${RPC_ENDPOINT:-}}"
YELLOWSTONE_TOKEN="${YELLOWSTONE_TOKEN:-}"
FORCE_RESTART_INDEXER_ON_START="${FORCE_RESTART_INDEXER_ON_START:-true}"
RESET_LOCAL_READ_MODEL_ON_CHAIN_REBUILD="${RESET_LOCAL_READ_MODEL_ON_CHAIN_REBUILD:-true}"
INDEXER_STARTUP_PROGRESS_TIMEOUT_SEC="${INDEXER_STARTUP_PROGRESS_TIMEOUT_SEC:-120}"
INDEXER_MIN_PROGRESS_SLOTS="${INDEXER_MIN_PROGRESS_SLOTS:-1}"
INDEXER_MAX_SLOT_LAG="${INDEXER_MAX_SLOT_LAG:-5000}"
POSTGRES_CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-alcheme-postgres}"
TRACKER_SETTLEMENT_ENABLED="${TRACKER_SETTLEMENT_ENABLED:-false}"
TRACKER_SETTLEMENT_EXECUTE_ON_CHAIN="${TRACKER_SETTLEMENT_EXECUTE_ON_CHAIN:-false}"
IDENTITY_REGISTRY_NAME="${IDENTITY_REGISTRY_NAME:-social_hub_identity}"
ANCHOR_SIGNER_HOST="${ANCHOR_SIGNER_HOST:-127.0.0.1}"
ANCHOR_SIGNER_PORT="${ANCHOR_SIGNER_PORT:-8787}"
ANCHOR_SIGNER_URL="${ANCHOR_SIGNER_URL:-http://${ANCHOR_SIGNER_HOST}:${ANCHOR_SIGNER_PORT}/sign}"
ANCHOR_SIGNER_AUTH_TOKEN="${ANCHOR_SIGNER_AUTH_TOKEN:-local-anchor-token}"
ANCHOR_SIGNER_TIMEOUT_MS="${ANCHOR_SIGNER_TIMEOUT_MS:-10000}"
ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
if [[ -n "${ANCHOR_SIGNER_MODE:-}" ]]; then
  ANCHOR_SIGNER_MODE="${ANCHOR_SIGNER_MODE}"
elif [[ "$START_ANCHOR_SIGNER" == "true" ]]; then
  ANCHOR_SIGNER_MODE="external"
else
  ANCHOR_SIGNER_MODE="local"
fi
ANCHOR_SIGNER_KEYPAIR_PATH="${ANCHOR_SIGNER_KEYPAIR_PATH:-$ANCHOR_WALLET}"
INDEXER_CHECKPOINT_UPDATED="false"
INDEXER_EVENT_SOURCE_EFFECTIVE=""
AI_GATEWAY_WARNING=""
CORE_PROGRAMS_WERE_MISSING="false"
REQUIRED_PDAS_WERE_MISSING="false"

mkdir -p "$RUNTIME_DIR"

log() {
  printf "[%s] %s\n" "$(date '+%H:%M:%S')" "$*"
}

warn() {
  printf "[%s] WARN: %s\n" "$(date '+%H:%M:%S')" "$*" >&2
}

err() {
  printf "[%s] ERROR: %s\n" "$(date '+%H:%M:%S')" "$*" >&2
}

trim_whitespace() {
  local s="${1:-}"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf "%s" "$s"
}

find_node_bin() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  if [[ -x /opt/homebrew/bin/node ]]; then
    printf "%s\n" "/opt/homebrew/bin/node"
    return 0
  fi
  return 1
}

derive_pubkey_from_keypair_file() {
  local wallet_path="${1:-}"
  local node_bin="${2:-}"

  if [[ -z "$wallet_path" || ! -f "$wallet_path" || -z "$node_bin" ]]; then
    return 1
  fi

  "$node_bin" - "$wallet_path" "$ROOT_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

const walletPath = process.argv[2];
const rootDir = process.argv[3];
const candidates = [
  path.join(rootDir, 'node_modules', '@solana', 'web3.js'),
  path.join(rootDir, 'frontend', 'node_modules', '@solana', 'web3.js'),
  path.join(rootDir, 'services', 'query-api', 'node_modules', '@solana', 'web3.js'),
];

let web3 = null;
for (const candidate of candidates) {
  try {
    web3 = require(candidate);
    break;
  } catch {}
}

if (!web3) {
  try {
    web3 = require('@solana/web3.js');
  } catch {
    console.error('Missing @solana/web3.js. Run `npm ci` in the repository root before starting the local stack.');
    process.exit(2);
  }
}

const { Keypair } = web3;
const raw = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
process.stdout.write(keypair.publicKey.toBase58());
NODE
}

resolve_membership_bridge_issuer_defaults() {
  local wallet_path node_bin derived_pubkey

  wallet_path="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"

  if [[ -z "$MEMBERSHIP_BRIDGE_ISSUER_SECRET" && -f "$wallet_path" ]]; then
    MEMBERSHIP_BRIDGE_ISSUER_SECRET="$(tr -d '\r\n' < "$wallet_path")"
  fi

  if [[ -n "$MEMBERSHIP_BRIDGE_ISSUER_KEY_ID" ]]; then
    return 0
  fi

  node_bin="$(find_node_bin || true)"
  if [[ -z "$node_bin" ]]; then
    return 0
  fi

  derived_pubkey="$(derive_pubkey_from_keypair_file "$wallet_path" "$node_bin" || true)"
  if [[ -n "$derived_pubkey" ]]; then
    MEMBERSHIP_BRIDGE_ISSUER_KEY_ID="$derived_pubkey"
  fi
}

assess_ai_gateway_warning() {
  local mode gateway external normalized
  mode="$(trim_whitespace "${AI_MODE:-builtin}" | tr '[:upper:]' '[:lower:]')"
  gateway="$(trim_whitespace "${NEW_API_URL:-}")"
  external="$(trim_whitespace "${AI_EXTERNAL_URL:-}")"
  normalized="$(printf "%s" "$gateway" | tr '[:upper:]' '[:lower:]')"

  if [[ "$mode" == "external" ]]; then
    if [[ -z "$external" ]]; then
      printf "AI_EXTERNAL_URL is unset while AI_MODE=external; this mode expects a separate AI adapter service implementing /generate-text and /embed, and this repo does not start one for you"
    fi
    return
  fi

  if [[ -z "$gateway" ]]; then
    printf "builtin AI gateway is unset; query-api will fall back to localhost:3000/v1 unless NEW_API_URL is exported"
    return
  fi

  if [[ "$normalized" == "http://localhost:3000/v1" || "$normalized" == "http://127.0.0.1:3000/v1" || "$normalized" == "http://localhost:3000/v1/" || "$normalized" == "http://127.0.0.1:3000/v1/" ]]; then
    printf "NEW_API_URL points at the frontend dev server; builtin AI calls will fail"
  fi
}

AI_GATEWAY_WARNING="$(assess_ai_gateway_warning)"
if [[ -n "$AI_GATEWAY_WARNING" ]]; then
  warn "$AI_GATEWAY_WARNING"
fi

resolve_membership_bridge_issuer_defaults

normalize_indexer_event_source() {
  local raw="${1:-}"
  local normalized
  normalized="$(trim_whitespace "$raw" | tr '[:upper:]' '[:lower:]')"

  case "$normalized" in
    ""|"auto")
      printf "auto"
      ;;
    "yellowstone"|"grpc")
      printf "yellowstone"
      ;;
    "local"|"local_rpc"|"rpc"|"polling")
      printf "local"
      ;;
    *)
      printf "invalid"
      ;;
  esac
}

is_probably_yellowstone_endpoint() {
  local endpoint="${1:-}"
  local normalized

  normalized="$(trim_whitespace "$endpoint")"
  if [[ -z "$normalized" ]]; then
    return 1
  fi

  local lower
  lower="$(printf "%s" "$normalized" | tr '[:upper:]' '[:lower:]')"

  # JSON-RPC / WS endpoints are not valid Yellowstone gRPC targets.
  if [[ "$lower" =~ ^https?://(127\.0\.0\.1|localhost)(:8899)?(/|$) ]]; then
    return 1
  fi
  if [[ "$lower" =~ ^(127\.0\.0\.1|localhost):8899$ ]]; then
    return 1
  fi
  if [[ "$lower" == ws://* || "$lower" == wss://* ]]; then
    return 1
  fi

  return 0
}

resolve_indexer_event_source() {
  local requested endpoint
  requested="$(normalize_indexer_event_source "$INDEXER_EVENT_SOURCE")"
  endpoint="${YELLOWSTONE_ENDPOINT:-${RPC_ENDPOINT:-}}"

  if [[ "$requested" == "invalid" ]]; then
    err "invalid INDEXER_EVENT_SOURCE=\"$INDEXER_EVENT_SOURCE\" (use: yellowstone|local|auto)"
    exit 1
  fi

  if [[ "$requested" == "local" ]]; then
    INDEXER_EVENT_SOURCE_EFFECTIVE="local"
    warn "indexer source forced to local development fallback (not production-grade)"
    return
  fi

  if is_probably_yellowstone_endpoint "$endpoint"; then
    INDEXER_EVENT_SOURCE_EFFECTIVE="yellowstone"
    YELLOWSTONE_ENDPOINT="$endpoint"
    log "indexer source: yellowstone (endpoint: $YELLOWSTONE_ENDPOINT)"
    return
  fi

  if [[ "$requested" == "yellowstone" ]]; then
    warn "yellowstone not configured or endpoint invalid for gRPC; fallback to local development listener"
  else
    warn "yellowstone endpoint missing; auto fallback to local development listener"
  fi
  INDEXER_EVENT_SOURCE_EFFECTIVE="local"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "missing required command: $cmd"
    exit 1
  fi
}

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

run_bg_with_timeout() {
  local timeout_sec="$1"
  local cmd="$2"

  bash -c "$cmd" >/dev/null 2>&1 &
  local pid=$!
  local i
  for ((i=0; i<timeout_sec; i++)); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      wait "$pid" || return $?
      return 0
    fi
    sleep 1
  done

  warn "command timeout after ${timeout_sec}s: $cmd"
  kill -TERM "$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
  return 124
}

start_local_redis_fallback() {
  local i
  local pid_file="$RUNTIME_DIR/redis-local.pid"
  local log_file="$RUNTIME_DIR/redis-local.log"

  if is_port_listening 6379; then
    return 0
  fi

  if ! command -v redis-server >/dev/null 2>&1; then
    return 1
  fi

  log "docker redis unavailable, trying local redis-server fallback on 6379..."
  nohup redis-server --port 6379 --save "" --appendonly no >"$log_file" 2>&1 &
  echo "$!" >"$pid_file"

  for ((i=0; i<15; i++)); do
    if is_port_listening 6379; then
      log "local redis-server fallback is listening on 6379"
      return 0
    fi
    if [[ -f "$pid_file" ]]; then
      local pid
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [[ "$pid" =~ ^[0-9]+$ ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
        warn "local redis-server fallback exited early (log: $log_file)"
        return 1
      fi
    fi
    sleep 1
  done

  warn "local redis-server fallback did not become reachable on 6379 in time"
  return 1
}

wait_for_http_health() {
  local url="$1"
  local timeout_sec="$2"
  local i
  for ((i=0; i<timeout_sec; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_rpc_health() {
  local timeout_sec="${1:-60}"
  local payload='{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
  local i

  for ((i=0; i<timeout_sec; i++)); do
    if curl -s "$RPC_URL" \
      -X POST \
      -H "Content-Type: application/json" \
      -d "$payload" | grep -q '"ok"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

get_confirmed_slot() {
  local payload='{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"confirmed"}]}'
  local response slot

  response="$(curl -s "$RPC_URL" -X POST -H "Content-Type: application/json" -d "$payload" || true)"
  slot="$(printf "%s" "$response" | sed -n 's/.*"result":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
  printf "%s" "$slot"
}

detect_postgres_container() {
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi

  if docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER_NAME"; then
    printf "%s" "$POSTGRES_CONTAINER_NAME"
    return 0
  fi

  local fallback
  fallback="$(docker ps --format '{{.Names}}' | grep -E 'alcheme.*postgres|postgres' | head -n1 || true)"
  if [[ -n "$fallback" ]]; then
    printf "%s" "$fallback"
    return 0
  fi

  return 1
}

run_psql_query() {
  local sql="$1"

  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$sql"
    return $?
  fi

  local pg_container
  pg_container="$(detect_postgres_container || true)"
  if [[ -n "$pg_container" ]]; then
    docker exec -i "$pg_container" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$sql"
    return $?
  fi

  return 127
}

get_sync_checkpoint_slot() {
  local program_id="$1"
  local out
  out="$(run_psql_query "SELECT last_processed_slot FROM sync_checkpoints WHERE program_id='${program_id}' LIMIT 1;" 2>/dev/null || true)"
  out="$(printf "%s" "$out" | head -n1 | tr -d '[:space:]')"
  printf "%s" "$out"
}

set_sync_checkpoint_slot() {
  local program_id="$1"
  local slot="$2"
  local out

  out="$(
    run_psql_query "UPDATE sync_checkpoints SET last_processed_slot=${slot}, last_successful_sync=NOW(), updated_at=NOW() WHERE program_id='${program_id}' RETURNING last_processed_slot;" \
      2>/dev/null || true
  )"
  out="$(printf "%s" "$out" | head -n1 | tr -d '[:space:]')"
  [[ "$out" == "$slot" ]]
}

clear_program_cursors() {
  local listener_mode="${1:-program_cursor}"
  run_psql_query "DELETE FROM indexer_program_cursors WHERE listener_mode='${listener_mode}';" >/dev/null 2>&1 || true
}

resolve_failed_slots_before() {
  local program_id="$1"
  local slot="$2"

  run_psql_query "UPDATE indexer_failed_slots
    SET resolved=TRUE, resolved_at=NOW(), updated_at=NOW()
    WHERE program_id='${program_id}'
      AND resolved=FALSE
      AND slot <= ${slot};" >/dev/null 2>&1 || true
}

resolve_failed_slots_behind_checkpoint() {
  local program_id="$1"
  local checkpoint_slot

  checkpoint_slot="$(get_sync_checkpoint_slot "$program_id")"
  if [[ "$checkpoint_slot" =~ ^[0-9]+$ ]]; then
    resolve_failed_slots_before "$program_id" "$checkpoint_slot"
  fi
}

ensure_indexer_checkpoint_freshness() {
  INDEXER_CHECKPOINT_UPDATED="false"

  if [[ "$AUTO_FAST_FORWARD_CHECKPOINT" != "true" ]]; then
    log "AUTO_FAST_FORWARD_CHECKPOINT=false, skip checkpoint fast-forward"
    return
  fi

  if [[ -z "${EVENT_PROGRAM_ID:-}" ]]; then
    warn "EVENT_PROGRAM_ID is empty, skip checkpoint fast-forward"
    return
  fi

  local head_slot checkpoint_slot lag target_slot effective_buffer safe_guard_buffer
  head_slot="$(get_confirmed_slot)"
  if ! [[ "$head_slot" =~ ^[0-9]+$ ]]; then
    warn "cannot read head slot from RPC, skip checkpoint fast-forward"
    return
  fi

  checkpoint_slot="$(get_sync_checkpoint_slot "$EVENT_PROGRAM_ID")"
  if [[ -z "$checkpoint_slot" ]]; then
    log "no sync checkpoint found for $EVENT_PROGRAM_ID, skip fast-forward"
    return
  fi
  if ! [[ "$checkpoint_slot" =~ ^[0-9]+$ ]]; then
    warn "invalid checkpoint slot ($checkpoint_slot), skip fast-forward"
    return
  fi

  if (( head_slot <= checkpoint_slot )); then
    return
  fi

  lag=$((head_slot - checkpoint_slot))
  if (( lag <= INDEXER_MAX_LAG_SLOTS )); then
    log "indexer checkpoint lag ${lag} slots (threshold ${INDEXER_MAX_LAG_SLOTS})"
    return
  fi

  effective_buffer="${INDEXER_FAST_FORWARD_BUFFER_SLOTS}"
  safe_guard_buffer=$((INDEXER_MAX_SLOT_LAG / 2))
  if (( safe_guard_buffer < 1 )); then
    safe_guard_buffer=1
  fi
  if (( effective_buffer > safe_guard_buffer )); then
    warn "fast-forward buffer ${effective_buffer} exceeds startup guard budget ${safe_guard_buffer}, clamping"
    effective_buffer="$safe_guard_buffer"
  fi

  target_slot=$((head_slot - effective_buffer))
  if (( target_slot < 0 )); then
    target_slot=0
  fi
  if (( target_slot <= checkpoint_slot )); then
    return
  fi

  warn "checkpoint lag ${lag} slots, fast-forwarding ${checkpoint_slot} -> ${target_slot}"
  if set_sync_checkpoint_slot "$EVENT_PROGRAM_ID" "$target_slot"; then
    clear_program_cursors "${LOCAL_LISTENER_MODE:-program_cursor}"
    resolve_failed_slots_before "$EVENT_PROGRAM_ID" "$target_slot"
    INDEXER_CHECKPOINT_UPDATED="true"
    log "checkpoint updated successfully and local program cursors cleared"
  else
    warn "failed to update checkpoint; continue without fast-forward"
  fi
}

start_surfpool_if_needed() {
  if wait_for_rpc_health 2; then
    log "surfpool already healthy on $RPC_URL"
    return
  fi

  local surfpool_args=(start --no-tui --yes)
  if [[ "$(uname -s)" == "Linux" ]]; then
    surfpool_args+=(--daemon)
    log "starting surfpool daemon..."
  else
    log "starting surfpool (non-daemon mode on $(uname -s))..."
  fi
  (
    cd "$ROOT_DIR"
    # Always spawn in background to avoid blocking this script.
    nohup surfpool "${surfpool_args[@]}" >"$RUNTIME_DIR/surfpool.log" 2>&1 &
  )

  if ! wait_for_rpc_health 90; then
    err "failed to start surfpool on $RPC_URL"
    err "surfpool log: $RUNTIME_DIR/surfpool.log"
    err "try running manually: cd \"$ROOT_DIR\" && surfpool start --no-tui --yes"
    exit 1
  fi
  log "surfpool is healthy"
}

ensure_frontend_wallet_funded() {
  if [[ "$AUTO_AIRDROP_WALLET" != "true" ]]; then
    log "AUTO_AIRDROP_WALLET=false, skip wallet airdrop"
    return
  fi

  if [[ -z "$AIRDROP_WALLET_ADDRESS" ]]; then
    log "AIRDROP_WALLET_ADDRESS is empty, skip wallet airdrop"
    return
  fi

  local addresses
  IFS=',' read -r -a addresses <<< "$AIRDROP_WALLET_ADDRESS"

  local addr trimmed_addr lamports_raw lamports after
  for addr in "${addresses[@]}"; do
    trimmed_addr="$(echo "$addr" | xargs)"
    if [[ -z "$trimmed_addr" ]]; then
      continue
    fi

    lamports_raw="$(solana balance "$trimmed_addr" --url "$RPC_URL" --lamports 2>/dev/null || true)"
    if [[ "$lamports_raw" =~ ^[0-9]+$ ]]; then
      lamports="$lamports_raw"
    else
      lamports=0
    fi

    if (( lamports == 0 )); then
      log "airdropping ${AIRDROP_AMOUNT_SOL} SOL to $trimmed_addr ..."
      if ! solana airdrop "$AIRDROP_AMOUNT_SOL" "$trimmed_addr" --url "$RPC_URL" >/dev/null 2>&1; then
        warn "airdrop failed for $trimmed_addr (faucet may be temporarily unavailable)"
        continue
      fi

      after="$(solana balance "$trimmed_addr" --url "$RPC_URL" 2>/dev/null || true)"
      log "wallet funded: $trimmed_addr => $after"
    else
      log "wallet already funded: $trimmed_addr (${lamports} lamports)"
    fi
  done
}

load_frontend_program_ids() {
  local env_file="$ROOT_DIR/frontend/.env.local"
  if [[ ! -f "$env_file" ]]; then
    err "frontend env file not found: $env_file"
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  IDENTITY_PROGRAM_ID="${NEXT_PUBLIC_IDENTITY_PROGRAM_ID:-}"
  CONTENT_PROGRAM_ID="${NEXT_PUBLIC_CONTENT_PROGRAM_ID:-}"
  ACCESS_PROGRAM_ID="${NEXT_PUBLIC_ACCESS_PROGRAM_ID:-}"
  EVENT_PROGRAM_ID="${NEXT_PUBLIC_EVENT_PROGRAM_ID:-}"
  FACTORY_PROGRAM_ID="${NEXT_PUBLIC_FACTORY_PROGRAM_ID:-}"
  MESSAGING_PROGRAM_ID="${NEXT_PUBLIC_MESSAGING_PROGRAM_ID:-}"
  CIRCLES_PROGRAM_ID="${NEXT_PUBLIC_CIRCLES_PROGRAM_ID:-}"
  EXTERNAL_APP_REGISTRY_PROGRAM_ID="${NEXT_PUBLIC_EXTERNAL_APP_REGISTRY_PROGRAM_ID:-${EXTERNAL_APP_REGISTRY_PROGRAM_ID:-}}"
  CONTRIBUTION_PROGRAM_ID="${NEXT_PUBLIC_CONTRIBUTION_ENGINE_PROGRAM_ID:-}"

  local required=(
    "$IDENTITY_PROGRAM_ID"
    "$CONTENT_PROGRAM_ID"
    "$ACCESS_PROGRAM_ID"
    "$EVENT_PROGRAM_ID"
    "$FACTORY_PROGRAM_ID"
    "$MESSAGING_PROGRAM_ID"
    "$CIRCLES_PROGRAM_ID"
    "$EXTERNAL_APP_REGISTRY_PROGRAM_ID"
    "$CONTRIBUTION_PROGRAM_ID"
  )

  local id
  for id in "${required[@]}"; do
    if [[ -z "$id" ]]; then
      err "missing required program id in frontend/.env.local"
      exit 1
    fi
  done
}

program_is_deployed() {
  local program_id="$1"
  local response
  response="$(curl -sS --max-time 3 \
    -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$program_id\",{\"encoding\":\"base64\"}]}" \
    2>/dev/null || true)"

  [[ -n "$response" && "$response" != *'"value":null'* && "$response" == *'"value":{'* ]]
}

check_core_programs() {
  local missing=()

  if ! program_is_deployed "$IDENTITY_PROGRAM_ID"; then missing+=("identity_registry:$IDENTITY_PROGRAM_ID"); fi
  if ! program_is_deployed "$CONTENT_PROGRAM_ID"; then missing+=("content_manager:$CONTENT_PROGRAM_ID"); fi
  if ! program_is_deployed "$ACCESS_PROGRAM_ID"; then missing+=("access_controller:$ACCESS_PROGRAM_ID"); fi
  if ! program_is_deployed "$EVENT_PROGRAM_ID"; then missing+=("event_emitter:$EVENT_PROGRAM_ID"); fi
  if ! program_is_deployed "$FACTORY_PROGRAM_ID"; then missing+=("registry_factory:$FACTORY_PROGRAM_ID"); fi
  if ! program_is_deployed "$MESSAGING_PROGRAM_ID"; then missing+=("messaging_manager:$MESSAGING_PROGRAM_ID"); fi
  if ! program_is_deployed "$CIRCLES_PROGRAM_ID"; then missing+=("circle_manager:$CIRCLES_PROGRAM_ID"); fi
  if ! program_is_deployed "$EXTERNAL_APP_REGISTRY_PROGRAM_ID"; then missing+=("external_app_registry:$EXTERNAL_APP_REGISTRY_PROGRAM_ID"); fi

  if [[ "${#missing[@]}" -gt 0 ]]; then
    warn "core programs missing on current chain:"
    printf '  - %s\n' "${missing[@]}"
    return 1
  fi

  return 0
}

current_core_source_fingerprint() {
  (
    cd "$ROOT_DIR"
    {
      [[ -f Anchor.toml ]] && printf '%s\n' "Anchor.toml"
      [[ -f Cargo.toml ]] && printf '%s\n' "Cargo.toml"
      [[ -f Cargo.lock ]] && printf '%s\n' "Cargo.lock"
      find programs shared cpi-interfaces -type f 2>/dev/null | LC_ALL=C sort
    } | while IFS= read -r relative_path; do
      [[ -f "$relative_path" ]] || continue
      shasum -a 256 "$relative_path"
    done | shasum -a 256 | awk '{print $1}'
  )
}

core_sources_changed_since_last_deploy() {
  local current_fingerprint recorded_fingerprint
  current_fingerprint="$(current_core_source_fingerprint)"

  if [[ ! -f "$CORE_PROGRAM_FINGERPRINT_FILE" ]]; then
    warn "core fingerprint file missing: $CORE_PROGRAM_FINGERPRINT_FILE"
    return 0
  fi

  recorded_fingerprint="$(tr -d '[:space:]' < "$CORE_PROGRAM_FINGERPRINT_FILE" 2>/dev/null || true)"
  if [[ -z "$recorded_fingerprint" ]]; then
    warn "core fingerprint file is empty: $CORE_PROGRAM_FINGERPRINT_FILE"
    return 0
  fi

  [[ "$current_fingerprint" != "$recorded_fingerprint" ]]
}

record_core_source_fingerprint() {
  local current_fingerprint
  current_fingerprint="$(current_core_source_fingerprint)"
  mkdir -p "$(dirname "$CORE_PROGRAM_FINGERPRINT_FILE")"
  printf '%s\n' "$current_fingerprint" > "$CORE_PROGRAM_FINGERPRINT_FILE"
}

ensure_sdk_localnet_config() {
  cat > "$ROOT_DIR/sdk/localnet-config.json" <<EOF
{
  "network": "$RPC_URL",
  "programIds": {
    "identity": "$IDENTITY_PROGRAM_ID",
    "content": "$CONTENT_PROGRAM_ID",
    "access": "$ACCESS_PROGRAM_ID",
    "event": "$EVENT_PROGRAM_ID",
    "factory": "$FACTORY_PROGRAM_ID",
    "messaging": "$MESSAGING_PROGRAM_ID",
    "circles": "$CIRCLES_PROGRAM_ID",
    "externalAppRegistry": "$EXTERNAL_APP_REGISTRY_PROGRAM_ID"
  }
}
EOF
}

deploy_core_if_needed() {
  if [[ "$FORCE_REDEPLOY_CORE" == "true" ]]; then
    log "FORCE_REDEPLOY_CORE=true, redeploying core programs"
  elif core_sources_changed_since_last_deploy; then
    log "core program sources changed since last deploy fingerprint, redeploying core programs"
  elif check_core_programs; then
    log "core programs already deployed"
    return
  else
    CORE_PROGRAMS_WERE_MISSING="true"
    log "current chain is missing core programs, redeploying onto a fresh chain"
  fi

  log "running scripts/deploy-local-optimized.sh ..."
  (
    cd "$ROOT_DIR"
    bash scripts/deploy-local-optimized.sh
  )

  if ! check_core_programs; then
    err "core program deployment check failed after deploy-local-optimized.sh"
    exit 1
  fi

  record_core_source_fingerprint
}

resolve_contribution_keypair() {
  local keypair_target="$ROOT_DIR/target/deploy/contribution_engine-keypair.json"
  local keypair_ext="$ROOT_DIR/extensions/contribution-engine/program/keypair.json"

  if [[ ! -f "$keypair_target" ]]; then
    err "missing keypair: $keypair_target"
    exit 1
  fi

  local target_id ext_id
  target_id="$(solana address -k "$keypair_target")"
  ext_id=""
  if [[ -f "$keypair_ext" ]]; then
    ext_id="$(solana address -k "$keypair_ext")"
  fi

  if [[ "$CONTRIBUTION_PROGRAM_ID" == "$target_id" ]]; then
    printf "%s\n" "$keypair_target"
    return
  fi

  if [[ -n "$ext_id" && "$CONTRIBUTION_PROGRAM_ID" == "$ext_id" ]]; then
    printf "%s\n" "$keypair_ext"
    return
  fi

  warn "CONTRIBUTION program id ($CONTRIBUTION_PROGRAM_ID) does not match known keypairs, using target keypair"
  printf "%s\n" "$keypair_target"
}

ensure_contribution_program() {
  if program_is_deployed "$CONTRIBUTION_PROGRAM_ID"; then
    log "contribution program already deployed: $CONTRIBUTION_PROGRAM_ID"
    return
  fi

  local so_path="$ROOT_DIR/target/deploy/contribution_engine.so"
  local keypair_path
  keypair_path="$(resolve_contribution_keypair)"

  if [[ ! -f "$so_path" ]]; then
    warn "missing binary: $so_path, running anchor build once..."
    (
      cd "$ROOT_DIR"
      anchor build
    )
  fi

  log "deploying contribution_engine: $CONTRIBUTION_PROGRAM_ID"
  (
    cd "$ROOT_DIR"
    solana program deploy \
      --url "$RPC_URL" \
      --program-id "$keypair_path" \
      "$so_path" \
      --max-sign-attempts 400 \
      --with-compute-unit-price 10000 \
      --use-rpc
  )

  if ! program_is_deployed "$CONTRIBUTION_PROGRAM_ID"; then
    err "failed to deploy contribution_engine: $CONTRIBUTION_PROGRAM_ID"
    exit 1
  fi
}

check_required_pdas() {
  local status

  set +e
  node - "$ROOT_DIR" "$RPC_URL" "$IDENTITY_PROGRAM_ID" "$CONTENT_PROGRAM_ID" "$ACCESS_PROGRAM_ID" "$EVENT_PROGRAM_ID" "$FACTORY_PROGRAM_ID" "$MESSAGING_PROGRAM_ID" "$CIRCLES_PROGRAM_ID" "$EXTERNAL_APP_REGISTRY_PROGRAM_ID" <<'NODE'
const path = require('path');

const [,, rootDir, rpc, identityId, contentId, accessId, eventId, factoryId, messagingId, circlesId, externalAppRegistryId] = process.argv;
const candidates = [
  path.join(rootDir, 'node_modules', '@solana', 'web3.js'),
  path.join(rootDir, 'frontend', 'node_modules', '@solana', 'web3.js'),
  path.join(rootDir, 'services', 'query-api', 'node_modules', '@solana', 'web3.js'),
];

let web3 = null;
for (const candidate of candidates) {
  try {
    web3 = require(candidate);
    break;
  } catch {}
}

if (!web3) {
  try {
    web3 = require('@solana/web3.js');
  } catch {
    console.error('Missing @solana/web3.js. Run `npm ci` in the repository root before starting the local stack.');
    process.exit(2);
  }
}

const { Connection, PublicKey } = web3;

async function main() {
  const conn = new Connection(rpc, 'confirmed');
  const identityProgram = new PublicKey(identityId);
  const contentProgram = new PublicKey(contentId);
  const accessProgram = new PublicKey(accessId);
  const circlesProgram = new PublicKey(circlesId);
  const eventProgram = new PublicKey(eventId);
  const factoryProgram = new PublicKey(factoryId);
  const messagingProgram = new PublicKey(messagingId);
  const externalAppRegistryProgram = new PublicKey(externalAppRegistryId);

  const [identityRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('identity_registry'), Buffer.from('social_hub_identity')],
    identityProgram,
  );
  const [contentManagerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('content_manager')],
    contentProgram,
  );
  const [accessControllerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('access_controller')],
    accessProgram,
  );
  const [circleManagerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('circle_manager')],
    circlesProgram,
  );
  const [eventEmitterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('event_emitter')],
    eventProgram,
  );
  const [registryFactoryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry_factory')],
    factoryProgram,
  );
  const [messagingManagerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('messaging_manager')],
    messagingProgram,
  );
  const [externalAppRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('external_app_registry')],
    externalAppRegistryProgram,
  );

  const [identityRegistry, contentManager, accessController, circleManager, eventEmitter, registryFactory, messagingManager, externalAppRegistry] = await Promise.all([
    conn.getAccountInfo(identityRegistryPda),
    conn.getAccountInfo(contentManagerPda),
    conn.getAccountInfo(accessControllerPda),
    conn.getAccountInfo(circleManagerPda),
    conn.getAccountInfo(eventEmitterPda),
    conn.getAccountInfo(registryFactoryPda),
    conn.getAccountInfo(messagingManagerPda),
    conn.getAccountInfo(externalAppRegistryPda),
  ]);

  if (!identityRegistry || !contentManager || !accessController || !circleManager || !eventEmitter || !registryFactory || !messagingManager || !externalAppRegistry) {
    process.exit(1);
  }
}

main().catch(() => process.exit(1));
NODE
  status=$?
  set -e

  if [[ "$status" -eq 2 ]]; then
    err "cannot verify required PDAs because @solana/web3.js is not installed"
    exit 1
  fi

  return "$status"
}

initialize_programs_if_needed() {
  if [[ "$AUTO_INITIALIZE" != "true" ]]; then
    warn "AUTO_INITIALIZE=false, skip on-chain initialize checks"
    return
  fi

  if check_required_pdas; then
    log "required PDAs already initialized"
    return
  fi

  REQUIRED_PDAS_WERE_MISSING="true"

  ensure_sdk_localnet_config
  log "initializing protocol PDAs via scripts/initialize-programs.ts ..."
  (
    cd "$ROOT_DIR"
    npx ts-node scripts/initialize-programs.ts
  )

  if ! check_required_pdas; then
    err "required PDAs still missing after initialization"
    exit 1
  fi
}

bootstrap_proof_attestor_registry() {
  if [[ "$AUTO_INITIALIZE" != "true" ]]; then
    log "AUTO_INITIALIZE=false, skip proof attestor bootstrap"
    return
  fi

  ensure_sdk_localnet_config
  log "bootstrapping proof attestor registry for crystallization contributor binding ..."
  (
    cd "$ROOT_DIR"
    npx ts-node scripts/bootstrap-proof-attestor.ts --cluster "$RPC_URL" --wallet "$ANCHOR_WALLET" --attestor "$DRAFT_PROOF_ISSUER_KEY_ID"
  )
}

cleanup_local_read_model_after_chain_rebuild_if_needed() {
  if [[ "$RESET_LOCAL_READ_MODEL_ON_CHAIN_REBUILD" != "true" ]]; then
    log "RESET_LOCAL_READ_MODEL_ON_CHAIN_REBUILD=false, keeping local read model"
    return
  fi

  if [[ "$CORE_PROGRAMS_WERE_MISSING" != "true" && "$REQUIRED_PDAS_WERE_MISSING" != "true" ]]; then
    log "chain rebuild not detected, keeping local read model"
    return
  fi

  local tables
  tables="$(run_psql_query "
    SELECT string_agg(format('%I', tablename), ', ' ORDER BY tablename)
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations';
  " 2>/dev/null || true)"
  tables="$(printf '%s' "$tables" | head -n1 | tr -d '\r')"

  if [[ -z "$tables" ]]; then
    warn "no local tables found to truncate after chain rebuild"
    return
  fi

  warn "fresh-chain signal detected; clearing local read model and indexer state to avoid DB/chain divergence"
  if ! run_psql_query "TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;" >/dev/null; then
    err "failed to clear local read model after chain rebuild"
    exit 1
  fi

  log "local read model cleared after chain rebuild"
}

seed_fresh_chain_checkpoint_baseline_if_needed() {
  if [[ "$RESET_LOCAL_READ_MODEL_ON_CHAIN_REBUILD" != "true" ]]; then
    return
  fi

  if [[ "$CORE_PROGRAMS_WERE_MISSING" != "true" && "$REQUIRED_PDAS_WERE_MISSING" != "true" ]]; then
    return
  fi

  if [[ -z "${EVENT_PROGRAM_ID:-}" ]]; then
    warn "EVENT_PROGRAM_ID is empty, skip fresh-chain checkpoint seeding"
    return
  fi

  local head_slot
  head_slot="$(get_confirmed_slot)"
  if ! [[ "$head_slot" =~ ^[0-9]+$ ]]; then
    warn "cannot read confirmed slot, skip fresh-chain checkpoint seeding"
    return
  fi

  if ! run_psql_query "
    INSERT INTO sync_checkpoints (
      program_id,
      program_name,
      last_processed_slot,
      total_events_processed,
      last_successful_sync
    )
    VALUES (
      '${EVENT_PROGRAM_ID}',
      'event-emitter',
      ${head_slot},
      0,
      NOW()
    )
    ON CONFLICT (program_id) DO UPDATE SET
      program_name = EXCLUDED.program_name,
      last_processed_slot = EXCLUDED.last_processed_slot,
      total_events_processed = 0,
      last_successful_sync = NOW(),
      updated_at = NOW();
  " >/dev/null; then
    err "failed to seed fresh-chain checkpoint baseline"
    exit 1
  fi

  log "seeded fresh-chain checkpoint baseline at slot ${head_slot}"
}

ensure_data_services() {
  local compose_rpc="${COMPOSE_RPC_ENDPOINT:-$RPC_URL}"
  local compose_event="${COMPOSE_EVENT_EMITTER_PROGRAM_ID:-${EVENT_PROGRAM_ID:-11111111111111111111111111111111}}"

  if is_port_listening 5432; then
    log "postgres already listening on 5432, skip docker postgres"
  elif command -v docker >/dev/null 2>&1; then
    log "ensuring postgres container is up..."
    run_bg_with_timeout 60 "cd \"$ROOT_DIR\" && RPC_ENDPOINT=\"$compose_rpc\" EVENT_EMITTER_PROGRAM_ID=\"$compose_event\" docker compose up -d postgres" || true
  else
    warn "docker not found, and postgres not listening on 5432"
  fi

  if is_port_listening 6379; then
    log "redis already listening on 6379, skip docker redis"
  elif command -v docker >/dev/null 2>&1; then
    log "starting redis container..."
    run_bg_with_timeout 60 "cd \"$ROOT_DIR\" && RPC_ENDPOINT=\"$compose_rpc\" EVENT_EMITTER_PROGRAM_ID=\"$compose_event\" docker compose up -d redis" || true
  else
    warn "docker not found, and redis not listening on 6379"
  fi

  # Ensure required data services are reachable, regardless of docker/local mode.
  local i
  for ((i=0; i<30; i++)); do
    if is_port_listening 5432; then
      break
    fi
    sleep 1
  done
  if ! is_port_listening 5432; then
    err "postgres is not reachable on 5432"
    exit 1
  fi

  for ((i=0; i<30; i++)); do
    if is_port_listening 6379; then
      break
    fi
    sleep 1
  done
  if ! is_port_listening 6379; then
    start_local_redis_fallback || true
  fi
  if ! is_port_listening 6379; then
    err "redis is not reachable on 6379"
    exit 1
  fi
}

deploy_query_api_migrations() {
  local query_api_dir="$ROOT_DIR/services/query-api"
  local prisma_bin="$query_api_dir/node_modules/.bin/prisma"

  if [[ ! -x "$prisma_bin" ]]; then
    err "query-api prisma CLI not found: $prisma_bin"
    err "run npm install in services/query-api before starting the local stack"
    exit 1
  fi

  cleanup_query_api_rolled_back_orphans

  log "deploying query-api prisma migrations..."
  if ! (
    cd "$query_api_dir" &&
    DATABASE_URL="$DATABASE_URL" \
    ./node_modules/.bin/prisma migrate deploy
  ); then
    err "query-api prisma migrate deploy failed"
    exit 1
  fi

  log "generating query-api prisma client..."
  if ! (
    cd "$query_api_dir" &&
    DATABASE_URL="$DATABASE_URL" \
    ./node_modules/.bin/prisma generate
  ); then
    err "query-api prisma generate failed"
    exit 1
  fi
}

cleanup_query_api_rolled_back_orphans() {
  local migrations_dir="$ROOT_DIR/services/query-api/prisma/migrations"
  local orphaned_names raw_name migration_name

  orphaned_names="$(
    run_psql_query "SELECT migration_name
      FROM _prisma_migrations
      WHERE rolled_back_at IS NOT NULL
        AND finished_at IS NULL;" 2>/dev/null || true
  )"

  if [[ -z "$orphaned_names" ]]; then
    return
  fi

  while IFS= read -r raw_name; do
    migration_name="$(printf "%s" "$raw_name" | tr -d '[:space:]')"
    if [[ -z "$migration_name" ]]; then
      continue
    fi

    if [[ ! -d "$migrations_dir/$migration_name" ]]; then
      warn "removing rolled-back prisma migration entry missing from repo: $migration_name"
      run_psql_query "DELETE FROM _prisma_migrations
        WHERE migration_name='${migration_name}'
          AND rolled_back_at IS NOT NULL
          AND finished_at IS NULL;" >/dev/null 2>&1 || true
    fi
  done <<< "$orphaned_names"
}

start_anchor_signer_optional() {
  if [[ "$START_ANCHOR_SIGNER" != "true" ]]; then
    log "START_ANCHOR_SIGNER=false, skip anchor-signer"
    return
  fi

  local signer_dir="$ROOT_DIR/extensions/anchor-signer"
  if [[ ! -d "$signer_dir" ]]; then
    err "anchor-signer extension not found: $signer_dir"
    exit 1
  fi

  local cmd="cd \"$signer_dir\" && ANCHOR_SIGNER_BIND_HOST=\"$ANCHOR_SIGNER_HOST\" ANCHOR_SIGNER_PORT=\"$ANCHOR_SIGNER_PORT\" ANCHOR_SIGNER_KEYPAIR_PATH=\"$ANCHOR_SIGNER_KEYPAIR_PATH\" ANCHOR_SIGNER_DEFAULT_RPC_URL=\"$RPC_URL\" ANCHOR_SIGNER_AUTH_TOKEN=\"$ANCHOR_SIGNER_AUTH_TOKEN\" node src/server.js"
  start_bg_service "anchor-signer" "is_port_listening $ANCHOR_SIGNER_PORT" "$cmd"

  if ! wait_for_http_health "http://127.0.0.1:${ANCHOR_SIGNER_PORT}/health" 30; then
    err "anchor-signer health check failed"
    err "log: $RUNTIME_DIR/anchor-signer.log"
    exit 1
  fi

  log "anchor-signer ready at http://127.0.0.1:${ANCHOR_SIGNER_PORT}/health"
}

start_bg_service() {
  local name="$1"
  local check_cmd="$2"
  local cmd="$3"
  local log_file="$RUNTIME_DIR/${name}.log"
  local pid_file="$RUNTIME_DIR/${name}.pid"

  if eval "$check_cmd"; then
    log "$name already running"
    return
  fi

  log "starting $name ..."
  nohup bash -c "$cmd" >"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" > "$pid_file"
  sleep 2

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    err "$name failed to start (see $log_file)"
    exit 1
  fi
}

start_query_api() {
  local cmd="cd \"$ROOT_DIR/services/query-api\" && DATABASE_URL=\"$DATABASE_URL\" REDIS_URL=\"$REDIS_URL\" SOLANA_RPC_URL=\"$RPC_URL\" CONTENT_PROGRAM_ID=\"$CONTENT_PROGRAM_ID\" EVENT_EMITTER_PROGRAM_ID=\"$EVENT_PROGRAM_ID\" EXTERNAL_APP_REGISTRY_PROGRAM_ID=\"$EXTERNAL_APP_REGISTRY_PROGRAM_ID\" EXTERNAL_APP_REGISTRY_MODE=\"$EXTERNAL_APP_REGISTRY_MODE\" EXTERNAL_APP_REGISTRY_AUTHORITY_KEYPAIR_PATH=\"$EXTERNAL_APP_REGISTRY_AUTHORITY_KEYPAIR_PATH\" EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_URL=\"$EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_URL\" EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_TOKEN=\"$EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_TOKEN\" EXTERNAL_APP_REGISTRY_IDL_PATH=\"$EXTERNAL_APP_REGISTRY_IDL_PATH\" INDEXER_ID=\"$INDEXER_ID\" INDEXER_MAX_SLOT_LAG=\"$INDEXER_MAX_SLOT_LAG\" CORS_ALLOWED_ORIGINS=\"$CORS_ALLOWED_ORIGINS\" EXTERNAL_APP_DEV_ORIGINS=\"$EXTERNAL_APP_DEV_ORIGINS\" EXTERNAL_APP_ADMIN_TOKEN=\"$EXTERNAL_APP_ADMIN_TOKEN\" VOICE_PROVIDER=\"$VOICE_PROVIDER\" VOICE_PUBLIC_URL=\"$VOICE_PUBLIC_URL\" LIVEKIT_SERVER_URL=\"$LIVEKIT_SERVER_URL\" LIVEKIT_API_KEY=\"$LIVEKIT_API_KEY\" LIVEKIT_API_SECRET=\"$LIVEKIT_API_SECRET\" VOICE_REQUIRE_PROVIDER_HEALTH=\"$VOICE_REQUIRE_PROVIDER_HEALTH\" VOICE_PROVIDER_HEALTH_TIMEOUT_MS=\"$VOICE_PROVIDER_HEALTH_TIMEOUT_MS\" STORAGE_UPLOAD_ENDPOINT=\"$STORAGE_UPLOAD_ENDPOINT\" STORAGE_UPLOAD_MODE=\"$STORAGE_UPLOAD_MODE\" AI_MODE=\"$AI_MODE\" AI_BUILTIN_TEXT_API=\"$AI_BUILTIN_TEXT_API\" NEW_API_URL=\"$NEW_API_URL\" NEW_API_KEY=\"$NEW_API_KEY\" NEW_API_TIMEOUT_MS=\"$NEW_API_TIMEOUT_MS\" AI_GATEWAY_TIMEOUT_MS=\"$AI_GATEWAY_TIMEOUT_MS\" AI_EXTERNAL_URL=\"$AI_EXTERNAL_URL\" AI_EXTERNAL_TIMEOUT_MS=\"$AI_EXTERNAL_TIMEOUT_MS\" AI_EXTERNAL_PRIVATE_CONTENT_MODE=\"$AI_EXTERNAL_PRIVATE_CONTENT_MODE\" SCORING_MODEL=\"$SCORING_MODEL\" GHOST_DRAFT_MODEL=\"$GHOST_DRAFT_MODEL\" DISCUSSION_INITIAL_DRAFT_MODEL=\"$DISCUSSION_INITIAL_DRAFT_MODEL\" DISCUSSION_SUMMARY_MODEL=\"$DISCUSSION_SUMMARY_MODEL\" DISCUSSION_TRIGGER_MODEL=\"$DISCUSSION_TRIGGER_MODEL\" EMBEDDING_MODEL=\"$EMBEDDING_MODEL\" DRAFT_LIFECYCLE_ANCHOR_LOOKUP_ATTEMPTS=\"$DRAFT_LIFECYCLE_ANCHOR_LOOKUP_ATTEMPTS\" DRAFT_LIFECYCLE_ANCHOR_LOOKUP_DELAY_MS=\"$DRAFT_LIFECYCLE_ANCHOR_LOOKUP_DELAY_MS\" DRAFT_LIFECYCLE_ANCHOR_RPC_TIMEOUT_MS=\"$DRAFT_LIFECYCLE_ANCHOR_RPC_TIMEOUT_MS\" DISCUSSION_AUTH_MODE=\"$DISCUSSION_AUTH_MODE\" DISCUSSION_REQUIRE_SESSION_TOKEN=\"$DISCUSSION_REQUIRE_SESSION_TOKEN\" DISCUSSION_REQUIRE_SESSION_BOOTSTRAP_SIGNATURE=\"$DISCUSSION_REQUIRE_SESSION_BOOTSTRAP_SIGNATURE\" DISCUSSION_SESSION_TTL_SEC=\"$DISCUSSION_SESSION_TTL_SEC\" DISCUSSION_SESSION_REFRESH_WINDOW_SEC=\"$DISCUSSION_SESSION_REFRESH_WINDOW_SEC\" DISCUSSION_RELEVANCE_MODE=\"$DISCUSSION_RELEVANCE_MODE\" DISCUSSION_RELEVANCE_USE_LLM=\"$DISCUSSION_RELEVANCE_USE_LLM\" DISCUSSION_SUMMARY_USE_LLM=\"$DISCUSSION_SUMMARY_USE_LLM\" DISCUSSION_SUMMARY_WINDOW=\"$DISCUSSION_SUMMARY_WINDOW\" DISCUSSION_SUMMARY_CACHE_TTL_SEC=\"$DISCUSSION_SUMMARY_CACHE_TTL_SEC\" DISCUSSION_DRAFT_TRIGGER_ENABLED=\"$DISCUSSION_DRAFT_TRIGGER_ENABLED\" DISCUSSION_DRAFT_TRIGGER_MODE=\"$DISCUSSION_DRAFT_TRIGGER_MODE\" DISCUSSION_DRAFT_TRIGGER_WINDOW=\"$DISCUSSION_DRAFT_TRIGGER_WINDOW\" DISCUSSION_DRAFT_TRIGGER_MIN_MESSAGES=\"$DISCUSSION_DRAFT_TRIGGER_MIN_MESSAGES\" DISCUSSION_DRAFT_TRIGGER_MIN_QUESTIONS=\"$DISCUSSION_DRAFT_TRIGGER_MIN_QUESTIONS\" DISCUSSION_DRAFT_TRIGGER_MIN_FOCUSED_RATIO=\"$DISCUSSION_DRAFT_TRIGGER_MIN_FOCUSED_RATIO\" DISCUSSION_DRAFT_TRIGGER_COOLDOWN_SEC=\"$DISCUSSION_DRAFT_TRIGGER_COOLDOWN_SEC\" DISCUSSION_DRAFT_TRIGGER_SUMMARY_USE_LLM=\"$DISCUSSION_DRAFT_TRIGGER_SUMMARY_USE_LLM\" DISCUSSION_DRAFT_TRIGGER_GENERATE_COMMENT=\"$DISCUSSION_DRAFT_TRIGGER_GENERATE_COMMENT\" GHOST_RELEVANCE_MODE=\"$GHOST_RELEVANCE_MODE\" GHOST_SUMMARY_USE_LLM=\"$GHOST_SUMMARY_USE_LLM\" GHOST_SUMMARY_WINDOW=\"$GHOST_SUMMARY_WINDOW\" GHOST_SUMMARY_CACHE_TTL_SEC=\"$GHOST_SUMMARY_CACHE_TTL_SEC\" GHOST_SUMMARY_INTERNAL_ENDPOINT_ENABLED=\"$GHOST_SUMMARY_INTERNAL_ENDPOINT_ENABLED\" GHOST_DRAFT_TRIGGER_ENABLED=\"$GHOST_DRAFT_TRIGGER_ENABLED\" GHOST_DRAFT_TRIGGER_MODE=\"$GHOST_DRAFT_TRIGGER_MODE\" GHOST_DRAFT_TRIGGER_WINDOW=\"$GHOST_DRAFT_TRIGGER_WINDOW\" GHOST_DRAFT_TRIGGER_MIN_MESSAGES=\"$GHOST_DRAFT_TRIGGER_MIN_MESSAGES\" GHOST_DRAFT_TRIGGER_MIN_QUESTIONS=\"$GHOST_DRAFT_TRIGGER_MIN_QUESTIONS\" GHOST_DRAFT_TRIGGER_MIN_FOCUSED_RATIO=\"$GHOST_DRAFT_TRIGGER_MIN_FOCUSED_RATIO\" GHOST_DRAFT_TRIGGER_COOLDOWN_SEC=\"$GHOST_DRAFT_TRIGGER_COOLDOWN_SEC\" GHOST_DRAFT_TRIGGER_SUMMARY_USE_LLM=\"$GHOST_DRAFT_TRIGGER_SUMMARY_USE_LLM\" GHOST_DRAFT_TRIGGER_GENERATE_COMMENT=\"$GHOST_DRAFT_TRIGGER_GENERATE_COMMENT\" GHOST_ADMIN_TOKEN=\"$GHOST_ADMIN_TOKEN\" INTERNAL_API_TOKEN=\"$INTERNAL_API_TOKEN\" DRAFT_PROOF_ISSUER_KEY_ID=\"$DRAFT_PROOF_ISSUER_KEY_ID\" DRAFT_PROOF_ISSUER_SECRET=\"$DRAFT_PROOF_ISSUER_SECRET\" MEMBERSHIP_BRIDGE_ISSUER_KEY_ID=\"$MEMBERSHIP_BRIDGE_ISSUER_KEY_ID\" MEMBERSHIP_BRIDGE_ISSUER_SECRET=\"$MEMBERSHIP_BRIDGE_ISSUER_SECRET\" CRYSTAL_MINT_RPC_URL=\"$CRYSTAL_MINT_RPC_URL\" CRYSTAL_MINT_AUTHORITY_SECRET=\"$CRYSTAL_MINT_AUTHORITY_SECRET\" CRYSTAL_MASTER_OWNER_PUBKEY=\"$CRYSTAL_MASTER_OWNER_PUBKEY\" CRYSTAL_METADATA_BASE_URL=\"$CRYSTAL_METADATA_BASE_URL\" ANCHOR_SIGNER_MODE=\"$ANCHOR_SIGNER_MODE\" ANCHOR_SIGNER_URL=\"$ANCHOR_SIGNER_URL\" ANCHOR_SIGNER_AUTH_TOKEN=\"$ANCHOR_SIGNER_AUTH_TOKEN\" ANCHOR_SIGNER_TIMEOUT_MS=\"$ANCHOR_SIGNER_TIMEOUT_MS\" npm run dev"
  start_bg_service "query-api" "is_port_listening 4000" "$cmd"

  if ! wait_for_http_health "http://127.0.0.1:4000/health" 90; then
    err "query-api health check failed"
    err "log: $RUNTIME_DIR/query-api.log"
    exit 1
  fi
  log "query-api healthy at http://127.0.0.1:4000/health"
}

run_ai_smoke_check_optional() {
  if [[ "$AI_SMOKE_CHECK_ON_START" != "true" ]]; then
    log "AI smoke check disabled"
    return
  fi

  local log_file="$RUNTIME_DIR/ai-smoke-check.log"
  local cmd="cd \"$ROOT_DIR/services/query-api\" && AI_MODE=\"$AI_MODE\" AI_BUILTIN_TEXT_API=\"$AI_BUILTIN_TEXT_API\" NEW_API_URL=\"$NEW_API_URL\" NEW_API_KEY=\"$NEW_API_KEY\" NEW_API_TIMEOUT_MS=\"$NEW_API_TIMEOUT_MS\" AI_GATEWAY_TIMEOUT_MS=\"$AI_GATEWAY_TIMEOUT_MS\" AI_EXTERNAL_URL=\"$AI_EXTERNAL_URL\" AI_EXTERNAL_TIMEOUT_MS=\"$AI_EXTERNAL_TIMEOUT_MS\" AI_EXTERNAL_PRIVATE_CONTENT_MODE=\"$AI_EXTERNAL_PRIVATE_CONTENT_MODE\" SCORING_MODEL=\"$SCORING_MODEL\" GHOST_DRAFT_MODEL=\"$GHOST_DRAFT_MODEL\" DISCUSSION_INITIAL_DRAFT_MODEL=\"$DISCUSSION_INITIAL_DRAFT_MODEL\" DISCUSSION_SUMMARY_MODEL=\"$DISCUSSION_SUMMARY_MODEL\" DISCUSSION_TRIGGER_MODEL=\"$DISCUSSION_TRIGGER_MODEL\" EMBEDDING_MODEL=\"$EMBEDDING_MODEL\" npx tsx scripts/ai-smoke-check.ts"

  log "running AI smoke check ..."
  if bash -c "$cmd" >"$log_file" 2>&1; then
    log "AI smoke check passed (log: $log_file)"
    sed 's/^/[ai-smoke] /' "$log_file"
    return
  fi

  warn "AI smoke check failed (log: $log_file)"
  sed 's/^/[ai-smoke] /' "$log_file" >&2 || true
  if [[ "$AI_SMOKE_CHECK_STRICT" == "true" ]]; then
    exit 1
  fi
}

start_tracker() {
  local wallet_path="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
  log "tracker runtime: contribution_engine=$CONTRIBUTION_PROGRAM_ID identity_registry_name=$IDENTITY_REGISTRY_NAME settlement_enabled=$TRACKER_SETTLEMENT_ENABLED settlement_execute_on_chain=$TRACKER_SETTLEMENT_EXECUTE_ON_CHAIN"
  local cmd="cd \"$ROOT_DIR/extensions/contribution-engine/tracker\" && RPC_URL=\"$RPC_URL\" WS_URL=\"$WS_URL\" WALLET_PATH=\"$wallet_path\" ANCHOR_WALLET=\"$wallet_path\" CONTRIBUTION_ENGINE_PROGRAM_ID=\"$CONTRIBUTION_PROGRAM_ID\" IDENTITY_REGISTRY_PROGRAM_ID=\"$IDENTITY_PROGRAM_ID\" IDENTITY_REGISTRY_NAME=\"$IDENTITY_REGISTRY_NAME\" REGISTRY_FACTORY_PROGRAM_ID=\"$FACTORY_PROGRAM_ID\" EVENT_EMITTER_PROGRAM_ID=\"$EVENT_PROGRAM_ID\" DATABASE_URL=\"$DATABASE_URL\" SETTLEMENT_ENABLED=\"$TRACKER_SETTLEMENT_ENABLED\" SETTLEMENT_EXECUTE_ON_CHAIN=\"$TRACKER_SETTLEMENT_EXECUTE_ON_CHAIN\" npm run dev"
  start_bg_service "tracker" "pgrep -f \"extensions/contribution-engine/tracker.*tsx watch src/index.ts\" >/dev/null 2>&1" "$cmd"
}

start_frontend() {
  local cmd="cd \"$ROOT_DIR/frontend\" && HOST=\"127.0.0.1\" PORT=\"3000\" NEXT_PUBLIC_GRAPHQL_URL=\"http://127.0.0.1:4000/graphql\" NEXT_PUBLIC_AUTH_SESSION_REQUIRE_SIGNATURE=\"false\" NEXT_PUBLIC_DISCUSSION_REQUIRE_SIGNATURE=\"false\" NEXT_PUBLIC_DISCUSSION_AUTH_MODE=\"session_token\" npm run dev -- --webpack"
  start_bg_service "frontend" "is_port_listening 3000" "$cmd"

  if ! wait_for_http_health "http://127.0.0.1:3000" 120; then
    err "frontend health check failed"
    err "log: $RUNTIME_DIR/frontend.log"
    exit 1
  fi
  log "frontend ready at http://127.0.0.1:3000"
}

start_indexer_optional() {
  if [[ "$START_INDEXER" != "true" ]]; then
    log "START_INDEXER=false, skip indexer-core"
    return
  fi

  if [[ -z "$INDEXER_EVENT_SOURCE_EFFECTIVE" ]]; then
    resolve_indexer_event_source
  fi

  if [[ "$FORCE_RESTART_INDEXER_ON_START" == "true" ]]; then
    pkill -f "cargo run --bin indexer" >/dev/null 2>&1 || true
    pkill -f "target/debug/indexer" >/dev/null 2>&1 || true
    sleep 1
  fi

  ensure_indexer_checkpoint_freshness
  resolve_failed_slots_behind_checkpoint "$EVENT_PROGRAM_ID"

  if [[ "$INDEXER_CHECKPOINT_UPDATED" == "true" ]] && (
    pgrep -f "cargo run --bin indexer" >/dev/null 2>&1 ||
    pgrep -f "target/debug/indexer" >/dev/null 2>&1
  ); then
    warn "restarting running indexer-core to apply checkpoint fast-forward"
    pkill -f "cargo run --bin indexer" >/dev/null 2>&1 || true
    pkill -f "target/debug/indexer" >/dev/null 2>&1 || true
    sleep 1
  fi

  local base_env
  base_env="DATABASE_URL=\"$DATABASE_URL\" REDIS_URL=\"$REDIS_URL\" INDEXER_ID=\"$INDEXER_ID\" EVENT_EMITTER_PROGRAM_ID=\"$EVENT_PROGRAM_ID\" EXTERNAL_APP_REGISTRY_PROGRAM_ID=\"$EXTERNAL_APP_REGISTRY_PROGRAM_ID\" REGISTRY_FACTORY_PROGRAM_ID=\"$FACTORY_PROGRAM_ID\" EXTENSION_PROGRAM_IDS=\"$CONTRIBUTION_PROGRAM_ID\" SOLANA_RPC_URL=\"$RPC_URL\" INDEXER_EVENT_SOURCE=\"$INDEXER_EVENT_SOURCE_EFFECTIVE\" LOCAL_LISTENER_MODE=\"$LOCAL_LISTENER_MODE\" LOCAL_WS_URL=\"$LOCAL_WS_URL\" LOCAL_BACKFILL_SIGNATURE_LIMIT=\"$LOCAL_BACKFILL_SIGNATURE_LIMIT\" ENABLE_METRICS=\"${ENABLE_METRICS:-true}\" METRICS_PORT=\"${INDEXER_METRICS_PORT:-9090}\""

  local cmd
  if [[ "$INDEXER_EVENT_SOURCE_EFFECTIVE" == "yellowstone" ]]; then
    cmd="cd \"$ROOT_DIR/services/indexer-core\" && $base_env YELLOWSTONE_ENDPOINT=\"$YELLOWSTONE_ENDPOINT\" YELLOWSTONE_TOKEN=\"$YELLOWSTONE_TOKEN\" cargo run --bin indexer"
  else
    cmd="cd \"$ROOT_DIR/services/indexer-core\" && $base_env LOCAL_RPC_POLL_INTERVAL_MS=\"$LOCAL_RPC_POLL_INTERVAL_MS\" LOCAL_RPC_MAX_SLOTS_PER_TICK=\"$LOCAL_RPC_MAX_SLOTS_PER_TICK\" LOCAL_RPC_INITIAL_BACKFILL_SLOTS=\"$LOCAL_RPC_INITIAL_BACKFILL_SLOTS\" LOCAL_RPC_MAX_RETRIES_PER_SLOT=\"$LOCAL_RPC_MAX_RETRIES_PER_SLOT\" LOCAL_RPC_MAX_RETRIES_PER_TX=\"$LOCAL_RPC_MAX_RETRIES_PER_TX\" LOCAL_RPC_MAX_FAILED_TXS_PER_SLOT=\"$LOCAL_RPC_MAX_FAILED_TXS_PER_SLOT\" LOCAL_RPC_MAX_CONCURRENT_TX_FETCHES=\"$LOCAL_RPC_MAX_CONCURRENT_TX_FETCHES\" LOCAL_RPC_REQUEST_TIMEOUT_MS=\"$LOCAL_RPC_REQUEST_TIMEOUT_MS\" cargo run --bin indexer"
  fi
  start_bg_service "indexer-core" "pgrep -f \"cargo run --bin indexer\" >/dev/null 2>&1 || pgrep -f \"target/debug/indexer\" >/dev/null 2>&1" "$cmd"
}

indexer_process_running() {
  pgrep -f "cargo run --bin indexer" >/dev/null 2>&1 || pgrep -f "target/debug/indexer" >/dev/null 2>&1
}

wait_for_indexer_progress() {
  if [[ "$START_INDEXER" != "true" ]]; then
    return
  fi
  if [[ -z "${EVENT_PROGRAM_ID:-}" ]]; then
    warn "EVENT_PROGRAM_ID is empty, skip indexer progress guard"
    return
  fi

  local timeout_sec="${INDEXER_STARTUP_PROGRESS_TIMEOUT_SEC}"
  local min_progress="${INDEXER_MIN_PROGRESS_SLOTS}"
  local max_lag="${INDEXER_MAX_SLOT_LAG}"
  local initial_slot current_slot head_slot lag
  local i

  initial_slot="$(get_sync_checkpoint_slot "$EVENT_PROGRAM_ID")"
  if [[ "$initial_slot" =~ ^[0-9]+$ ]]; then
    log "indexer checkpoint before guard: $initial_slot"
  else
    initial_slot=""
    log "indexer checkpoint not found yet; waiting for first write..."
  fi

  for ((i=0; i<timeout_sec; i++)); do
    if ! indexer_process_running; then
      err "indexer-core exited during startup guard"
      err "log: $RUNTIME_DIR/indexer-core.log"
      exit 1
    fi

    current_slot="$(get_sync_checkpoint_slot "$EVENT_PROGRAM_ID")"
    if [[ "$current_slot" =~ ^[0-9]+$ ]]; then
      if [[ -z "$initial_slot" ]]; then
        log "indexer checkpoint initialized at slot $current_slot"
        return
      fi
      if (( current_slot >= initial_slot + min_progress )); then
        log "indexer checkpoint advanced: $initial_slot -> $current_slot"
        return
      fi
    fi
    sleep 1
  done

  # Fallback: no new events during guard window is acceptable if checkpoint lag is healthy.
  current_slot="$(get_sync_checkpoint_slot "$EVENT_PROGRAM_ID")"
  head_slot="$(get_confirmed_slot)"
  if [[ "$current_slot" =~ ^[0-9]+$ && "$head_slot" =~ ^[0-9]+$ ]]; then
    if (( head_slot >= current_slot )); then
      lag=$((head_slot - current_slot))
    else
      lag=0
    fi

    if (( lag <= max_lag )); then
      log "indexer checkpoint stable (no new events), lag ${lag} <= ${max_lag}; startup guard passed"
      return
    fi
  fi

  if [[ "$current_slot" =~ ^[0-9]+$ && "$head_slot" =~ ^[0-9]+$ ]]; then
    err "indexer checkpoint did not advance within ${timeout_sec}s (checkpoint=${current_slot}, head=${head_slot}, lag=${lag:-unknown})"
  else
    err "indexer checkpoint did not advance within ${timeout_sec}s"
  fi
  err "log: $RUNTIME_DIR/indexer-core.log"
  exit 1
}

print_summary() {
  cat <<EOF

============================================================
Local stack is up
============================================================
Surfpool RPC:      $RPC_URL
Surfpool WS:       $WS_URL
Frontend:          http://127.0.0.1:3000
Query API:         http://127.0.0.1:4000/graphql
Query health:      http://127.0.0.1:4000/health
Indexer source:    ${INDEXER_EVENT_SOURCE_EFFECTIVE:-not-started}
Local listener:    ${LOCAL_LISTENER_MODE}
ExternalApp V2:    program=$EXTERNAL_APP_REGISTRY_PROGRAM_ID mode=$EXTERNAL_APP_REGISTRY_MODE

Logs directory:    $RUNTIME_DIR
Note: lines above are status info, not shell commands.
Tail logs:
  tail -f $RUNTIME_DIR/query-api.log
  tail -f $RUNTIME_DIR/ai-smoke-check.log
  tail -f $RUNTIME_DIR/tracker.log
  tail -f $RUNTIME_DIR/frontend.log
EOF

  if [[ "${INDEXER_EVENT_SOURCE_EFFECTIVE:-}" == "local" ]]; then
    echo "Warning:            local indexer mode is a development fallback, not production-grade"
  fi

  if [[ "$START_INDEXER" == "true" ]]; then
    echo "  tail -f $RUNTIME_DIR/indexer-core.log"
  fi
  if [[ "$START_ANCHOR_SIGNER" == "true" ]]; then
    echo "Anchor signer:      $ANCHOR_SIGNER_URL"
    echo "  tail -f $RUNTIME_DIR/anchor-signer.log"
  fi
}

main() {
  require_cmd curl
  require_cmd lsof
  require_cmd node
  require_cmd npm
  require_cmd solana
  require_cmd surfpool

  load_frontend_program_ids
  start_surfpool_if_needed
  ensure_frontend_wallet_funded
  deploy_core_if_needed
  ensure_contribution_program
  initialize_programs_if_needed
  bootstrap_proof_attestor_registry

  ensure_data_services
  deploy_query_api_migrations
  cleanup_local_read_model_after_chain_rebuild_if_needed
  seed_fresh_chain_checkpoint_baseline_if_needed
  resolve_indexer_event_source
  start_anchor_signer_optional
  start_query_api
  run_ai_smoke_check_optional
  start_tracker
  start_indexer_optional
  wait_for_indexer_progress
  start_frontend
  print_summary
}

main "$@"
