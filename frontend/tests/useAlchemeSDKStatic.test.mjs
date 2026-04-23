import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hookSource = readFileSync(new URL('../src/hooks/useAlchemeSDK.ts', import.meta.url), 'utf8');

test('useAlchemeSDK only requires a single-transaction signer and synthesizes signAllTransactions fallback', () => {
  assert.match(hookSource, /if \(!wallet\.publicKey \|\| !wallet\.signTransaction\)/);
  assert.doesNotMatch(hookSource, /if \(!wallet\.publicKey \|\| !wallet\.signTransaction \|\| !wallet\.signAllTransactions\)/);
  assert.match(hookSource, /const signAllTransactions = wallet\.signAllTransactions/);
  assert.match(hookSource, /wallet\.signTransaction!\(transaction as any\)/);
});

test('useAlchemeSDK requires explicit frontend Program ID env instead of hardcoded fallbacks', () => {
  assert.doesNotMatch(hookSource, /NEXT_PUBLIC_IDENTITY_PROGRAM_ID\s*\|\|\s*['"]/);
  assert.doesNotMatch(hookSource, /NEXT_PUBLIC_CONTENT_PROGRAM_ID\s*\|\|\s*['"]/);
  assert.doesNotMatch(hookSource, /NEXT_PUBLIC_ACCESS_PROGRAM_ID\s*\|\|\s*['"]/);
  assert.doesNotMatch(hookSource, /NEXT_PUBLIC_EVENT_PROGRAM_ID\s*\|\|\s*['"]/);
  assert.doesNotMatch(hookSource, /NEXT_PUBLIC_FACTORY_PROGRAM_ID\s*\|\|\s*['"]/);
  assert.doesNotMatch(hookSource, /NEXT_PUBLIC_MESSAGING_PROGRAM_ID\s*\|\|\s*['"]/);
  assert.doesNotMatch(hookSource, /NEXT_PUBLIC_CIRCLES_PROGRAM_ID\s*\|\|\s*['"]/);
  assert.doesNotMatch(hookSource, /NEXT_PUBLIC_CONTRIBUTION_ENGINE_PROGRAM_ID\s*\|\|\s*['"]/);
  assert.match(hookSource, /throw new Error\(`Missing required frontend program ID env:/);
  assert.doesNotMatch(hookSource, /process\.env\[envName\]/);
  assert.match(hookSource, /process\.env\.NEXT_PUBLIC_IDENTITY_PROGRAM_ID/);
  assert.match(hookSource, /process\.env\.NEXT_PUBLIC_CONTENT_PROGRAM_ID/);
  assert.match(hookSource, /process\.env\.NEXT_PUBLIC_ACCESS_PROGRAM_ID/);
  assert.match(hookSource, /process\.env\.NEXT_PUBLIC_EVENT_PROGRAM_ID/);
  assert.match(hookSource, /process\.env\.NEXT_PUBLIC_FACTORY_PROGRAM_ID/);
  assert.match(hookSource, /process\.env\.NEXT_PUBLIC_MESSAGING_PROGRAM_ID/);
  assert.match(hookSource, /process\.env\.NEXT_PUBLIC_CIRCLES_PROGRAM_ID/);
  assert.match(hookSource, /process\.env\.NEXT_PUBLIC_CONTRIBUTION_ENGINE_PROGRAM_ID/);
});
