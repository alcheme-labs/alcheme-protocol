import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const sdkDir = path.join(repoRoot, 'sdk');
const distIdlPath = path.join(sdkDir, 'dist/idl/registry_factory.json');
const sdkPackageJsonPath = path.join(sdkDir, 'package.json');
const sdkNpmrcPath = path.join(sdkDir, '.npmrc');

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('sdk package defaults to a devnet prerelease publication channel', () => {
  const pkg = JSON.parse(fs.readFileSync(sdkPackageJsonPath, 'utf8'));

  assert.match(
    pkg.version,
    /^\d+\.\d+\.\d+-devnet\.\d+$/,
    'expected SDK version to use a devnet prerelease suffix'
  );
  assert.equal(
    pkg.publishConfig?.tag,
    'devnet',
    'expected SDK publishConfig.tag to default to devnet'
  );
  assert.match(
    fs.readFileSync(sdkNpmrcPath, 'utf8'),
    /^tag=devnet$/m,
    'expected SDK .npmrc to pin npm CLI publishes to the devnet tag'
  );
});

test('clean sdk build recreates packaged idl assets', () => {
  fs.rmSync(path.join(sdkDir, 'dist'), { recursive: true, force: true });
  run('npm', ['run', 'build'], sdkDir);

  assert.equal(
    fs.existsSync(distIdlPath),
    true,
    'expected sdk build to recreate dist/idl/registry_factory.json'
  );
});

test('packed sdk tarball is runtime-focused and installable by an external consumer', () => {
  fs.rmSync(path.join(sdkDir, 'dist'), { recursive: true, force: true });

  const packOutput = JSON.parse(run('npm', ['pack', '--json'], sdkDir));
  const tarballName = packOutput[0]?.filename;
  assert.equal(typeof tarballName, 'string');

  const tarballPath = path.join(sdkDir, tarballName);
  const tarContents = run('tar', ['-tzf', tarballPath], sdkDir);

  assert.match(tarContents, /package\/dist\/index\.js/);
  assert.match(tarContents, /package\/dist\/idl\/registry_factory\.json/);
  assert.doesNotMatch(tarContents, /package\/src\//);
  assert.doesNotMatch(tarContents, /package\/tests\//);

  const consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcheme-sdk-consumer-'));
  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'alcheme-sdk-consumer-smoke',
        private: true,
      },
      null,
      2
    )
  );

  try {
    run('npm', ['install', tarballPath], consumerDir);
    const smoke = run(
      'node',
      [
        '-e',
        [
          "const sdk = require('@alcheme/sdk');",
          "const idl = require('@alcheme/sdk/idl/registry_factory.json');",
          "if (typeof sdk.Alcheme !== 'function') throw new Error('missing Alcheme export');",
          "if (!idl.address) throw new Error('missing registry_factory idl address');",
          "process.stdout.write('ok');",
        ].join(' '),
      ],
      consumerDir
    );

    assert.equal(smoke, 'ok');
  } finally {
    fs.rmSync(consumerDir, { recursive: true, force: true });
    fs.rmSync(tarballPath, { force: true });
  }
});
