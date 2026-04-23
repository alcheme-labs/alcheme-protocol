# Contributing to Alcheme Protocol

Thanks for taking the time to contribute.

This repository is being opened in phases. The code is public, but the first public snapshot intentionally carries only a smaller documentation surface than the internal source tree. Please prefer small, scoped changes and keep proposals grounded in the current public codebase.

## Before You Start

- Check whether an issue or pull request already covers the same change.
- Prefer a short design note or draft PR for non-trivial changes before large implementation work.
- Never commit secrets, private keys, local `.env` files, generated `.next*` output, or deployment artifacts.

## Prerequisites

- Node.js 20
- Rust stable toolchain
- Solana CLI 3.0.11
- Anchor CLI 0.31.1
- Docker (for local Postgres 16 and Redis 7 services)

## Local Development

1. Install root dependencies with `npm ci`.
2. Install package-specific dependencies where needed, for example:
   - `cd frontend && npm ci`
   - `cd sdk && npm ci`
   - `cd services/query-api && npm ci`
3. Start the local stack with `bash scripts/start-local-stack.sh`.
4. If you need local protocol deployment, use `bash scripts/deploy-local-optimized.sh`.
5. If your proposal depends on context that is not present in the public snapshot, restate that context directly in the issue or PR instead of assuming access to internal docs or runbooks.

## Validation Expectations

Run the narrowest checks that prove your change.

- Root guardrails:
  - `npm run check:covenant`
  - `npm run validate:extension-manifest`
  - `npm run audit:licenses`
- Frontend:
  - `cd frontend && npm run test:ci`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
- SDK:
  - `cd sdk && npm test`
  - `cd sdk && npm run build`
- Query API:
  - `cd services/query-api && npm test`
  - `cd services/query-api && npm run build`
- Indexer:
  - `cd services/indexer-core && cargo test`

If your change touches dependencies, manifests, or release packaging, include the relevant audit output in your PR notes.

## Public Documentation Baseline

For the first public snapshot, contributors should treat the following as the public documentation baseline:

- `README.md`
- `README.zh-CN.md`
- `CONTRIBUTING.md`
- schema files under `docs/schemas/`

Do not assume that roadmap notes, internal runbooks, or broader planning docs are part of the public source of truth yet.

## Pull Request Guidelines

- Keep PRs focused on one logical change.
- Explain the user-facing or protocol-facing impact.
- Call out migrations, breaking changes, or operational follow-up explicitly.
- Include verification commands and outcomes in the PR description.
- Update public-facing documentation only when it matches the current public code truth.
- If a change relies on context that is absent from the public snapshot, summarize that context inside the PR description.

## Commit Style

Use clear, reviewable commits. Conventional Commits are preferred, for example:

- `feat(frontend): add circle summary loading state`
- `fix(query-api): reject invalid discussion bootstrap tokens`
- `chore(ci): align node runtime to 20`

## License

By contributing to this repository, you agree that your contributions will be released under the repository's `Apache-2.0` license unless explicitly stated otherwise.
