#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const POLICY_PATH = 'config/license-audit-policy.json';
const LOCKFILES = [
  { scope: 'root', path: 'package-lock.json' },
  { scope: 'frontend', path: 'frontend/package-lock.json' },
  { scope: 'sdk', path: 'sdk/package-lock.json' },
  { scope: 'query-api', path: 'services/query-api/package-lock.json' },
  { scope: 'contribution-tracker', path: 'extensions/contribution-engine/tracker/package-lock.json' },
];

const STRONG_COPYLEFT = /\b(?:AGPL|GPL-(?:2|3)\.0-(?:only|or-later))\b/i;
const WATCHLIST = /\b(?:LGPL|MPL-2\.0)\b/i;

function parseArgs(argv) {
  const args = {
    json: null,
    failOnStrong: false,
    failOnUnapprovedWatchlist: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === '--fail-on-strong') {
      args.failOnStrong = true;
      continue;
    }
    if (arg === '--fail-on-unapproved-watchlist') {
      args.failOnUnapprovedWatchlist = true;
    }
  }

  return args;
}

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function loadPolicy() {
  return (
    readJson(POLICY_PATH) ?? {
      version: 1,
      defaultPolicy: {
        strongCopyleft: 'forbid',
        watchlist: 'review',
      },
      approvedWatchlistRules: [],
    }
  );
}

function classify(license) {
  if (!license) return null;
  if (STRONG_COPYLEFT.test(license)) return 'strong-copyleft';
  if (WATCHLIST.test(license)) return 'watchlist';
  return null;
}

function matchesPattern(value, pattern) {
  if (!pattern) return true;
  return new RegExp(pattern).test(value);
}

function findApproval(finding, policy) {
  if (finding.severity !== 'watchlist') return null;
  const rules = policy.approvedWatchlistRules ?? [];

  return (
    rules.find(
      (rule) =>
        matchesPattern(finding.scope, rule.scopePattern ?? rule.scope) &&
        matchesPattern(finding.packageName, rule.packagePattern ?? rule.packageName) &&
        matchesPattern(finding.license, rule.licensePattern ?? rule.license)
    ) ?? null
  );
}

function collectFindings(policy) {
  const findings = [];

  for (const lockfile of LOCKFILES) {
    const data = readJson(lockfile.path);
    if (!data?.packages) continue;

    for (const [packagePath, meta] of Object.entries(data.packages)) {
      if (!meta?.license) continue;
      const severity = classify(meta.license);
      if (!severity) continue;

      const finding = {
        scope: lockfile.scope,
        lockfile: lockfile.path,
        packagePath: packagePath || '.',
        packageName:
          packagePath === ''
            ? data.name || lockfile.scope
            : packagePath.replace(/^node_modules\//, ''),
        version: meta.version || '(unknown)',
        license: meta.license,
        dev: meta.dev === true,
        severity,
      };

      const approval = findApproval(finding, policy);
      if (approval) {
        finding.approval = {
          status: 'approved',
          reason: approval.reason,
        };
      } else if (severity === 'watchlist') {
        finding.approval = {
          status: 'unapproved',
        };
      }

      findings.push(finding);
    }
  }

  findings.sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity.localeCompare(right.severity);
    }
    if ((left.approval?.status ?? '') !== (right.approval?.status ?? '')) {
      return (left.approval?.status ?? '').localeCompare(right.approval?.status ?? '');
    }
    if (left.scope !== right.scope) {
      return left.scope.localeCompare(right.scope);
    }
    return left.packageName.localeCompare(right.packageName);
  });

  return findings;
}

function summarize(findings) {
  const strong = findings.filter((finding) => finding.severity === 'strong-copyleft');
  const watchlist = findings.filter((finding) => finding.severity === 'watchlist');
  const approvedWatchlist = watchlist.filter((finding) => finding.approval?.status === 'approved');
  const unapprovedWatchlist = watchlist.filter((finding) => finding.approval?.status !== 'approved');

  return {
    strongCopyleft: strong.length,
    watchlist: watchlist.length,
    approvedWatchlist: approvedWatchlist.length,
    unapprovedWatchlist: unapprovedWatchlist.length,
  };
}

function writeJson(reportPath, payload) {
  if (!reportPath) return;
  const fullPath = path.isAbsolute(reportPath) ? reportPath : path.join(ROOT, reportPath);
  fs.writeFileSync(fullPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function printSummary(findings, summary, policy) {
  console.log('Node License Risk Audit');
  console.log('');
  console.log(`Policy file: ${POLICY_PATH}`);
  console.log(`Strong copyleft findings: ${summary.strongCopyleft}`);
  console.log(`Watchlist findings: ${summary.watchlist}`);
  console.log(`Approved watchlist findings: ${summary.approvedWatchlist}`);
  console.log(`Unapproved watchlist findings: ${summary.unapprovedWatchlist}`);
  console.log('');

  if (!findings.length) {
    console.log('No AGPL/GPL/LGPL/MPL findings detected in tracked package-lock files.');
    return;
  }

  if ((policy.approvedWatchlistRules ?? []).length) {
    console.log('Approved watchlist policy is active for the initial public release.');
    console.log('');
  }

  for (const finding of findings) {
    const devMarker = finding.dev ? 'dev' : 'runtime';
    const approvalMarker =
      finding.approval?.status === 'approved'
        ? ` approved: ${finding.approval.reason}`
        : finding.approval?.status === 'unapproved'
          ? ' unapproved'
          : '';

    console.log(
      `[${finding.severity}] ${finding.scope} ${finding.packageName}@${finding.version} (${finding.license}; ${devMarker})${approvalMarker}`
    );
  }
}

const args = parseArgs(process.argv.slice(2));
const policy = loadPolicy();
const findings = collectFindings(policy);
const summary = summarize(findings);

const payload = {
  generatedAt: new Date().toISOString(),
  policyPath: POLICY_PATH,
  policy,
  findings,
  summary,
};

printSummary(findings, summary, policy);
writeJson(args.json, payload);

if (args.failOnStrong && summary.strongCopyleft > 0) {
  process.exitCode = 1;
}

if (args.failOnUnapprovedWatchlist && summary.unapprovedWatchlist > 0) {
  process.exitCode = 1;
}
