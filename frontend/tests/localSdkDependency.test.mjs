import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const dockerfileSource = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('frontend pins @alcheme/sdk to the local workspace package', () => {
  const pkg = JSON.parse(packageSource);

  assert.equal(pkg.dependencies['@alcheme/sdk'], 'file:../sdk');
});

test('frontend docker build compiles sdk before installing frontend dependencies', () => {
  assert.match(dockerfileSource, /WORKDIR \/app\/sdk/);
  assert.match(dockerfileSource, /COPY sdk\/package\*\.json \.\//);
  assert.match(dockerfileSource, /RUN npm ci/);
  assert.match(dockerfileSource, /COPY sdk \.\//);
  assert.match(dockerfileSource, /RUN npm run build/);

  const sdkBuildIndex = dockerfileSource.indexOf('WORKDIR /app/sdk');
  const frontendInstallIndex = dockerfileSource.indexOf('WORKDIR /app/frontend');
  assert.notEqual(sdkBuildIndex, -1);
  assert.notEqual(frontendInstallIndex, -1);
  assert.ok(sdkBuildIndex < frontendInstallIndex, 'sdk build should happen before frontend npm ci');
});
