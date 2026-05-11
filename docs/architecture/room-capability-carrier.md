# Room Capability Carrier

Date: 2026-05-11

## Decision

`CommunicationRoom` is the lower-level runtime container. Plaza is a first-party
capability bundle carried by deterministic circle rooms such as
`circle:<circleId>`.

Room does not inherit Plaza. Plaza is implemented as an enabled capability set on
top of Room.

## Current Runtime Placement

`CommunicationRoom` owns runtime identity and operational surfaces:

- room key
- room type
- room members
- communication sessions
- communication messages for arbitrary/external rooms
- voice sessions
- voice participant state
- room policy metadata
- V1 capability metadata

Circle Plaza still owns the existing discussion/product workflow:

- text discussion storage in `circle_discussion_messages`
- discussion AI analysis and summary
- draft candidate notices
- manual create-draft
- draft discussion
- proof package handoff
- crystallization binding and entitlement flow

The bridge is `CommunicationRoom.metadata.capabilities`. For circle rooms,
`plazaDiscussion`, `aiSummary`, `draftGeneration`, `crystallization`, and
`governance` default to enabled. For external game rooms, those Plaza-specific
capabilities default to disabled.

## Capability Defaults

Circle room defaults:

```text
textChat: true
voice: true
voiceClip: true
transcriptRecap: false
plazaDiscussion: true
aiSummary: true
draftGeneration: true
crystallization: true
governance: true
```

External game room defaults:

```text
textChat: true
voice: true
voiceClip: false
transcriptRecap: false
plazaDiscussion: false
aiSummary: false
draftGeneration: false
crystallization: false
governance: false
```

External rooms must not receive Plaza AI, draft, crystallization, or governance
behavior by accident. If a future integration needs one of those surfaces, it
needs an explicit signed capability design and a separate plan.

## Intentional Storage Split

The current split is deliberate:

```text
Circle Plaza discussion:
  circle_discussion_messages

Arbitrary/external room chat:
  communication_messages
```

This means:

- Plaza reads and writes still use the existing discussion runtime.
- Room capability checks may ensure/read `circle:<circleId>` metadata before
  Plaza writes.
- Read-only Plaza discussion routes must not create or update
  `communication_rooms`.
- Arbitrary room chat must not be routed through `circle_discussion_messages`.

## AI And Knowledge Guardrails

AI summary, draft generation, proof handoff, and crystallization remain
review-gated Plaza capabilities. They are not automatic room-chat side effects.

Outside first-party circle Plaza, do not enable these by default:

- AI summary
- draft generation
- transcript-to-draft
- automatic crystallization
- governance execution

Voice transcript and recap behavior stays opt-in. Real-time voice audio is not
stored in query-api.

## Future Message-Unification Gate

Do not move Plaza text from `circle_discussion_messages` into
`communication_messages` until all gates below are satisfied:

```text
Before Plaza text can move from circle_discussion_messages to communication_messages:
  - discussion AI analysis can read CommunicationMessage envelopes.
  - draft candidate notices can be represented without losing source links.
  - manual create-draft route can resolve source message ids from the new table.
  - draft proof package can anchor source evidence from the new message table.
  - frontend Plaza UI has regression tests for discussion, draft notice, create draft, and crystallization handoff.
  - backfill strategy exists for old local/dev rows if needed.
  - rollback strategy exists.
```

Any future unification must be a separate migration plan with its own regression
suite. It is not part of the circle-room voice and capability-carrier pass.

## Developer Rule

When adding new room features, first decide whether the behavior belongs to:

```text
CommunicationRoom:
  general runtime/session/message/voice policy behavior

Plaza capability:
  first-party circle discussion, AI summary, draft, proof, crystallization, governance
```

If the behavior depends on Plaza discussion semantics, do not implement it as a
generic Room default.
