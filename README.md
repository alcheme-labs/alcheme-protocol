# Alcheme Protocol (Archived)

> [!IMPORTANT]
> This project is no longer maintained. The repository is preserved as a
> historical source snapshot; the code may not build or run, and no support,
> security updates, or future releases are planned.

Alcheme was an exploration of a Solana-native social, knowledge, and governance
protocol.

During development, I came to believe that the blockchain and community layers,
as they were framed in this project, did not address a sufficiently clear,
real, and urgent need. At the same time, the codebase kept growing in complexity
without arriving at a distinctive and focused core. For those reasons, I have
ended active development.

The exploration was not wasted. I carry forward many of the ideas developed
here, and the process connected them into new questions, directions, and ways
of thinking. I am publishing this curated source archive to preserve an honest
record of what was built, not to present Alcheme as a maintained product or to
promise continued support.

本项目现已停止维护。在持续开发与验证的过程中，我逐渐意识到：以本项目当时的形态来看，
区块链与社区并没有对应到足够明确、真实且迫切的需求；与此同时，项目规模不断扩大，
复杂度持续上升，却始终没有形成足够鲜明、聚焦的核心。因此，我决定停止继续维护。

不过，这段探索并非没有价值。我从中继承并沉淀了许多重要思想，也在实践中把它们串联起来，
延伸出了新的问题、新的方向与新的思考。现在将经过筛选的核心代码作为历史存档公开，
是为了诚实地保留这段实践的痕迹，证明这些工作曾经真实发生过；它不再代表一个持续维护的产品，
也不承诺后续支持。

Development logs and project recordings are available on the
[Alcheme Protocol YouTube channel](https://www.youtube.com/@alchemeprotocol).

## What Is Preserved Here

This archive includes selected source code that shows the main shape of the
project:

- Solana / Anchor programs under `programs/`
- shared protocol types and CPI interfaces under `shared/` and
  `cpi-interfaces/`
- the public TypeScript SDK under `sdk/`
- the contribution-engine extension and integration examples
- the chain event indexer under `services/indexer-core/src/`
- the first-party API, governance, discussion, knowledge, and runtime source
  under `services/query-api/src/`
- the first-party web product source under `frontend/src/`

The first-party source is included to document the work that existed. This is
not a complete release bundle and is not expected to be runnable from this
repository alone.

Some older public integration and architecture documents are retained as
historical context. They may describe the earlier, narrower public baseline and
should not be read as current maintenance or support commitments.

## Intentionally Not Published

This archive intentionally excludes:

- environment files, credentials, keys, signer material, and private endpoints
- deployment manifests, containers, infrastructure configuration, operator
  scripts, runbooks, backups, and incident or security operations material
- database migrations and live-data tooling
- the signing sidecar and mobile packaging shell
- internal prompts, evaluation fixtures, anti-abuse details, private plans,
  research notes, product Wiki, and founder or strategy documents
- first-party product test suites, generated builds, caches, logs, reports,
  screenshots, and test artifacts

## Suggested Reading Path

1. Inspect the on-chain programs in [`programs/`](./programs/).
2. Read the client surface in [`sdk/src/`](./sdk/src/).
3. Follow the product path through [`frontend/src/`](./frontend/src/) and
   [`services/query-api/src/`](./services/query-api/src/).
4. Inspect chain event projection in
   [`services/indexer-core/src/`](./services/indexer-core/src/).

## License

This archive uses a mixed-license model. Protocol, SDK, integration, and
indexer components are Apache-2.0. The first-party managed runtime and web
product source are BUSL-1.1 with the parameters recorded in `LICENSING.md`.
See [`LICENSING.md`](./LICENSING.md), [`LICENSE`](./LICENSE), and the texts under
[`licenses/`](./licenses/).
