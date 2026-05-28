# External App Registry Program

This Anchor program is the V2 on-chain audit root for external app access.

## Scope

- Stores objective registry facts: `app_id_hash`, owner, manifest hash, server key hash, policy digest, review circle, decision digest, execution intent digest, status, and optional execution receipt digest.
- Emits `ProtocolEvent::*ExternalApp*V2` events through the shared Event Emitter.
- Authorizes only the configured governance authority for registry record mutations.

## Non-Scope

- No Owner Bond custody.
- No Community Backing custody.
- No challenge or appeal escrow.
- No automatic slashing, release, or compensation.

Those economic flows belong to the later V3 external app marketplace/governance program.
