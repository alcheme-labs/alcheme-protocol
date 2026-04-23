export function parseXcodeMajor(versionText) {
  const match = /Xcode\s+(\d+)/i.exec(versionText ?? '');

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

export function needsLegacyXcodeCompatibility(versionText) {
  const major = parseXcodeMajor(versionText);

  return Number.isInteger(major) && major < 15;
}

export function patchPbxprojForLegacyXcode(contents) {
  return contents.replace(/\bobjectVersion = 60;/g, 'objectVersion = 56;');
}

export function patchCapAppSwiftPackageForLegacyXcode(contents) {
  return contents.replace(
    /^\/\/ swift-tools-version:\s*5\.9$/m,
    '// swift-tools-version: 5.8',
  );
}
