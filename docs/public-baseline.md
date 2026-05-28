# Public Baseline Export Policy

The public repository is a generated baseline, not the full private development
tree.

The export uses `config/public-baseline-allowlist.txt`. Paths absent from that
allowlist are not copied into the public snapshot. Public-only overlays under
`config/public-baseline/` replace root metadata such as `LICENSE`,
`CONTRIBUTING.md`, `package.json`, `tsconfig.json`, and public-safe
documentation so the exported repository does not point contributors at private
runtime paths. When a document needs different public and private wording, keep
the private-tree document at its normal path and put the public version under
`config/public-baseline/` with the destination path. This keeps the public
surface stable and avoids editing or deleting private-source files just to
prepare a release.

## Public Baseline

- Protocol programs
- Shared protocol types
- CPI interfaces
- SDK source and tests
- Public architecture overview
- Public static architecture map
- Public schemas and integration docs
- Minimal examples and public integration packages
- Public contribution-engine program surface

## Private/Internal

- First-party managed runtime
- Frontend and mobile product surfaces
- Signing sidecars and production key-management topology
- Internal prompts, evals, anti-abuse rules, and rate-limit strategy
- Runbooks, deployment scripts, incident notes, funding materials, and roadmap
  documents

## GitHub Publication

If a broader repository has already been public, making later deletion commits
does not remove those files from Git history. For a clean public baseline, make
the broad repository private first, then publish a fresh public repository from
the allowlisted export.
