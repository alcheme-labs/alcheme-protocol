# Security Policy

## Supported Scope

Security fixes are prioritized for:

- the current `main` branch
- the latest tagged release, once public releases begin

Older snapshots and local development-only scripts may not receive coordinated fixes.

## How to Report a Vulnerability

Please do **not** open a public GitHub issue for vulnerabilities involving secrets, auth bypass, signing flows, private content exposure, or infrastructure access.

Instead:

1. Use GitHub private vulnerability reporting on the public repository.
2. Do not announce the public repository until GitHub private vulnerability reporting is enabled there.
3. If the private reporting form is temporarily unavailable, do not disclose the details publicly; ask a maintainer to restore the private reporting path before sharing technical details.
4. Include reproduction steps, affected paths, impact, and any proof-of-concept details needed to validate the report.

## What to Include

- affected component or package
- exact commit or release if known
- reproduction steps
- expected impact
- whether the issue requires credential rotation or history cleanup

## Response Expectations

The project does not currently publish a formal SLA, but maintainers will triage reports as quickly as practical. Verified high-impact reports are prioritized over feature work.
