import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const frontendRoot = new URL('..', import.meta.url).pathname;
const srcRoot = join(frontendRoot, 'src');
const allowedDirectFetchFiles = new Set([
  'src/lib/api/fetch.ts',
  'src/lib/api/graphqlClient.ts',
]);
const allowedDirectEventSourceFiles = new Set([
  'src/lib/api/ghostDrafts.ts',
  'src/lib/discussion/realtime.ts',
]);
const allowedApiFetchImportFiles = new Set([
  'src/app/providers.tsx',
  'src/lib/http/apiFetch.ts',
]);

function listSourceFiles(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listSourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

test('frontend production code uses shared API fetch helpers instead of direct fetch', () => {
  const offenders = [];
  for (const file of listSourceFiles(srcRoot)) {
    const rel = relative(frontendRoot, file);
    if (allowedDirectFetchFiles.has(rel)) continue;

    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (/\bfetch\s*\(/.test(line)) {
        offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(offenders, []);
});

test('frontend API transport helper is only used inside the API layer', () => {
  const offenders = [];
  for (const file of listSourceFiles(srcRoot)) {
    const rel = relative(frontendRoot, file);
    if (rel.startsWith('src/lib/api/')) continue;
    if (allowedApiFetchImportFiles.has(rel)) continue;

    const source = readFileSync(file, 'utf8');
    if (source.includes('@/lib/api/fetch') || source.includes('@/lib/http/apiFetch')) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(offenders, []);
});

test('frontend service streams are opened through API or realtime clients', () => {
  const offenders = [];
  for (const file of listSourceFiles(srcRoot)) {
    const rel = relative(frontendRoot, file);
    if (allowedDirectEventSourceFiles.has(rel)) continue;

    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (/new\s+EventSource\s*\(/.test(line)) {
        offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(offenders, []);
});
