import test from 'node:test';
import assert from 'node:assert/strict';

import {
  needsLegacyXcodeCompatibility,
  patchCapAppSwiftPackageForLegacyXcode,
  patchPbxprojForLegacyXcode,
} from '../config/xcodeCompat.mjs';

test('detects that Xcode 14 needs legacy project compatibility patches', () => {
  assert.equal(
    needsLegacyXcodeCompatibility('Xcode 14.3\nBuild version 14E222b\n'),
    true,
  );
  assert.equal(
    needsLegacyXcodeCompatibility('Xcode 15.4\nBuild version 15F31d\n'),
    false,
  );
});

test('downgrades the pbxproj object version for older Xcode', () => {
  const input = `// !$*UTF8*$!\n{\n\tobjectVersion = 60;\n}\n`;
  const output = patchPbxprojForLegacyXcode(input);

  assert.match(output, /objectVersion = 56;/);
  assert.doesNotMatch(output, /objectVersion = 60;/);
});

test('downgrades the local CapApp package tools version for older Xcode', () => {
  const input = `// swift-tools-version: 5.9\nimport PackageDescription\n`;
  const output = patchCapAppSwiftPackageForLegacyXcode(input);

  assert.match(output, /swift-tools-version: 5.8/);
  assert.doesNotMatch(output, /swift-tools-version: 5.9/);
});
