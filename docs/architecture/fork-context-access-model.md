# Fork Context Access Model

Date: 2026-05-12

## Status

This is a product and architecture constraint record. It defines the rules that
future implementation plans must follow. It does not claim that fork context
capsules, upstream reference expansion, or source-gate evaluators are already
implemented.

## Decision

Forked circles do not inherit upstream assets, upstream membership, or upstream
private content.

A forked circle carries a controlled context record that explains where it came
from, what upstream material may be cited, and which original source gates still
apply.

In short:

```text
Fork does not inherit ownership.
Fork does not inherit access.
Fork does not inherit private content.
Fork carries provenance, selected context, and citation capability.
```

## Current Code Boundary

Circle hierarchy and fork lineage are separate concepts.

Hierarchy is represented by `Circle.parentCircleId` and `childCircles`. Fork
lineage is represented by `CircleForkLineage(sourceCircleId, targetCircleId)`.
A forked circle is an independent circle with a lineage link, not a child node
that shares the source circle's descendants.

Current fork inheritance snapshots preserve configuration and lineage context.
They do not make the fork target a structural child of the source circle and do
not grant access to the source circle's full content.

## Product Model

When circle `B` forks from `A3` in a path like:

```text
A1 -> A2 -> A3
```

`B` should be understood as:

```text
B is an independent path forked from A3.
B can carry a proof-backed context capsule from A1 -> A2 -> A3.
B does not own A1/A2/A3 assets.
B does not receive A1/A2/A3 permissions.
B must respect the original gates of upstream references.
```

The product language should prefer:

```text
Fork Context
Origin Snapshot
Upstream Reference
Derived Knowledge
Citation Credit
```

Avoid product or code language that implies:

```text
asset inheritance
permission inheritance
subtree sharing
private content cloning
```

## Three Separate Domains

### Assets

Assets are durable ownership and contribution records:

- Crystal assets
- Crystal receipts
- Crystal entitlements
- proof packages
- contributor roots
- future revenue or attribution accounting

Assets stay with their original circle and original contributors. A fork may
cite or derive from upstream assets, but it must not copy them into the fork
target as owned fork assets.

If a forked circle later creates new knowledge, that new knowledge belongs to
the forked circle. Upstream sources remain citations or derived-from references.

### Access

Access decides who can view or expand upstream material.

Joining fork target `B` must not grant access to upstream source circles. A
public `B` does not make gated `A2` or private `A3` material public.

When a user expands an upstream reference inside `B`, the system must evaluate
the original source gate for that upstream source.

### Context

Context explains why the fork exists and what source material it can cite.
Context may be carried into the fork target as a controlled, proof-backed
capsule.

Context is not the same as raw source content. It should contain references,
summaries, anchors, hashes, and policy labels before it contains full text.

## Fork Context Capsule

Every completed fork should eventually have a `ForkContextCapsule`. The capsule
is the fork target's origin record, not a content migration.

Recommended contents:

```text
sourcePath:
  ordered source circles, for example A1 -> A2 -> A3

forkOrigin:
  source circle where the fork was created, for example A3

forkDeclaration:
  user's explanation of why the fork exists

createdAtCutoff:
  fork creation time; later upstream content does not flow into B automatically

publicUpstreamRefs:
  references that can be fully shown according to source rules

gatedUpstreamRefs:
  references that exist in the capsule but require source-gate checks to expand

sealedUpstreamRefs:
  references represented only by proof/hash/source metadata

originSnapshot:
  controlled summary of the fork origin, key source anchors, and fork reason
```

The capsule should be immutable enough to explain the fork origin, while later
manual citations from `B` can point to newer upstream material through explicit
references.

## Source Gate Matrix

The upstream source circle's access model controls what can be carried and
shown.

| Source circle gate | Fork allowed by default | What B can carry | What B users can expand |
| --- | --- | --- | --- |
| Open/free | Yes | Public upstream references and summaries | Full content if source material itself is public |
| Crystal-gated | Yes, if fork policy allows | Gated references, hashes, summaries, and selected anchors | Full content only if the viewer satisfies the original source gate |
| Invite-only/private | No by default | Nothing, or sealed references only after explicit approval | Nothing by default; expansion requires original source permission |

The crystal-gated rule is especially important:

```text
If A2 requires enough A1 crystals to enter,
then a user in B must still satisfy that A2 source gate
before expanding A2-origin material.
```

The fork target's own access policy is not enough to expand upstream material.

## A1/A2/A3 Handling

For a fork from `A3`, treat the source path conservatively:

```text
A1/A2:
  May contribute public or source-gated crystallized knowledge references.
  Gated source content still requires the original gate to expand.

A3:
  Is the fork origin.
  Should contribute an origin snapshot, declaration context, key anchors, and
  selected references.
  Must not expose full discussions, member space, or private history by default.

B:
  Owns its local discussions, drafts, and future knowledge.
  Can cite fork context and upstream references.
  Does not own or unlock upstream assets.
```

## Visibility States In The Fork Target

When `B` displays upstream material, it should show a state label instead of
pretending every source is local content.

```text
Public source:
  Full content can be shown in B.

Source-gated:
  B can show title, source circle, summary, hash, and citation metadata.
  Full expansion requires the viewer to satisfy the original source gate.

Sealed source:
  B can show that a proof-backed upstream source exists.
  Content text is not shown in B by default.
```

This keeps `B` useful without turning `B` into a backdoor for upstream content.

## AI And Draft Guardrails

AI and draft generation must not bypass source gates.

Default AI context for `B` may include:

- `B` local discussion and knowledge
- public upstream references
- safe origin snapshot summaries
- hashes, proof anchors, and citation metadata

Default AI context must not include:

- private upstream discussion text
- source-gated full text unless the acting user has source access and explicitly
  opts in
- invite-only source content
- post-fork upstream content unless explicitly cited later

If a draft or output uses source-gated upstream material, the draft should carry
a restriction marker such as:

```text
contains_source_gated_upstream
```

Before crystallization or public publishing, the system must verify that the
output does not leak restricted upstream content into a broader audience than
the original source allowed.

## Invite-Only Rule

Invite-only/private source circles are trust spaces, not public progression
gates.

Default rule:

```text
Invite-only/private circles cannot be forked into public paths.
```

Allowed exceptions require explicit source-side approval, such as:

- source circle manager approval
- source governance approval
- a one-time fork allowance recorded in policy

Even with approval, the default exported form should be sealed or summarized
context, not raw content.

## Crystal-Gated Rule

Crystal-gated circles can be fork sources, but the original source gate follows
their upstream references.

Example:

```text
A1 is open.
A2 requires N A1 crystals.
A3 forks into public B.
```

In this case:

```text
B may show that A2 contributed upstream context.
B may show safe summaries or proof metadata from A2.
B users can expand A2-origin material only if they satisfy A2's original gate.
B membership alone is not enough.
```

This preserves the meaning of progression-based access while still allowing fork
lineage and citations to remain visible.

## Non-Goals

This document does not authorize:

- copying upstream assets into the fork target
- granting upstream membership to fork members
- making private or invite-only source circles discoverable by default
- feeding source-gated text into AI by default
- migrating fork source content into the fork target's local knowledge table
- making fork lineage equivalent to hierarchy inheritance
- auto-syncing post-fork upstream content into the fork target

## Implementation Principles

Future implementation should prefer additive structures over changing hierarchy
semantics.

Likely implementation direction:

```text
CircleForkLineage:
  remains the source -> target relationship

ForkContextCapsule:
  records source path, cutoff, declaration, source refs, gate labels, and
  origin snapshot

ForkUpstreamReference:
  optional future normalized table for queryable references if JSON metadata
  becomes insufficient

Access evaluator:
  evaluates source gates at view/expand time

Draft/AI context builder:
  reads only permitted context classes for the acting user and target audience
```

Do not implement this by setting `parentCircleId` on the fork target unless the
product explicitly wants the fork to become a hierarchy child. That would change
the meaning of fork.

## Acceptance Rules For Future Plans

Any future implementation plan for fork context must prove:

- `B` cannot read private `A3` content merely because it forked from `A3`.
- Public `B` does not make crystal-gated `A2` content public.
- Invite-only/private sources are not forkable by default.
- Source-gated references are visible as metadata only until the viewer passes
  the original source gate.
- AI context excludes restricted upstream text by default.
- Crystallization or publishing cannot leak restricted upstream text into a
  broader audience.
- Asset ownership and entitlements remain attached to original knowledge and
  original contributors.

## Summary Rule

The durable product rule is:

```text
Fork creates an independent path.
Upstream gates remain in force.
Context can travel.
Assets and permissions do not.
```
