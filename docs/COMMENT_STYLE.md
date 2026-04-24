# Comment Style

This project uses English-first comments with optional Chinese context.

## Goals

- Keep comments short, stable, and useful for maintainers, generated docs, and AI-assisted review.
- Put English first so public APIs, IDL output, search, and external contributors have one default language.
- Add Chinese after `CN:` when a comment captures durable product semantics, protocol intent, migration risk, or safety constraints.
- Do not store full conversations, temporary debugging notes, or implementation diaries in source comments.

## Default Rule

- Do not comment obvious code.
- Use English-only comments for ordinary implementation hints.
- Use English first plus `CN:` for durable comments that future readers should not reinterpret casually.
- Keep source comments local to the code they protect. Longer background belongs in docs or a private context ledger.

## Tags

- `INVARIANT`: A rule that must remain true across future changes.
- `SAFETY`: A guardrail that prevents misuse, data loss, or protocol breakage.
- `MIGRATION`: Compatibility or account/data-shape behavior during upgrades.
- `TECH-DEBT`: Known incomplete work with an explicit future direction.
- `CONTEXT`: Short pointer to external background, not a full discussion transcript.

## Format

Rust doc comment:

```rust
/// INVARIANT: Archived circles remain readable but must reject new writes.
/// CN: 已归档圈层仍然可读，但必须拒绝新的写入。
```

Rust multi-line protocol comment:

```rust
/// MIGRATION: Legacy Circle accounts may be one byte smaller than `Circle::SPACE`.
/// CN: 生命周期字段追加前创建的旧 Circle 账户可能比当前 `Circle::SPACE` 少 1 字节。
///
/// CONTEXT: circle-lifecycle-archive-2026-04-24
```

TypeScript inline comment:

```ts
// SAFETY: Compose is a write flow, so archived circles are filtered out.
// CN: 发布页属于写入流程，因此过滤已归档圈层。
```

## Context Storage

Use source comments for rules that must stay close to code. Use docs or a private context ledger for longer rationale, meeting notes, and conversation history. If source code needs that history, add a short `CONTEXT: <id>` pointer instead of embedding the full discussion.
