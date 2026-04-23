#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

for cmd in cargo anchor grep; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "missing required command: ${cmd}" >&2
    exit 1
  fi
done

cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
anchor build

if grep -R -n "\.unwrap()" programs shared; then
  echo "unsafe unwrap detected in on-chain/shared code" >&2
  exit 1
fi

if grep -R -n -E "unchecked_|wrapping_add|wrapping_sub|overflowing_" programs shared; then
  echo "potential unchecked arithmetic detected in on-chain/shared code" >&2
  exit 1
fi

echo "solana security audit checks completed"
