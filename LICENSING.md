# Alcheme Public Archive Licensing

This archive contains components under two licenses. The root `LICENSE` is the
Apache License 2.0; BUSL-covered directories are identified below and governed
by `licenses/BUSL-1.1.txt`.

## License Precedence

When license notices disagree, use this order:

1. A file-level SPDX or license header.
2. A package manifest or crate manifest in the nearest package root.
3. The directory map in this document.
4. The repository default in this document.

Earlier published versions remain available under the license stated for those
versions. This map applies to this archived snapshot.

## Apache-2.0 Components

The following components are licensed under Apache-2.0 unless a file states
otherwise:

- `programs/`
- `shared/`
- `cpi-interfaces/`
- `services/indexer-core/`
- `sdk/`
- `packages/game-chat-react/`
- `examples/`
- `extensions/contribution-engine/program/`
- `extensions/contribution-engine/extension.manifest.json`
- `docs/schemas/` and the public integration/architecture documentation
- protocol, SDK, indexer, manifest, and package compatibility tests

Full text: `LICENSE` and `licenses/APACHE-2.0.txt`.

## BUSL-1.1 Components

The following published source is licensed under BUSL-1.1 unless a file states
otherwise:

- `services/query-api/`
- `frontend/`

For these components:

- Licensor: 杭州星原驱动科技有限公司
- Licensed Work: Alcheme Managed Runtime and First-Party Product Surfaces
- First BUSL boundary date: 2026-05-27
- Change Date: 2030-05-27
- Change License: Apache License, Version 2.0

The Additional Use Grant permits limited production use for private internal
deployments, non-public demos and pilots that are not used to raise funding for
or validate a competing product, security research, and integrations with
official Alcheme deployments or Apache-2.0 Alcheme protocol components. It does
not create production-use rights for fundraising demos, public previews,
market validation, a competing hosted managed runtime, public node service,
first-party product clone, or substantially similar commercial service without
a separate commercial license from the Licensor.

Full text and parameters: `licenses/BUSL-1.1.txt`.

## Trademark And Official Network Boundary

This archive does not grant rights to the Alcheme name, logos, domains,
official deployments, governance authorities, program IDs, validator/node
identities, or other brand and network identifiers. Forks should use a distinct
name and make their independent status clear.
