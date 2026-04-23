import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const LOCALES = ['en', 'zh', 'es', 'fr'];

function getByPath(object, dottedPath) {
  return dottedPath.split('.').reduce((current, segment) => (
    current && typeof current === 'object' ? current[segment] : undefined
  ), object);
}

function listI18nFiles() {
  const output = execFileSync(
    'rg',
    ['--pcre2', '-l', 'useI18n\\((["\']).+?\\1\\)', 'src'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    }
  );

  return output.trim().split(/\n+/).filter(Boolean);
}

function collectNamespaceKeyPairs(filePath) {
  const source = readFileSync(path.join(ROOT, filePath), 'utf8');
  const translators = [...source.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*useI18n\((['"])([^'"]+)\2\)/g
  )].map((match) => ({
    variable: match[1],
    namespace: match[3],
  }));

  if (translators.length === 0) return [];

  const pairs = [];

  for (const translator of translators) {
    const callPattern = new RegExp(
      `\\b${translator.variable}\\((['"])([^'"\\\`$]+)\\1`,
      'g'
    );
    const keyMatches = [...source.matchAll(callPattern)]
      .map((match) => match[2])
      .filter((key) => !key.includes('${') && !key.startsWith('/'));

    for (const key of keyMatches) {
      pairs.push({
        namespace: translator.namespace,
        key,
      });
    }
  }

  return pairs;
}

test('all literal i18n keys used by frontend components exist in every locale file', () => {
  const files = listI18nFiles();
  const pairs = files.flatMap(collectNamespaceKeyPairs);
  const uniquePairs = [...new Map(
    pairs.map((pair) => [`${pair.namespace}:${pair.key}`, pair])
  ).values()];

  const missing = [];

  for (const locale of LOCALES) {
    const messages = JSON.parse(
      readFileSync(path.join(ROOT, `src/i18n/messages/${locale}.json`), 'utf8')
    );

    for (const pair of uniquePairs) {
      const value = getByPath(messages, `${pair.namespace}.${pair.key}`);
      if (value === undefined) {
        missing.push(`${locale}: ${pair.namespace}.${pair.key}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});
