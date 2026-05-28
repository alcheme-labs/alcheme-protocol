# Alcheme Protocol Public Baseline

Alcheme is an open-core Solana-native social and knowledge protocol. This public
baseline is the protocol and integration surface intended for external review,
auditing, and early ecosystem integration.

This is not the full internal product runtime. The Alcheme team maintains a
private source tree with stronger runtime services, operational tooling,
production signing infrastructure, prompts, evals, anti-abuse policy, and
first-party product surfaces.

## What You Can Understand Here

This baseline is enough to inspect the protocol shape:

- how Alcheme models identity, circles, content, access, messaging, external
  applications, and extension registries on Solana
- how external programs and clients can build against the public TypeScript SDK
- how extension manifests describe program identity, permissions, events,
  parser contracts, and compatibility requirements
- where an Alcheme-compatible managed runtime fits without exposing the
  first-party runtime implementation

For the high-level system map, start with
[`docs/public-architecture-overview.md`](./docs/public-architecture-overview.md)
and the static map at
[`docs/public-architecture-map.html`](./docs/public-architecture-map.html).

## Included

- Solana / Anchor programs under `programs/`
- Shared protocol types under `shared/`
- CPI permission and helper interfaces under `cpi-interfaces/`
- TypeScript SDK source under `sdk/`
- Public extension manifest and contribution-engine program surface
- Public schemas and integration quickstarts under `docs/`
- Minimal examples and public integration packages

## Not Included

- First-party `query-api` managed runtime
- First-party web/mobile product surfaces
- Production indexer/query deployments and runbooks
- Signing sidecars, key-management topology, and operator scripts
- Internal prompts, eval fixtures, anti-abuse policy, and rate-limit strategy
- Private roadmap, funding, grant, incident, and security operations notes

## Development Model

The public baseline is generated from the private development repository using
an allowlist, not by deleting paths in-place. External contributions should
target the public baseline surface; the Alcheme team can merge suitable changes
back into the private development tree.

## Suggested Reading Path

1. Read [`docs/public-architecture-overview.md`](./docs/public-architecture-overview.md)
   and open [`docs/public-architecture-map.html`](./docs/public-architecture-map.html).
2. Inspect [`programs/README.md`](./programs/README.md) and the individual
   program directories.
3. Inspect [`sdk/README.md`](./sdk/README.md) and `sdk/src/`.
4. Try the public integration material under `docs/integration/` and
   `examples/`.

## License

Protocol and integration components in this baseline are licensed under
Apache-2.0 unless a file states otherwise. See `LICENSE`, `LICENSING.md`, and
`licenses/APACHE-2.0.txt`.
