# Contributing To Alcheme Protocol Public Baseline

This public repository is an Apache-2.0 protocol and integration baseline
generated from the private Alcheme development tree. Please keep public
contributions focused on the files that are present in this baseline.

## Before You Start

- Check whether an issue or pull request already covers the same change.
- Prefer a short design note or draft PR for non-trivial protocol changes.
- Never commit secrets, private keys, local `.env` files, generated `.next*`
  output, build artifacts, or deployment artifacts.
- If your proposal depends on private runtime behavior that is not present in
  the public baseline, restate the required context directly in the issue or PR.

## Prerequisites

- Node.js 20
- Rust stable toolchain
- Solana CLI 3.0.11
- Anchor CLI 0.31.1

## Validation Expectations

Run the narrowest checks that prove your change. Common public-baseline checks:

- `cargo metadata --no-deps --format-version 1`
- `anchor build`
- `cd sdk && npm ci && npm test`
- `cd packages/game-chat-react && npm ci && npm run typecheck`

Some integration examples require an Alcheme-compatible runtime endpoint. The
first-party managed runtime and operator indexer/query implementations are not
part of this public baseline.

## Pull Request Guidelines

- Keep PRs focused on one logical change.
- Explain the protocol-facing or integrator-facing impact.
- Call out migrations, breaking changes, or operational follow-up explicitly.
- Include verification commands and outcomes in the PR description.
- Update public-facing documentation only when it matches the current public
  baseline truth.

## License

By contributing to this public baseline, you agree that your contribution is
licensed under Apache-2.0 unless a file states otherwise.
