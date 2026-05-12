# Program Layer Architecture

HTML diagram: [Open this subproject map](../docs/architecture/subproject-maps.html#programs).

`programs/` contains the core Anchor programs that form the on-chain authority layer for Alcheme. These programs are supported by `shared/` for common protocol vocabulary and `cpi-interfaces/` for cross-program cooperation.

## Contract-Layer Map

```mermaid
flowchart TB
    shared["shared\ncommon types, constants, errors, events"]
    cpi["cpi-interfaces\nCPI permissions and helper calls"]

    identity["identity-registry\nidentity and reputation"]
    access["access-controller\npermissions and relationships"]
    content["content-manager\ncontent, replies, drafts, anchors"]
    event["event-emitter\nprotocol event stream"]
    factory["registry-factory\nregistries and extension registry"]
    messaging["messaging-manager\nmessage metadata and presence"]
    circle["circle-manager\ncircles, members, knowledge, forks"]
    contrib["contribution-engine program\nofficial extension"]

    shared --> identity
    shared --> access
    shared --> content
    shared --> event
    shared --> factory
    shared --> messaging
    shared --> circle
    cpi --> identity
    cpi --> access
    cpi --> content
    cpi --> messaging
    cpi --> circle
    cpi --> contrib

    content -. "verify identity" .-> identity
    content -. "check access / relationships" .-> access
    content -. "read circle membership" .-> circle
    identity -. "emit identity events" .-> event
    access -. "emit access events" .-> event
    content -. "emit content events" .-> event
    messaging -. "emit message events" .-> event
    circle -. "emit circle / knowledge events" .-> event
    factory -. "register extensions" .-> contrib
    contrib -. "settle reputation" .-> identity
```

## Program Set

| Program | Path | Primary Authority |
| --- | --- | --- |
| Identity Registry | `programs/identity-registry/` | user identity, handles, verification, reputation fields |
| Access Controller | `programs/access-controller/` | permission rules, relationship facts, access checks |
| Content Manager | `programs/content-manager/` | content posts, replies, reposts, quotes, V2 anchors, draft lifecycle anchors |
| Event Emitter | `programs/event-emitter/` | event batches, typed event emission, subscriptions, archive stats |
| Registry Factory | `programs/registry-factory/` | deployed registries, deployment templates, extension registry |
| Messaging Manager | `programs/messaging-manager/` | conversation metadata, message hashes, batches, presence |
| Circle Manager | `programs/circle-manager/` | circle hierarchy, membership, forks, knowledge, transfers, contributor proofs |

## Build And Test Entry Points

| Surface | Command or File |
| --- | --- |
| Anchor workspace | `Anchor.toml` |
| Rust workspace | `Cargo.toml` |
| Build programs | `npm run build` |
| Anchor tests | `npm test` |
| Unit tests | `npm run test:unit` |
| Integration tests | `npm run test:integration` |

## Blind Spots To Check

| Question | Evidence Needed |
| --- | --- |
| Which program relationships are enforced on-chain versus only reflected in read models? | Inspect account constraints and CPI helper calls in `programs/*/src/instructions.rs`. |
| Which events are fully projected by `indexer-core`? | Compare emitted events against `services/indexer-core/src/parsers/*`. |
| Which localnet IDs differ from devnet IDs? | Compare `Anchor.toml` with `config/devnet-program-ids.json`. |
