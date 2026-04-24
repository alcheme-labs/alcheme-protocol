import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(filePath), '..', '..');

const SOURCE_ROOTS = [
  path.join(repoRoot, 'programs'),
  path.join(repoRoot, 'shared'),
  path.join(repoRoot, 'extensions', 'contribution-engine', 'program'),
];

const HAN_PATTERN = /[\p{Script=Han}]/u;

function walkRustFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'target') continue;
      walkRustFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      files.push(fullPath);
    }
  }
  return files;
}

function preserveNewlines(text) {
  return text.replace(/[^\n]/g, ' ');
}

function stripCfgTestModules(source) {
  let result = source;
  let searchFrom = 0;

  while (true) {
    const attrIndex = result.indexOf('#[cfg(test)]', searchFrom);
    if (attrIndex === -1) break;

    const modIndex = result.indexOf('mod tests', attrIndex);
    const braceStart = result.indexOf('{', modIndex);
    if (modIndex === -1 || braceStart === -1) {
      searchFrom = attrIndex + 1;
      continue;
    }

    let depth = 0;
    let end = braceStart;
    for (; end < result.length; end += 1) {
      if (result[end] === '{') depth += 1;
      if (result[end] === '}') {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }

    result = result.slice(0, attrIndex) + preserveNewlines(result.slice(attrIndex, end)) + result.slice(end);
    searchFrom = end;
  }

  return result;
}

function parseNormalString(source, start) {
  let content = '';
  let index = start + 1;

  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      content += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === '"') {
      return { content, end: index + 1 };
    }
    content += char;
    index += 1;
  }

  return { content, end: source.length };
}

function parseRawString(source, start) {
  let index = source[start] === 'b' ? start + 2 : start + 1;
  let hashes = '';

  while (source[index] === '#') {
    hashes += '#';
    index += 1;
  }

  if (source[index] !== '"') return null;

  const contentStart = index + 1;
  const terminator = `"${hashes}`;
  const endQuote = source.indexOf(terminator, contentStart);
  if (endQuote === -1) {
    return { content: source.slice(contentStart), end: source.length };
  }

  return {
    content: source.slice(contentStart, endQuote),
    end: endQuote + terminator.length,
  };
}

function findChineseStringLiterals(source) {
  const findings = [];
  let index = 0;

  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const lineEnd = source.indexOf('\n', index);
      index = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }

    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }

    let parsed = null;
    if (source[index] === 'r' && (source[index + 1] === '"' || source[index + 1] === '#')) {
      parsed = parseRawString(source, index);
    } else if (
      source[index] === 'b' &&
      source[index + 1] === 'r' &&
      (source[index + 2] === '"' || source[index + 2] === '#')
    ) {
      parsed = parseRawString(source, index);
    } else if (source[index] === '"') {
      parsed = parseNormalString(source, index);
    } else if (source[index] === 'b' && source[index + 1] === '"') {
      parsed = parseNormalString(source, index + 1);
    }

    if (parsed) {
      if (HAN_PATTERN.test(parsed.content)) {
        const line = source.slice(0, index).split('\n').length;
        findings.push({ line, content: parsed.content });
      }
      index = parsed.end;
      continue;
    }

    index += 1;
  }

  return findings;
}

test('on-chain runtime messages use English literals', () => {
  const findings = [];
  const files = SOURCE_ROOTS.flatMap((root) => walkRustFiles(root));

  for (const file of files) {
    const source = stripCfgTestModules(fs.readFileSync(file, 'utf8'));
    for (const finding of findChineseStringLiterals(source)) {
      findings.push(`${path.relative(repoRoot, file)}:${finding.line} Rust string literal: ${finding.content}`);
    }
  }

  assert.deepEqual(findings, []);
});
